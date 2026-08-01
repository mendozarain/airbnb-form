import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MINOR_ID_CUTOFF, type UpdateSubmissionInput } from "@cozy-d-714/shared";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService
  ) {}

  async list(filter?: string) {
    const statuses = statusesFor(filter);
    const submissions = await this.prisma.submission.findMany({
      where: { status: { in: statuses } },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return {
      submissions: submissions.map((submission) => ({
        id: submission.id,
        guestEmail: submission.guestEmail,
        checkIn: dateOnly(submission.checkIn),
        checkOut: dateOnly(submission.checkOut),
        status: submission.status.toLowerCase(),
        createdAt: submission.createdAt.toISOString()
      }))
    };
  }

  async get(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        guests: {
          orderBy: { createdAt: "asc" },
          include: { files: { orderBy: { createdAt: "asc" } } }
        },
        runs: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });
    if (!submission) throw new NotFoundException("Submission not found");

    return {
      submission: {
        id: submission.id,
        guestEmail: submission.guestEmail,
        buildingCode: submission.buildingCode,
        unitNumber: submission.unitNumber,
        checkIn: dateOnly(submission.checkIn),
        checkOut: dateOnly(submission.checkOut),
        purpose: submission.purpose,
        ownerName: submission.ownerName,
        ownerContact: submission.ownerContact,
        status: submission.status.toLowerCase(),
        createdAt: submission.createdAt.toISOString(),
        latestError: submission.runs[0]?.errorMessage ?? null,
        guests: submission.guests.map((guest) => ({
          id: guest.id,
          fullName: guest.fullName,
          age: guest.age,
          requiresId: guest.requiresId,
          files: guest.files.map((file) => ({
            id: file.id,
            filename: file.filename,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
            url: `/api/admin/files/${file.id}`
          }))
        }))
      }
    };
  }

  async uploadEditFile(id: string, file: Express.Multer.File) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, select: { status: true } });
    if (!submission) throw new NotFoundException("Submission not found");
    ensureEditable(submission.status);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `admin-edits/${id}/${randomUUID()}-${safeName}`;
    await this.storage.put(key, file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      metadata: {
        originalName: file.originalname,
        deleteAfter: new Date(Date.now() + 31 * 86_400_000).toISOString()
      }
    });
    return { key, filename: file.originalname, size: file.size };
  }

  async update(id: string, input: UpdateSubmissionInput, actor?: AuditActor) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { invite: true, guests: { include: { files: true } } }
    });
    if (!submission) throw new NotFoundException("Submission not found");
    ensureEditable(submission.status);

    const cutoff = Number(process.env.MINOR_ID_CUTOFF ?? MINOR_ID_CUTOFF);
    const existingGuests = new Map(submission.guests.map((guest) => [guest.id, guest]));
    const retainedIds = new Set(input.guests.flatMap((guest) => guest.retainFileIds));
    const existingFiles = new Map(
      submission.guests.flatMap((guest) => guest.files.map((file) => [file.id, file]))
    );
    for (const fileId of retainedIds) {
      if (!existingFiles.has(fileId))
        throw new ConflictException("A retained ID file does not belong to this registration");
    }

    const uploaded = new Map<string, Awaited<ReturnType<StorageService["head"]>>>();
    for (const key of input.guests.flatMap((guest) => (guest.idFileKey ? [guest.idFileKey] : []))) {
      const object = await this.storage.head(key);
      if (!object || !key.startsWith(`admin-edits/${id}/`))
        throw new ConflictException("An edited ID file is missing");
      uploaded.set(key, object);
    }

    for (const guest of input.guests) {
      if (guest.id && !existingGuests.has(guest.id))
        throw new ConflictException("A guest does not belong to this registration");
      if (guest.age >= cutoff && guest.retainFileIds.length === 0 && !guest.idFileKey) {
        throw new ConflictException(`Valid ID is required for ${guest.fullName}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.guest.deleteMany({ where: { submissionId: id } });
      await tx.submission.update({
        where: { id },
        data: {
          guestEmail: input.guestEmail,
          purpose: input.purpose,
          status: "READY_FOR_REVIEW"
        }
      });
      await tx.invite.update({ where: { id: submission.inviteId }, data: { purpose: input.purpose } });

      for (const guest of input.guests) {
        const created = await tx.guest.create({
          data: {
            submissionId: id,
            fullName: guest.fullName,
            age: guest.age,
            requiresId: guest.age >= cutoff
          }
        });
        for (const fileId of guest.retainFileIds) {
          const file = existingFiles.get(fileId)!;
          await tx.guestFile.create({
            data: {
              guestId: created.id,
              storageKey: file.storageKey,
              filename: file.filename,
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
              deleteAfter: file.deleteAfter
            }
          });
        }
        if (guest.idFileKey) {
          const object = uploaded.get(guest.idFileKey)!;
          await tx.guestFile.create({
            data: {
              guestId: created.id,
              storageKey: guest.idFileKey,
              filename: object.metadata.originalName ?? guest.idFileKey.split("/").at(-1) ?? "guest-id",
              contentType: object.contentType ?? "application/octet-stream",
              sizeBytes: object.size ?? 0,
              deleteAfter: new Date(Date.now() + 31 * 86_400_000)
            }
          });
        }
      }
    });

    const removedKeys = submission.guests
      .flatMap((guest) => guest.files)
      .filter((file) => !retainedIds.has(file.id))
      .map((file) => file.storageKey);
    await Promise.allSettled(removedKeys.map((key) => this.storage.delete(key)));
    await this.audit.record(actor, "submission.updated", "submission", id, {
      guestCount: input.guests.length,
      purpose: input.purpose,
      previousStatus: submission.status.toLowerCase(),
      status: "ready_for_review"
    });
    return { ok: true, status: "ready_for_review" };
  }

  async confirm(id: string) {
    const updated = await this.prisma.submission.updateMany({
      where: {
        id,
        status: {
          in: [SubmissionStatus.READY_FOR_REVIEW, SubmissionStatus.FAILED]
        }
      },
      data: { status: SubmissionStatus.QUEUED }
    });

    if (!updated.count) {
      const current = await this.prisma.submission.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundException("Submission not found");
      if (current.status === SubmissionStatus.QUEUED || current.status === SubmissionStatus.SUBMITTING) {
        return { ok: true, queued: true, alreadyRunning: true, status: current.status.toLowerCase() };
      }
      throw new ConflictException("Submission cannot be confirmed in its current state");
    }

    await this.prisma.automationRun.create({
      data: { submissionId: id, status: "queued" }
    });
    return { ok: true, queued: true, status: "queued" };
  }

  async reject(id: string) {
    const result = await this.prisma.submission.updateMany({
      where: { id, status: { in: [SubmissionStatus.READY_FOR_REVIEW, SubmissionStatus.FAILED] } },
      data: { status: SubmissionStatus.REJECTED }
    });
    if (!result.count) throw new ConflictException("Submission cannot be rejected");
    return { ok: true };
  }

  async reset(id: string) {
    const result = await this.prisma.submission.updateMany({
      where: { id, status: { in: [SubmissionStatus.QUEUED, SubmissionStatus.SUBMITTING] } },
      data: { status: SubmissionStatus.READY_FOR_REVIEW }
    });
    if (!result.count) throw new ConflictException("Submission is not queued or submitting");

    await this.prisma.automationRun.create({
      data: {
        submissionId: id,
        status: "reset_to_ready_for_review",
        errorMessage: "Manually reset stale submitting status",
        finishedAt: new Date()
      }
    });
    return { ok: true };
  }

  async remove(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        guests: { include: { files: true } },
        runs: { select: { screenshotStorageKey: true } }
      }
    });
    if (!submission) throw new NotFoundException("Submission not found");

    const keys = [
      ...submission.guests.flatMap((guest) => guest.files.map((file) => file.storageKey)),
      ...submission.runs.flatMap((run) => (run.screenshotStorageKey ? [run.screenshotStorageKey] : []))
    ];
    await this.prisma.submission.delete({ where: { id } });
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    return { ok: true, deletedFiles: keys.length };
  }

  async file(id: string) {
    const file = await this.prisma.guestFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException("File not found");
    const object = await this.storage.get(file.storageKey);
    if (!object) throw new NotFoundException("File is missing from storage");
    return { file, object };
  }
}

function ensureEditable(status: SubmissionStatus) {
  if (
    status !== SubmissionStatus.READY_FOR_REVIEW &&
    status !== SubmissionStatus.FAILED &&
    status !== SubmissionStatus.REJECTED
  ) {
    throw new ConflictException("Registration can no longer be edited after PMO processing begins");
  }
}

function statusesFor(filter?: string): SubmissionStatus[] {
  if (filter === "ready_for_review") {
    return [
      SubmissionStatus.READY_FOR_REVIEW,
      SubmissionStatus.QUEUED,
      SubmissionStatus.SUBMITTING,
      SubmissionStatus.FAILED,
      SubmissionStatus.SUBMITTED_EMAIL_FAILED
    ];
  }
  if (filter === "done") return [SubmissionStatus.SUBMITTED, SubmissionStatus.SUBMITTED_EMAIL_SENT];
  if (filter === "rejected") return [SubmissionStatus.REJECTED];
  return Object.values(SubmissionStatus);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
