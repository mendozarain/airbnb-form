import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BUILDING_CODES, PURPOSES, type BuildingCode, type Purpose } from "@cozy-d-714/shared";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { EmailService } from "./email.service.js";
import { GoogleFormRunner, type GoogleFormFile, type GoogleFormSubmission } from "./google-form.runner.js";
import { PassImageService } from "./pass-image.service.js";

const EMAIL_SENDABLE_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED_EMAIL_FAILED,
  SubmissionStatus.SUBMITTED_EMAIL_SENT
];

@Injectable()
export class AutomationService {
  private processing = false;
  private cleaning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly runner: GoogleFormRunner,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly passImages: PassImageService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue() {
    if (this.processing || process.env.ENABLE_BACKGROUND_WORKERS === "false") return;
    this.processing = true;
    try {
      const next = await this.prisma.submission.findFirst({
        where: { status: SubmissionStatus.QUEUED },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });
      if (!next) return;

      const claimed = await this.prisma.submission.updateMany({
        where: { id: next.id, status: SubmissionStatus.QUEUED },
        data: { status: SubmissionStatus.SUBMITTING }
      });
      if (claimed.count) await this.run(next.id);
    } finally {
      this.processing = false;
    }
  }

  @Cron("17 18 * * *")
  async cleanup() {
    if (this.cleaning || process.env.ENABLE_BACKGROUND_WORKERS === "false") return;
    this.cleaning = true;
    try {
      await this.cleanupExpiredIds();
      await this.cleanupOldScreenshots();
      await this.cleanupOrphanUploads();
    } finally {
      this.cleaning = false;
    }
  }

  async retryEmail(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        guestEmail: true,
        purpose: true,
        status: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, screenshotStorageKey: true }
        }
      }
    });
    if (!submission) throw new NotFoundException("Submission not found");
    if (!EMAIL_SENDABLE_STATUSES.includes(submission.status)) {
      throw new ConflictException("Submission does not have an entrance pass email to send");
    }

    const run = submission.runs[0];
    if (!run?.screenshotStorageKey) {
      throw new ConflictException("Entrance pass screenshot is missing");
    }

    const claimed = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: { in: EMAIL_SENDABLE_STATUSES } },
      data: { status: SubmissionStatus.SUBMITTED }
    });
    if (!claimed.count) throw new ConflictException("Email send is already running");

    try {
      const screenshot = await this.storage.head(run.screenshotStorageKey);
      if (!screenshot) throw new Error("Entrance pass screenshot is missing from storage");
      await this.email.sendEntrancePass(
        submission.guestEmail,
        await this.settings.getEmailTemplate(parsePurpose(submission.purpose)),
        this.passImages.createUrl(run.screenshotStorageKey)
      );
      await this.prisma.$transaction([
        this.prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "submitted_email_sent", errorMessage: null, finishedAt: new Date() }
        }),
        this.prisma.submission.update({
          where: { id: submissionId },
          data: { status: SubmissionStatus.SUBMITTED_EMAIL_SENT }
        })
      ]);
      return { ok: true, status: "submitted_email_sent" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not email entrance pass";
      await this.prisma.$transaction([
        this.prisma.automationRun.update({
          where: { id: run.id },
          data: { status: "submitted_email_failed", errorMessage: message, finishedAt: new Date() }
        }),
        this.prisma.submission.update({
          where: { id: submissionId },
          data: { status: SubmissionStatus.SUBMITTED_EMAIL_FAILED }
        })
      ]);
      throw error;
    }
  }

  private async run(submissionId: string) {
    try {
      const submission = await this.loadSubmission(submissionId);
      const result = await this.runner.submit(submission);
      let status: SubmissionStatus = result.ok
        ? SubmissionStatus.SUBMITTED
        : result.retryable
          ? SubmissionStatus.READY_FOR_REVIEW
          : SubmissionStatus.FAILED;
      let errorMessage = result.error ?? null;

      if (result.ok && result.screenshotKey) {
        try {
          const screenshot = await this.storage.head(result.screenshotKey);
          if (!screenshot) throw new Error("Entrance pass screenshot is missing from storage");
          await this.email.sendEntrancePass(
            submission.guestEmail,
            await this.settings.getEmailTemplate(submission.purpose),
            this.passImages.createUrl(result.screenshotKey)
          );
          status = SubmissionStatus.SUBMITTED_EMAIL_SENT;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : "Could not email entrance pass";
          status = SubmissionStatus.SUBMITTED_EMAIL_FAILED;
        }
      }

      await this.finishRun(submissionId, status.toLowerCase(), errorMessage, result.screenshotKey);
      await this.prisma.submission.update({ where: { id: submissionId }, data: { status } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not confirm submission";
      await this.finishRun(submissionId, "failed", message);
      await this.prisma.submission.updateMany({
        where: { id: submissionId, status: { in: [SubmissionStatus.QUEUED, SubmissionStatus.SUBMITTING] } },
        data: { status: SubmissionStatus.FAILED }
      });
    }
  }

  private async finishRun(
    submissionId: string,
    status: string,
    errorMessage: string | null,
    screenshotStorageKey?: string
  ) {
    const run = await this.prisma.automationRun.findFirst({
      where: { submissionId, status: "queued" },
      orderBy: { createdAt: "desc" }
    });
    const data = { status, errorMessage, screenshotStorageKey, finishedAt: new Date() };
    if (run) await this.prisma.automationRun.update({ where: { id: run.id }, data });
    else await this.prisma.automationRun.create({ data: { submissionId, ...data } });
  }

  private async loadSubmission(submissionId: string): Promise<GoogleFormSubmission> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        guests: {
          orderBy: { createdAt: "asc" },
          include: { files: true }
        }
      }
    });
    if (!submission) throw new Error("Submission not found");
    if (!BUILDING_CODES.includes(submission.buildingCode as BuildingCode))
      throw new Error("Invalid building code");
    if (!PURPOSES.includes(submission.purpose as Purpose)) throw new Error("Invalid purpose");

    const idFiles: GoogleFormFile[] = [];
    for (const file of submission.guests.flatMap((guest) => guest.files)) {
      const bytes = await this.storage.getBytes(file.storageKey);
      if (!bytes) throw new Error(`ID file is missing from storage: ${file.filename}`);
      idFiles.push({
        filename: file.filename,
        contentType: file.contentType,
        bytes: toArrayBuffer(bytes)
      });
    }

    return {
      guestEmail: submission.guestEmail,
      buildingCode: submission.buildingCode as BuildingCode,
      unitNumber: submission.unitNumber,
      checkIn: submission.checkIn.toISOString(),
      checkOut: submission.checkOut.toISOString(),
      purpose: submission.purpose as Purpose,
      ownerName: submission.ownerName,
      ownerContact: submission.ownerContact,
      guests: submission.guests.map((guest) => ({ fullName: guest.fullName, age: guest.age })),
      idFiles
    };
  }

  private async cleanupExpiredIds() {
    const files = await this.prisma.guestFile.findMany({
      where: { deleteAfter: { lt: new Date() } },
      select: { id: true, storageKey: true }
    });
    for (const file of files) {
      await this.storage.delete(file.storageKey).catch(() => undefined);
      await this.prisma.guestFile.delete({ where: { id: file.id } }).catch(() => undefined);
    }
  }

  private async cleanupOldScreenshots() {
    const cutoff = new Date(Date.now() - 31 * 86400000);
    const runs = await this.prisma.automationRun.findMany({
      where: { createdAt: { lt: cutoff }, screenshotStorageKey: { not: null } },
      select: { id: true, screenshotStorageKey: true }
    });
    for (const run of runs) {
      if (run.screenshotStorageKey)
        await this.storage.delete(run.screenshotStorageKey).catch(() => undefined);
      await this.prisma.automationRun.update({
        where: { id: run.id },
        data: { screenshotStorageKey: null }
      });
    }
  }

  private async cleanupOrphanUploads() {
    let cursor: string | undefined;
    const cutoff = new Date(Date.now() - 86400000);
    do {
      const page = await this.storage.list("ids/", cursor);
      cursor = page.nextCursor;
      const candidates = page.objects.filter((object) => object.lastModified < cutoff);
      if (!candidates.length) continue;
      const keys = candidates.map((object) => object.key);
      const referenced = await this.prisma.guestFile.findMany({
        where: { storageKey: { in: keys } },
        select: { storageKey: true }
      });
      const keep = new Set(referenced.map((item) => item.storageKey));
      await Promise.allSettled(keys.filter((key) => !keep.has(key)).map((key) => this.storage.delete(key)));
    } while (cursor);
  }
}

function toArrayBuffer(bytes: Buffer) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parsePurpose(value: string): Purpose {
  if (PURPOSES.includes(value as Purpose)) return value as Purpose;
  throw new Error("Invalid purpose");
}
