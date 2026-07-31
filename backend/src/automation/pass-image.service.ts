import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { requiredEnv } from "../config/env.js";

const ENTRANCE_PASS_URL_TTL_SECONDS = 30 * 24 * 60 * 60;

type EntrancePassTokenPayload = {
  key: string;
  expiresAt: number;
};

@Injectable()
export class PassImageService {
  createUrl(storageKey: string, now = new Date()) {
    if (!isEntrancePassStorageKey(storageKey)) {
      throw new Error("Invalid entrance pass storage key");
    }

    const payload: EntrancePassTokenPayload = {
      key: storageKey,
      expiresAt: Math.floor(now.getTime() / 1000) + ENTRANCE_PASS_URL_TTL_SECONDS
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(encodedPayload);
    const baseUrl = requiredEnv("PUBLIC_APP_URL").replace(/\/+$/, "");

    return `${baseUrl}/api/entrance-pass/${encodedPayload}.${signature}`;
  }

  verifyToken(token: string, now = new Date()) {
    const [encodedPayload, signature, extra] = token.split(".");
    if (!encodedPayload || !signature || extra !== undefined) {
      throw new Error("Invalid entrance pass token");
    }

    const expectedSignature = this.sign(encodedPayload);
    const actualBytes = Buffer.from(signature, "base64url");
    const expectedBytes = Buffer.from(expectedSignature, "base64url");
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      throw new Error("Invalid entrance pass token");
    }

    let payload: EntrancePassTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8")
      ) as EntrancePassTokenPayload;
    } catch {
      throw new Error("Invalid entrance pass token");
    }

    if (
      !payload ||
      !isEntrancePassStorageKey(payload.key) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(now.getTime() / 1000)
    ) {
      throw new Error("Invalid or expired entrance pass token");
    }

    return payload.key;
  }

  private sign(encodedPayload: string) {
    return createHmac("sha256", requiredEnv("BETTER_AUTH_SECRET")).update(encodedPayload).digest("base64url");
  }
}

function isEntrancePassStorageKey(value: unknown): value is string {
  return (
    typeof value === "string" && /^automation\/[a-zA-Z0-9_-]+-entrance-pass-before-submit\.png$/.test(value)
  );
}
