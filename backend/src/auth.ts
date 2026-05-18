import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Context, Next } from "hono";
import type { AppEnv, Env } from "./env";

type AuthenticatedAdmin = {
  id: string;
  email?: string;
  role?: string | string[];
  claims: JWTPayload;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const token = headerToken || c.req.query("token") || "";

  if (!token) {
    return c.json({ error: "Admin login is required" }, 401);
  }

  if (!c.env.NEON_AUTH_URL) {
    return c.json({ error: "NEON_AUTH_URL is not configured" }, 500);
  }

  try {
    const claims = await verifyNeonAuthToken(c.env.NEON_AUTH_URL, token);
    const admin = adminFromClaims(claims);

    if (!isAllowedAdmin(admin, c.env.ADMIN_EMAILS)) {
      return c.json({ error: "This account is not allowed to use the admin area" }, 403);
    }

    c.set("admin", admin);
    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid admin session";
    return c.json({ error: message }, 401);
  }
}

async function verifyNeonAuthToken(authUrl: string, token: string) {
  const jwksUrl = new URL(trimTrailingSlash(authUrl));
  jwksUrl.pathname = `${jwksUrl.pathname.replace(/\/$/, "")}/.well-known/jwks.json`;

  const cacheKey = jwksUrl.toString();
  const jwks = jwksCache.get(cacheKey) ?? createRemoteJWKSet(jwksUrl);
  jwksCache.set(cacheKey, jwks);

  // Django analogy: this is the Worker version of AuthenticationMiddleware.
  // It proves the request belongs to a signed-in Neon Auth user before our route runs.
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

function adminFromClaims(claims: JWTPayload): AuthenticatedAdmin {
  return {
    id: String(claims.sub ?? ""),
    email: stringClaim(claims.email),
    role: roleClaim(claims.role),
    claims
  };
}

function isAllowedAdmin(admin: AuthenticatedAdmin, configuredEmails?: string) {
  const roles = Array.isArray(admin.role) ? admin.role : admin.role ? [admin.role] : [];
  if (roles.includes("admin")) {
    return true;
  }

  const allowedEmails = (configuredEmails ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length === 0) {
    return true;
  }

  return Boolean(admin.email && allowedEmails.includes(admin.email.toLowerCase()));
}

export function isExplicitlyBlockedAdminEmail(email: string, configuredEmails?: string) {
  const allowedEmails = (configuredEmails ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowedEmails.length > 0 && !allowedEmails.includes(email.toLowerCase());
}

function stringClaim(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function roleClaim(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return undefined;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
