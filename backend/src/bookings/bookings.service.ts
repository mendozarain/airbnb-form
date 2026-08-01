import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { requiredEnv } from "../config/env.js";
import { HostexDeliveryKind, HostexDeliveryStatus, InviteStatus } from "../generated/prisma/enums.js";
import { HostexApiError, HostexClient, HostexUncertainSendError } from "../hostex/hostex.client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const MESSAGE = (firstName: string, guestUrl: string) =>
  `Hi ${firstName}, please complete the guest registration form for your upcoming stay at Cozy Davao D-714 before arrival: ${guestUrl}\n\n` +
  "Please include every guest and upload a valid ID for each guest aged 16 or older. Thank you!";

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostex: HostexClient,
    private readonly audit: AuditService
  ) {}

  async list(input: { start?: string; end?: string; status?: string; query?: string }) {
    const query = input.query?.trim();
    const bookings = await this.prisma.booking.findMany({
      where: {
        ...(input.start || input.end
          ? {
              checkIn: {
                ...(input.start ? { gte: dateValue(input.start) } : {}),
                ...(input.end ? { lte: dateValue(input.end) } : {})
              }
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(query
          ? {
              OR: [
                { guestName: { contains: query, mode: "insensitive" } },
                { guestEmail: { contains: query, mode: "insensitive" } },
                { reservationCode: { contains: query, mode: "insensitive" } },
                { stayCode: { contains: query, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: { invites: { include: { submission: true } } },
      orderBy: { checkIn: "asc" },
      take: 500
    });
    return { bookings: bookings.map(bookingSummary) };
  }

  async get(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        invites: {
          include: {
            submission: true,
            hostexAutomation: true,
            hostexDeliveries: { orderBy: { createdAt: "asc" } }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    if (!booking) throw new NotFoundException("Booking not found");
    const summary = bookingSummary(booking);
    return {
      booking: {
        ...summary,
        channelId: booking.channelId,
        listingId: booking.listingId,
        numberOfAdults: booking.numberOfAdults,
        numberOfChildren: booking.numberOfChildren,
        bookedAt: booking.bookedAt?.toISOString() ?? null,
        cancelledAt: booking.cancelledAt?.toISOString() ?? null,
        registrations: booking.invites.map((invite) => ({
          invite: inviteSummary(invite, booking),
          submission: invite.submission
            ? {
                id: invite.submission.id,
                guestEmail: invite.submission.guestEmail,
                checkIn: dateOnly(invite.submission.checkIn),
                checkOut: dateOnly(invite.submission.checkOut),
                status: invite.submission.status.toLowerCase(),
                createdAt: invite.submission.createdAt.toISOString()
              }
            : null,
          deliveries: [
            ...(invite.hostexAutomation &&
            !invite.hostexDeliveries.some((delivery) => delivery.kind === HostexDeliveryKind.AUTOMATED)
              ? [
                  {
                    id: invite.hostexAutomation.id,
                    kind: "automated",
                    status: invite.hostexAutomation.status.toLowerCase(),
                    attempts: invite.hostexAutomation.attempts,
                    sentAt: invite.hostexAutomation.sentAt?.toISOString() ?? null,
                    confirmedAt: invite.hostexAutomation.confirmedAt?.toISOString() ?? null,
                    lastError: invite.hostexAutomation.lastError
                  }
                ]
              : []),
            ...invite.hostexDeliveries
              .map((delivery) => ({
                id: delivery.id,
                kind: delivery.kind === HostexDeliveryKind.AUTOMATED ? "automated" : "manual",
                status: delivery.status.toLowerCase(),
                attempts: delivery.attempts,
                sentAt: delivery.sentAt?.toISOString() ?? null,
                confirmedAt: delivery.confirmedAt?.toISOString() ?? null,
                lastError: delivery.lastError
              }))
          ]
        }))
      }
    };
  }

  async uncategorized() {
    const invites = await this.prisma.invite.findMany({
      where: { bookingId: null },
      include: { submission: true },
      orderBy: { createdAt: "desc" },
      take: 500
    });
    return {
      registrations: invites.map((invite) => ({
        invite: {
          id: invite.id,
          guestUrl: invite.publicToken ? inviteUrl(invite.publicToken) : null,
          checkIn: dateOnly(invite.checkIn),
          checkOut: dateOnly(invite.checkOut),
          purpose: invite.purpose,
          status: invite.revokedAt
            ? "revoked"
            : invite.status === InviteStatus.OPEN && invite.expiresAt < new Date()
              ? "expired"
              : invite.status.toLowerCase(),
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
          booking: null
        },
        submission: invite.submission
          ? {
              id: invite.submission.id,
              guestEmail: invite.submission.guestEmail,
              checkIn: dateOnly(invite.submission.checkIn),
              checkOut: dateOnly(invite.submission.checkOut),
              status: invite.submission.status.toLowerCase(),
              createdAt: invite.submission.createdAt.toISOString()
            }
          : null,
        deliveries: []
      }))
    };
  }

  async sendInvite(inviteId: string, allowUnknownDuplicate: boolean, actor?: AuditActor) {
    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
      include: { booking: true, hostexDeliveries: true }
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (!invite.booking) throw new ConflictException("Assign this link to a Hostex booking before sending");
    if (!invite.booking.conversationId)
      throw new ConflictException("This booking has no Hostex conversation");
    if (invite.status !== InviteStatus.OPEN || invite.expiresAt <= new Date() || invite.revokedAt) {
      throw new ConflictException("Only an active link can be sent");
    }

    const existing = invite.hostexDeliveries
      .filter((delivery) => delivery.kind === HostexDeliveryKind.MANUAL)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    if (
      existing &&
      (existing.status === HostexDeliveryStatus.SENT || existing.status === HostexDeliveryStatus.CONFIRMED)
    ) {
      return { status: existing.status.toLowerCase(), alreadySent: true };
    }
    if (existing?.status === HostexDeliveryStatus.UNKNOWN && !allowUnknownDuplicate) {
      throw new ConflictException("Delivery outcome is unknown; confirm duplicate risk before retrying");
    }

    const delivery = await this.prisma.hostexMessageDelivery.create({
      data: {
        inviteId,
        bookingId: invite.booking.id,
        kind: HostexDeliveryKind.MANUAL,
        conversationId: invite.booking.conversationId,
        status: HostexDeliveryStatus.SENDING,
        attempts: 1,
        lastAttemptAt: new Date()
      }
    });

    try {
      const guestUrl = inviteUrl(invite.publicToken);
      const result = await this.hostex.sendMessage(
        invite.booking.conversationId,
        MESSAGE(firstName(invite.booking.guestName), guestUrl)
      );
      const updated = await this.prisma.hostexMessageDelivery.update({
        where: { id: delivery.id },
        data: { status: HostexDeliveryStatus.SENT, sentAt: new Date(), requestId: result.requestId }
      });
      await this.audit.record(actor, "invite.sent", "invite", inviteId, {
        bookingId: invite.booking.id,
        deliveryId: updated.id,
        kind: "manual"
      });
      return { status: "sent" };
    } catch (error) {
      const uncertain = error instanceof HostexUncertainSendError;
      await this.prisma.hostexMessageDelivery.update({
        where: { id: delivery.id },
        data: {
          status: uncertain ? HostexDeliveryStatus.UNKNOWN : HostexDeliveryStatus.BLOCKED,
          requestId: error instanceof HostexApiError ? error.requestId : null,
          lastError: safeError(error)
        }
      });
      if (!uncertain) throw error;
      return { status: "unknown" };
    }
  }

  async reconcileInvite(inviteId: string, actor?: AuditActor) {
    const delivery = await this.prisma.hostexMessageDelivery.findFirst({
      where: { inviteId, kind: HostexDeliveryKind.MANUAL },
      orderBy: { createdAt: "desc" },
      include: { invite: { include: { booking: true } } }
    });
    if (!delivery) throw new NotFoundException("Hostex message delivery not found");
    if (!delivery.conversationId) throw new ConflictException("This delivery has no Hostex conversation");
    const guestUrl = inviteUrl(delivery.invite.publicToken);
    const conversation = await this.hostex.getConversation(delivery.conversationId);
    const confirmed = conversation.messages.some(
      (message) => message.sender_role !== "guest" && message.content?.includes(guestUrl)
    );
    if (confirmed) {
      await this.prisma.hostexMessageDelivery.update({
        where: { id: delivery.id },
        data: { status: HostexDeliveryStatus.CONFIRMED, confirmedAt: new Date(), lastError: null }
      });
      await this.audit.record(actor, "invite.delivery_confirmed", "invite", inviteId, {
        deliveryId: delivery.id
      });
    }
    return { ok: true, confirmed, status: confirmed ? "confirmed" : delivery.status.toLowerCase() };
  }
}

function bookingSummary(booking: {
  id: string;
  reservationCode: string;
  stayCode: string;
  propertyId: number;
  channelType: string;
  status: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  numberOfGuests: number | null;
  conversationId: string | null;
  checkIn: Date;
  checkOut: Date;
  lastSyncedAt: Date;
  invites: Array<{
    status: InviteStatus;
    expiresAt: Date;
    revokedAt: Date | null;
    submission: { status: string } | null;
  }>;
}) {
  return {
    id: booking.id,
    reservationCode: booking.reservationCode,
    stayCode: booking.stayCode,
    propertyId: booking.propertyId,
    channelType: booking.channelType,
    status: booking.status,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    numberOfGuests: booking.numberOfGuests,
    conversationId: booking.conversationId,
    checkIn: dateOnly(booking.checkIn),
    checkOut: dateOnly(booking.checkOut),
    lastSyncedAt: booking.lastSyncedAt.toISOString(),
    registrationStatus: registrationStatus(booking.invites),
    registrationCount: booking.invites.length
  };
}

function registrationStatus(
  invites: Array<{
    status: InviteStatus;
    expiresAt: Date;
    revokedAt: Date | null;
    submission: { status: string } | null;
  }>
) {
  const statuses = invites.flatMap((invite) =>
    invite.submission ? [String(invite.submission.status).toLowerCase()] : []
  );
  if (
    statuses.some((status) =>
      ["submitted", "submitted_email_failed", "submitted_email_sent"].includes(status)
    )
  ) {
    return "done" as const;
  }
  if (statuses.some((status) => ["ready_for_review", "queued", "submitting", "failed"].includes(status))) {
    return "review" as const;
  }
  if (statuses.includes("rejected")) return "rejected" as const;
  if (
    invites.some(
      (invite) => invite.status === InviteStatus.OPEN && !invite.revokedAt && invite.expiresAt > new Date()
    )
  ) {
    return "pending" as const;
  }
  return "needs_registration" as const;
}

function inviteSummary(
  invite: {
    id: string;
    publicToken: string | null;
    checkIn: Date;
    checkOut: Date;
    purpose: string;
    status: InviteStatus;
    expiresAt: Date;
    createdAt: Date;
    revokedAt: Date | null;
    hostexAutomation: {
      channelType: string;
      status: HostexDeliveryStatus;
      dueAt: Date;
      attempts: number;
      sentAt: Date | null;
      confirmedAt: Date | null;
      lastError: string | null;
    } | null;
  },
  booking: { id: string; guestName: string | null; channelType: string; stayCode: string }
) {
  return {
    id: invite.id,
    guestUrl: invite.publicToken ? inviteUrl(invite.publicToken) : null,
    checkIn: dateOnly(invite.checkIn),
    checkOut: dateOnly(invite.checkOut),
    purpose: invite.purpose,
    status: invite.revokedAt
      ? "revoked"
      : invite.status === InviteStatus.OPEN && invite.expiresAt < new Date()
        ? "expired"
        : invite.status.toLowerCase(),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    booking: {
      id: booking.id,
      guestName: booking.guestName,
      channelType: booking.channelType,
      stayCode: booking.stayCode
    },
    hostex: invite.hostexAutomation
      ? {
          channelType: invite.hostexAutomation.channelType,
          status: invite.hostexAutomation.status.toLowerCase(),
          dueAt: invite.hostexAutomation.dueAt.toISOString(),
          attempts: invite.hostexAutomation.attempts,
          sentAt: invite.hostexAutomation.sentAt?.toISOString() ?? null,
          confirmedAt: invite.hostexAutomation.confirmedAt?.toISOString() ?? null,
          lastError: invite.hostexAutomation.lastError
        }
      : undefined
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function inviteUrl(publicToken: string | null) {
  if (!publicToken) throw new ConflictException("Invite has no public URL");
  return `${requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "")}/invite/${publicToken}`;
}

function firstName(value: string | null) {
  return value?.trim().split(/\s+/)[0] || "there";
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Hostex message failed";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500);
}
