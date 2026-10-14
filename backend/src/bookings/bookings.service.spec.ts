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
    const service = new BookingsService(
      { booking: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never
    );

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

describe("BookingsService.emailInvite", () => {
  function setup(
    overrides: { invite?: Record<string, unknown>; guestEmail?: string | null; configured?: boolean } = {}
  ) {
    process.env.PUBLIC_APP_URL = "https://app.example.com/";
    const invite = {
      id: "invite-1",
      publicToken: "token-1",
      purpose: "Tenant",
      status: "OPEN",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      checkIn: at("2027-01-10T00:00:00Z"),
      checkOut: at("2027-01-12T00:00:00Z"),
      booking: { id: "booking-1", guestName: "Maria Guest", guestEmail: overrides.guestEmail ?? null },
      ...overrides.invite
    };
    const prisma = {
      invite: { findUnique: jest.fn(() => Promise.resolve(invite)) },
      booking: { update: jest.fn(() => Promise.resolve({})) }
    };
    const audit = { record: jest.fn(() => Promise.resolve({})) };
    const email = {
      configured: jest.fn(() => overrides.configured ?? true),
      sendMessage: jest.fn<
        (input: { to: string; subject: string; html: string }) => Promise<{ messageId: string }>
      >(() => Promise.resolve({ messageId: "msg-1" }))
    };
    const service = new BookingsService(prisma as never, {} as never, audit as never, email as never);
    return { service, prisma, audit, email };
  }

  it("emails the registration link, keeps the real address, and audits it", async () => {
    const { service, prisma, audit, email } = setup({ guestEmail: "abc123@guest.booking.com" });

    await expect(service.emailInvite("invite-1", "maria@example.com", { id: "admin" })).resolves.toEqual({
      status: "sent",
      to: "maria@example.com"
    });

    const sent = email.sendMessage.mock.calls[0]?.[0];
    expect(sent?.to).toBe("maria@example.com");
    expect(sent?.html).toContain("https://app.example.com/invite/token-1");
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { guestEmail: "maria@example.com" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      { id: "admin" },
      "invite.emailed",
      "invite",
      "invite-1",
      expect.objectContaining({ to: "maria@example.com", bookingId: "booking-1" })
    );
  });

  it("does not overwrite a real guest email already on the booking", async () => {
    const { service, prisma } = setup({ guestEmail: "owner@example.com" });

    await service.emailInvite("invite-1", "maria@example.com");

    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it("refuses expired or revoked links and unconfigured email", async () => {
    await expect(
      setup({ invite: { expiresAt: new Date(Date.now() - 1000) } }).service.emailInvite("invite-1", "a@b.co")
    ).rejects.toThrow("Only an active link can be emailed");
    await expect(
      setup({ invite: { revokedAt: new Date() } }).service.emailInvite("invite-1", "a@b.co")
    ).rejects.toThrow("Only an active link can be emailed");
    const unconfigured = setup({ configured: false });
    await expect(unconfigured.service.emailInvite("invite-1", "a@b.co")).rejects.toThrow("not configured");
    expect(unconfigured.email.sendMessage).not.toHaveBeenCalled();
  });
});
