import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  PRICING_ALGORITHM,
  channelPrice,
  pricingTier,
  pricingConfigSchema,
  type AirbnbPricingRulesPatch,
  type PricingConfig
} from "@cozy-d-714/shared";
import { AuditService, type AuditActor } from "../audit/audit.service.js";
import { PricingRunMode, PricingRunStatus } from "../generated/prisma/enums.js";
import {
  HostexClient,
  type HostexAirbnbPriceRules,
  type HostexDiscountRule
} from "../hostex/hostex.client.js";
import { localDate } from "../hostex/hostex.time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { upgradePricingConfig } from "./pricing.config.js";
import { addDays, calculatePricing, compressPrices, type CalculatedPricingDay } from "./pricing.engine.js";

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostex: HostexClient,
    private readonly audit: AuditService
  ) {}

  async settings() {
    const settings = await this.requiredSettings();
    const history = await this.prisma.pricingSettingVersion.findMany({
      where: { settingId: "primary" },
      orderBy: { version: "desc" },
      take: 20,
      select: { version: true, changedBy: true, createdAt: true }
    });
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
    await this.requiredSettings();
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
    await this.requiredSettings();
    if (enabled && process.env.ENABLE_HOSTEX_PRICING_AUTOMATION !== "true") {
      throw new ConflictException("Pricing automation is disabled in the server environment");
    }
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

  async airbnbSettings() {
    const listingId = await this.airbnbListingId();
    const settings = await this.hostex.getAirbnbPriceAndRules(listingId);
    return airbnbRulesView(listingId, settings);
  }

  async updateAirbnbSettings(patch: AirbnbPricingRulesPatch, actor?: AuditActor) {
    const listingId = await this.airbnbListingId();
    const current = await this.hostex.getAirbnbPriceAndRules(listingId);
    const settings = airbnbRulesPatch(patch, current);
    const result = await this.hostex.updateAirbnbPriceAndRules(listingId, settings);
    await this.audit.record(actor, "pricing.airbnb_settings_updated", "airbnb_listing", listingId, {
      fields: Object.keys(patch),
      requestId: result.requestId
    });
    return this.airbnbSettings();
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
    const config = await this.assertPublishable(run);
    if (!run.days.some((day) => day.available)) throw new ConflictException("No available nights to publish");

    const claimed = await this.prisma.pricingRun.updateMany({
      where: { id: runId, status: PricingRunStatus.PREVIEWED },
      data: {
        status: PricingRunStatus.RUNNING,
        mode: run.mode === PricingRunMode.AUTOMATIC ? run.mode : PricingRunMode.MANUAL,
        finishedAt: null
      }
    });
    if (!claimed.count) throw new ConflictException("Pricing preview is already being applied");

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
      if (!ranges.length) continue;
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

    const config = await this.assertPublishable(run);
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
    if (!ranges.length) throw new ConflictException("No available nights to publish; create a new preview");
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
    if (preview.status === "previewed" && preview.days.some((day) => day.available))
      await this.apply(preview.id);
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
    if (hasCurrentAlgorithm(settings.config)) return settings;
    const config = upgradePricingConfig(settings.config);
    // Upgrade config, version history and audit together. Only the winning reader upgrades.
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.pricingSetting.updateMany({
        where: { id: settings.id, version: settings.version },
        data: {
          config: config as never,
          version: { increment: 1 },
          automationOn: false,
          updatedBy: "system:pricing-upgrade"
        }
      });
      const current = await transaction.pricingSetting.findUnique({ where: { id: settings.id } });
      if (!current || !hasCurrentAlgorithm(current.config)) {
        throw new ConflictException("Pricing settings changed during upgrade; refresh and try again");
      }
      if (changed.count) {
        await transaction.pricingSettingVersion.create({
          data: {
            settingId: current.id,
            version: current.version,
            config: current.config as never,
            changedBy: "system:pricing-upgrade"
          }
        });
        await transaction.adminAuditEvent.create({
          data: {
            action: "pricing.algorithm_upgraded",
            entityType: "pricing_settings",
            entityId: current.id,
            details: {
              algorithm: PRICING_ALGORITHM,
              previousVersion: settings.version,
              version: current.version,
              bookingMarkup: 30,
              agodaMarkup: 30,
              automationPaused: true
            }
          }
        });
      }
      return current;
    });
  }

  private async assertPublishable(run: {
    configSnapshot: unknown;
    settingsVersion: number;
    startedAt: Date;
    days: Array<{ date: Date; available: boolean }>;
  }) {
    if (!hasCurrentAlgorithm(run.configSnapshot)) {
      throw new ConflictException("This run uses the retired pricing algorithm; create a new preview");
    }
    const settings = await this.requiredSettings();
    if (settings.version !== run.settingsVersion) {
      throw new ConflictException("Pricing settings changed; create a new preview");
    }
    const config = pricingConfigSchema.parse(run.configSnapshot);
    const today = localDate(new Date(), config.timezone);
    if (localDate(run.startedAt, config.timezone) !== today) {
      throw new ConflictException("Pricing preview is from a different day; create a new preview");
    }
    const end = addDays(today, config.horizonDays);
    const [availabilities, bookings] = await Promise.all([
      this.hostex.getAvailabilities(config.propertyId, today, end),
      this.prisma.booking.findMany({
        where: { status: "accepted", checkOut: { gte: dateValue(today) }, checkIn: { lte: dateValue(end) } },
        select: { checkIn: true, checkOut: true, status: true }
      })
    ]);
    const fresh = calculatePricing(
      today,
      config,
      bookings.map((booking) => ({
        checkIn: dateOnly(booking.checkIn),
        checkOut: dateOnly(booking.checkOut),
        status: booking.status
      })),
      availabilities
    );
    const previous = new Map(run.days.map((day) => [dateOnly(day.date), day.available]));
    if (
      fresh.days.length !== run.days.length ||
      fresh.days.some((day) => previous.get(day.date) !== day.available)
    ) {
      throw new ConflictException("Availability changed; create a new preview");
    }
    return config;
  }

  private async airbnbListingId() {
    const settings = await this.requiredSettings();
    const config = pricingConfigSchema.parse(settings.config);
    const listing = config.listings.find((item) => item.channelType.toLowerCase() === "airbnb");
    if (!listing) throw new ConflictException("Airbnb listing is missing from pricing settings");
    return listing.listingId;
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
    configSnapshot?: unknown;
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
  const parsed = pricingConfigSchema.safeParse(run.configSnapshot);
  const config = parsed.success ? parsed.data : null;
  const today = localDate(run.startedAt, "Asia/Manila");
  return {
    ...runSummary(run),
    occupancy: run.occupancy ?? {},
    days: run.days.map((day) => ({
      date: dateOnly(day.date),
      leadDays: Math.round((day.date.getTime() - dateValue(today).getTime()) / 86_400_000),
      tier: config
        ? pricingTier(Math.round((day.date.getTime() - dateValue(today).getTime()) / 86_400_000)).label
        : undefined,
      platformPrices: config?.listings.map((listing) => ({
        channelType: listing.channelType,
        listingId: listing.listingId,
        price: channelPrice(day.airbnbPrice, listing.ratio)
      })),
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

function airbnbRulesPatch(
  patch: AirbnbPricingRulesPatch,
  current: HostexAirbnbPriceRules
): HostexAirbnbPriceRules {
  const minimumStay = patch.minimumStay ?? requiredNumber(current.minimum_stay, "minimum stay");
  const maximumStay = patch.maximumStay ?? requiredNumber(current.maximum_stay, "maximum stay");
  if (minimumStay > maximumStay) {
    throw new BadRequestException("Minimum stay cannot be greater than maximum stay");
  }
  const settings: HostexAirbnbPriceRules = {};
  if (patch.weeklyDiscount !== undefined || patch.monthlyDiscount !== undefined) {
    const discounts = new Map<number, HostexDiscountRule>();
    for (const rule of requiredDiscountRules(current.long_term_discount, "length-of-stay discounts")) {
      discounts.set(rule.days, rule);
    }
    if (patch.weeklyDiscount !== undefined) {
      discounts.set(7, { days: 7, discount: patch.weeklyDiscount });
    }
    if (patch.monthlyDiscount !== undefined) {
      discounts.set(28, { days: 28, discount: patch.monthlyDiscount });
    }
    settings.long_term_discount = [...discounts.values()].sort((left, right) => left.days - right.days);
  }
  if (patch.earlyBirdDiscount !== undefined) settings.early_bird_discount = patch.earlyBirdDiscount;
  if (patch.lastMinuteDiscount !== undefined) settings.last_minute_discount = patch.lastMinuteDiscount;
  if (patch.highRatedGuestDiscount !== undefined)
    settings.high_rated_guest_discount = patch.highRatedGuestDiscount;
  if (patch.mobileOnlyDiscount !== undefined) settings.mobile_only_discount = patch.mobileOnlyDiscount;
  if (patch.minimumStay !== undefined) settings.minimum_stay = patch.minimumStay;
  if (patch.maximumStay !== undefined) settings.maximum_stay = patch.maximumStay;
  if (patch.advanceNotice !== undefined) settings.advance_notice = patch.advanceNotice;
  if (patch.availabilityWindow !== undefined) settings.availability_window = patch.availabilityWindow;
  if (patch.preparationTime !== undefined) settings.preparation_time = patch.preparationTime;
  if (patch.daysOfWeekCheckIn !== undefined)
    settings.days_of_week_check_in = uniqueWeekdays(patch.daysOfWeekCheckIn);
  if (patch.daysOfWeekCheckOut !== undefined)
    settings.days_of_week_check_out = uniqueWeekdays(patch.daysOfWeekCheckOut);
  return settings;
}

function airbnbRulesView(listingId: string, settings: HostexAirbnbPriceRules) {
  return {
    listingId,
    listingCurrency: requiredString(settings.listing_currency, "listing currency"),
    basePrice: requiredNumber(settings.base_price, "base price"),
    weekendPrice:
      settings.weekend_price === null ? null : requiredNumber(settings.weekend_price, "weekend price"),
    longTermDiscount: requiredDiscountRules(settings.long_term_discount, "length-of-stay discounts"),
    earlyBirdDiscount: requiredDiscountRules(settings.early_bird_discount, "early-bird discounts"),
    lastMinuteDiscount: requiredDiscountRules(settings.last_minute_discount, "last-minute discounts"),
    highRatedGuestDiscount: requiredBoolean(settings.high_rated_guest_discount, "top-rated guest discount"),
    mobileOnlyDiscount: requiredBoolean(settings.mobile_only_discount, "mobile-only discount"),
    minimumStay: requiredNumber(settings.minimum_stay, "minimum stay"),
    maximumStay: requiredNumber(settings.maximum_stay, "maximum stay"),
    advanceNotice:
      settings.advance_notice === null ? null : requiredNumber(settings.advance_notice, "advance notice"),
    availabilityWindow: requiredNumber(settings.availability_window, "availability window"),
    preparationTime: requiredNumber(settings.preparation_time, "preparation time"),
    daysOfWeekCheckIn: requiredWeekdays(settings.days_of_week_check_in, "check-in days"),
    daysOfWeekCheckOut: requiredWeekdays(settings.days_of_week_check_out, "check-out days"),
    syncedAt: new Date().toISOString()
  };
}

function requiredDiscountRules(value: HostexDiscountRule[] | undefined, label: string) {
  if (
    !Array.isArray(value) ||
    value.some((rule) => !Number.isFinite(rule.discount) || !Number.isFinite(rule.days))
  ) {
    throw new Error(`Hostex Airbnb ${label} are unavailable`);
  }
  return value.map((rule) => ({ discount: rule.discount, days: rule.days }));
}

function requiredNumber(value: number | undefined, label: string) {
  if (!Number.isFinite(value)) throw new Error(`Hostex Airbnb ${label} is unavailable`);
  return Number(value);
}

function requiredBoolean(value: boolean | undefined, label: string) {
  if (typeof value !== "boolean") throw new Error(`Hostex Airbnb ${label} is unavailable`);
  return value;
}

function requiredString(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(`Hostex Airbnb ${label} is unavailable`);
  return value;
}

function requiredWeekdays(value: number[] | undefined, label: string) {
  if (!Array.isArray(value) || value.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error(`Hostex Airbnb ${label} are unavailable`);
  }
  return uniqueWeekdays(value);
}

function uniqueWeekdays(value: number[]) {
  return [...new Set(value)].sort((left, right) => left - right);
}

function hasCurrentAlgorithm(value: unknown) {
  return Boolean(
    value && typeof value === "object" && "algorithm" in value && value.algorithm === PRICING_ALGORITHM
  );
}
