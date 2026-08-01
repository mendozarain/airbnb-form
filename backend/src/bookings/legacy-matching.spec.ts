import { strictLegacyBookingMatch } from "./legacy-matching.js";

const invite = {
  checkIn: "2026-08-10",
  checkOut: "2026-08-12",
  guestEmail: " GUEST@Example.com ",
  guestNames: ["José Dela-Cruz"]
};

describe("strictLegacyBookingMatch", () => {
  it("matches normalized exact email or punctuation-insensitive exact name with the same dates", () => {
    expect(
      strictLegacyBookingMatch(invite, [
        {
          stayCode: "stay-1",
          checkIn: "2026-08-10",
          checkOut: "2026-08-12",
          guestEmail: "guest@example.com",
          guestName: "Jose Dela Cruz"
        }
      ])?.stayCode
    ).toBe("stay-1");
  });

  it("does not use dates alone or fuzzy name fragments", () => {
    expect(
      strictLegacyBookingMatch(invite, [
        {
          stayCode: "stay-1",
          checkIn: "2026-08-10",
          checkOut: "2026-08-12",
          guestName: "Jose"
        }
      ])
    ).toBeNull();
  });

  it("leaves conflicting exact identifiers ambiguous", () => {
    expect(
      strictLegacyBookingMatch(invite, [
        {
          stayCode: "email-stay",
          checkIn: "2026-08-10",
          checkOut: "2026-08-12",
          guestEmail: "guest@example.com",
          guestName: "Someone Else"
        },
        {
          stayCode: "name-stay",
          checkIn: "2026-08-10",
          checkOut: "2026-08-12",
          guestEmail: "other@example.com",
          guestName: "Jose Dela Cruz"
        }
      ])
    ).toBeNull();
  });
});
