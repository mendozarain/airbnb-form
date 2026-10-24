import { Logger } from "@nestjs/common";
import { jest } from "@jest/globals";
import { requiresGuestId } from "@cozy-d-714/shared";
import { AI_REVIEW_MODEL } from "../settings/settings.service.js";
import {
  AiReviewService,
  classifyModelResult,
  readStoredResults,
  type ModelDocument,
  type ModelResult
} from "./ai-review.service.js";

describe("AI ID review", () => {
  const juanId: ModelDocument = {
    appearsPhotoId: true,
    nameAsPrinted: "JUAN M DELA CRUZ",
    belongsToGuest: false
  };
  function modelResult(overrides: Partial<ModelResult> & Pick<ModelResult, "verdict">): ModelResult {
    return {
      imageReadable: true,
      confidence: 0.96,
      reason: "Checked against the entered name",
      documents: [{ ...juanId, belongsToGuest: overrides.verdict === "match" }],
      ...overrides
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("requires IDs only for ages 16 through 59", () => {
    expect(requiresGuestId(15)).toBe(false);
    expect(requiresGuestId(16)).toBe(true);
    expect(requiresGuestId(59)).toBe(true);
    expect(requiresGuestId(60)).toBe(false);
  });

  it("accepts a partial typed name when the model says the ID matches", () => {
    const result = classifyModelResult(
      "guest-1",
      "Juan Cruz",
      modelResult({
        verdict: "match",
        reason: "Middle name omitted; given name and surname agree",
        documents: [{ ...juanId, nameAsPrinted: "JUAN DELA CRUZ", belongsToGuest: true }]
      })
    );
    expect(result.verdict).toBe("match");
    expect(result.matchedName).toBe("JUAN DELA CRUZ");
    expect(result.extractedNames).toEqual(["JUAN DELA CRUZ"]);
  });

  it("accepts a different name order when the model says the ID matches", () => {
    const result = classifyModelResult(
      "guest-1",
      "Cruz, Juan",
      modelResult({
        verdict: "match",
        reason: "Surname-first order still names the same person",
        documents: [{ ...juanId, belongsToGuest: true }]
      })
    );
    expect(result.verdict).toBe("match");
    expect(result.matchedName).toBe("JUAN M DELA CRUZ");
  });

  it("accepts one obscured letter when the model says the ID matches", () => {
    const result = classifyModelResult(
      "guest-1",
      "Juan Dela Cruz",
      modelResult({
        verdict: "match",
        confidence: 0.93,
        reason: "One letter is blurred; the rest of the name agrees",
        documents: [{ ...juanId, nameAsPrinted: "JUAN DELA CRUX", belongsToGuest: true }]
      })
    );
    expect(result.verdict).toBe("match");
    expect(result.matchedName).toBe("JUAN DELA CRUX");
    expect(result.confidence).toBe(0.93);
  });

  it("rejects a different person when the model reports a high-confidence mismatch", () => {
    const result = classifyModelResult(
      "guest-1",
      "Pedro Reyes",
      modelResult({
        verdict: "mismatch",
        confidence: 0.97,
        reason: "The ID clearly names a different person",
        documents: [{ ...juanId, belongsToGuest: false }]
      })
    );
    expect(result.verdict).toBe("clear_mismatch");
    expect(result.matchedName).toBeNull();
    expect(result.extractedNames).toEqual(["JUAN M DELA CRUZ"]);
  });

  it("holds an unsure or low-confidence result for manual review", () => {
    expect(
      classifyModelResult(
        "guest-1",
        "Pedro Reyes",
        modelResult({ verdict: "mismatch", confidence: 0.62, reason: "Name is partly unclear" })
      ).verdict
    ).toBe("uncertain");
    expect(
      classifyModelResult(
        "guest-1",
        "Juan Dela Cruz",
        modelResult({ verdict: "unsure", confidence: 0.4, reason: "Could not tell" })
      ).verdict
    ).toBe("uncertain");
    expect(
      classifyModelResult(
        "guest-1",
        "Juan Dela Cruz",
        modelResult({ verdict: "match", confidence: 0.5, reason: "Weak match" })
      ).verdict
    ).toBe("uncertain");
    expect(
      classifyModelResult(
        "guest-1",
        "Juan Dela Cruz",
        modelResult({ verdict: "match", imageReadable: false })
      ).verdict
    ).toBe("uncertain");
  });

  it("passes when the matching guest appears on the second visible ID", () => {
    const result = classifyModelResult(
      "guest-1",
      "Maria Santos",
      modelResult({
        verdict: "match",
        confidence: 0.98,
        reason: "The second ID belongs to the guest",
        documents: [
          juanId,
          { appearsPhotoId: true, nameAsPrinted: "MARIA CLARA SANTOS", belongsToGuest: true }
        ]
      })
    );
    expect(result.verdict).toBe("match");
    expect(result.extractedNames).toEqual(["JUAN M DELA CRUZ", "MARIA CLARA SANTOS"]);
    expect(result.matchedName).toBe("MARIA CLARA SANTOS");
  });

  it("sends a non-ID or unreadable upload to review instead of auto-rejecting it", () => {
    const mixed = classifyModelResult(
      "guest-1",
      "Pedro Reyes",
      modelResult({
        verdict: "mismatch",
        confidence: 0.96,
        reason: "One item is not an ID",
        documents: [juanId, { appearsPhotoId: false, nameAsPrinted: null, belongsToGuest: false }]
      })
    );
    expect(mixed.verdict).toBe("uncertain");
    expect(
      classifyModelResult("guest-1", "Pedro Reyes", modelResult({ verdict: "mismatch", documents: [] }))
        .verdict
    ).toBe("uncertain");
  });

  it("normalizes legacy stored single-name results", () => {
    expect(
      readStoredResults([
        {
          guestId: "guest-1",
          enteredName: "Juan Dela Cruz",
          extractedName: "JUAN DELA CRUZ",
          verdict: "match",
          confidence: 0.96,
          reason: "Match"
        }
      ])[0]
    ).toMatchObject({
      extractedName: "JUAN DELA CRUZ",
      extractedNames: ["JUAN DELA CRUZ"],
      matchedName: "JUAN DELA CRUZ"
    });
  });

  it("requests strict zero-retention structured output from OpenRouter", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  image_readable: true,
                  verdict: "match",
                  confidence: 0.97,
                  reason: "The ID belongs to the entered guest",
                  documents: [
                    {
                      appears_photo_id: true,
                      name_as_printed: "Juan Dela Cruz",
                      belongs_to_guest: true
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const service = new AiReviewService({} as never, {} as never, {} as never, {} as never, {} as never);
    const callable = service as unknown as {
      callOpenRouter(
        file: { filename: string; contentType: string },
        bytes: Uint8Array,
        isPdf: boolean,
        enteredName: string
      ): Promise<ModelResult>;
    };

    await expect(
      callable.callOpenRouter(
        { filename: "id.jpg", contentType: "image/jpeg" },
        new Uint8Array([1, 2, 3]),
        false,
        "Juan Dela Cruz"
      )
    ).resolves.toMatchObject({
      verdict: "match",
      confidence: 0.97,
      documents: [{ nameAsPrinted: "Juan Dela Cruz", belongsToGuest: true }]
    });

    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") throw new Error("Expected JSON body");
    const body = JSON.parse(request.body) as {
      model: string;
      provider: Record<string, unknown>;
      response_format: { json_schema: { strict: boolean; schema: Record<string, unknown> } };
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("google/gemini-3.1-flash-lite");
    expect(body.model).toBe(AI_REVIEW_MODEL);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toMatchObject({
      required: ["image_readable", "verdict", "confidence", "reason", "documents"]
    });
    expect(body.messages[0]?.content[0]?.text).toContain("Juan Dela Cruz");
    expect(body.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("logs the OpenRouter status and error text without the API key or image", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "No endpoints found matching your data policy (Zero data retention). Key test-key",
              code: 404
            }
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        )
      )
    );
    const service = new AiReviewService({} as never, {} as never, {} as never, {} as never, {} as never);
    const callable = service as unknown as {
      callOpenRouter(
        file: { filename: string; contentType: string },
        bytes: Uint8Array,
        isPdf: boolean,
        enteredName: string
      ): Promise<ModelResult>;
    };

    await expect(
      callable.callOpenRouter(
        { filename: "id.jpg", contentType: "image/jpeg" },
        new Uint8Array([1, 2, 3]),
        false,
        "Juan Dela Cruz"
      )
    ).rejects.toThrow("OpenRouter request failed (404)");

    expect(loggerError).toHaveBeenCalledTimes(3);
    const logged = loggerError.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("OpenRouter request failed (404)");
    expect(logged).toContain("No endpoints found matching your data policy (Zero data retention)");
    expect(logged).not.toContain("test-key");
    expect(logged).not.toContain("base64");
    expect(logged).not.toContain("AQID");
  });

  it("queues exactly one PMO run after a passing check when Auto Queue is enabled", async () => {
    const reviewUpdate = jest.fn(() => Promise.resolve({}));
    const submissionUpdate = jest.fn(() => Promise.resolve({}));
    const automationCreate = jest.fn(() => Promise.resolve({}));
    const submissionFindFirst = jest
      .fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "submission-1" });
    const submissionFindUnique = jest.fn(() => Promise.resolve({ id: "submission-1", guests: [] }));
    const prisma = {
      submission: {
        findFirst: submissionFindFirst,
        findUnique: submissionFindUnique,
        updateMany: jest.fn(() => Promise.resolve({ count: 1 }))
      },
      submissionAiReview: { upsert: jest.fn(() => Promise.resolve({})) },
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          submissionAiReview: { update: reviewUpdate },
          submission: { update: submissionUpdate },
          automationRun: { create: automationCreate }
        })
      )
    };
    const settings = {
      isAiIdCheckEnabled: jest.fn(() => Promise.resolve(false)),
      isAutoQueueEnabled: jest.fn(() => Promise.resolve(true))
    };
    const audit = { record: jest.fn(() => Promise.resolve({})) };
    const service = new AiReviewService(
      prisma as never,
      {} as never,
      settings as never,
      {} as never,
      audit as never
    );

    await service.processQueue();

    expect(submissionUpdate).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: { status: "QUEUED" }
    });
    expect(automationCreate).toHaveBeenCalledTimes(1);
    expect(automationCreate).toHaveBeenCalledWith({
      data: { submissionId: "submission-1", status: "queued" }
    });
  });
});
