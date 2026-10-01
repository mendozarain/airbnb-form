import { Signer } from "@aws-sdk/rds-signer";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { loadSecrets } from "./config/secrets.js";

// Provisions the least-privilege runtime role, runs `prisma migrate deploy` and grants that role access to the
// result. Everything connects to Aurora as the admin user with a short-lived IAM token, so no password exists.
export async function handler() {
  await loadSecrets();
  const host = requiredEnv("DB_HOST");
  const admin = requiredEnv("DB_ADMIN_USER");
  const appUser = requiredEnv("DB_USER");
  const port = Number(process.env.DB_PORT ?? 5432);
  const database = process.env.DB_NAME ?? "postgres";
  const token = await new Signer({
    hostname: host,
    port,
    username: admin,
    region: process.env.AWS_REGION ?? "ap-southeast-2"
  }).getAuthToken();

  await withAdmin({ host, port, user: admin, password: token, database }, async (client) => {
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appUser]);
    if (!exists.rowCount) await client.query(`CREATE ROLE ${quoteIdent(appUser)} LOGIN`);
    await client.query(`GRANT rds_iam TO ${quoteIdent(appUser)}`);
  });

  const url = `postgresql://${encodeURIComponent(admin)}:${encodeURIComponent(token)}@${host}:${port}/${database}?sslmode=require`;
  const log = await runPrismaMigrate(url);

  await withAdmin({ host, port, user: admin, password: token, database }, async (client) => {
    const role = quoteIdent(appUser);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(admin)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(admin)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`
    );
  });

  return { ok: true, log: log.slice(-2000) };
}

async function withAdmin(
  config: { host: string; port: number; user: string; password: string; database: string },
  work: (client: pg.Client) => Promise<void>
) {
  const client = new pg.Client({ ...config, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 60_000 });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function runPrismaMigrate(databaseUrl: string) {
  const root = process.env.LAMBDA_TASK_ROOT ?? process.cwd();
  const output: string[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { cwd: path.join(root, "backend"), env: { ...process.env, DATABASE_URL: databaseUrl } }
    );
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  const log = output.join("");
  console.log(log);
  if (code !== 0) throw new Error(`prisma migrate deploy exited with ${code}`);
  return log;
}

function quoteIdent(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
