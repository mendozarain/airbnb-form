import { ConflictException, GoneException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type {
  CreateBookingInviteInput,
  CreateInviteInput,
  GuestSubmission,
  RegenerateInviteInput,
  UpdateInviteInput
} from "@cozy-d-714/shared";
import { MINOR_ID_CUTOFF, SENIOR_ID_CUTOFF, requiresGuestId } from "@cozy-d-714/shared";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { HostexDeliveryStatus, InviteStatus, SubmissionStatus } from "../generated/prisma/enums.js";
import { JobDispatcher } from "../jobs/job.dispatcher.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { StorageService } from "../storage/storage.service.js";
import { requiredEnv } from "../config/env.js";
import { deleteAfterIso, safeFileName, uploadKey, type UploadRequest } from "../common/upload.js";

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Optional() private readonly jobs?: JobDispatcher
  ) {}

  async create(input: CreateInviteInput) {
    const token = nanoid(32);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 7 * 86400000);
    const invite = await this.prisma.invite.create({
      data: {
        tokenHash: hashToken(token),
        publicToken: token,
        checkIn: new Date(`${input.checkIn}T00:00:00.000Z`),
        checkOut: new Date(`${input.checkOut}T00:00:00.000Z`),
        purpose: input.purpose,
        expiresAt
      }
    });

    return {
      token,
      guestUrl: `${requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "")}/invite/${token}`,
      expiresAt: invite.expiresAt.toISOString()
    };
  }

  async list() {
    const invites = await this.prisma.invite.findMany({
      where: { status: InviteStatus.OPEN },
      include: { hostexAutomation: true, booking: true },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    const origin = requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "");

    return {
      invites: invites.map((invite) => ({
        id: invite.id,
        guestUrl: invite.publicToken ? `${origin}/invite/${invite.publicToken}` : null,
        checkIn: dateOnly(invite.checkIn),
        checkOut: dateOnly(invite.checkOut),
        purpose: invite.purpose,
        status: invite.expiresAt < new Date() ? "expired" : "open",
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        booking: invite.booking
          ? {
              id: invite.booking.id,
              guestName: invite.booking.guestName,
              channelType: invite.booking.channelType,
              stayCode: invite.booking.stayCode
            }
          : null,
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
      }))
    };
  }

  async remove(id: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      select: { status: true, hostexAutomation: { select: { id: true } } }
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.hostexAutomation) throw new ConflictException("Hostex-managed invites cannot be deleted");
    if (invite.status !== InviteStatus.OPEN) throw new ConflictException("Only open invites can be deleted");
    await this.prisma.invite.delete({ where: { id } });
    return { ok: true };
  }

  async createForBooking(bookingId: string, input: CreateBookingInviteInput, actor?: AuditActor) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { hostexAutomation: { include: { invite: true } } }
    });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.status !== "accepted")
      throw new ConflictException("Only accepted bookings can receive links");
    if (
      input.purpose === "Tenant" &&
      booking.hostexAutomation?.invite.status === InviteStatus.OPEN &&
      booking.hostexAutomation.invite.expiresAt > new Date()
    ) {
      throw new ConflictException("This booking already has an active scheduled Tenant link");
    }

    const created = await this.createInviteRecord({
      bookingId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      purpose: input.purpose,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 7 * 86_400_000)
    });
    await this.audit.record(actor, "invite.created", "invite", created.inviteId, {
      bookingId,
      purpose: input.purpose
    });
    return created;
  }

  async update(id: string, input: UpdateInviteInput, actor?: AuditActor) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      include: { hostexAutomation: true }
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.status !== InviteStatus.OPEN || invite.expiresAt <= new Date() || invite.revokedAt) {
      throw new ConflictException("Only an active pending link can be edited");
    }
    if (invite.hostexAutomation && input.purpose && input.purpose !== "Tenant") {
      throw new ConflictException("An automated invitation must remain Tenant");
    }
    const updated = await this.prisma.invite.update({
      where: { id },
      data: {
        purpose: input.purpose,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined
      }
    });
    await this.audit.record(actor, "invite.updated", "invite", id, {
      purpose: updated.purpose,
      expiresAt: updated.expiresAt.toISOString()
    });
    return { ok: true };
  }

  async regenerate(id: string, input: RegenerateInviteInput, actor?: AuditActor) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      include: { hostexAutomation: true }
    });
    if (!invite) throw new NotFoundException("Invite not found");

    const token = nanoid(32);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 7 * 86_400_000);
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id },
        data: {
          ...(invite.status === InviteStatus.OPEN ? { status: InviteStatus.REVOKED } : {}),
          revokedAt: new Date(),
          revokedReason: "Regenerated by admin"
        }
      });
      if (invite.hostexAutomation) {
        await tx.hostexBookingAutomation.update({
          where: { id: invite.hostexAutomation.id },
          data: {
            status: HostexDeliveryStatus.CANCELLED,
            nextAttemptAt: null,
            lastError: "Scheduled delivery suppressed because the link was regenerated"
          }
        });
      }
      return tx.invite.create({
        data: {
          tokenHash: hashToken(token),
          publicToken: token,
          bookingId: invite.bookingId,
          parentInviteId: invite.id,
          checkIn: invite.checkIn,
          checkOut: invite.checkOut,
          purpose: invite.purpose,
          expiresAt
        }
      });
    });
    await this.audit.record(actor, "invite.regenerated", "invite", created.id, {
      bookingId: created.bookingId,
      replacedInviteId: invite.id,
      purpose: created.purpose
    });
    return {
      id: created.id,
      guestUrl: `${requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "")}/invite/${token}`,
      expiresAt: created.expiresAt.toISOString()
    };
  }

  async assignBooking(id: string, bookingId: string | null, actor?: AuditActor) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      include: { hostexAutomation: true }
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.hostexAutomation) throw new ConflictException("Automated links cannot be reassigned");
    if (bookingId) {
      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException("Booking not found");
      if (
        dateOnly(invite.checkIn) !== dateOnly(booking.checkIn) ||
        dateOnly(invite.checkOut) !== dateOnly(booking.checkOut)
      ) {
        throw new ConflictException("Invite dates must match the selected booking");
      }
    }
    await this.prisma.invite.update({ where: { id }, data: { bookingId } });
    await this.audit.record(actor, "invite.booking_assigned", "invite", id, { bookingId });
    return { ok: true };
  }

  private async createInviteRecord(input: {
    bookingId: string;
    checkIn: Date;
    checkOut: Date;
    purpose: string;
    expiresAt: Date;
  }) {
    const token = nanoid(32);
    const invite = await this.prisma.invite.create({
      data: {
        tokenHash: hashToken(token),
        publicToken: token,
        bookingId: input.bookingId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        purpose: input.purpose,
        expiresAt: input.expiresAt
      }
    });
    return {
      inviteId: invite.id,
      token,
      guestUrl: `${requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "")}/invite/${token}`,
      expiresAt: invite.expiresAt.toISOString()
    };
  }

  async getPublic(token: string) {
    const invite = await this.findOpen(token);
    return {
      token,
      checkIn: dateOnly(invite.checkIn),
      checkOut: dateOnly(invite.checkOut),
      buildingCode: process.env.BUILDING_CODE ?? "D",
      unitNumber: process.env.UNIT_NUMBER ?? "714",
      purpose: invite.purpose,
      ownerName: requiredEnv("OWNER_NAME"),
      ownerContact: requiredEnv("OWNER_CONTACT"),
      minorIdCutoff: Number(process.env.MINOR_ID_CUTOFF ?? MINOR_ID_CUTOFF),
      seniorIdCutoff: Number(process.env.SENIOR_ID_CUTOFF ?? SENIOR_ID_CUTOFF)
    };
  }

  // Files go straight from the browser to S3: API Gateway caps request bodies at 10 MB. The returned key is
  // validated again (HeadObject) when the guest submits the registration.
  async presignUpload(token: string, request: UploadRequest) {
    const invite = await this.findOpen(token);
    const key = uploadKey(`ids/${invite.id}`, request.filename);
    const uploadUrl = await this.storage.presignPut(key, {
      contentType: request.contentType,
      contentLength: request.size,
      metadata: { originalName: safeFileName(request.filename), deleteAfter: deleteAfterIso() }
    });
    return {
      key,
      filename: request.filename,
      size: request.size,
      uploadUrl,
      headers: { "Content-Type": request.contentType }
    };
  }

  async submit(token: string, input: GuestSubmission) {
    const invite = await this.findOpen(token);
    const [autoQueue, aiIdCheck] = await Promise.all([
      this.settings.isAutoQueueEnabled(),
      this.settings.isAiIdCheckEnabled()
    ]);
    const lowerCutoff = Number(process.env.MINOR_ID_CUTOFF ?? MINOR_ID_CUTOFF);
    const upperCutoff = Number(process.env.SENIOR_ID_CUTOFF ?? SENIOR_ID_CUTOFF);
    const needsAiCheck =
      aiIdCheck && input.guests.some((guest) => requiresGuestId(guest.age, lowerCutoff, upperCutoff));
    const initialStatus = needsAiCheck
      ? SubmissionStatus.AI_CHECK_PENDING
      : autoQueue
        ? SubmissionStatus.QUEUED
        : SubmissionStatus.READY_FOR_REVIEW;

    for (const guest of input.guests) {
      if (requiresGuestId(guest.age, lowerCutoff, upperCutoff) && !guest.idFileKey) {
        throw new ConflictException(`Valid ID is required for ${guest.fullName}`);
      }
    }

    const files = new Map<string, Awaited<ReturnType<StorageService["head"]>>>();
    for (const key of input.guests.flatMap((guest) => (guest.idFileKey ? [guest.idFileKey] : []))) {
      const object = await this.storage.head(key);
      if (!object || !key.startsWith(`ids/${invite.id}/`)) {
        throw new ConflictException("An uploaded ID file is missing");
      }
      files.set(key, object);
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.submission.create({
        data: {
          inviteId: invite.id,
          guestEmail: input.guestEmail,
          buildingCode: process.env.BUILDING_CODE ?? "D",
          unitNumber: process.env.UNIT_NUMBER ?? "714",
          checkIn: invite.checkIn,
          checkOut: invite.checkOut,
          purpose: invite.purpose,
          ownerName: requiredEnv("OWNER_NAME"),
          ownerContact: requiredEnv("OWNER_CONTACT"),
          status: initialStatus
        }
      });

      if (needsAiCheck) {
        await tx.submissionAiReview.create({
          data: {
            submissionId: created.id,
            status: "PENDING",
            model: "google/gemini-2.5-flash-lite"
          }
        });
      } else if (autoQueue) {
        await tx.automationRun.create({
          data: { submissionId: created.id, status: "queued" }
        });
      }

      for (const guest of input.guests) {
        const createdGuest = await tx.guest.create({
          data: {
            submissionId: created.id,
            fullName: guest.fullName,
            age: guest.age,
            requiresId: requiresGuestId(guest.age, lowerCutoff, upperCutoff)
          }
        });

        if (guest.idFileKey) {
          const object = files.get(guest.idFileKey)!;
          await tx.guestFile.create({
            data: {
              guestId: createdGuest.id,
              storageKey: guest.idFileKey,
              filename: object?.metadata.originalName ?? guest.idFileKey.split("/").at(-1) ?? "guest-id",
              contentType: object?.contentType ?? "application/octet-stream",
              sizeBytes: object?.size ?? 0,
              deleteAfter: new Date(Date.now() + 31 * 86400000)
            }
          });
        }
      }

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.SUBMITTED, submittedAt: new Date() }
      });
      return created;
    });

    if (initialStatus === SubmissionStatus.AI_CHECK_PENDING) await this.jobs?.enqueue("aiReview.queue");
    else if (initialStatus === SubmissionStatus.QUEUED) await this.jobs?.enqueue("automation.queue");
    return { submissionId: submission.id, status: initialStatus.toLowerCase() };
  }

  private async findOpen(token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.status !== InviteStatus.OPEN || invite.expiresAt < new Date() || invite.revokedAt) {
      throw new GoneException("Invite is expired or already used");
    }
    return invite;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
