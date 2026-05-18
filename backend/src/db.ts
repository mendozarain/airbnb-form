import { neon } from "@neondatabase/serverless";
import type { Env } from "./env";

export function sqlFor(env: Env) {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Add it with `wrangler secret put DATABASE_URL`.");
  }

  // Django analogy: this is the low-level DB connection, like using
  // `django.db.connection.cursor()` when you want explicit SQL instead of ORM models.
  return neon(env.DATABASE_URL);
}

export async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
