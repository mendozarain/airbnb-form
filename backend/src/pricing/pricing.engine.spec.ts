import { pricingConfigWithDefaults, type PricingConfig } from "@cozy-d-714/shared";
import {
  addDays,
  calculateDay,
  calculatePricing,
  compressPrices,
  compressRestrictions
} from "./pricing.engine.js";

const listings = [{ channelType: "airbnb", listingId: "airbnb", ratio: 1 }];

const quiet = {
  available: true,
  windowOccupancy: 0,
  nearTermOccupancy: 0,
  adjacentFilled: false,
  orphanGap: false
};

function config(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return pricingConfigWithDefaults({ listings, ...overrides });
}

function quote(
  date: string,
  today: string,
  context: Partial<typeof quiet> = {},
  overrides: Partial<PricingConfig> = {}
) {
  return calculateDay(date, today, { ...quiet, ...context }, config(overrides));
}

function calendar(
  today: string,
  horizonDays: number,
  bookings: Array<{ checkIn: string; checkOut: string; status?: string }> = [],
  overrides: Partial<PricingConfig> = {}
) {
  const dates = Array.from({ length: horizonDays + 1 }, (_, index) => addDays(today, index));
  return calculatePricing(
    today,
    config({ horizonDays, ...overrides }),
    bookings.map((booking) => ({ status: "accepted", ...booking })),
    dates.map((date) => ({ date, available: true }))
  );
}

describe("demand-pace pricing", () => {
  it("seeds Rain's rates, floors, discounts, and extra-guest fee", () => {
    const seeded = config();
    expect(seeded).toMatchObject({
      weekdayBasePrice: 2750,
      weekendBasePrice: 3400,
      weekdayFloor: 2300,
      weekendFloor: 3000,
      maximumPrice: 5000,
      lastMinuteWeekdayPrice: 2300,
      lastMinuteLeadDays: 3,
      weekendMinStay: 2,
      defaultMinStay: 1,
      minStayRelaxLeadDays: 3,
      weeklyDiscountPercent: 10,
      monthlyDiscountPercent: 25,
      extraGuestFee: 320,
      airbnbExtraGuestFeeMinimum: 318,
      includedGuests: 4
    });
  });

  it("holds weekday and weekend rates until pace says a close-in night is unsold", () => {
    expect(quote("2026-11-09", "2026-10-01", {}, { events: [] }).airbnbPrice).toBe(2750);
    expect(quote("2026-11-07", "2026-10-01", {}, { events: [] }).airbnbPrice).toBe(3400);
    expect(quote("2026-11-09", "2026-11-09", { nearTermOccupancy: 0.6 }, { events: [] }).airbnbPrice).toBe(
      2750
    );
    expect(quote("2026-11-07", "2026-11-07", { nearTermOccupancy: 0.6 }, { events: [] }).airbnbPrice).toBe(
      3400
    );
  });

  it("drops an unsold weekday inside three days to the floor and keeps weekends at 3000", () => {
    expect(quote("2026-11-09", "2026-11-09", { nearTermOccupancy: 0.59 }, { events: [] }).airbnbPrice).toBe(
      2300
    );
    expect(quote("2026-11-07", "2026-11-07", { nearTermOccupancy: 0.59 }, { events: [] }).airbnbPrice).toBe(
      3000
    );
    const weekend = quote("2026-11-07", "2026-11-07", { nearTermOccupancy: 0 }, { events: [] });
    expect(weekend.airbnbPrice).toBeGreaterThanOrEqual(3000);
    expect(weekend.reasons).toContain("last-minute weekend floor");
  });

  it("raises weekends when a nearby night is filled, including inside the last-minute window", () => {
    const early = quote("2026-11-07", "2026-11-01", { adjacentFilled: true }, { events: [] });
    const late = quote(
      "2026-11-07",
      "2026-11-06",
      { adjacentFilled: true, nearTermOccupancy: 0 },
      { events: [] }
    );
    expect(early.airbnbPrice).toBeGreaterThan(3400);
    expect(late.airbnbPrice).toBeGreaterThan(3400);
    expect(late.reasons).toContain("nearby dates booked");
    expect(late.reasons).not.toContain("last-minute weekend floor");
  });

  it("raises open nights when the surrounding window is already busy", () => {
    const priced = quote(
      "2026-11-09",
      "2026-11-09",
      { nearTermOccupancy: 0.9, windowOccupancy: 0.9 },
      { events: [] }
    );
    expect(priced.airbnbPrice).toBeGreaterThan(2750);
    expect(priced.reasons).toContain("high surrounding occupancy");
  });

  it("never prices below the floors or above the ceiling", () => {
    for (let lead = 0; lead <= 40; lead++) {
      const today = addDays("2026-11-09", -lead);
      const weekday = quote("2026-11-09", today, { nearTermOccupancy: 0 }, { events: [] });
      const weekend = quote(
        "2026-11-07",
        addDays("2026-11-07", -lead),
        { nearTermOccupancy: 0 },
        { events: [] }
      );
      expect(weekday.airbnbPrice).toBeGreaterThanOrEqual(2300);
      expect(weekday.airbnbPrice).toBeLessThanOrEqual(5000);
      expect(weekend.airbnbPrice).toBeGreaterThanOrEqual(3000);
      expect(weekend.airbnbPrice).toBeLessThanOrEqual(5000);
    }
    expect(
      quote("2026-11-07", "2026-10-01", { windowOccupancy: 1 }, { events: [], highOccupancyPremium: 1 })
        .airbnbPrice
    ).toBe(5000);
  });

  it("prices the seeded Davao calendar, with Christmas peaks above the season rate", () => {
    expect(quote("2026-12-18", "2026-12-01").airbnbPrice).toBe(3400);
    expect(quote("2026-12-19", "2026-12-01")).toMatchObject({
      airbnbPrice: 4200,
      minStay: 3,
      event: "Pasko / Christmas–New Year"
    });
    expect(quote("2026-12-25", "2026-12-23")).toMatchObject({
      airbnbPrice: 4800,
      minStay: 3,
      event: "Pasko peak"
    });
    expect(quote("2026-12-31", "2026-12-01")).toMatchObject({ airbnbPrice: 4800, event: "Pasko peak" });
    expect(quote("2027-01-02", "2026-12-01")).toMatchObject({ airbnbPrice: 4200, minStay: 3 });
    expect(quote("2027-01-03", "2026-12-01").event).toBeNull();
    expect(quote("2026-11-28", "2026-11-01")).toMatchObject({ airbnbPrice: 3400, event: "Pasko Fiesta" });
    expect(quote("2026-12-08", "2026-11-01")).toMatchObject({
      airbnbPrice: 3400,
      event: "Immaculate Conception"
    });
    expect(quote("2027-02-06", "2027-01-15")).toMatchObject({ airbnbPrice: 3500, event: "Chinese New Year" });
    expect(quote("2027-03-13", "2027-03-01")).toMatchObject({ airbnbPrice: 3500, event: "Araw ng Dabaw" });
    expect(quote("2027-03-16", "2027-03-01").event).toBeNull();
    expect(quote("2027-03-25", "2027-03-01")).toMatchObject({
      airbnbPrice: 4000,
      minStay: 2,
      event: "Holy Week"
    });
    expect(quote("2027-04-09", "2027-04-01")).toMatchObject({
      airbnbPrice: 3500,
      event: "Araw ng Kagitingan"
    });
    expect(quote("2027-08-14", "2027-08-01")).toMatchObject({
      airbnbPrice: 3500,
      minStay: 2,
      event: "Kadayawan"
    });
    expect(quote("2027-08-11", "2027-08-01")).toMatchObject({
      airbnbPrice: 3500,
      minStay: 1,
      event: "Kadayawan"
    });
    expect(quote("2027-12-24", "2027-12-01")).toMatchObject({ airbnbPrice: 4800, minStay: 3 });
  });

  it("uses a two-night weekend minimum, relaxes it near arrival, and leaves weekdays at one", () => {
    expect(quote("2026-11-06", "2026-10-20", {}, { events: [] }).minStay).toBe(2);
    expect(quote("2026-11-07", "2026-10-20", {}, { events: [] }).minStay).toBe(2);
    expect(quote("2026-11-08", "2026-10-20", {}, { events: [] }).minStay).toBe(1);
    const relaxed = quote("2026-11-06", "2026-11-05", {}, { events: [] });
    expect(relaxed.minStay).toBe(1);
    expect(relaxed.reasons).toContain("relaxed close to arrival");
    expect(quote("2026-11-06", "2026-10-20", {}, { events: [], weekendMinStay: 3 }).minStay).toBe(3);
  });

  it("keeps event minimums close to arrival and opens a one-night orphan gap", () => {
    expect(quote("2026-12-25", "2026-12-23").minStay).toBe(3);
    expect(quote("2027-08-14", "2027-08-12").minStay).toBe(2);
    const gap = calendar(
      "2026-11-01",
      8,
      [
        { checkIn: "2026-11-06", checkOut: "2026-11-07" },
        { checkIn: "2026-11-08", checkOut: "2026-11-09" }
      ],
      { events: [] }
    );
    const saturday = gap.days.find((day) => day.date === "2026-11-07");
    expect(saturday).toMatchObject({ available: true, minStay: 1 });
    expect(saturday?.reasons).toContain("orphan gap");

    const christmas = calendar("2026-12-23", 6, [
      { checkIn: "2026-12-24", checkOut: "2026-12-25" },
      { checkIn: "2026-12-26", checkOut: "2026-12-27" }
    ]);
    expect(christmas.days.find((day) => day.date === "2026-12-25")).toMatchObject({
      available: true,
      minStay: 1,
      airbnbPrice: 4800
    });
    expect(christmas.days.find((day) => day.date === "2026-12-27")?.minStay).toBe(3);
  });

  it("drops only weekdays that are behind the near-term pace", () => {
    const empty = calendar("2026-11-09", 2, [], { events: [] });
    expect(empty.days[0]).toMatchObject({ date: "2026-11-09", airbnbPrice: 2300 });
    const busy = calendar("2026-11-09", 6, [{ checkIn: "2026-11-10", checkOut: "2026-11-16" }], {
      events: []
    });
    expect(busy.days[0]?.airbnbPrice).toBeGreaterThan(2300);
    expect(busy.occupancy.nearTerm.ratio).toBeGreaterThanOrEqual(0.6);
  });

  it("compresses prices and arrival minimums without inventing a stay-through rule", () => {
    const days = [0, 1, 2, 3].map((offset) =>
      quote(addDays("2026-11-06", offset), "2026-10-01", { available: offset !== 2 }, { events: [] })
    );
    expect(compressPrices(days, 1.2).map((range) => range.price)).toEqual([4080, 3300]);
    const restrictions = compressRestrictions(days);
    expect(restrictions).toEqual([
      { start_date: "2026-11-06", end_date: "2026-11-07", min_stay_on_arrival: 2 },
      { start_date: "2026-11-09", end_date: "2026-11-09", min_stay_on_arrival: 1 }
    ]);
    expect(JSON.stringify(restrictions)).not.toContain("min_stay_through");
  });
});
