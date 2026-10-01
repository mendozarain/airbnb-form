import "dotenv/config";
import { Signer } from "@aws-sdk/rds-signer";
import { PrismaPg } from "@prisma/adapter-pg";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { PoolConfig } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

// With DB_IAM_AUTH=true (Aurora express configuration) the password is a short-lived IAM token, minted per new
// connection. Small, quickly-recycled pools let a scale-to-zero cluster pause between bursts of work.
export function databasePoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (env.DB_IAM_AUTH !== "true") return { connectionString: required(env, "DATABASE_URL") };

  const host = required(env, "DB_HOST");
  const port = Number(env.DB_PORT ?? 5432);
  const username = required(env, "DB_USER");
  const signer = new Signer({
    hostname: host,
    port,
    username,
    region: env.S3_REGION?.trim() || env.AWS_REGION || "ap-southeast-2"
  });

  return {
    host,
    port,
    user: username,
    database: env.DB_NAME ?? "postgres",
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: true },
    max: Number(env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 60_000
  };
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg(databasePoolConfig());
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
