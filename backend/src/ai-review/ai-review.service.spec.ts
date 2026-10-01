import { jest } from "@jest/globals";
import { requiresGuestId } from "@cozy-d-714/shared";
import {
  AiReviewService,
  classifyModelResult,
  namesMatch,
  readStoredResults,
  type ModelDocument,
  type ModelResult
} from "./ai-review.service.js";

describe("AI ID review", () => {
  const clearDocument: ModelDocument = {
    documentReadable: true,
    appearsPhotoId: true,
    extractedName: "JUAN M DELA CRUZ",
    confidence: 0.96,
    explanation: "Readable government ID"
  };
  const clearId: ModelResult = {
    imageReadable: true,
    documents: [clearDocument],
    explanation: "One visible ID"
  };

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

  it("matches reordered names, omitted middle names, accents, and initials", () => {
    expect(namesMatch("Juan Dela Cruz", "CRUZ, JUAN M. DELA")).toBe(true);
    expect(namesMatch("José M Mendoza", "Jose Miguel Mendoza")).toBe(true);
    expect(namesMatch("Maria Santos", "Maria Clara Santos")).toBe(true);
    expect(namesMatch("Juan Dela Cruz", "Pedro Dela Cruz")).toBe(false);
    expect(namesMatch("Juan", "Juan Dela Cruz")).toBe(false);
  });

  it("passes a normalized match and rejects only a clear high-confidence mismatch", () => {
    expect(classifyModelResult("guest-1", "Juan Dela Cruz", clearId).verdict).toBe("match");
    expect(
      classifyModelResult("guest-1", "Pedro Reyes", {
        ...clearId,
        documents: [{ ...clearDocument, extractedName: "Juan Dela Cruz" }]
      }).verdict
    ).toBe("clear_mismatch");
    expect(
      classifyModelResult("guest-1", "Pedro Reyes", {
        ...clearId,
        documents: [{ ...clearDocument, confidence: 0.89 }]
      }).verdict
    ).toBe("uncertain");
  });

  it("passes when the matching guest appears on the second visible ID", () => {
    const result = classifyModelResult("guest-1", "Maria Santos", {
      imageReadable: true,
      documents: [clearDocument, { ...clearDocument, extractedName: "MARIA CLARA SANTOS", confidence: 0.98 }],
      explanation: "Two visible IDs"
    });
    expect(result.verdict).toBe("match");
    expect(result.extractedNames).toEqual(["JUAN M DELA CRUZ", "MARIA CLARA SANTOS"]);
    expect(result.matchedName).toBe("MARIA CLARA SANTOS");
  });

  it("rejects several readable nonmatching IDs but sends mixed-quality uploads to review", () => {
    const mismatch = classifyModelResult("guest-1", "Pedro Reyes", {
      imageReadable: true,
      documents: [clearDocument, { ...clearDocument, extractedName: "Maria Santos" }],
      explanation: "Two readable IDs"
    });
    expect(mismatch.verdict).toBe("clear_mismatch");

    const mixed = classifyModelResult("guest-1", "Pedro Reyes", {
      imageReadable: true,
      documents: [clearDocument, { ...clearDocument, extractedName: null, documentReadable: false }],
      explanation: "One unreadable ID"
    });
    expect(mixed.verdict).toBe("uncertain");
    expect(classifyModelResult("guest-1", "Pedro Reyes", { ...clearId, documents: [] }).verdict).toBe(
      "uncertain"
    );
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
                  documents: [
                    {
                      document_readable: true,
                      appears_photo_id: true,
                      extracted_name: "Juan Dela Cruz",
                      confidence: 0.97,
                      explanation: "Readable ID"
                    }
                  ],
                  explanation: "Readable"
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
        isPdf: boolean
      ): Promise<ModelResult>;
    };

    await expect(
      callable.callOpenRouter(
        { filename: "id.jpg", contentType: "image/jpeg" },
        new Uint8Array([1, 2, 3]),
        false
      )
    ).resolves.toMatchObject({
      documents: [{ extractedName: "Juan Dela Cruz", confidence: 0.97 }]
    });

    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") throw new Error("Expected JSON body");
    const body = JSON.parse(request.body) as {
      model: string;
      provider: Record<string, unknown>;
      response_format: { json_schema: { strict: boolean; schema: Record<string, unknown> } };
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("google/gemini-2.5-flash-lite");
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toMatchObject({
      required: ["image_readable", "documents", "explanation"]
    });
    expect(body.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
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
