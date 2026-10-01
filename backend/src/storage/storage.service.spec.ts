import { StorageService } from "./storage.service.js";

describe("StorageService presigning", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.S3_BUCKET = "uploads-bucket";
    process.env.S3_REGION = "ap-southeast-2";
    process.env.S3_ACCESS_KEY_ID = "AKIATEST";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("signs the content type and exact length, and hoists metadata into the URL", async () => {
    const url = new URL(
      await new StorageService().presignPut("ids/invite-1/file.jpg", {
        contentType: "image/jpeg",
        contentLength: 2048,
        metadata: { originalName: "file.jpg", deleteAfter: "2026-11-01T00:00:00.000Z" }
      })
    );
    expect(url.host).toBe("uploads-bucket.s3.ap-southeast-2.amazonaws.com");
    expect(url.pathname).toBe("/ids/invite-1/file.jpg");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("x-amz-meta-originalname")).toBe("file.jpg");
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBe(300);
  });

  it("rejects keys that escape the bucket prefix", async () => {
    await expect(
      new StorageService().presignGet("ids/../secrets", { filename: 'a"b.png' })
    ).rejects.toThrow("Invalid storage key");
  });

  it("forces a safe download name on signed GET URLs", async () => {
    const url = new URL(await new StorageService().presignGet("ids/i/a.png", { filename: 'a"b\r\n.png', contentType: "image/png" }));
    expect(url.searchParams.get("response-content-disposition")).toBe('inline; filename="a_b__.png"');
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
  });
});
