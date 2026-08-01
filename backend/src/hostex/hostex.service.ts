import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createHash, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import {
  HostexDeliveryKind,
  HostexDeliveryStatus,
  HostexWebhookStatus,
  InviteStatus
} from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  HostexApiError,
  HostexClient,
  HostexUncertainSendError,
  type HostexReservation
} from "./hostex.client.js";
import { addDaysToDateOnly, deliveryDueAt, endOfCheckInDay, localDate } from "./hostex.time.js";

const DELIVERY_MESSAGE = (firstName: string, guestUrl: string) =>
  `Hi ${firstName}, please complete the guest registration form for your upcoming stay at Cozy Davao D-714 before arrival: ${guestUrl}\n\n` +
  "Please include every guest and upload a valid ID for each guest aged 16 or older. Thank you!";

const AUTOMATIC_SENDABLE: HostexDeliveryStatus[] = [
  HostexDeliveryStatus.SCHEDULED,
  HostexDeliveryStatus.RETRY_WAIT
];
type HostexWebhookPayload = {
  event?: unknown;
  reservation_code?: unknown;
  stay_code?: unknown;
  property_id?: unknown;
  conversation_id?: unknown;
  message_id?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
};

type WebhookAuthentication = "verified" | "invalid" | "unconfigured";

@Injectable()
export class HostexService {
  private processingWebhooks = false;
  private syncingReservations = false;
  private processingDeliveries = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: HostexClient
  ) {}

  async authenticateWebhook(
    providedSecret: string | undefined,
    providedBootstrapToken: string | undefined
  ): Promise<WebhookAuthentication> {
    if (!providedSecret) return "invalid";

    const configuredSecret = process.env.HOSTEX_WEBHOOK_SECRET?.trim();
    if (configuredSecret) return secureEqual(providedSecret, configuredSecret) ? "verified" : "invalid";

    const credential = await this.prisma.hostexWebhookCredential.findUnique({ where: { id: "primary" } });
    const providedDigest = hashToken(providedSecret);
    if (credential) {
      return secureEqual(providedDigest, credential.secretDigest) ? "verified" : "invalid";
    }

    const bootstrapToken = process.env.HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN?.trim();
    if (!bootstrapToken) return "unconfigured";
    if (!secureEqual(providedBootstrapToken, bootstrapToken)) return "invalid";

    try {
      await this.prisma.hostexWebhookCredential.create({
        data: { id: "primary", secretDigest: providedDigest }
      });
      return "verified";
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const raced = await this.prisma.hostexWebhookCredential.findUnique({ where: { id: "primary" } });
      return raced && secureEqual(providedDigest, raced.secretDigest) ? "verified" : "invalid";
    }
  }

  async status() {
    const configuredSecret = Boolean(process.env.HOSTEX_WEBHOOK_SECRET?.trim());
    const credential = configuredSecret
      ? null
      : await this.prisma.hostexWebhookCredential.findUnique({
          where: { id: "primary" },
          select: { capturedAt: true }
        });
    return {
      webhookVerified: configuredSecret || Boolean(credential),
      webhookVerifiedAt: credential?.capturedAt.toISOString() ?? null,
      automationEnabled: this.automationEnabled()
    };
  }

  async enqueueWebhook(payload: HostexWebhookPayload) {
    const event = stringValue(payload.event);
    if (
      !event ||
      ![
        "reservation_created",
        "reservation_updated",
        "message_created",
        "property_availability_updated",
        "listing_calendar_updated"
      ].includes(event)
    ) {
      return { ok: true, ignored: true };
    }

    const timestamp = parseTimestamp(payload.timestamp);
    const values = {
      event,
      reservationCode: stringValue(payload.reservation_code),
      stayCode: stringValue(payload.stay_code),
      propertyId: numberValue(payload.property_id),
      conversationId: stringValue(payload.conversation_id),
      messageId: stringValue(payload.message_id),
      eventTimestamp: timestamp
    };
    const dedupeKey = createHash("sha256")
      .update(JSON.stringify({ ...values, eventTimestamp: timestamp.toISOString() }))
      .digest("hex");

    try {
      await this.prisma.hostexWebhookEvent.create({ data: { dedupeKey, ...values } });
      return { ok: true, queued: true };
    } catch (error) {
      if (isUniqueConstraint(error)) return { ok: true, duplicate: true };
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processWebhookEvents() {
    if (this.processingWebhooks) return;
    this.processingWebhooks = true;
    try {
      await this.prisma.hostexWebhookEvent.updateMany({
        where: {
          status: HostexWebhookStatus.PROCESSING,
          createdAt: { lt: new Date(Date.now() - 10 * 60_000) },
          attempts: { lt: 5 }
        },
        data: {
          status: HostexWebhookStatus.FAILED,
          nextAttemptAt: new Date(),
          lastError: "Recovered a webhook event interrupted during processing"
        }
      });
      for (let index = 0; index < 10; index += 1) {
        const event = await this.claimWebhookEvent();
        if (!event) break;
        try {
          if (["property_availability_updated", "listing_calendar_updated"].includes(event.event)) {
            await this.prisma.hostexCalendarDay.deleteMany();
          } else if (event.event === "message_created" && event.conversationId) {
            await this.reconcileConversation(event.conversationId);
          } else if (event.reservationCode && event.stayCode) {
            const reservation = await this.client.getReservation(event.reservationCode, event.stayCode);
            if (reservation) await this.syncReservation(reservation, this.automationEnabled());
            else await this.cancelDelivery(event.stayCode, "Reservation is no longer available in Hostex");
          }
          await this.prisma.hostexWebhookEvent.update({
            where: { id: event.id },
            data: {
              status: HostexWebhookStatus.PROCESSED,
              processedAt: new Date(),
              nextAttemptAt: null,
              lastError: null
            }
          });
        } catch (error) {
          const retryAt = new Date(Date.now() + Math.min(event.attempts, 5) * 60_000);
          await this.prisma.hostexWebhookEvent.update({
            where: { id: event.id },
            data: {
              status: HostexWebhookStatus.FAILED,
              nextAttemptAt: retryAt,
              lastError: safeError(error)
            }
          });
        }
      }
    } finally {
      this.processingWebhooks = false;
    }
  }

  @Cron("*/15 14-23 * * *", { timeZone: process.env.HOSTEX_TIMEZONE ?? "Asia/Manila" })
  async scheduledReservationSync() {
    if (!this.automationEnabled()) return;
    await this.syncUpcoming(true);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDeliveryQueue() {
    if (this.processingDeliveries || !this.automationEnabled()) return;
    this.processingDeliveries = true;
    try {
      await this.recoverStaleSending();
      const retries = await this.prisma.hostexBookingAutomation.findMany({
        where: {
          status: HostexDeliveryStatus.RETRY_WAIT,
          attempts: { lt: 5 },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }]
        },
        orderBy: { nextAttemptAt: "asc" },
        take: 10,
        select: { id: true }
      });
      for (const delivery of retries) await this.sendDelivery(delivery.id, false, false);
    } finally {
      this.processingDeliveries = false;
    }
  }

  async syncNow() {
    if (this.syncingReservations) return { ok: true, alreadyRunning: true };
    this.syncingReservations = true;
    try {
      const today = localDate(new Date(), this.timeZone());
      const start = addDaysToDateOnly(today, -730);
      const end = addDaysToDateOnly(today, 365);
      let found = 0;
      for (const status of ["accepted", "cancelled"]) {
        let cursor = start;
        while (cursor <= end) {
          const chunkEnd = minDate(addDaysToDateOnly(cursor, 179), end);
          const reservations = await this.client.listReservations({
            propertyId: this.propertyId(),
            status,
            startCheckIn: cursor,
            endCheckIn: chunkEnd
          });
          found += reservations.length;
          for (const reservation of reservations) await this.syncReservation(reservation, false);
          cursor = addDaysToDateOnly(chunkEnd, 1);
        }
      }
      return { ok: true, found, sent: 0 };
    } finally {
      this.syncingReservations = false;
    }
  }

  async sendNow(inviteId: string, allowUnknownDuplicate = false) {
    const delivery = await this.prisma.hostexBookingAutomation.findUnique({ where: { inviteId } });
    if (!delivery) throw new NotFoundException("Hostex invite delivery not found");
    if (delivery.status === HostexDeliveryStatus.UNKNOWN && !allowUnknownDuplicate) {
      throw new ConflictException("Delivery outcome is unknown; confirm duplicate risk before retrying");
    }
    return this.sendDelivery(delivery.id, true, allowUnknownDuplicate);
  }

  async reconcileInvite(inviteId: string) {
    const delivery = await this.prisma.hostexBookingAutomation.findUnique({ where: { inviteId } });
    if (!delivery) throw new NotFoundException("Hostex invite delivery not found");
    const confirmed = await this.reconcileDelivery(delivery.id, false);
    const current = await this.prisma.hostexBookingAutomation.findUnique({ where: { id: delivery.id } });
    return { ok: true, confirmed, status: current?.status.toLowerCase() };
  }

  private async syncUpcoming(sendDue: boolean) {
    if (this.syncingReservations) return { ok: true, alreadyRunning: true };
    this.syncingReservations = true;
    try {
      const timeZone = this.timeZone();
      const today = localDate(new Date(), timeZone);
      const reservations = await this.client.listReservations({
        propertyId: this.propertyId(),
        status: "accepted",
        startCheckIn: today,
        endCheckIn: addDaysToDateOnly(today, 1)
      });
      let sent = 0;
      for (const reservation of reservations) {
        const result = await this.syncReservation(reservation, sendDue);
        if (result?.status === HostexDeliveryStatus.SENT) sent += 1;
      }
      return { ok: true, found: reservations.length, sent };
    } finally {
      this.syncingReservations = false;
    }
  }

  private async syncReservation(reservation: HostexReservation, sendDue: boolean) {
    if (reservation.property_id !== this.propertyId()) return null;
    if (reservation.status !== "accepted") {
      await this.cancelDelivery(reservation.stay_code, `Reservation status is ${reservation.status}`);
      return null;
    }

    const delivery = await this.upsertAcceptedReservation(reservation);
    if (!sendDue || !isDeliveryDue(delivery.invite.checkIn, delivery.dueAt, this.timeZone())) {
      return delivery;
    }
    return this.sendDelivery(delivery.id, false, false);
  }

  private async upsertAcceptedReservation(reservation: HostexReservation) {
    const dueAt = deliveryDueAt(reservation.check_in_date, this.timeZone());
    const expiresAt = new Date(dueAt.getTime() + 7 * 86_400_000);
    const checkIn = dateOnlyValue(reservation.check_in_date);
    const checkOut = dateOnlyValue(reservation.check_out_date);
    const booking = await this.prisma.booking.upsert({
      where: { stayCode: reservation.stay_code },
      create: bookingValues(reservation, checkIn, checkOut),
      update: bookingValues(reservation, checkIn, checkOut)
    });
    const existing = await this.prisma.hostexBookingAutomation.findUnique({
      where: { bookingId: booking.id },
      include: { invite: true }
    });

    if (existing) {
      const recoverCancelled = existing.status === HostexDeliveryStatus.CANCELLED;
      const recoverMissingConversation =
        existing.status === HostexDeliveryStatus.BLOCKED &&
        existing.lastError === "Hostex reservation has no conversation" &&
        Boolean(reservation.conversation_id);
      const status =
        recoverCancelled || recoverMissingConversation
          ? reservation.conversation_id
            ? HostexDeliveryStatus.SCHEDULED
            : HostexDeliveryStatus.BLOCKED
          : existing.status;
      const [updated] = await this.prisma.$transaction([
        this.prisma.hostexBookingAutomation.update({
          where: { id: existing.id },
          data: {
            reservationCode: reservation.reservation_code,
            propertyId: reservation.property_id,
            channelType: reservation.channel_type,
            conversationId: reservation.conversation_id ?? null,
            dueAt,
            status,
            nextAttemptAt: recoverCancelled || recoverMissingConversation ? null : existing.nextAttemptAt,
            lastError:
              recoverCancelled || recoverMissingConversation
                ? reservation.conversation_id
                  ? null
                  : "Hostex reservation has no conversation"
                : existing.lastError
          },
          include: { invite: true }
        }),
        this.prisma.invite.updateMany({
          where: { id: existing.inviteId, status: InviteStatus.OPEN },
          data: { checkIn, checkOut, expiresAt }
        })
      ]);
      return { ...updated, invite: { ...updated.invite, checkIn, checkOut, expiresAt } };
    }

    const token = nanoid(32);
    try {
      const invite = await this.prisma.invite.create({
        data: {
          tokenHash: hashToken(token),
          publicToken: token,
          checkIn,
          checkOut,
          purpose: "Tenant",
          expiresAt,
          bookingId: booking.id,
          hostexAutomation: {
            create: {
              bookingId: booking.id,
              reservationCode: reservation.reservation_code,
              stayCode: reservation.stay_code,
              propertyId: reservation.property_id,
              channelType: reservation.channel_type,
              conversationId: reservation.conversation_id ?? null,
              dueAt,
              status: reservation.conversation_id
                ? HostexDeliveryStatus.SCHEDULED
                : HostexDeliveryStatus.BLOCKED,
              lastError: reservation.conversation_id ? null : "Hostex reservation has no conversation"
            }
          }
        },
        include: { hostexAutomation: true }
      });
      return { ...invite.hostexAutomation!, invite };
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const raced = await this.prisma.hostexBookingAutomation.findUnique({
        where: { bookingId: booking.id },
        include: { invite: true }
      });
      if (!raced) throw error;
      return raced;
    }
  }

  private async sendDelivery(id: string, force: boolean, allowUnknownDuplicate: boolean) {
    let delivery = await this.prisma.hostexBookingAutomation.findUnique({
      where: { id },
      include: { invite: true }
    });
    if (!delivery) throw new NotFoundException("Hostex invite delivery not found");
    if (isSentStatus(delivery.status)) {
      return delivery;
    }

    const reservation = await this.client.getReservation(delivery.reservationCode, delivery.stayCode);
    if (!reservation || reservation.status !== "accepted") {
      await this.cancelDelivery(delivery.stayCode, "Reservation is not accepted in Hostex");
      return this.prisma.hostexBookingAutomation.findUnique({ where: { id } });
    }
    await this.upsertAcceptedReservation(reservation);
    delivery = await this.prisma.hostexBookingAutomation.findUnique({
      where: { id },
      include: { invite: true }
    });
    if (!delivery) throw new NotFoundException("Hostex invite delivery not found");

    if (delivery.invite.status === InviteStatus.SUBMITTED) {
      return this.prisma.hostexBookingAutomation.update({
        where: { id },
        data: { status: HostexDeliveryStatus.SKIPPED_SUBMITTED, lastError: null }
      });
    }
    if (!force && !isDeliveryDue(delivery.invite.checkIn, delivery.dueAt, this.timeZone())) return delivery;
    if (!delivery.conversationId) {
      return this.prisma.hostexBookingAutomation.update({
        where: { id },
        data: { status: HostexDeliveryStatus.BLOCKED, lastError: "Hostex reservation has no conversation" }
      });
    }

    const allowed = [...AUTOMATIC_SENDABLE];
    if (force) allowed.push(HostexDeliveryStatus.BLOCKED);
    if (allowUnknownDuplicate) allowed.push(HostexDeliveryStatus.UNKNOWN);
    const attemptStartedAt = new Date();
    const attempt = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.hostexBookingAutomation.updateMany({
        where: {
          id,
          status: { in: allowed },
          ...(force ? {} : { attempts: { lt: 5 } })
        },
        data: {
          status: HostexDeliveryStatus.SENDING,
          attempts: { increment: 1 },
          lastAttemptAt: attemptStartedAt,
          nextAttemptAt: null,
          lastError: null
        }
      });
      if (!claimed.count) return null;
      return transaction.hostexMessageDelivery.create({
        data: {
          inviteId: delivery.inviteId,
          bookingId: delivery.bookingId,
          kind: HostexDeliveryKind.AUTOMATED,
          conversationId: delivery.conversationId,
          status: HostexDeliveryStatus.SENDING,
          attempts: 1,
          lastAttemptAt: attemptStartedAt
        }
      });
    });
    if (!attempt) {
      return this.prisma.hostexBookingAutomation.findUnique({ where: { id } });
    }

    const guestUrl = this.guestUrl(delivery.invite.publicToken);
    const firstName = firstNameFor(reservation.guest_name);
    try {
      const result = await this.client.sendMessage(
        delivery.conversationId,
        DELIVERY_MESSAGE(firstName, guestUrl)
      );
      const sentAt = new Date();
      const [updated] = await this.prisma.$transaction([
        this.prisma.hostexBookingAutomation.update({
          where: { id },
          data: {
            status: HostexDeliveryStatus.SENT,
            sentAt,
            requestId: result.requestId,
            lastError: null
          }
        }),
        this.prisma.hostexMessageDelivery.update({
          where: { id: attempt.id },
          data: {
            status: HostexDeliveryStatus.SENT,
            sentAt,
            requestId: result.requestId,
            lastError: null
          }
        })
      ]);
      return updated;
    } catch (error) {
      if (error instanceof HostexUncertainSendError) {
        const [updated] = await this.prisma.$transaction([
          this.prisma.hostexBookingAutomation.update({
            where: { id },
            data: { status: HostexDeliveryStatus.UNKNOWN, lastError: error.message }
          }),
          this.prisma.hostexMessageDelivery.update({
            where: { id: attempt.id },
            data: { status: HostexDeliveryStatus.UNKNOWN, lastError: error.message }
          })
        ]);
        return updated;
      }
      if (error instanceof HostexApiError && isRetryable(error)) {
        const current = await this.prisma.hostexBookingAutomation.findUnique({
          where: { id },
          include: { invite: true }
        });
        const retryAt = nextRetryAt(current?.attempts ?? 1, error.retryAfterSeconds);
        const retryAllowed =
          (current?.attempts ?? 5) < 5 &&
          retryAt < endOfCheckInDay(dateOnly(current!.invite.checkIn), this.timeZone());
        const status = retryAllowed ? HostexDeliveryStatus.RETRY_WAIT : HostexDeliveryStatus.BLOCKED;
        const [updated] = await this.prisma.$transaction([
          this.prisma.hostexBookingAutomation.update({
            where: { id },
            data: {
              status,
              nextAttemptAt: retryAllowed ? retryAt : null,
              requestId: error.requestId,
              lastError: error.message
            }
          }),
          this.prisma.hostexMessageDelivery.update({
            where: { id: attempt.id },
            data: {
              status,
              nextAttemptAt: retryAllowed ? retryAt : null,
              requestId: error.requestId,
              lastError: error.message
            }
          })
        ]);
        return updated;
      }
      const requestId = error instanceof HostexApiError ? error.requestId : null;
      const lastError = safeError(error);
      const [updated] = await this.prisma.$transaction([
        this.prisma.hostexBookingAutomation.update({
          where: { id },
          data: { status: HostexDeliveryStatus.BLOCKED, requestId, lastError }
        }),
        this.prisma.hostexMessageDelivery.update({
          where: { id: attempt.id },
          data: { status: HostexDeliveryStatus.BLOCKED, requestId, lastError }
        })
      ]);
      return updated;
    }
  }

  private async reconcileConversation(conversationId: string) {
    const deliveries = await this.prisma.hostexBookingAutomation.findMany({
      where: {
        conversationId,
        status: {
          in: [HostexDeliveryStatus.SENDING, HostexDeliveryStatus.SENT, HostexDeliveryStatus.UNKNOWN]
        }
      },
      select: { id: true }
    });
    for (const delivery of deliveries) await this.reconcileDelivery(delivery.id, false);
  }

  private async reconcileDelivery(id: string, markUnknownWhenMissing: boolean) {
    const delivery = await this.prisma.hostexBookingAutomation.findUnique({
      where: { id },
      include: { invite: true }
    });
    if (!delivery?.conversationId) return false;
    const guestUrl = this.guestUrl(delivery.invite.publicToken);
    const conversation = await this.client.getConversation(delivery.conversationId);
    const found = conversation.messages.some(
      (message) => message.sender_role === "host" && message.content?.includes(guestUrl)
    );
    if (found) {
      const confirmedAt = new Date();
      const latestAttempt = await this.prisma.hostexMessageDelivery.findFirst({
        where: {
          inviteId: delivery.inviteId,
          kind: HostexDeliveryKind.AUTOMATED,
          status: {
            in: [
              HostexDeliveryStatus.SENDING,
              HostexDeliveryStatus.SENT,
              HostexDeliveryStatus.UNKNOWN
            ]
          }
        },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      await this.prisma.$transaction([
        this.prisma.hostexBookingAutomation.update({
          where: { id },
          data: {
            status: HostexDeliveryStatus.CONFIRMED,
            confirmedAt,
            lastError: null
          }
        }),
        ...(latestAttempt
          ? [
              this.prisma.hostexMessageDelivery.update({
                where: { id: latestAttempt.id },
                data: {
                  status: HostexDeliveryStatus.CONFIRMED,
                  confirmedAt,
                  lastError: null
                }
              })
            ]
          : [])
      ]);
    } else if (markUnknownWhenMissing && delivery.status === HostexDeliveryStatus.SENDING) {
      const lastError = "Hostex send was interrupted before its outcome was recorded";
      const latestAttempt = await this.prisma.hostexMessageDelivery.findFirst({
        where: {
          inviteId: delivery.inviteId,
          kind: HostexDeliveryKind.AUTOMATED,
          status: HostexDeliveryStatus.SENDING
        },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      await this.prisma.$transaction([
        this.prisma.hostexBookingAutomation.update({
          where: { id },
          data: { status: HostexDeliveryStatus.UNKNOWN, lastError }
        }),
        ...(latestAttempt
          ? [
              this.prisma.hostexMessageDelivery.update({
                where: { id: latestAttempt.id },
                data: { status: HostexDeliveryStatus.UNKNOWN, lastError }
              })
            ]
          : [])
      ]);
    }
    return found;
  }

  private async recoverStaleSending() {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const stale = await this.prisma.hostexBookingAutomation.findMany({
      where: { status: HostexDeliveryStatus.SENDING, lastAttemptAt: { lt: staleBefore } },
      take: 10,
      select: { id: true }
    });
    for (const delivery of stale) await this.reconcileDelivery(delivery.id, true);
  }

  private async cancelDelivery(stayCode: string, reason: string) {
    const booking = await this.prisma.booking.findUnique({ where: { stayCode } });
    if (!booking) return;
    const delivery = await this.prisma.hostexBookingAutomation.findUnique({
      where: { bookingId: booking.id },
      include: { invite: true }
    });
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: "cancelled", cancelledAt: new Date(), lastSyncedAt: new Date() }
      }),
      ...(delivery
        ? [
            this.prisma.hostexBookingAutomation.update({
              where: { id: delivery.id },
              data: { status: HostexDeliveryStatus.CANCELLED, nextAttemptAt: null, lastError: reason }
            })
          ]
        : []),
      this.prisma.invite.updateMany({
        where: { bookingId: booking.id, status: InviteStatus.OPEN },
        data: { expiresAt: new Date() }
      })
    ]);
  }

  private async claimWebhookEvent() {
    const candidate = await this.prisma.hostexWebhookEvent.findFirst({
      where: {
        status: { in: [HostexWebhookStatus.PENDING, HostexWebhookStatus.FAILED] },
        attempts: { lt: 5 },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }]
      },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate) return null;
    const claimed = await this.prisma.hostexWebhookEvent.updateMany({
      where: {
        id: candidate.id,
        status: { in: [HostexWebhookStatus.PENDING, HostexWebhookStatus.FAILED] }
      },
      data: { status: HostexWebhookStatus.PROCESSING, attempts: { increment: 1 } }
    });
    if (!claimed.count) return null;
    return { ...candidate, attempts: candidate.attempts + 1 };
  }

  private propertyId() {
    const value = Number(process.env.HOSTEX_PROPERTY_ID ?? "12684960");
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("HOSTEX_PROPERTY_ID must be a positive integer");
    return value;
  }

  private timeZone() {
    return process.env.HOSTEX_TIMEZONE?.trim() || "Asia/Manila";
  }

  private guestUrl(publicToken: string | null) {
    if (!publicToken) throw new Error("Hostex invite is missing its public token");
    const origin = process.env.PUBLIC_APP_URL?.trim();
    if (!origin) throw new Error("PUBLIC_APP_URL is required");
    return `${origin.replace(/\/+$/, "")}/invite/${publicToken}`;
  }

  private automationEnabled() {
    return (
      process.env.ENABLE_BACKGROUND_WORKERS !== "false" &&
      process.env.ENABLE_HOSTEX_INVITE_AUTOMATION === "true"
    );
  }
}

function isDeliveryDue(checkIn: Date, dueAt: Date, timeZone: string) {
  const now = new Date();
  return now >= dueAt && now < endOfCheckInDay(dateOnly(checkIn), timeZone);
}

function dateOnlyValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function bookingValues(reservation: HostexReservation, checkIn: Date, checkOut: Date) {
  return {
    reservationCode: reservation.reservation_code,
    propertyId: reservation.property_id,
    channelType: reservation.channel_type,
    channelId: reservation.channel_id ?? null,
    listingId: reservation.listing_id ?? null,
    status: reservation.status,
    stayStatus: reservation.stay_status ?? null,
    guestName: reservation.guest_name ?? null,
    guestEmail: reservation.guest_email ?? null,
    guestPhone: reservation.guest_phone ?? null,
    numberOfGuests: reservation.number_of_guests ?? null,
    numberOfAdults: reservation.number_of_adults ?? null,
    numberOfChildren: reservation.number_of_children ?? null,
    conversationId: reservation.conversation_id ?? null,
    checkIn,
    checkOut,
    bookedAt: optionalDate(reservation.booked_at),
    cancelledAt: optionalDate(reservation.cancelled_at),
    lastSyncedAt: new Date(),
    stayCode: reservation.stay_code
  };
}

function optionalDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minDate(first: string, second: string) {
  return first < second ? first : second;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function firstNameFor(value?: string | null) {
  return value?.trim().split(/\s+/)[0] || "there";
}

function isRetryable(error: HostexApiError) {
  const code = Number(error.code);
  return code === 429 || code >= 500;
}

function isSentStatus(status: HostexDeliveryStatus) {
  return status === HostexDeliveryStatus.SENT || status === HostexDeliveryStatus.CONFIRMED;
}

function nextRetryAt(attempts: number, retryAfterSeconds?: number) {
  const delays = [300, 900, 3600, 21_600];
  const seconds = Math.max(
    retryAfterSeconds ?? 0,
    delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)]
  );
  return new Date(Date.now() + seconds * 1000);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") throw new Error("Hostex webhook timestamp is required");
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Hostex webhook timestamp is invalid");
  return timestamp;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Hostex automation failed";
  return message.slice(0, 500);
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function secureEqual(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}
