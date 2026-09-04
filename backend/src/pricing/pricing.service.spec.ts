import { jest } from "@jest/globals";
import { airbnbPricingRulesPatchSchema, type PricingConfig } from "@cozy-d-714/shared";
import { PricingRunMode, PricingRunStatus } from "../generated/prisma/enums.js";
import { PricingService } from "./pricing.service.js";

const config: PricingConfig = {
  propertyName: "D-714",
  propertyId: 12684960,
  timezone: "Asia/Manila",
  horizonDays: 1,
  baseAirbnbPrice: 3000,
  minimumAirbnbPrice: 2500,
  maximumNonEventAirbnbPrice: 3700,
  rainySeasonDiscount: 0.05,
  urgentGapDays: 14,
  urgentGapDiscount: 0.17,
  weekendPremium: 0.08,
  lowOccupancyThreshold: 0.3,
  lowOccupancyDiscount: 0.05,
  lowOccupancyLeadDays: 45,
  mediumOccupancyThreshold: 0.65,
  mediumOccupancyPremium: 0.08,
  highOccupancyThreshold: 0.8,
  highOccupancyPremium: 0.15,
  eventBoost: 0.25,
  roundTo: 50,
  listings: [
    { channelType: "airbnb", listingId: "airbnb", ratio: 1 },
    { channelType: "agoda", listingId: "agoda", ratio: 1.5 }
  ],
  recurringEvents: []
};

const settings = {
  id: "primary",
  version: 1,
  automationOn: false,
  config,
  updatedAt: new Date(),
  updatedBy: null
};

const airbnbRules = {
  listing_currency: "PHP",
  base_price: 3000,
  weekend_price: 3500,
  long_term_discount: [
    { days: 7, discount: 20 },
    { days: 14, discount: 25 },
    { days: 28, discount: 40 }
  ],
  early_bird_discount: [{ days: 60, discount: 10 }],
  last_minute_discount: [{ days: 2, discount: 15 }],
  high_rated_guest_discount: true,
  mobile_only_discount: false,
  minimum_stay: 2,
  maximum_stay: 365,
  advance_notice: 24,
  availability_window: 365,
  preparation_time: 1,
  days_of_week_check_in: [0, 1, 2, 3, 4, 5, 6],
  days_of_week_check_out: [0, 1, 2, 3, 4, 5, 6]
};

describe("PricingService", () => {
  it("accepts strict partial Airbnb patches and rejects empty or unknown fields", () => {
    expect(airbnbPricingRulesPatchSchema.safeParse({ weeklyDiscount: 20 }).success).toBe(true);
    expect(airbnbPricingRulesPatchSchema.safeParse({}).success).toBe(false);
    expect(
      airbnbPricingRulesPatchSchema.safeParse({ weeklyDiscount: 20, listingId: "browser-value" }).success
    ).toBe(false);
  });

  it("persists every pricing rules version with its actor", async () => {
    const nextSettings = {
      ...settings,
      version: 2,
      updatedBy: "admin@example.com",
      updatedAt: new Date("2026-08-01T10:00:00Z")
    };
    const versionCreate = resolved({ id: "version-2" });
    const prisma = {
      pricingSetting: {
        updateMany: resolved({ count: 1 }),
        findUnique: resolved(nextSettings)
      },
      pricingSettingVersion: {
        create: versionCreate,
        findMany: resolved([
          {
            version: 2,
            changedBy: "admin@example.com",
            createdAt: new Date("2026-08-01T10:00:00Z")
          }
        ])
      },
      $transaction: undefined as unknown
    };
    prisma.$transaction = jest.fn(async (work: (transaction: typeof prisma) => Promise<unknown>) =>
      work(prisma)
    );
    const audit = { record: resolved({}) };
    const service = new PricingService(prisma as never, {} as never, audit as never);

    await expect(
      service.updateSettings(config, 1, { id: "admin-1", email: "admin@example.com" })
    ).resolves.toMatchObject({ version: 2, updatedBy: "admin@example.com" });

    expect(versionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settingId: "primary",
        version: 2,
        changedBy: "admin@example.com"
      })
    });
  });

  it("reads live Airbnb settings for the server-configured listing", async () => {
    const hostex = { getAirbnbPriceAndRules: resolved(airbnbRules) };
    const service = new PricingService(
      { pricingSetting: { findUnique: resolved(settings) } } as never,
      hostex as never,
      { record: resolved({}) } as never
    );

    await expect(service.airbnbSettings()).resolves.toMatchObject({
      listingId: "airbnb",
      listingCurrency: "PHP",
      longTermDiscount: airbnbRules.long_term_discount,
      highRatedGuestDiscount: true
    });
    expect(hostex.getAirbnbPriceAndRules).toHaveBeenCalledWith("airbnb");
  });

  it("updates only requested Airbnb fields and preserves custom stay discounts", async () => {
    const getAirbnbPriceAndRules = jest
      .fn<() => Promise<typeof airbnbRules>>()
      .mockResolvedValueOnce(airbnbRules)
      .mockResolvedValueOnce({
        ...airbnbRules,
        long_term_discount: [
          { days: 7, discount: 20 },
          { days: 14, discount: 25 },
          { days: 28, discount: 45 }
        ],
        mobile_only_discount: true
      });
    const updateAirbnbPriceAndRules = resolved({ requestId: "request-1" });
    const audit = { record: resolved({}) };
    const service = new PricingService(
      { pricingSetting: { findUnique: resolved(settings) } } as never,
      { getAirbnbPriceAndRules, updateAirbnbPriceAndRules } as never,
      audit as never
    );

    await expect(
      service.updateAirbnbSettings(
        { monthlyDiscount: 45, mobileOnlyDiscount: true },
        { id: "admin-1", email: "admin@example.com" }
      )
    ).resolves.toMatchObject({ mobileOnlyDiscount: true });

    expect(updateAirbnbPriceAndRules).toHaveBeenCalledWith("airbnb", {
      long_term_discount: [
        { days: 7, discount: 20 },
        { days: 14, discount: 25 },
        { days: 28, discount: 45 }
      ],
      mobile_only_discount: true
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ email: "admin@example.com" }),
      "pricing.airbnb_settings_updated",
      "airbnb_listing",
      "airbnb",
      expect.objectContaining({ fields: ["monthlyDiscount", "mobileOnlyDiscount"] })
    );
  });

  it("does not render missing live Airbnb values as zero", async () => {
    const service = new PricingService(
      { pricingSetting: { findUnique: resolved(settings) } } as never,
      { getAirbnbPriceAndRules: resolved({ ...airbnbRules, minimum_stay: undefined }) } as never,
      { record: resolved({}) } as never
    );

    await expect(service.airbnbSettings()).rejects.toThrow("Hostex Airbnb minimum stay is unavailable");
  });

  it("rejects a partial availability patch that conflicts with the current live range", async () => {
    const updateAirbnbPriceAndRules = resolved({ requestId: "request-1" });
    const service = new PricingService(
      { pricingSetting: { findUnique: resolved(settings) } } as never,
      { getAirbnbPriceAndRules: resolved(airbnbRules), updateAirbnbPriceAndRules } as never,
      { record: resolved({}) } as never
    );

    await expect(service.updateAirbnbSettings({ minimumStay: 366 })).rejects.toThrow(
      "Minimum stay cannot be greater than maximum stay"
    );
    expect(updateAirbnbPriceAndRules).not.toHaveBeenCalled();
  });

  it("does not audit or read back an Airbnb update that Hostex rejects", async () => {
    const audit = { record: resolved({}) };
    const getAirbnbPriceAndRules = resolved(airbnbRules);
    const service = new PricingService(
      { pricingSetting: { findUnique: resolved(settings) } } as never,
      {
        getAirbnbPriceAndRules,
        updateAirbnbPriceAndRules: jest.fn(() => Promise.reject(new Error("Airbnb rejected the update")))
      } as never,
      audit as never
    );

    await expect(service.updateAirbnbSettings({ weeklyDiscount: 20 })).rejects.toThrow(
      "Airbnb rejected the update"
    );
    expect(getAirbnbPriceAndRules).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("claims the run before reading Hostex and records a durable preview", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const runCreate = resolved({ id: "run-1" });
    const availability = resolved([
      { date: "2026-08-01", available: true },
      { date: "2026-08-02", available: true }
    ]);
    const runUpdate = resolved({
      id: "run-1",
      mode: PricingRunMode.PREVIEW,
      status: PricingRunStatus.PREVIEWED,
      settingsVersion: 1,
      initiatedBy: null,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      occupancy: {},
      days: []
    });
    const prisma = {
      pricingSetting: { findUnique: resolved(settings) },
      pricingRun: { create: runCreate, update: runUpdate },
      booking: { findMany: resolved([]) }
    };
    const hostex = { getAvailabilities: availability };
    const service = new PricingService(prisma as never, hostex as never, { record: resolved({}) } as never);

    try {
      await service.preview();

      expect(runCreate.mock.invocationCallOrder[0]).toBeLessThan(availability.mock.invocationCallOrder[0]);
      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: PricingRunStatus.PREVIEWED }) })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("records partial listing failures without treating Hostex acceptance as confirmation", async () => {
    const run = {
      id: "run-1",
      mode: PricingRunMode.PREVIEW,
      status: PricingRunStatus.PREVIEWED,
      settingsVersion: 1,
      configSnapshot: config,
      initiatedBy: null,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      days: [
        {
          date: new Date("2026-08-01T00:00:00.000Z"),
          airbnbPrice: 3000,
          available: true,
          occupancyRatio: 0,
          event: null,
          reasons: ["base"]
        }
      ],
      submissions: []
    };
    const submitPrices = jest
      .fn<() => Promise<{ requestId: string | null }>>()
      .mockResolvedValueOnce({ requestId: "request-1" })
      .mockRejectedValueOnce(new Error("channel unavailable"));
    const pricingRunUpdate = resolved({});
    const pricingSubmissionCreate = resolved({});
    const prisma = {
      pricingRun: {
        findUnique: resolved(run),
        updateMany: resolved({ count: 1 }),
        update: pricingRunUpdate
      },
      pricingSetting: { findUnique: resolved(settings) },
      pricingSubmission: { create: pricingSubmissionCreate }
    };
    const service = new PricingService(
      prisma as never,
      { submitPrices } as never,
      { record: resolved({}) } as never
    );
    jest.spyOn(service, "getRun").mockResolvedValue({ run: {} } as never);

    await service.apply("run-1");

    expect(pricingSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "submitted", requestId: "request-1" })
      })
    );
    expect(pricingSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
    expect(pricingRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PricingRunStatus.PARTIAL_FAILED }) })
    );
  });
});

function resolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}
