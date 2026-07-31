import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
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
