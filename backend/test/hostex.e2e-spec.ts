import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HostexAdminController, HostexWebhookController } from "../src/hostex/hostex.controller.js";
import { HostexService } from "../src/hostex/hostex.service.js";

describe("Hostex endpoints", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("authenticates and quickly queues webhook payloads while accepting unknown fields", async () => {
    const authenticateWebhook = jest
      .fn<() => Promise<"verified" | "invalid" | "unconfigured">>()
      .mockResolvedValueOnce("invalid")
      .mockResolvedValueOnce("unconfigured")
      .mockResolvedValueOnce("verified");
    const enqueueWebhook = jest
      .fn<() => Promise<{ ok: boolean; queued: boolean }>>()
      .mockResolvedValue({ ok: true, queued: true });
    const module = await Test.createTestingModule({
      controllers: [HostexWebhookController],
      providers: [{ provide: HostexService, useValue: { authenticateWebhook, enqueueWebhook } }]
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/webhooks/hostex")
      .set("Hostex-Webhook-Secret-Token", "wrong")
      .send({ event: "reservation_created" })
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/webhooks/hostex")
      .set("Hostex-Webhook-Secret-Token", "webhook-secret")
      .send({ event: "reservation_created" })
      .expect(503);

    await request(app.getHttpServer())
      .post("/api/webhooks/hostex?setup=bootstrap-token")
      .set("Hostex-Webhook-Secret-Token", "assigned-secret")
      .send({ event: "reservation_created", stay_code: "stay-1", future_field: true })
      .expect(200)
      .expect({ ok: true, queued: true });
    expect(enqueueWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ event: "reservation_created", future_field: true })
    );
    expect(authenticateWebhook).toHaveBeenLastCalledWith("assigned-secret", "bootstrap-token");

    await app.close();
  });

  it("exposes admin sync, send, and reconciliation actions", async () => {
    const status = jest
      .fn<() => Promise<{ webhookVerified: boolean; automationEnabled: boolean }>>()
      .mockResolvedValue({ webhookVerified: true, automationEnabled: false });
    const syncNow = jest
      .fn<() => Promise<{ ok: boolean; found: number; sent: number }>>()
      .mockResolvedValue({ ok: true, found: 1, sent: 0 });
    const sendNow = jest.fn<() => Promise<{ status: string }>>().mockResolvedValue({ status: "SENT" });
    const reconcileInvite = jest
      .fn<() => Promise<{ ok: boolean; confirmed: boolean; status: string }>>()
      .mockResolvedValue({ ok: true, confirmed: true, status: "confirmed" });
    const module = await Test.createTestingModule({
      controllers: [HostexAdminController],
      providers: [{ provide: HostexService, useValue: { status, syncNow, sendNow, reconcileInvite } }]
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get("/api/admin/hostex/status")
      .expect(200)
      .expect({ webhookVerified: true, automationEnabled: false });
    await request(app.getHttpServer()).post("/api/admin/hostex/sync").expect(201);
    await request(app.getHttpServer())
      .post("/api/admin/hostex/invites/invite-1/send")
      .send({ allowUnknownDuplicate: true })
      .expect(201);
    await request(app.getHttpServer()).post("/api/admin/hostex/invites/invite-1/reconcile").expect(201);
    expect(sendNow).toHaveBeenCalledWith("invite-1", true);
    expect(reconcileInvite).toHaveBeenCalledWith("invite-1");

    await app.close();
  });
});
