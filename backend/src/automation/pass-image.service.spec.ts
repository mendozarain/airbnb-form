import { PassImageService } from "./pass-image.service.js";

describe("PassImageService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough";
    process.env.PUBLIC_APP_URL = "https://dev.example.com/";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates a signed URL and resolves it to the private storage key", () => {
    const service = new PassImageService();
    const now = new Date("2026-07-31T00:00:00.000Z");
    const key = "automation/1234-entrance-pass-before-submit.png";
    const url = service.createUrl(key, now);
    const token = url.split("/").at(-1);

    expect(url).toMatch(/^https:\/\/dev\.example\.com\/api\/entrance-pass\//);
    expect(token).toBeDefined();
    expect(service.verifyToken(token!, new Date("2026-08-01T00:00:00.000Z"))).toBe(key);
  });

  it("rejects tampered and expired image URLs", () => {
    const service = new PassImageService();
    const now = new Date("2026-07-31T00:00:00.000Z");
    const url = service.createUrl("automation/1234-entrance-pass-before-submit.png", now);
    const token = url.split("/").at(-1)!;

    expect(() => service.verifyToken(`${token.slice(0, -1)}x`, now)).toThrow("Invalid entrance pass token");
    expect(() => service.verifyToken(token, new Date("2026-08-31T00:00:01.000Z"))).toThrow(
      "Invalid or expired entrance pass token"
    );
  });

  it("rejects storage keys outside the generated entrance-pass namespace", () => {
    const service = new PassImageService();

    expect(() => service.createUrl("ids/private-document.png")).toThrow("Invalid entrance pass storage key");
  });
});
