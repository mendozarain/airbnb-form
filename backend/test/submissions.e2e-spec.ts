import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AutomationService } from "../src/automation/automation.service.js";
import { StorageService } from "../src/storage/storage.service.js";
import { SubmissionsController } from "../src/submissions/submissions.controller.js";
import { SubmissionsService } from "../src/submissions/submissions.service.js";

describe("submission email endpoint", () => {
  it("passes a resend request to the automation service", async () => {
    const retryEmail = jest
      .fn<() => Promise<{ ok: true; status: string }>>()
      .mockResolvedValue({ ok: true, status: "submitted_email_sent" });
    const module = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [
        { provide: SubmissionsService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: AutomationService, useValue: { retryEmail } }
      ]
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/admin/submissions/submission-1/retry-email")
      .expect(201)
      .expect({ ok: true, status: "submitted_email_sent" });
    expect(retryEmail).toHaveBeenCalledWith("submission-1");

    await app.close();
  });
});
