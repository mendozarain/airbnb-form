import { bookingRegistrationStatus } from "./registration-status.js";

const now = new Date("2026-08-01T04:00:00.000Z");

describe("bookingRegistrationStatus", () => {
  it.each(["2026-07-31", "2026-08-01"])("marks a stay checking out on %s as done in Manila", (checkOut) => {
    expect(bookingRegistrationStatus([], date(checkOut), now)).toBe("done");
  });

  it("keeps a future stay without a registration in needs registration", () => {
    expect(bookingRegistrationStatus([], date("2026-08-02"), now)).toBe("needs_registration");
  });

  it("preserves the completed state for a submitted future registration", () => {
    expect(
      bookingRegistrationStatus(
        [
          {
            status: "CLOSED",
            expiresAt: date("2026-08-08"),
            revokedAt: null,
            submission: { status: "submitted_email_sent" }
          }
        ],
        date("2026-08-05"),
        now
      )
    ).toBe("done");
  });
});

function date(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
