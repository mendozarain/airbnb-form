import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export type UploadRequest = { filename: string; contentType: string; size: number };

// IDs are reviewed as images or PDFs; reject anything else before a presigned URL is issued.
export function parseUploadRequest(value: unknown): UploadRequest {
  const body = (value ?? {}) as Partial<UploadRequest>;
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const size = typeof body.size === "number" ? body.size : Number.NaN;
  if (!filename || filename.length > 255) throw new BadRequestException("A file name is required");
  if (!Number.isInteger(size) || size <= 0) throw new BadRequestException("File size is required");
  if (size > MAX_UPLOAD_BYTES) throw new BadRequestException("Files can be at most 100 MB");
  if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
    throw new BadRequestException("Upload an image or PDF");
  }
  return { filename, contentType, size };
}

export function uploadKey(prefix: string, filename: string) {
  return `${prefix}/${randomUUID()}-${safeFileName(filename)}`;
}

export function safeFileName(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function deleteAfterIso() {
  return new Date(Date.now() + 31 * 86_400_000).toISOString();
}
