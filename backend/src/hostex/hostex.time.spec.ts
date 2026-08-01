import {
  addDaysToDateOnly,
  deliveryDueAt,
  endOfCheckInDay,
  localDate,
  zonedDateTime
} from "./hostex.time.js";

describe("Hostex Manila scheduling", () => {
  it("schedules 2 PM Manila on the day before check-in", () => {
    expect(deliveryDueAt("2026-08-02", "Asia/Manila").toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });

  it("keeps same-day catch-up open until midnight after the check-in date", () => {
    expect(endOfCheckInDay("2026-08-02", "Asia/Manila").toISOString()).toBe("2026-08-02T16:00:00.000Z");
  });

  it("uses calendar dates rather than server-local dates", () => {
    expect(localDate(new Date("2026-08-01T16:30:00.000Z"), "Asia/Manila")).toBe("2026-08-02");
    expect(addDaysToDateOnly("2026-08-01", 1)).toBe("2026-08-02");
    expect(zonedDateTime("2026-08-02", 14, "Australia/Brisbane").toISOString()).toBe(
      "2026-08-02T04:00:00.000Z"
    );
  });
});
