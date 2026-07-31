import "dotenv/config";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { listEnv, requiredEnv } from "../config/env.js";
import { prisma } from "../prisma/prisma.client.js";
import { hashPassword, verifyPassword } from "./password.js";

export const auth = betterAuth({
  appName: "Cozy Davao D-714",
  baseURL: requiredEnv("BETTER_AUTH_URL"),
  basePath: "/api/auth",
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  trustedOrigins: listEnv("TRUSTED_ORIGINS"),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    password: {
      hash: hashPassword,
      verify: verifyPassword
    }
  },
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: process.env.NODE_ENV === "production"
  },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })]
});
