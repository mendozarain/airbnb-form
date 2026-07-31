import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput
} from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import { requiredEnv } from "../config/env.js";

type PutOptions = {
  contentType?: string;
  metadata?: Record<string, string>;
};

@Injectable()
export class StorageService {
  private readonly bucket = requiredEnv("AWS_S3_BUCKET_NAME");
  private readonly client = new S3Client({
    endpoint: requiredEnv("AWS_ENDPOINT_URL"),
    region: process.env.AWS_DEFAULT_REGION ?? "auto",
    forcePathStyle: process.env.AWS_S3_URL_STYLE === "path",
    credentials: {
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY")
    }
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
