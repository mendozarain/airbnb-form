import { ConflictException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { HostexDeliveryStatus, HostexWebhookStatus, InviteStatus } from "../generated/prisma/enums.js";
import { HostexUncertainSendError, type HostexReservation } from "./hostex.client.js";
import { HostexService } from "./hostex.service.js";

describe("HostexService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HOSTEX_PROPERTY_ID = "12684960";
    process.env.HOSTEX_TIMEZONE = "Asia/Manila";
    process.env.PUBLIC_APP_URL = "https://cozy.example.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("pins the first Hostex webhook secret only after the bootstrap token matches", async () => {
    delete process.env.HOSTEX_WEBHOOK_SECRET;
    process.env.HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN = "bootstrap-secret";
    let credential: { id: string; secretDigest: string; capturedAt: Date } | null = null;
    const create = jest.fn((args: any) => {
      credential = { ...args.data, capturedAt: new Date("2026-08-01T00:00:00Z") };
      return Promise.resolve(credential);
    });
    const findUnique = jest.fn(() => Promise.resolve(credential));
    const service = new HostexService(
      { hostexWebhookCredential: { findUnique, create } } as never,
      {} as never
    );

    await expect(service.authenticateWebhook("hostex-secret", undefined)).resolves.toBe("invalid");
    await expect(service.authenticateWebhook("hostex-secret", "wrong")).resolves.toBe("invalid");
    await expect(service.authenticateWebhook("hostex-secret", "bootstrap-secret")).resolves.toBe("verified");
    await expect(service.authenticateWebhook("hostex-secret", undefined)).resolves.toBe("verified");
    await expect(service.authenticateWebhook("different-secret", undefined)).resolves.toBe("invalid");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: { id: "primary", secretDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain("hostex-secret");
  });

  it("handles concurrent first webhook deliveries without replacing the pinned digest", async () => {
    delete process.env.HOSTEX_WEBHOOK_SECRET;
    process.env.HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN = "bootstrap-secret";
    const pinned = {
      id: "primary",
      secretDigest: "52c8ef4dea8c6f356a6622c0d0918543994ab7f2e5dd238312d65ffa2121a2eb",
      capturedAt: new Date()
    };
    let lookupCount = 0;
    let createCount = 0;
    const findUnique = jest.fn(() => {
      lookupCount += 1;
      return Promise.resolve(lookupCount <= 2 ? null : pinned);
    });
    const create = jest.fn(() => {
      createCount += 1;
      if (createCount === 1) return Promise.resolve(pinned);
      return Promise.reject(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    });
    const service = new HostexService(
      { hostexWebhookCredential: { findUnique, create } } as never,
      {} as never
    );

    await expect(
      Promise.all([
        service.authenticateWebhook("same-secret", "bootstrap-secret"),
        service.authenticateWebhook("same-secret", "bootstrap-secret")
      ])
    ).resolves.toEqual(["verified", "verified"]);
  });

  it("supports an explicit webhook secret override without database access", async () => {
    process.env.HOSTEX_WEBHOOK_SECRET = "configured-secret";
    const service = new HostexService({} as never, {} as never);

    await expect(service.authenticateWebhook("configured-secret", undefined)).resolves.toBe("verified");
    await expect(service.authenticateWebhook("wrong", undefined)).resolves.toBe("invalid");
  });

  it("creates every automated invite as Tenant while leaving manual creation separate", async () => {
    const reservation = acceptedReservation();
    const inviteCreate = jest.fn((args: any) =>
      Promise.resolve({
        id: "invite-1",
        publicToken: "public-token",
        status: "OPEN",
        checkIn: args.data.checkIn,
        checkOut: args.data.checkOut,
        expiresAt: args.data.expiresAt,
        hostexDelivery: {
          id: "delivery-1",
          inviteId: "invite-1",
          ...args.data.hostexDelivery.create,
          attempts: 0
        }
      })
    );
    const prisma = {
      hostexInviteDelivery: { findUnique: resolved(null) },
      invite: { create: inviteCreate }
    };
    const client = { listReservations: resolved([reservation]) };
    const service = new HostexService(prisma as never, client as never);

    await expect(service.syncNow()).resolves.toEqual({ ok: true, found: 1, sent: 0 });
    expect(inviteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: "Tenant",
          hostexDelivery: expect.objectContaining({
            create: expect.objectContaining({ stayCode: "stay-1" })
          })
        })
      })
    );
  });

  it("deduplicates webhook deliveries using their stable event fields", async () => {
    const create = jest.fn<(input: any) => Promise<{ id: string }>>().mockResolvedValue({ id: "event-1" });
    const prisma = { hostexWebhookEvent: { create } };
    const service = new HostexService(prisma as never, {} as never);
    const payload = {
      event: "reservation_created",
      reservation_code: "reservation-1",
      stay_code: "stay-1",
      property_id: 12684960,
      timestamp: "2026-08-01T00:00:00Z",
      future_field: "ignored"
    };

    await expect(service.enqueueWebhook(payload)).resolves.toEqual({ ok: true, queued: true });
    const dedupeKey = create.mock.calls[0][0].data.dedupeKey;
    expect(dedupeKey).toHaveLength(64);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey,
        event: "reservation_created",
        stayCode: "stay-1",
        propertyId: 12684960
      })
    });
  });

  it("ignores unknown webhook event types for forward compatibility", async () => {
    const service = new HostexService({} as never, {} as never);
    await expect(service.enqueueWebhook({ event: "new_future_event" })).resolves.toEqual({
      ok: true,
      ignored: true
    });
  });

  it("requires explicit duplicate-risk confirmation for an unknown send", async () => {
    const prisma = {
      hostexInviteDelivery: {
        findUnique: resolved({ id: "delivery-1", status: HostexDeliveryStatus.UNKNOWN })
      }
    };
    const service = new HostexService(prisma as never, {} as never);

    await expect(service.sendNow("invite-1", false)).rejects.toBeInstanceOf(ConflictException);
  });

  it("claims once and sends the personalized Tenant form message", async () => {
    const reservation = acceptedReservation();
    const delivery = scheduledDelivery();
    const findUnique = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery);
    const update = jest.fn<() => Promise<any>>().mockResolvedValue(delivery);
    const updateMany = resolved({ count: 1 });
    const inviteUpdate = resolved(delivery.invite);
    const prisma = {
      hostexInviteDelivery: { findUnique, update, updateMany },
      invite: { update: inviteUpdate },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const sendMessage = jest
      .fn<() => Promise<{ requestId: string }>>()
      .mockResolvedValue({ requestId: "request-1" });
    const client = { getReservation: resolved(reservation), sendMessage };
    const service = new HostexService(prisma as never, client as never);

    await service.sendNow("invite-1");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "delivery-1" }),
        data: expect.objectContaining({
          status: HostexDeliveryStatus.SENDING,
          attempts: { increment: 1 }
        })
      })
    );
    expect(sendMessage).toHaveBeenCalledWith(
      "conversation-1",
      "Hi Alex, please complete the guest registration form for your upcoming stay at Cozy Davao D-714 before arrival: https://cozy.example.com/invite/public-token\n\nPlease include every guest and upload a valid ID for each guest aged 16 or older. Thank you!"
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "delivery-1" },
        data: expect.objectContaining({ status: HostexDeliveryStatus.SENT, requestId: "request-1" })
      })
    );
  });

  it("records a network-interrupted send as unknown without retrying", async () => {
    const delivery = scheduledDelivery();
    const findUnique = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(delivery);
    const update = jest.fn<() => Promise<any>>().mockResolvedValue(delivery);
    const prisma = {
      hostexInviteDelivery: { findUnique, update, updateMany: resolved({ count: 1 }) },
      invite: { update: resolved(delivery.invite) },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const client = {
      getReservation: resolved(acceptedReservation()),
      sendMessage: jest.fn<() => Promise<never>>().mockRejectedValue(new HostexUncertainSendError())
    };
    const service = new HostexService(prisma as never, client as never);

    await service.sendNow("invite-1");

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: HostexDeliveryStatus.UNKNOWN })
      })
    );
  });

  it("expires an unused link when a reservation-updated webhook reports cancellation", async () => {
    process.env.ENABLE_HOSTEX_INVITE_AUTOMATION = "true";
    const webhook = {
      id: "event-1",
      event: "reservation_updated",
      reservationCode: "reservation-1",
      stayCode: "stay-1",
      conversationId: null,
      attempts: 0,
      createdAt: new Date()
    };
    const webhookFind = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce(webhook)
      .mockResolvedValueOnce(null);
    const deliveryUpdate = resolved(scheduledDelivery());
    const inviteUpdateMany = resolved({ count: 1 });
    const prisma = {
      hostexWebhookEvent: {
        findFirst: webhookFind,
        updateMany: resolved({ count: 1 }),
        update: resolved({})
      },
      hostexInviteDelivery: {
        findUnique: resolved(scheduledDelivery()),
        update: deliveryUpdate
      },
      invite: { updateMany: inviteUpdateMany },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const cancelled = { ...acceptedReservation(), status: "cancelled" };
    const service = new HostexService(prisma as never, { getReservation: resolved(cancelled) } as never);

    await service.processWebhookEvents();

    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: "delivery-1" },
      data: {
        status: HostexDeliveryStatus.CANCELLED,
        nextAttemptAt: null,
        lastError: "Reservation status is cancelled"
      }
    });
    expect(inviteUpdateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", status: InviteStatus.OPEN },
      data: { expiresAt: expect.any(Date) }
    });
    expect(prisma.hostexWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: HostexWebhookStatus.PROCESSED })
      })
    );
  });
});

function acceptedReservation(): HostexReservation {
  return {
    reservation_code: "reservation-1",
    stay_code: "stay-1",
    property_id: 12684960,
    channel_type: "airbnb",
    check_in_date: "2026-08-02",
    check_out_date: "2026-08-04",
    status: "accepted",
    guest_name: "Alex Guest",
    conversation_id: "conversation-1"
  };
}

function scheduledDelivery() {
  return {
    id: "delivery-1",
    inviteId: "invite-1",
    reservationCode: "reservation-1",
    stayCode: "stay-1",
    propertyId: 12684960,
    channelType: "airbnb",
    conversationId: "conversation-1",
    dueAt: new Date("2026-08-01T06:00:00.000Z"),
    status: HostexDeliveryStatus.SCHEDULED,
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    sentAt: null,
    confirmedAt: null,
    requestId: null,
    lastError: null,
    invite: {
      id: "invite-1",
      publicToken: "public-token",
      status: InviteStatus.OPEN,
      checkIn: new Date("2026-08-02T00:00:00.000Z"),
      checkOut: new Date("2026-08-04T00:00:00.000Z"),
      expiresAt: new Date("2026-08-08T06:00:00.000Z")
    }
  };
}

function resolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}
