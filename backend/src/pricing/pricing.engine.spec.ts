import type { PricingConfig } from "@cozy-d-714/shared";
import { calculateDay, calculatePricing, compressPrices } from "./pricing.engine.js";

const config: PricingConfig = {
  propertyName: "D-714 Mantina Enclaves, Davao City",
  propertyId: 12684960,
  timezone: "Asia/Manila",
  horizonDays: 2,
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
  listings: [{ channelType: "airbnb", listingId: "airbnb", ratio: 1 }],
  recurringEvents: [{ name: "Kadayawan Festival", start: "08-15", end: "08-24" }]
};

describe("pricing engine parity", () => {
  it("matches the Python urgent-gap floor and non-event ceiling", () => {
    const urgent = calculateDay("2026-07-10", "2026-07-10", true, 0.1, config);
    const highSaturday = calculateDay("2026-12-05", "2026-12-01", false, 1, config);
    expect(urgent.airbnbPrice).toBe(2500);
    expect(urgent.reasons).toContain("urgent gap");
    expect(highSaturday.airbnbPrice).toBeLessThanOrEqual(3700);
  });

  it("applies the event boost only to configured dates", () => {
    expect(calculateDay("2026-08-14", "2026-07-10", false, 0.5, config).event).toBeNull();
    expect(calculateDay("2026-08-15", "2026-07-10", false, 0.5, config)).toMatchObject({
      event: "Kadayawan Festival",
      airbnbPrice: 3750
    });
    expect(calculateDay("2026-08-25", "2026-07-10", false, 0.5, config).event).toBeNull();
  });

  it("compresses equal consecutive channel prices", () => {
    const days = [
      calculateDay("2026-07-10", "2026-01-01", false, 0.5, { ...config, baseAirbnbPrice: 3000 }),
      calculateDay("2026-07-11", "2026-01-01", false, 0.5, { ...config, baseAirbnbPrice: 3000 })
    ];
    days[0].airbnbPrice = 3000;
    days[1].airbnbPrice = 3000;
    expect(compressPrices(days, 1.5)).toEqual([
      { start_date: "2026-07-10", end_date: "2026-07-11", price: 4500 }
    ]);
  });

  it("uses check-out-exclusive occupancy", () => {
    const result = calculatePricing(
      "2026-08-01",
      config,
      [{ checkIn: "2026-08-01", checkOut: "2026-08-02", status: "accepted" }],
      [
        { date: "2026-08-01", available: false },
        { date: "2026-08-02", available: true },
        { date: "2026-08-03", available: true }
      ]
    );
    expect(result.occupancy["2026-08"]).toMatchObject({ booked: 1, total: 3 });
  });

  it("refuses an incomplete availability horizon", () => {
    expect(() => calculatePricing("2026-08-01", config, [], [])).toThrow(
      "Hostex availability is missing 3 date(s)"
    );
  });
});
