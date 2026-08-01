import { ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import type { CreateInviteInput, GuestSubmission } from "@cozy-d-714/shared";
import { MINOR_ID_CUTOFF } from "@cozy-d-714/shared";
import { InviteStatus } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { requiredEnv } from "../config/env.js";

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
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
      include: { hostexDelivery: true },
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
        hostex: invite.hostexDelivery
          ? {
              channelType: invite.hostexDelivery.channelType,
              status: invite.hostexDelivery.status.toLowerCase(),
              dueAt: invite.hostexDelivery.dueAt.toISOString(),
              attempts: invite.hostexDelivery.attempts,
              sentAt: invite.hostexDelivery.sentAt?.toISOString() ?? null,
              confirmedAt: invite.hostexDelivery.confirmedAt?.toISOString() ?? null,
              lastError: invite.hostexDelivery.lastError
            }
          : undefined
      }))
    };
  }

  async remove(id: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      select: { status: true, hostexDelivery: { select: { id: true } } }
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.hostexDelivery) throw new ConflictException("Hostex-managed invites cannot be deleted");
    if (invite.status !== InviteStatus.OPEN) throw new ConflictException("Only open invites can be deleted");
    await this.prisma.invite.delete({ where: { id } });
    return { ok: true };
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
      minorIdCutoff: Number(process.env.MINOR_ID_CUTOFF ?? MINOR_ID_CUTOFF)
    };
  }

  async upload(token: string, file: Express.Multer.File) {
    const invite = await this.findOpen(token);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `ids/${invite.id}/${randomUUID()}-${safeName}`;
    const deleteAfter = new Date(Date.now() + 31 * 86400000).toISOString();

    await this.storage.put(key, file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      metadata: { originalName: file.originalname, deleteAfter }
    });

    return { key, filename: file.originalname, size: file.size };
  }

  async submit(token: string, input: GuestSubmission) {
    const invite = await this.findOpen(token);
    const cutoff = Number(process.env.MINOR_ID_CUTOFF ?? MINOR_ID_CUTOFF);

    for (const guest of input.guests) {
      if (guest.age >= cutoff && !guest.idFileKey) {
        throw new ConflictException(`Valid ID is required for ${guest.fullName}`);
      }
    }

    const files = new Map<string, Awaited<ReturnType<StorageService["head"]>>>();
    for (const key of input.guests.flatMap((guest) => (guest.idFileKey ? [guest.idFileKey] : []))) {
      const object = await this.storage.head(key);
      if (!object) throw new ConflictException("An uploaded ID file is missing");
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
          ownerContact: requiredEnv("OWNER_CONTACT")
        }
      });

      for (const guest of input.guests) {
        const createdGuest = await tx.guest.create({
          data: {
            submissionId: created.id,
            fullName: guest.fullName,
            age: guest.age,
            requiresId: guest.age >= cutoff
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

    return { submissionId: submission.id, status: "ready_for_review" };
  }

  private async findOpen(token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.status !== InviteStatus.OPEN || invite.expiresAt < new Date()) {
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
