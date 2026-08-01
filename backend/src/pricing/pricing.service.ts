import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { pricingConfigSchema, type PricingConfig } from "@cozy-d-714/shared";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { PricingRunMode, PricingRunStatus } from "../generated/prisma/enums.js";
import { HostexClient } from "../hostex/hostex.client.js";
import { localDate } from "../hostex/hostex.time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { addDays, calculatePricing, compressPrices, type CalculatedPricingDay } from "./pricing.engine.js";

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostex: HostexClient,
    private readonly audit: AuditService
  ) {}

  async settings() {
    const [settings, history] = await Promise.all([
      this.requiredSettings(),
      this.prisma.pricingSettingVersion.findMany({
        where: { settingId: "primary" },
        orderBy: { version: "desc" },
        take: 20,
        select: { version: true, changedBy: true, createdAt: true }
      })
    ]);
    return {
      version: settings.version,
      automationOn: settings.automationOn,
      automationAvailable: process.env.ENABLE_HOSTEX_PRICING_AUTOMATION === "true",
      config: pricingConfigSchema.parse(settings.config),
      updatedAt: settings.updatedAt.toISOString(),
      updatedBy: settings.updatedBy,
      history: history.map((item) => ({
        version: item.version,
        changedBy: item.changedBy,
        createdAt: item.createdAt.toISOString()
      }))
    };
  }

  async updateSettings(config: PricingConfig, expectedVersion: number, actor?: AuditActor) {
    const parsed = pricingConfigSchema.parse(config);
    const current = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.pricingSetting.updateMany({
        where: { id: "primary", version: expectedVersion },
        data: { config: parsed as never, version: { increment: 1 }, updatedBy: actor?.email ?? null }
      });
      if (!updated.count) throw new ConflictException("Pricing settings changed; refresh before saving");
      const value = await transaction.pricingSetting.findUnique({ where: { id: "primary" } });
      if (!value) throw new Error("Pricing settings are missing");
      await transaction.pricingSettingVersion.create({
        data: {
          settingId: value.id,
          version: value.version,
          config: value.config as never,
          changedBy: actor?.email ?? null
        }
      });
      return value;
    });
    await this.audit.record(actor, "pricing.settings_updated", "pricing_settings", "primary", {
      version: current.version
    });
    return this.settings();
  }

  async setAutomation(enabled: boolean, actor?: AuditActor) {
    await this.prisma.pricingSetting.update({
      where: { id: "primary" },
      data: { automationOn: enabled, updatedBy: actor?.email ?? null }
    });
    await this.audit.record(
      actor,
      enabled ? "pricing.automation_enabled" : "pricing.automation_disabled",
      "pricing_settings",
      "primary"
    );
    return this.settings();
  }

  async preview(actor?: AuditActor, mode: PricingRunMode = PricingRunMode.PREVIEW, runKey?: string) {
    const settings = await this.requiredSettings();
    const config = pricingConfigSchema.parse(settings.config);
    let claimed;
    try {
      claimed = await this.prisma.pricingRun.create({
        data: {
          runKey,
          mode,
          status: PricingRunStatus.RUNNING,
          settingsVersion: settings.version,
          configSnapshot: config as never,
          initiatedBy: actor?.email ?? null
        }
      });
    } catch (error) {
      if (runKey && isUniqueConstraint(error)) {
        return this.getRunByKey(runKey);
      }
      throw error;
    }

    try {
      const today = localDate(new Date(), config.timezone);
      const end = addDays(today, config.horizonDays);
      const [bookings, availabilities] = await Promise.all([
        this.prisma.booking.findMany({
          where: {
            status: "accepted",
            checkOut: { gte: dateValue(today) },
            checkIn: { lte: dateValue(end) }
          },
          select: { checkIn: true, checkOut: true, status: true }
        }),
        this.hostex.getAvailabilities(config.propertyId, today, end)
      ]);
      const calculated = calculatePricing(
        today,
        config,
        bookings.map((booking) => ({
          checkIn: dateOnly(booking.checkIn),
          checkOut: dateOnly(booking.checkOut),
          status: booking.status
        })),
        availabilities
      );
      const run = await this.prisma.pricingRun.update({
        where: { id: claimed.id },
        data: {
          status: PricingRunStatus.PREVIEWED,
          occupancy: calculated.occupancy as never,
          finishedAt: new Date(),
          days: {
            create: calculated.days.map((day) => ({
              date: dateValue(day.date),
              airbnbPrice: day.airbnbPrice,
              available: day.available,
              occupancyRatio: day.occupancyRatio,
              event: day.event,
              reasons: day.reasons as never
            }))
          }
        },
        include: { days: { orderBy: { date: "asc" } } }
      });
      await this.audit.record(actor, "pricing.previewed", "pricing_run", run.id, {
        settingsVersion: settings.version,
        dayCount: run.days.length
      });
      return runView(run);
    } catch (error) {
      await this.prisma.pricingRun.update({
        where: { id: claimed.id },
        data: { status: PricingRunStatus.FAILED, finishedAt: new Date(), errorMessage: safeError(error) }
      });
      throw error;
    }
  }

  async apply(runId: string, actor?: AuditActor) {
    const run = await this.prisma.pricingRun.findUnique({
      where: { id: runId },
      include: { days: { orderBy: { date: "asc" } }, submissions: true }
    });
    if (!run) throw new NotFoundException("Pricing preview not found");
    if (run.status !== PricingRunStatus.PREVIEWED)
      throw new ConflictException("Only a preview can be applied");
    const settings = await this.requiredSettings();
    if (settings.version !== run.settingsVersion)
      throw new ConflictException("Pricing settings changed; create a new preview");

    const claimed = await this.prisma.pricingRun.updateMany({
      where: { id: runId, status: PricingRunStatus.PREVIEWED },
      data: {
        status: PricingRunStatus.RUNNING,
        mode: run.mode === PricingRunMode.AUTOMATIC ? run.mode : PricingRunMode.MANUAL,
        finishedAt: null
      }
    });
    if (!claimed.count) throw new ConflictException("Pricing preview is already being applied");

    const config = pricingConfigSchema.parse(run.configSnapshot);
    const days: CalculatedPricingDay[] = run.days.map((day) => ({
      date: dateOnly(day.date),
      airbnbPrice: day.airbnbPrice,
      available: day.available,
      occupancyRatio: day.occupancyRatio,
      event: day.event,
      reasons: Array.isArray(day.reasons) ? day.reasons.map(String) : []
    }));
    let failures = 0;
    for (const listing of config.listings) {
      const ranges = compressPrices(days, listing.ratio);
      try {
        const result = await this.hostex.submitPrices(listing.channelType, listing.listingId, ranges);
        await this.prisma.pricingSubmission.create({
          data: {
            runId,
            channelType: listing.channelType,
            listingId: listing.listingId,
            ratio: listing.ratio,
            rangeCount: ranges.length,
            requestId: result.requestId,
            status: "submitted"
          }
        });
      } catch (error) {
        failures += 1;
        await this.prisma.pricingSubmission.create({
          data: {
            runId,
            channelType: listing.channelType,
            listingId: listing.listingId,
            ratio: listing.ratio,
            rangeCount: ranges.length,
            status: "failed",
            error: safeError(error)
          }
        });
      }
    }
    const status = failures
      ? failures === config.listings.length
        ? PricingRunStatus.FAILED
        : PricingRunStatus.PARTIAL_FAILED
      : PricingRunStatus.SUBMITTED;
    await this.prisma.pricingRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: failures ? `${failures} listing submission(s) failed` : null
      }
    });
    await this.audit.record(actor, "pricing.applied", "pricing_run", runId, {
      status: status.toLowerCase(),
      failures
    });
    return this.getRun(runId);
  }

  async retryListing(runId: string, submissionId: string, actor?: AuditActor) {
    const run = await this.prisma.pricingRun.findUnique({
      where: { id: runId },
      include: { days: { orderBy: { date: "asc" } }, submissions: { orderBy: { attempt: "asc" } } }
    });
    if (!run) throw new NotFoundException("Pricing run not found");
    const failed = run.submissions.find((submission) => submission.id === submissionId);
    if (!failed || failed.status !== "failed")
      throw new ConflictException("Only a failed listing can be retried");
    const newer = run.submissions.some(
      (submission) =>
        submission.channelType === failed.channelType &&
        submission.listingId === failed.listingId &&
        submission.attempt > failed.attempt
    );
    if (newer) throw new ConflictException("A newer retry already exists for this listing");

    const config = pricingConfigSchema.parse(run.configSnapshot);
    const listing = config.listings.find(
      (item) => item.channelType === failed.channelType && item.listingId === failed.listingId
    );
    if (!listing) throw new ConflictException("The failed listing is no longer in this settings snapshot");
    const days: CalculatedPricingDay[] = run.days.map((day) => ({
      date: dateOnly(day.date),
      airbnbPrice: day.airbnbPrice,
      available: day.available,
      occupancyRatio: day.occupancyRatio,
      event: day.event,
      reasons: Array.isArray(day.reasons) ? day.reasons.map(String) : []
    }));
    const ranges = compressPrices(days, listing.ratio);
    let retry;
    try {
      retry = await this.prisma.pricingSubmission.create({
        data: {
          runId,
          channelType: listing.channelType,
          listingId: listing.listingId,
          ratio: listing.ratio,
          rangeCount: ranges.length,
          attempt: failed.attempt + 1,
          status: "sending"
        }
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ConflictException("This listing retry is already running");
      throw error;
    }

    try {
      const result = await this.hostex.submitPrices(listing.channelType, listing.listingId, ranges);
      await this.prisma.pricingSubmission.update({
        where: { id: retry.id },
        data: { status: "submitted", requestId: result.requestId, error: null }
      });
    } catch (error) {
      await this.prisma.pricingSubmission.update({
        where: { id: retry.id },
        data: { status: "failed", error: safeError(error) }
      });
    }
    await this.recomputeRunStatus(runId, config);
    await this.audit.record(actor, "pricing.listing_retried", "pricing_run", runId, {
      channelType: listing.channelType,
      listingId: listing.listingId,
      attempt: retry.attempt
    });
    return this.getRun(runId);
  }

  async runs() {
    const runs = await this.prisma.pricingRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { submissions: { orderBy: { createdAt: "asc" } } }
    });
    return {
      runs: runs.map((run) => ({ ...runSummary(run), submissions: run.submissions.map(submissionView) }))
    };
  }

  async getRun(id: string) {
    const run = await this.prisma.pricingRun.findUnique({
      where: { id },
      include: { days: { orderBy: { date: "asc" } }, submissions: true }
    });
    if (!run) throw new NotFoundException("Pricing run not found");
    return { run: { ...runView(run), submissions: run.submissions.map(submissionView) } };
  }

  @Cron("0 8 * * *", { timeZone: "Asia/Manila" })
  async automaticPricing() {
    if (process.env.ENABLE_HOSTEX_PRICING_AUTOMATION !== "true") return;
    const settings = await this.requiredSettings();
    if (!settings.automationOn) return;
    const date = localDate(new Date(), "Asia/Manila");
    const preview = await this.preview(undefined, PricingRunMode.AUTOMATIC, `automatic:${date}`);
    if (preview.status === "previewed") await this.apply(preview.id);
  }

  private async getRunByKey(runKey: string) {
    const run = await this.prisma.pricingRun.findUnique({
      where: { runKey },
      include: { days: { orderBy: { date: "asc" } } }
    });
    if (!run) throw new Error("Automatic pricing run disappeared");
    return runView(run);
  }

  private async requiredSettings() {
    const settings = await this.prisma.pricingSetting.findUnique({ where: { id: "primary" } });
    if (!settings) throw new Error("Pricing settings are missing");
    return settings;
  }

  private async recomputeRunStatus(runId: string, config: PricingConfig) {
    const submissions = await this.prisma.pricingSubmission.findMany({
      where: { runId },
      orderBy: { attempt: "asc" }
    });
    const latest = new Map<string, (typeof submissions)[number]>();
    for (const submission of submissions) {
      latest.set(`${submission.channelType}:${submission.listingId}`, submission);
    }
    const failed = config.listings.filter(
      (listing) => latest.get(`${listing.channelType}:${listing.listingId}`)?.status !== "submitted"
    ).length;
    await this.prisma.pricingRun.update({
      where: { id: runId },
      data: {
        status: failed
          ? failed === config.listings.length
            ? PricingRunStatus.FAILED
            : PricingRunStatus.PARTIAL_FAILED
          : PricingRunStatus.SUBMITTED,
        errorMessage: failed ? `${failed} listing submission(s) failed` : null,
        finishedAt: new Date()
      }
    });
  }
}

function runSummary(run: {
  id: string;
  mode: PricingRunMode;
  status: PricingRunStatus;
  settingsVersion: number;
  initiatedBy: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: run.id,
    mode: run.mode.toLowerCase(),
    status: run.status.toLowerCase(),
    settingsVersion: run.settingsVersion,
    initiatedBy: run.initiatedBy,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null
  };
}

function runView(
  run: Parameters<typeof runSummary>[0] & {
    occupancy: unknown;
    days: Array<{
      date: Date;
      airbnbPrice: number;
      available: boolean;
      occupancyRatio: number;
      event: string | null;
      reasons: unknown;
    }>;
  }
) {
  return {
    ...runSummary(run),
    occupancy: run.occupancy ?? {},
    days: run.days.map((day) => ({
      date: dateOnly(day.date),
      airbnbPrice: day.airbnbPrice,
      available: day.available,
      occupancyRatio: day.occupancyRatio,
      event: day.event,
      reasons: Array.isArray(day.reasons) ? day.reasons.map(String) : []
    }))
  };
}

function submissionView(submission: {
  id: string;
  channelType: string;
  listingId: string;
  attempt: number;
  status: string;
  requestId: string | null;
  error: string | null;
  createdAt: Date;
}) {
  return {
    id: submission.id,
    channelType: submission.channelType,
    listingId: submission.listingId,
    attempt: submission.attempt,
    status: submission.status,
    requestId: submission.requestId,
    error: submission.error,
    createdAt: submission.createdAt.toISOString()
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Hostex pricing failed";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500);
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
