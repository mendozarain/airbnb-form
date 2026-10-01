import { channelPrice, type PricingConfig } from "@cozy-d-714/shared";
import { addDays, calculateDay, calculatePricing, compressPrices } from "./pricing.engine.js";

const config: PricingConfig = {
  algorithm: "vacancy-tiers-v1",
  propertyName: "D-714",
  propertyId: 12684960,
  timezone: "Asia/Manila",
  horizonDays: 2,
  baseAirbnbPrice: 3000,
  minimumAirbnbPrice: 2000,
  maximumNonEventAirbnbPrice: 3700,
  weekendPremium: 0.08,
  eventBoost: 0.25,
  roundTo: 50,
  listings: [{ channelType: "airbnb", listingId: "airbnb", ratio: 1 }],
  recurringEvents: [{ name: "Kadayawan Festival", start: "08-15", end: "08-24" }]
};

// Keep the night fixed so weekday/event effects cannot mask a time-tier regression.
const night = "2026-07-20";
const priceAt = (lead: number, overrides: Partial<PricingConfig> = {}, occupancy = 0) =>
  calculateDay(night, addDays(night, -lead), true, occupancy, { ...config, ...overrides }).airbnbPrice;

describe("vacancy tier pricing", () => {
  it.each([
    [0, 2000],
    [1, 2000],
    [2, 2000],
    [3, 2250],
    [7, 2250],
    [8, 2500],
    [14, 2500],
    [15, 2750],
    [30, 2750],
    [31, 3000],
    [365, 3000]
  ])("%i days away costs PHP %i", (lead, expected) => expect(priceAt(lead)).toBe(expected));

  it("scales with the configured floor without changing the far-away base", () => {
    expect(priceAt(31, { minimumAirbnbPrice: 2400 })).toBe(3000);
    expect(priceAt(15, { minimumAirbnbPrice: 2400 })).toBe(2850);
    expect(priceAt(8, { minimumAirbnbPrice: 2400 })).toBe(2700);
    expect(priceAt(3, { minimumAirbnbPrice: 2400 })).toBe(2550);
    expect(priceAt(2, { minimumAirbnbPrice: 2400 })).toBe(2400);
  });

  it("ignores occupancy and legacy stacked discounts", () => {
    const legacy = {
      rainySeasonDiscount: 1,
      urgentGapDays: 60,
      urgentGapDiscount: 1,
      lowOccupancyDiscount: 1
    };
    expect(priceAt(15, legacy as Partial<PricingConfig>, 0)).toBe(2750);
    expect(priceAt(15, legacy as Partial<PricingConfig>, 1)).toBe(2750);
  });

  it("keeps a small base/floor gap above minimum until day two", () => {
    for (const lead of [3, 8, 15, 31]) expect(priceAt(lead, { baseAirbnbPrice: 2001 })).toBe(2001);
    expect(priceAt(2, { baseAirbnbPrice: 2001 })).toBe(2000);
    expect(priceAt(3, { minimumAirbnbPrice: 2999 })).toBe(3000);
    expect(priceAt(2, { minimumAirbnbPrice: 2999 })).toBe(2999);
  });

  it("allows intentionally equal base and floor prices", () => {
    for (const lead of [0, 2, 3, 8, 15, 31]) expect(priceAt(lead, { minimumAirbnbPrice: 3000 })).toBe(3000);
  });

  it("fades weekend and event premiums to the floor, with the existing event ceiling exception", () => {
    for (const date of ["2026-07-18", "2026-08-15"]) {
      const far = calculateDay(date, addDays(date, -31), true, 0, config);
      expect(far.airbnbPrice).toBe(date === "2026-08-15" ? 3750 : 3250);
      const middle = calculateDay(date, addDays(date, -8), true, 0, config);
      expect(middle.airbnbPrice).toBeLessThan(far.airbnbPrice);
      expect(middle.airbnbPrice).toBeGreaterThan(2000);
      for (const lead of [0, 1, 2])
        expect(calculateDay(date, addDays(date, -lead), true, 1, config).airbnbPrice).toBe(2000);
    }
    expect(
      calculateDay("2026-07-18", "2026-06-01", true, 1, { ...config, weekendPremium: 1 }).airbnbPrice
    ).toBe(3700);
    expect(calculateDay("2026-08-25", "2026-07-01", true, 0, config).event).toBeNull();
  });

  it("never increases the same empty night's rate as it approaches", () => {
    let previous = Infinity;
    for (let lead = 365; lead >= 0; lead--) {
      const price = priceAt(lead);
      expect(price).toBeLessThanOrEqual(previous);
      expect(price).toBeGreaterThanOrEqual(config.minimumAirbnbPrice);
      previous = price;
    }
  });

  it.each([
    [1.2, 2400],
    [1.3, 2600],
    [1.4, 2800]
  ])("applies ratio %s after reaching the floor", (ratio, expected) => {
    expect(channelPrice(priceAt(2), ratio)).toBe(expected);
    expect(channelPrice(2001, ratio)).toBe(Math.round(2001 * ratio));
  });

  it("excludes booked/blocked nights and never compresses across the gap", () => {
    const days = [0, 1, 2, 3].map((offset) => ({
      ...calculateDay(addDays(night, offset), night, offset !== 2, 0, config),
      airbnbPrice: 2000
    }));
    expect(compressPrices(days, 1.3)).toEqual([
      { start_date: night, end_date: "2026-07-21", price: 2600 },
      { start_date: "2026-07-23", end_date: "2026-07-23", price: 2600 }
    ]);
    expect(
      compressPrices(
        days.map((day) => ({ ...day, available: false })),
        1
      )
    ).toEqual([]);
  });

  it("uses checkout-exclusive accepted occupancy and skips bookings even when availability lags", () => {
    const result = calculatePricing(
      "2026-08-01",
      config,
      [
        { checkIn: "2026-07-31", checkOut: "2026-08-02", status: "accepted" },
        { checkIn: "2026-08-02", checkOut: "2026-08-03", status: "cancelled" }
      ],
      [
        { date: "2026-08-01", available: true },
        { date: "2026-08-02", available: true },
        { date: "2026-08-03", available: false }
      ]
    );
    expect(result.occupancy["2026-08"]).toMatchObject({ booked: 1, total: 3 });
    expect(result.days.map((day) => day.available)).toEqual([false, true, false]);
    expect(result.days[0]?.reasons).toContain("skipped: booked or blocked");
  });

  it("refuses incomplete availability", () => {
    expect(() => calculatePricing("2026-08-01", config, [], [])).toThrow(
      "Hostex availability is missing 3 date(s)"
    );
  });
});
