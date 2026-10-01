import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { EmailService } from "../automation/email.service.js";
import { AiReviewStatus, SubmissionStatus } from "../generated/prisma/enums.js";
import { JobDispatcher } from "../jobs/job.dispatcher.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AI_REVIEW_MODEL, SettingsService } from "../settings/settings.service.js";
import { StorageService } from "../storage/storage.service.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024;
const STALE_CHECK_MS = 10 * 60 * 1000;

type ReviewVerdict = "match" | "clear_mismatch" | "uncertain";
export type ReviewResult = {
  guestId: string;
  enteredName: string;
  extractedName: string | null;
  extractedNames: string[];
  matchedName: string | null;
  verdict: ReviewVerdict;
  confidence: number;
  reason: string;
};

export type ModelDocument = {
  documentReadable: boolean;
  appearsPhotoId: boolean;
  extractedName: string | null;
  confidence: number;
  explanation: string;
};

export type ModelResult = {
  imageReadable: boolean;
  documents: ModelDocument[];
  explanation: string;
};

@Injectable()
export class AiReviewService {
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    @Optional() private readonly jobs?: JobDispatcher
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue() {
    if (this.processing || process.env.ENABLE_BACKGROUND_WORKERS === "false") return;
    this.processing = true;
    try {
      if (await this.recoverStaleCheck()) return;
      const next = await this.prisma.submission.findFirst({
        where: { status: SubmissionStatus.AI_CHECK_PENDING },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });
      if (!next) return;
      const claimed = await this.prisma.submission.updateMany({
        where: { id: next.id, status: SubmissionStatus.AI_CHECK_PENDING },
        data: { status: SubmissionStatus.AI_CHECKING }
      });
      if (!claimed.count) return;
      await this.prisma.submissionAiReview.upsert({
        where: { submissionId: next.id },
        create: {
          submissionId: next.id,
          status: AiReviewStatus.CHECKING,
          model: AI_REVIEW_MODEL
        },
        update: {
          status: AiReviewStatus.CHECKING,
          model: AI_REVIEW_MODEL,
          error: null,
          checkedAt: null
        }
      });
      await this.run(next.id);
    } finally {
      this.processing = false;
    }
  }

  async approveAndQueue(submissionId: string, actor?: AuditActor) {
    const updated = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: { in: [SubmissionStatus.REJECTED, SubmissionStatus.AI_REVIEW_REQUIRED] }
      },
      data: { status: SubmissionStatus.QUEUED }
    });
    if (!updated.count) {
      const current = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true }
      });
      if (!current) throw new NotFoundException("Submission not found");
      if (current.status === SubmissionStatus.QUEUED || current.status === SubmissionStatus.SUBMITTING) {
        return { ok: true, status: current.status.toLowerCase(), alreadyRunning: true };
      }
      throw new ConflictException("This AI review cannot be overridden in its current state");
    }
    await this.prisma.automationRun.create({
      data: { submissionId, status: "queued" }
    });
    await this.audit.record(actor, "ai_id_check.overridden", "submission", submissionId, {
      status: "queued"
    });
    await this.jobs?.enqueue("automation.queue");
    return { ok: true, status: "queued" };
  }

  async retry(submissionId: string, actor?: AuditActor) {
    const updated = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: { in: [SubmissionStatus.REJECTED, SubmissionStatus.AI_REVIEW_REQUIRED] }
      },
      data: { status: SubmissionStatus.AI_CHECK_PENDING }
    });
    if (!updated.count) throw new ConflictException("This AI check cannot be retried in its current state");
    await this.prisma.submissionAiReview.upsert({
      where: { submissionId },
      create: { submissionId, status: AiReviewStatus.PENDING, model: AI_REVIEW_MODEL },
      update: {
        status: AiReviewStatus.PENDING,
        model: AI_REVIEW_MODEL,
        error: null,
        checkedAt: null,
        notificationSentAt: null,
        notificationError: null
      }
    });
    await this.audit.record(actor, "ai_id_check.retried", "submission", submissionId);
    await this.jobs?.enqueue("aiReview.queue");
    return { ok: true, status: "ai_check_pending" };
  }

  async retryNotification(submissionId: string, actor?: AuditActor) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { aiReview: true }
    });
    if (!submission) throw new NotFoundException("Submission not found");
    if (
      !submission.aiReview ||
      (submission.status !== SubmissionStatus.REJECTED &&
        submission.status !== SubmissionStatus.AI_REVIEW_REQUIRED)
    ) {
      throw new ConflictException("This submission does not have an AI review notification to retry");
    }
    await this.sendNotification(submissionId);
    await this.audit.record(actor, "ai_id_check.notification_retried", "submission", submissionId);
    return { ok: true };
  }

  private async run(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        guests: {
          where: { requiresId: true },
          orderBy: { createdAt: "asc" },
          include: { files: { orderBy: { createdAt: "asc" }, take: 1 } }
        }
      }
    });
    if (!submission) throw new Error("Submission not found");

    const results: ReviewResult[] = [];
    let processingError: string | null = null;
    if (await this.settings.isAiIdCheckEnabled()) {
      for (const guest of submission.guests) {
        try {
          results.push(await this.reviewGuest(guest));
        } catch (error) {
          const reason = error instanceof Error ? error.message : "AI review failed";
          processingError ??= reason;
          results.push({
            guestId: guest.id,
            enteredName: guest.fullName,
            extractedName: null,
            extractedNames: [],
            matchedName: null,
            verdict: "uncertain",
            confidence: 0,
            reason
          });
        }
      }
    }

    if (results.some((result) => result.verdict === "clear_mismatch")) {
      await this.finish(
        submissionId,
        AiReviewStatus.REJECTED,
        SubmissionStatus.REJECTED,
        results,
        processingError
      );
      await this.sendNotification(submissionId).catch(() => undefined);
      return;
    }
    if (results.some((result) => result.verdict === "uncertain")) {
      await this.finish(
        submissionId,
        AiReviewStatus.REVIEW_REQUIRED,
        SubmissionStatus.AI_REVIEW_REQUIRED,
        results,
        processingError
      );
      await this.sendNotification(submissionId).catch(() => undefined);
      return;
    }

    const autoQueue = await this.settings.isAutoQueueEnabled();
    await this.prisma.$transaction(async (tx) => {
      await tx.submissionAiReview.update({
        where: { submissionId },
        data: {
          status: AiReviewStatus.PASSED,
          results: results as never,
          error: null,
          checkedAt: new Date()
        }
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: autoQueue ? SubmissionStatus.QUEUED : SubmissionStatus.READY_FOR_REVIEW
        }
      });
      if (autoQueue) {
        await tx.automationRun.create({ data: { submissionId, status: "queued" } });
      }
    });
    await this.audit.record(undefined, "ai_id_check.passed", "submission", submissionId, {
      guestCount: results.length,
      status: autoQueue ? "queued" : "ready_for_review"
    });
    if (autoQueue) await this.jobs?.enqueue("automation.queue");
  }

  private async reviewGuest(guest: {
    id: string;
    fullName: string;
    files: Array<{ storageKey: string; filename: string; contentType: string; sizeBytes: number }>;
  }): Promise<ReviewResult> {
    const file = guest.files[0];
    if (!file) return uncertain(guest, "Required ID file is missing");
    if (file.sizeBytes > MAX_AI_FILE_BYTES) {
      return uncertain(guest, "ID file is larger than the 20 MB AI review limit");
    }
    const isPdf = file.contentType === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
    if (!file.contentType.startsWith("image/") && !isPdf) {
      return uncertain(guest, "ID file type is not supported for AI review");
    }
    const bytes = await this.storage.getBytes(file.storageKey);
    if (!bytes) return uncertain(guest, "ID file is missing from storage");
    const model = await this.callOpenRouter(file, bytes, isPdf);
    return classifyModelResult(guest.id, guest.fullName, model);
  }

  private async callOpenRouter(
    file: { filename: string; contentType: string },
    bytes: Uint8Array,
    isPdf: boolean
  ): Promise<ModelResult> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error("OpenRouter API key is not configured");
    const mime = isPdf ? "application/pdf" : file.contentType;
    const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    const attachment = isPdf
      ? { type: "file", file: { filename: file.filename, file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };
    const body = {
      model: AI_REVIEW_MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Inspect the entire guest upload, including every area of the image. Find every distinct visible government- or institution-issued photo ID; do not stop after the first ID. Return exactly one documents entry for every visible ID. Extract only names that are clearly printed and never infer an unreadable or missing name. If no ID is visible, return an empty documents array. Report overall image readability and a short explanation."
            },
            attachment
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "guest_id_review",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["image_readable", "documents", "explanation"],
            properties: {
              image_readable: { type: "boolean" },
              documents: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "document_readable",
                    "appears_photo_id",
                    "extracted_name",
                    "confidence",
                    "explanation"
                  ],
                  properties: {
                    document_readable: { type: "boolean" },
                    appears_photo_id: { type: "boolean" },
                    extracted_name: { type: ["string", "null"] },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    explanation: { type: "string", maxLength: 500 }
                  }
                }
              },
              explanation: { type: "string", maxLength: 500 }
            }
          }
        }
      },
      provider: { zdr: true, data_collection: "deny", require_parameters: true },
      ...(isPdf ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {})
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "HTTP-Referer": process.env.PUBLIC_APP_URL?.trim() || "https://cozy-d714.app",
            "X-Title": "Cozy D-714 guest ID review"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000)
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
        return parseModelResult(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("OpenRouter request failed");
      }
    }
    throw lastError ?? new Error("OpenRouter request failed");
  }

  private async finish(
    submissionId: string,
    reviewStatus: AiReviewStatus,
    submissionStatus: SubmissionStatus,
    results: ReviewResult[],
    error: string | null
  ) {
    await this.prisma.$transaction([
      this.prisma.submissionAiReview.update({
        where: { submissionId },
        data: {
          status: reviewStatus,
          results: results as never,
          error,
          checkedAt: new Date(),
          notificationSentAt: null,
          notificationError: null
        }
      }),
      this.prisma.submission.update({ where: { id: submissionId }, data: { status: submissionStatus } })
    ]);
    await this.audit.record(
      undefined,
      `ai_id_check.${reviewStatus.toLowerCase()}`,
      "submission",
      submissionId,
      {
        guestCount: results.length,
        error
      }
    );
  }

  private async sendNotification(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { aiReview: true }
    });
    if (!submission?.aiReview) throw new Error("AI review not found");
    const results = readStoredResults(submission.aiReview.results);
    const reviewEmail = await this.settings.getAiReviewEmail();
    const link = `${(process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}/admin/submissions/${submissionId}`;
    const title =
      submission.status === SubmissionStatus.REJECTED ? "AI ID check rejected" : "AI ID check needs review";
    const rows = results
      .map(
        (result) =>
          `<tr><td>${escapeHtml(result.enteredName)}</td><td>${escapeHtml(result.extractedNames.join(", ") || "—")}</td><td>${escapeHtml(result.matchedName ?? "—")}</td><td>${escapeHtml(result.reason)}</td></tr>`
      )
      .join("");
    const html = `<h1>${title}</h1><p>Submission ${escapeHtml(submissionId)} requires your attention.</p><table border="1" cellpadding="8" cellspacing="0"><thead><tr><th>Entered name</th><th>All extracted names</th><th>Matched name</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table><p>Model: ${escapeHtml(submission.aiReview.model)}<br>Checked: ${escapeHtml(submission.aiReview.checkedAt?.toISOString() ?? "unknown")}</p><p><a href="${escapeHtml(link)}">Open registration review</a></p>`;
    try {
      await this.email.sendMessage({ to: reviewEmail, subject: `${title}: ${submission.guestEmail}`, html });
      await this.prisma.submissionAiReview.update({
        where: { submissionId },
        data: { notificationSentAt: new Date(), notificationError: null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send AI review notification";
      await this.prisma.submissionAiReview.update({
        where: { submissionId },
        data: { notificationError: message }
      });
      throw error;
    }
  }

  private async recoverStaleCheck() {
    const stale = await this.prisma.submission.findFirst({
      where: {
        status: SubmissionStatus.AI_CHECKING,
        aiReview: { updatedAt: { lt: new Date(Date.now() - STALE_CHECK_MS) } }
      },
      select: { id: true }
    });
    if (!stale) return false;
    const result: ReviewResult = {
      guestId: "unknown",
      enteredName: "Unknown guest",
      extractedName: null,
      extractedNames: [],
      matchedName: null,
      verdict: "uncertain",
      confidence: 0,
      reason: "AI review worker did not finish within 10 minutes"
    };
    await this.finish(
      stale.id,
      AiReviewStatus.REVIEW_REQUIRED,
      SubmissionStatus.AI_REVIEW_REQUIRED,
      [result],
      result.reason
    );
    await this.sendNotification(stale.id).catch(() => undefined);
    return true;
  }
}

export function namesMatch(entered: string, extracted: string) {
  const left = nameTokens(entered);
  const right = nameTokens(extracted);
  if (!left.length || !right.length) return false;
  if (left.length === 1 || right.length === 1) {
    return left.length === right.length && tokensCompatible(left[0], right[0]);
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const available = [...longer];
  return shorter.every((token) => {
    const index = available.findIndex((candidate) => tokensCompatible(token, candidate));
    if (index < 0) return false;
    available.splice(index, 1);
    return true;
  });
}

export function classifyModelResult(guestId: string, enteredName: string, model: ModelResult): ReviewResult {
  const guest = { id: guestId, fullName: enteredName };
  const extractedNames = uniqueNames(model.documents.map((document) => document.extractedName));
  const readableCandidates = model.documents.filter(
    (document) =>
      document.documentReadable &&
      document.appearsPhotoId &&
      Boolean(document.extractedName?.trim()) &&
      document.confidence >= 0.9
  );
  const match = readableCandidates.find((document) => namesMatch(enteredName, document.extractedName!));
  if (match) {
    const matchedName = match.extractedName!.trim();
    return {
      guestId,
      enteredName,
      extractedName: extractedNames[0] ?? null,
      extractedNames,
      matchedName,
      verdict: "match",
      confidence: match.confidence,
      reason: "Entered name matches one of the visible IDs after normalization"
    };
  }
  if (!model.imageReadable) return uncertain(guest, "The uploaded image is not readable", model);
  if (!model.documents.length) return uncertain(guest, "No photo ID could be detected", model);
  if (readableCandidates.length !== model.documents.length) {
    return uncertain(
      guest,
      "At least one visible ID could not be read and verified with at least 90% confidence",
      model
    );
  }
  if (
    nameTokens(enteredName).length >= 2 &&
    readableCandidates.every((document) => nameTokens(document.extractedName!).length >= 2)
  ) {
    return {
      guestId,
      enteredName,
      extractedName: extractedNames[0] ?? null,
      extractedNames,
      matchedName: null,
      verdict: "clear_mismatch",
      confidence: Math.min(...readableCandidates.map((document) => document.confidence)),
      reason: "None of the readable, high-confidence ID names match the entered guest name"
    };
  }
  return uncertain(guest, "The names do not contain enough information for a clear decision", model);
}

function nameTokens(value: string) {
  const ignored = new Set(["mr", "mrs", "ms", "miss", "jr", "sr", "ii", "iii", "iv"]);
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !ignored.has(token));
}

function tokensCompatible(left: string, right: string) {
  return (
    left === right ||
    (left.length === 1 && right.startsWith(left)) ||
    (right.length === 1 && left.startsWith(right))
  );
}

function uncertain(
  guest: { id: string; fullName: string },
  reason: string,
  model?: ModelResult
): ReviewResult {
  return {
    guestId: guest.id,
    enteredName: guest.fullName,
    extractedName: model
      ? (uniqueNames(model.documents.map((document) => document.extractedName))[0] ?? null)
      : null,
    extractedNames: model ? uniqueNames(model.documents.map((document) => document.extractedName)) : [],
    matchedName: null,
    verdict: "uncertain",
    confidence: model ? Math.max(0, ...model.documents.map((document) => document.confidence)) : 0,
    reason
  };
}

function parseModelResult(payload: unknown): ModelResult {
  const outer = payload as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = outer?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter returned an invalid structured response");
  const value = JSON.parse(content) as Record<string, unknown>;
  if (
    !Array.isArray(value.documents) ||
    typeof value.image_readable !== "boolean" ||
    typeof value.explanation !== "string"
  ) {
    throw new Error("OpenRouter returned an invalid structured response");
  }
  const documents = value.documents.map((item) => parseModelDocument(item));
  return {
    imageReadable: value.image_readable,
    documents,
    explanation: value.explanation.slice(0, 500)
  };
}

function parseModelDocument(value: unknown): ModelDocument {
  const item = value as Record<string, unknown> | null;
  if (
    !item ||
    typeof item.document_readable !== "boolean" ||
    typeof item.appears_photo_id !== "boolean" ||
    (typeof item.extracted_name !== "string" && item.extracted_name !== null) ||
    typeof item.confidence !== "number" ||
    item.confidence < 0 ||
    item.confidence > 1 ||
    typeof item.explanation !== "string"
  ) {
    throw new Error("OpenRouter returned an invalid structured response");
  }
  return {
    documentReadable: item.document_readable,
    appearsPhotoId: item.appears_photo_id,
    extractedName: item.extracted_name,
    confidence: item.confidence,
    explanation: item.explanation.slice(0, 500)
  };
}

export function readStoredResults(value: unknown): ReviewResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const legacy = item as Partial<ReviewResult>;
    const extractedNames = uniqueNames(
      Array.isArray(legacy.extractedNames) ? legacy.extractedNames : [legacy.extractedName]
    );
    return [
      {
        guestId: String(legacy.guestId ?? "unknown"),
        enteredName: String(legacy.enteredName ?? "Unknown guest"),
        extractedName: extractedNames[0] ?? null,
        extractedNames,
        matchedName:
          typeof legacy.matchedName === "string"
            ? legacy.matchedName
            : legacy.verdict === "match"
              ? (extractedNames[0] ?? null)
              : null,
        verdict:
          legacy.verdict === "match" || legacy.verdict === "clear_mismatch" ? legacy.verdict : "uncertain",
        confidence: typeof legacy.confidence === "number" ? legacy.confidence : 0,
        reason: typeof legacy.reason === "string" ? legacy.reason : "Stored AI result needs review"
      }
    ];
  });
}

function uniqueNames(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const name = value?.trim();
    if (!name) return [];
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
