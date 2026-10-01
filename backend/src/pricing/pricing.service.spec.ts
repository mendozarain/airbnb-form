import { jest } from "@jest/globals";
import {
  PRICING_ALGORITHM,
  airbnbPricingRulesPatchSchema,
  pricingConfigSchema,
  type PricingConfig
} from "@cozy-d-714/shared";
import { PricingRunMode, PricingRunStatus } from "../generated/prisma/enums.js";
import { upgradePricingConfig } from "./pricing.config.js";
import { PricingService } from "./pricing.service.js";

const config: PricingConfig = {
  algorithm: "vacancy-tiers-v1",
  propertyName: "D-714",
  propertyId: 12684960,
  timezone: "Asia/Manila",
  horizonDays: 1,
  baseAirbnbPrice: 3000,
  minimumAirbnbPrice: 2500,
  maximumNonEventAirbnbPrice: 3700,
  weekendPremium: 0.08,
  eventBoost: 0.25,
  roundTo: 50,
  listings: [
    { channelType: "airbnb", listingId: "airbnb", ratio: 1 },
    { channelType: "agoda", listingId: "agoda", ratio: 1.3 }
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

afterEach(() => jest.useRealTimers());

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
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-01T00:00:00Z"));
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
    run.days.push({ ...run.days[0], date: new Date("2026-08-02T00:00:00Z") });
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
      pricingSubmission: { create: pricingSubmissionCreate },
      booking: { findMany: resolved([]) }
    };
    const service = new PricingService(
      prisma as never,
      {
        submitPrices,
        getAvailabilities: resolved(
          run.days.map((day) => ({ date: day.date.toISOString().slice(0, 10), available: day.available }))
        )
      } as never,
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

describe("pricing settings upgrade", () => {
  const legacyConfig = () => {
    const { algorithm: _algorithm, ...legacy } = config;
    void _algorithm;
    return {
      ...legacy,
      rainySeasonDiscount: 0.9,
      listings: [
        { channelType: "airbnb", listingId: "airbnb", ratio: 1 },
        ...["plan-1", "plan-2", "plan-3"].map((listingId) => ({
          channelType: "booking.com",
          listingId,
          ratio: 1.5
        })),
        { channelType: "agoda", listingId: "agoda", ratio: 1.5 },
        { channelType: "booking_site", listingId: "direct", ratio: 1.5 }
      ]
    };
  };

  it("upgrades all OTA plans, preserves other rates, and removes obsolete controls", () => {
    const upgraded = upgradePricingConfig(legacyConfig());
    expect(upgraded).toMatchObject({
      algorithm: PRICING_ALGORITHM,
      baseAirbnbPrice: 3000,
      minimumAirbnbPrice: 2500
    });
    expect(upgraded.listings.map((listing) => listing.ratio)).toEqual([1, 1.3, 1.3, 1.3, 1.3, 1.5]);
    expect(upgraded).not.toHaveProperty("rainySeasonDiscount");
    expect(upgradePricingConfig(upgraded)).toEqual(upgraded);
  });

  it.each([1.2, 1.3, 1.4])("accepts independent OTA markup %s", (ratio) => {
    const current = upgradePricingConfig(legacyConfig());
    current.listings = current.listings.map((listing) =>
      listing.channelType === "agoda" ? { ...listing, ratio } : listing
    );
    expect(pricingConfigSchema.safeParse(current).success).toBe(true);
  });

  it.each([1.19, 1.41, 1.5])("rejects out-of-range OTA ratio %s", (ratio) => {
    expect(
      pricingConfigSchema.safeParse({
        ...config,
        listings: [{ channelType: "agoda", listingId: "agoda", ratio }]
      }).success
    ).toBe(false);
  });

  it("rejects mixed Booking.com markups and an Airbnb multiplier", () => {
    const current = upgradePricingConfig(legacyConfig());
    current.listings[1].ratio = 1.2;
    expect(pricingConfigSchema.safeParse(current).success).toBe(false);
    expect(
      pricingConfigSchema.safeParse({
        ...config,
        listings: [{ channelType: "airbnb", listingId: "airbnb", ratio: 1.3 }]
      }).success
    ).toBe(false);
  });

  it("does not reinterpret an unknown algorithm as legacy settings", () => {
    expect(() => upgradePricingConfig({ ...legacyConfig(), algorithm: "future-version" })).toThrow(
      "Unsupported pricing algorithm"
    );
  });

  it.each([1, 0])(
    "upgrades transactionally and records only the winning reader (claim=%s)",
    async (count) => {
      const legacy = { ...settings, config: legacyConfig(), automationOn: true };
      const current = {
        ...settings,
        config: upgradePricingConfig(legacy.config),
        version: 2,
        automationOn: false
      };
      const transaction = {
        pricingSetting: { updateMany: resolved({ count }), findUnique: resolved(current) },
        pricingSettingVersion: { create: resolved({}) },
        adminAuditEvent: { create: resolved({}) }
      };
      const prisma = {
        pricingSetting: {
          findUnique: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValueOnce(legacy)
            .mockResolvedValue(current)
        },
        pricingSettingVersion: { findMany: resolved([]) },
        $transaction: jest.fn(async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction))
      };
      const service = new PricingService(prisma as never, {} as never, {} as never);
      await expect(service.settings()).resolves.toMatchObject({
        version: 2,
        automationOn: false,
        config: current.config
      });
      expect(transaction.pricingSetting.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "primary", version: 1 },
          data: expect.objectContaining({ automationOn: false, version: { increment: 1 } })
        })
      );
      expect(transaction.pricingSettingVersion.create).toHaveBeenCalledTimes(count);
      expect(transaction.adminAuditEvent.create).toHaveBeenCalledTimes(count);
      if (count)
        expect(transaction.adminAuditEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ action: "pricing.algorithm_upgraded" }) })
        );
      await service.settings();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    }
  );
});

function publishingFixture() {
  const days = ["2026-08-01", "2026-08-02"].map((date) => ({
    date: new Date(`${date}T00:00:00Z`),
    airbnbPrice: 2500,
    available: true,
    occupancyRatio: 0,
    event: null,
    reasons: ["base"]
  }));
  const run = {
    id: "run-1",
    mode: PricingRunMode.PREVIEW,
    status: PricingRunStatus.PREVIEWED,
    configSnapshot: { ...config } as Record<string, unknown>,
    settingsVersion: 1,
    startedAt: new Date("2026-08-01T00:00:00Z"),
    finishedAt: null,
    initiatedBy: null,
    errorMessage: null,
    occupancy: {},
    days,
    submissions: [
      {
        id: "failed-1",
        channelType: "agoda",
        listingId: "agoda",
        attempt: 1,
        status: "failed",
        createdAt: new Date("2026-08-01T00:00:00Z"),
        requestId: null,
        error: "channel unavailable"
      }
    ]
  };
  const prisma = {
    pricingSetting: { findUnique: resolved({ ...settings }) },
    pricingRun: { findUnique: resolved(run), updateMany: resolved({ count: 1 }), update: resolved({}) },
    pricingSubmission: { create: resolved({ id: "retry-2" }), update: resolved({}), findMany: resolved([]) },
    booking: { findMany: resolved([]) }
  };
  const hostex = {
    getAvailabilities: resolved(
      days.map((day) => ({ date: day.date.toISOString().slice(0, 10), available: true }))
    ),
    submitPrices: resolved({ requestId: "request-1" })
  };
  const service = new PricingService(prisma as never, hostex as never, { record: resolved({}) } as never);
  return { run, prisma, hostex, service };
}

describe("publishing safeguards", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-01T00:00:00Z"));
  });

  for (const operation of ["apply", "retry"] as const) {
    const publish = (service: PricingService) =>
      operation === "apply" ? service.apply("run-1") : service.retryListing("run-1", "failed-1");
    it(`${operation}: rejects a legacy snapshot before calling Hostex`, async () => {
      const { run, hostex, service } = publishingFixture();
      delete run.configSnapshot.algorithm;
      await expect(publish(service)).rejects.toThrow("retired pricing algorithm");
      expect(hostex.getAvailabilities).not.toHaveBeenCalled();
      expect(hostex.submitPrices).not.toHaveBeenCalled();
    });
    it(`${operation}: rejects outdated settings`, async () => {
      const { run, hostex, service } = publishingFixture();
      run.settingsVersion = 0;
      await expect(publish(service)).rejects.toThrow("Pricing settings changed");
      expect(hostex.submitPrices).not.toHaveBeenCalled();
    });
    it(`${operation}: expires previews at Manila midnight, before UTC midnight`, async () => {
      const { hostex, service } = publishingFixture();
      jest.setSystemTime(new Date("2026-08-01T16:00:00Z"));
      await expect(publish(service)).rejects.toThrow("different day");
      expect(hostex.submitPrices).not.toHaveBeenCalled();
    });
    it(`${operation}: rejects newly booked and newly opened availability`, async () => {
      for (const wasAvailable of [true, false]) {
        const { run, hostex, service } = publishingFixture();
        run.days[0].available = wasAvailable;
        hostex.getAvailabilities.mockResolvedValue([
          { date: "2026-08-01", available: !wasAvailable },
          { date: "2026-08-02", available: true }
        ]);
        await expect(publish(service)).rejects.toThrow("Availability changed");
        expect(hostex.submitPrices).not.toHaveBeenCalled();
      }
    });
    it(`${operation}: rejects an incomplete availability response`, async () => {
      const { hostex, service } = publishingFixture();
      hostex.getAvailabilities.mockResolvedValue([]);
      await expect(publish(service)).rejects.toThrow("availability is missing");
      expect(hostex.submitPrices).not.toHaveBeenCalled();
    });
    it(`${operation}: submits only available nights using the snapshotted platform ratio`, async () => {
      const { run, hostex, service } = publishingFixture();
      run.days[0].available = false;
      hostex.getAvailabilities.mockResolvedValue([
        { date: "2026-08-01", available: false },
        { date: "2026-08-02", available: true }
      ]);
      jest.spyOn(service, "getRun").mockResolvedValue({ run: {} } as never);
      await publish(service);
      expect(hostex.submitPrices).toHaveBeenCalledWith("agoda", "agoda", [
        { start_date: "2026-08-02", end_date: "2026-08-02", price: 3250 }
      ]);
      expect(hostex.submitPrices).toHaveBeenCalledTimes(operation === "apply" ? 2 : 1);
    });
  }

  it("returns lead time, tier, and snapshotted channel prices for previews", async () => {
    const { service } = publishingFixture();
    const result = await service.getRun("run-1");
    expect(result.run.days[0]).toMatchObject({
      leadDays: 0,
      tier: "0–2 days",
      platformPrices: [
        { channelType: "airbnb", price: 2500 },
        { channelType: "agoda", price: 3250 }
      ]
    });
  });

  it("keeps historical runs readable without applying modern markups", async () => {
    const { run, service } = publishingFixture();
    delete run.configSnapshot.algorithm;
    const result = await service.getRun("run-1");
    expect(result.run.days[0]).toMatchObject({ airbnbPrice: 2500 });
    expect(result.run.days[0]?.platformPrices).toBeUndefined();
  });

  it("does not send empty price batches", async () => {
    const { run, hostex, service } = publishingFixture();
    run.days.forEach((day) => {
      day.available = false;
    });
    hostex.getAvailabilities.mockResolvedValue(
      run.days.map((day) => ({ date: day.date.toISOString().slice(0, 10), available: false }))
    );
    await expect(service.apply("run-1")).rejects.toThrow("No available nights");
    expect(hostex.submitPrices).not.toHaveBeenCalled();
  });
});
