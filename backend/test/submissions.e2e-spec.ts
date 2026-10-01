import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AiReviewService } from "../src/ai-review/ai-review.service.js";
import { EntrancePassChatService } from "../src/automation/entrance-pass-chat.service.js";
import { AutomationService } from "../src/automation/automation.service.js";
import { StorageService } from "../src/storage/storage.service.js";
import { SubmissionsController } from "../src/submissions/submissions.controller.js";
import { SubmissionsService } from "../src/submissions/submissions.service.js";

describe("submission email endpoint", () => {
  it("passes a resend request to the automation service", async () => {
    const retryEmail = jest
      .fn<() => Promise<{ ok: true; status: string }>>()
      .mockResolvedValue({ ok: true, status: "submitted_email_sent" });
    const retryChat = jest.fn<() => Promise<{ status: string }>>().mockResolvedValue({ status: "sent" });
    const reconcileChat = jest
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValue({ status: "unknown" });
    const module = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [
        { provide: SubmissionsService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: EntrancePassChatService, useValue: { retry: retryChat, reconcile: reconcileChat } },
        { provide: AutomationService, useValue: { retryEmail } },
        { provide: AiReviewService, useValue: {} }
      ]
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/admin/submissions/submission-1/retry-email")
      .expect(201)
      .expect({ ok: true, status: "submitted_email_sent" });
    expect(retryEmail).toHaveBeenCalledWith("submission-1");

    await request(app.getHttpServer())
      .post("/api/admin/submissions/submission-1/chat-deliveries/delivery-1/retry")
      .expect(201)
      .expect({ status: "sent" });
    expect(retryChat).toHaveBeenCalledWith("submission-1", "delivery-1");
    await request(app.getHttpServer())
      .post("/api/admin/submissions/submission-1/chat-deliveries/delivery-1/reconcile")
      .expect(201)
      .expect({ status: "unknown" });
    expect(reconcileChat).toHaveBeenCalledWith("submission-1", "delivery-1");
    expect(retryEmail).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
