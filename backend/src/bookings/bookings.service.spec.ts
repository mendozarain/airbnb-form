import { jest } from "@jest/globals";
import {
  BookingsService,
  compareRegistrationBookings,
  compareRegistrationInvites
} from "./bookings.service.js";

const at = (value: string) => new Date(value);

function booking(
  id: string,
  bookedAt: string | null,
  createdAt: string,
  inviteCreatedAt?: string,
  submissionCreatedAt?: string
) {
  return {
    id,
    reservationCode: `reservation-${id}`,
    stayCode: `stay-${id}`,
    propertyId: 12684960,
    channelType: "airbnb",
    status: "accepted",
    guestName: "Maria Guest",
    guestEmail: null,
    guestPhone: null,
    numberOfGuests: 1,
    conversationId: null,
    checkIn: at("2027-01-10T00:00:00Z"),
    checkOut: at("2027-01-12T00:00:00Z"),
    lastSyncedAt: at("2026-09-04T00:00:00Z"),
    bookedAt: bookedAt ? at(bookedAt) : null,
    createdAt: at(createdAt),
    invites: inviteCreatedAt
      ? [
          {
            createdAt: at(inviteCreatedAt),
            status: "OPEN" as const,
            expiresAt: at("2027-01-12T00:00:00Z"),
            revokedAt: null,
            submission: submissionCreatedAt
              ? { createdAt: at(submissionCreatedAt), status: "submitted" }
              : null
          }
        ]
      : []
  };
}

describe("registration booking ordering", () => {
  it("uses the newest invite or submission activity first", () => {
    const values = [
      booking(
        "older-submission",
        "2026-09-03T00:00:00Z",
        "2026-09-03T00:00:00Z",
        "2026-09-01T00:00:00Z",
        "2026-09-02T00:00:00Z"
      ),
      booking("new-invite", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "2026-09-04T00:00:00Z"),
      booking(
        "newest-submission",
        "2026-09-01T00:00:00Z",
        "2026-09-01T00:00:00Z",
        "2026-09-02T00:00:00Z",
        "2026-09-05T00:00:00Z"
      )
    ];

    expect(values.sort(compareRegistrationBookings).map((value) => value.id)).toEqual([
      "newest-submission",
      "new-invite",
      "older-submission"
    ]);
  });

  it("places bookings without registration activity last by Hostex booking time", () => {
    const values = [
      booking("new-no-registration", "2026-09-05T00:00:00Z", "2026-09-05T00:00:00Z"),
      booking("registration", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"),
      booking("old-no-registration", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z")
    ];

    expect(values.sort(compareRegistrationBookings).map((value) => value.id)).toEqual([
      "registration",
      "new-no-registration",
      "old-no-registration"
    ]);
  });

  it("uses creation time and id as stable tie-breakers", () => {
    const values = [
      booking("b", null, "2026-09-04T00:00:00Z"),
      booking("a", null, "2026-09-04T00:00:00Z"),
      booking("newer", null, "2026-09-05T00:00:00Z")
    ];

    expect(values.sort(compareRegistrationBookings).map((value) => value.id)).toEqual(["newer", "a", "b"]);
  });

  it("preserves activity ordering after status and search filters", async () => {
    const values = [
      booking("no-registration", "2026-09-05T00:00:00Z", "2026-09-05T00:00:00Z"),
      booking("registration", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z")
    ];
    const findMany = jest.fn(() => Promise.resolve(values));
    const service = new BookingsService({ booking: { findMany } } as never, {} as never, {} as never);

    const result = await service.list({ status: "accepted", query: "Maria" });

    expect(result.bookings.map((value) => value.id)).toEqual(["registration", "no-registration"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "accepted",
          OR: expect.arrayContaining([{ guestName: { contains: "Maria", mode: "insensitive" } }])
        })
      })
    );
  });

  it("keeps uncategorized registrations newest-first by invite or submission activity", () => {
    const values = [
      {
        id: "new-invite",
        createdAt: at("2026-09-04T00:00:00Z"),
        submission: null
      },
      {
        id: "new-submission",
        createdAt: at("2026-09-01T00:00:00Z"),
        submission: { createdAt: at("2026-09-05T00:00:00Z") }
      }
    ];

    expect(values.sort(compareRegistrationInvites).map((value) => value.id)).toEqual([
      "new-submission",
      "new-invite"
    ]);
  });
});
