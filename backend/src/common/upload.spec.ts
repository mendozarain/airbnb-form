import { BadRequestException } from "@nestjs/common";
import { MAX_UPLOAD_BYTES, parseUploadRequest, safeFileName, uploadKey } from "./upload.js";

describe("parseUploadRequest", () => {
  it("accepts an image or PDF within the size limit", () => {
    expect(parseUploadRequest({ filename: "id.jpg", contentType: "Image/JPEG", size: 1234 })).toEqual({
      filename: "id.jpg",
      contentType: "image/jpeg",
      size: 1234
    });
    expect(parseUploadRequest({ filename: "id.pdf", contentType: "application/pdf", size: MAX_UPLOAD_BYTES })).toMatchObject({
      contentType: "application/pdf"
    });
  });

  it.each([
    [{ contentType: "image/png", size: 10 }],
    [{ filename: "a.png", contentType: "image/png", size: 0 }],
    [{ filename: "a.png", contentType: "image/png", size: 1.5 }],
    [{ filename: "a.png", contentType: "image/png", size: MAX_UPLOAD_BYTES + 1 }],
    [{ filename: "a.exe", contentType: "application/x-msdownload", size: 10 }],
    [undefined]
  ])("rejects %j", (body) => {
    expect(() => parseUploadRequest(body)).toThrow(BadRequestException);
  });
});

describe("uploadKey", () => {
  it("keeps the prefix and strips unsafe characters from the file name", () => {
    expect(safeFileName("my id (1).jpg")).toBe("my_id__1_.jpg");
    expect(uploadKey("ids/invite-1", "../x y.png")).toMatch(/^ids\/invite-1\/[0-9a-f-]{36}-\.\._x_y\.png$/);
  });
});
