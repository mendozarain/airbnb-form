import { jest } from "@jest/globals";
import type { PricingConfig } from "@cozy-d-714/shared";
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

describe("PricingService", () => {
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
