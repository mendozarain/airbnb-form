import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import { requiredEnv } from "../config/env.js";

type PutOptions = {
  contentType?: string;
  metadata?: Record<string, string>;
};

@Injectable()
export class StorageService {
  // Lambda reserves the AWS_* names, so config lives under S3_*. The legacy AWS_* names still work for local
  // S3-compatible stores. Without explicit keys the SDK default credential chain (the function's IAM role) applies.
  private readonly bucket = process.env.S3_BUCKET?.trim() || requiredEnv("AWS_S3_BUCKET_NAME");
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT?.trim() || process.env.AWS_ENDPOINT_URL?.trim() || undefined,
    region: process.env.S3_REGION?.trim() || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "auto",
    forcePathStyle: (process.env.S3_URL_STYLE ?? process.env.AWS_S3_URL_STYLE) === "path",
    ...(process.env.S3_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY")
          }
        }
      : {})
  });

  async put(key: string, body: Buffer | Uint8Array | string | Readable, options: PutOptions = {}) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: normalizeKey(key),
        Body: body,
        ContentType: options.contentType,
        Metadata: options.metadata
      })
    );
  }

  async get(key: string) {
    return this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: normalizeKey(key)
        })
      )
      .catch((error) => {
        if (isNotFound(error)) return null;
        throw error;
      });
  }

  async getBytes(key: string) {
    const object = await this.get(key);
    if (!object?.Body) return null;
    return Buffer.from(await object.Body.transformToByteArray());
  }

  async getJson<T>(key: string) {
    const bytes = await this.getBytes(key);
    return bytes ? (JSON.parse(bytes.toString("utf8")) as T) : null;
  }

  async head(key: string) {
    const object = await this.client
      .send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: normalizeKey(key)
        })
      )
      .catch((error) => {
        if (isNotFound(error)) return null;
        throw error;
      });

    if (!object) return null;
    return {
      size: object.ContentLength ?? 0,
      contentType: object.ContentType,
      metadata: normalizeMetadata(object.Metadata),
      lastModified: object.LastModified
    };
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: normalizeKey(key)
      })
    );
  }

  async list(prefix: string, cursor?: string) {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
        MaxKeys: 1000
      })
    );

    return {
      objects: (response.Contents ?? []).flatMap((item) =>
        item.Key
          ? [
              {
                key: item.Key,
                size: item.Size ?? 0,
                lastModified: item.LastModified ?? new Date(0)
              }
            ]
          : []
      ),
      nextCursor: response.NextContinuationToken
    };
  }

  // The browser must PUT exactly this content type and byte length, so the signed URL cannot be reused for a
  // larger or different object. x-amz-meta-* values are hoisted into the URL and need no extra headers.
  async presignPut(
    key: string,
    options: {
      contentType: string;
      contentLength: number;
      metadata?: Record<string, string>;
      expiresInSeconds?: number;
    }
  ) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: normalizeKey(key),
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        Metadata: options.metadata
      }),
      { expiresIn: options.expiresInSeconds ?? 300, signableHeaders: new Set(["content-type", "content-length"]) }
    );
  }

  async presignGet(key: string, options: { filename?: string; contentType?: string; expiresInSeconds?: number } = {}) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: normalizeKey(key),
        ResponseContentType: options.contentType,
        ResponseContentDisposition: options.filename
          ? `inline; filename="${options.filename.replace(/["\\\r\n]/g, "_")}"`
          : undefined
      }),
      { expiresIn: options.expiresInSeconds ?? 120 }
    );
  }

  nodeStream(object: GetObjectCommandOutput) {
    if (!object.Body) throw new Error("Stored object has no body");
    return object.Body as Readable;
  }
}

function normalizeKey(key: string) {
  const value = key.replace(/^\/+/, "");
  if (!value || value.split("/").includes("..")) throw new Error("Invalid storage key");
  return value;
}

function normalizeMetadata(metadata?: Record<string, string>): Record<string, string> {
  if (!metadata) return {};
  return {
    ...metadata,
    originalName: metadata.originalName ?? metadata.originalname,
    savedAt: metadata.savedAt ?? metadata.savedat,
    checkedAt: metadata.checkedAt ?? metadata.checkedat
  };
}

function isNotFound(error: unknown) {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NoSuchKey" || value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}
