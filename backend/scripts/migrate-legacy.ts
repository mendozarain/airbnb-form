import "dotenv/config";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
const skipObjects = process.argv.includes("--skip-objects");
const source = new pg.Pool({ connectionString: required("SOURCE_DATABASE_URL") });
const destination = new pg.Pool({ connectionString: required("DATABASE_URL") });

const queries = {
  users: `select * from neon_auth."user" order by "createdAt"`,
  accounts: `select * from neon_auth.account order by "createdAt"`,
  invites: `select * from public.invites order by created_at`,
  submissions: `select * from public.submissions order by created_at`,
  guests: `select * from public.guests order by created_at`,
  files: `select * from public.guest_files where delete_after >= now() order by created_at`,
  runs: `select *, case when created_at >= now() - interval '31 days' then screenshot_r2_key else null end as retained_screenshot_key from public.automation_runs order by created_at`,
  settings: `select * from public.app_settings order by key`
} as const;

async function main() {
  const active = await source.query(`
    select
      (select count(*) from public.invites where status = 'open')::int as open_invites,
      (select count(*) from public.submissions where status in ('ready_for_review', 'queued', 'submitting'))::int as active_submissions
  `);
  if (active.rows[0].open_invites || active.rows[0].active_submissions) {
    throw new Error("Source has open invites or active submissions. Pause writes before migration.");
  }

  const data = Object.fromEntries(
    await Promise.all(
      Object.entries(queries).map(async ([name, sql]) => [name, (await source.query(sql)).rows])
    )
  ) as Record<keyof typeof queries, Array<Record<string, any>>>;

  console.table(Object.entries(data).map(([table, rows]) => ({ table, rows: rows.length })));
  const objectKeys = new Set<string>([
    ...data.files.map((row) => String(row.r2_key)),
    ...data.runs.flatMap((row) => (row.retained_screenshot_key ? [String(row.retained_screenshot_key)] : []))
  ]);
  console.log(`Objects selected by retention policy: ${objectKeys.size}`);
  if (dryRun) return;

  const destinationCount = await destination.query(`
    select
      (select count(*) from invites)::int +
      (select count(*) from auth_user)::int as rows
  `);
  if (destinationCount.rows[0].rows !== 0) {
    throw new Error("Destination is not empty. Migration only runs against a fresh Railway database.");
  }

  const copiedObjects = skipObjects ? { required: 0, optional: 0 } : await copyObjects([...objectKeys], data);
  await copyRows(data);
  await verify(data, skipObjects ? null : copiedObjects.required, objectKeys.size);
}

async function copyRows(data: Record<keyof typeof queries, Array<Record<string, any>>>) {
  const client = await destination.connect();
  const purposeByInvite = new Map(
    data.submissions.map((submission) => [submission.invite_id, submission.purpose])
  );
  try {
    await client.query("begin");
    for (const row of data.users) {
      await client.query(
        `insert into auth_user (id,name,email,"emailVerified",image,role,banned,"banReason","banExpires","createdAt","updatedAt") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          row.id,
          row.name,
          row.email,
          row.emailVerified,
          row.image,
          row.role ?? "admin",
          row.banned ?? false,
          row.banReason,
          row.banExpires,
          row.createdAt,
          row.updatedAt
        ]
      );
    }
    for (const row of data.accounts) {
      await client.query(
        `insert into auth_account (id,"accountId","providerId","userId","accessToken","refreshToken","idToken","accessTokenExpiresAt","refreshTokenExpiresAt",scope,password,"createdAt","updatedAt") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          row.id,
          row.accountId,
          row.providerId,
          row.userId,
          row.accessToken,
          row.refreshToken,
          row.idToken,
          row.accessTokenExpiresAt,
          row.refreshTokenExpiresAt,
          row.scope,
          row.password,
          row.createdAt,
          row.updatedAt
        ]
      );
    }
    for (const row of data.invites) {
      await client.query(
        `insert into invites (id,token_hash,public_token,check_in,check_out,purpose,status,expires_at,submitted_at,created_at) values ($1,$2,$3,$4,$5,$6,$7::invite_status,$8,$9,$10)`,
        [
          row.id,
          row.token_hash,
          row.public_token,
          row.check_in,
          row.check_out,
          purposeByInvite.get(row.id) ?? "Visitor of Tenant",
          row.status,
          row.expires_at,
          row.submitted_at,
          row.created_at
        ]
      );
    }
    for (const row of data.submissions) {
      await client.query(
        `insert into submissions (id,invite_id,guest_email,building_code,unit_number,check_in,check_out,purpose,owner_name,owner_contact,status,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::submission_status,$12)`,
        [
          row.id,
          row.invite_id,
          row.guest_email,
          row.building_code,
          row.unit_number,
          row.check_in,
          row.check_out,
          row.purpose,
          row.owner_name,
          row.owner_contact,
          row.status,
          row.created_at
        ]
      );
    }
    for (const row of data.guests) {
      await client.query(
        `insert into guests (id,submission_id,full_name,age,requires_id,created_at) values ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.submission_id, row.full_name, row.age, row.requires_id, row.created_at]
      );
    }
    for (const row of data.files) {
      await client.query(
        `insert into guest_files (id,guest_id,storage_key,filename,content_type,size_bytes,delete_after,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.id,
          row.guest_id,
          row.r2_key,
          row.filename,
          row.content_type,
          row.size_bytes,
          row.delete_after,
          row.created_at
        ]
      );
    }
    for (const row of data.runs) {
      await client.query(
        `insert into automation_runs (id,submission_id,status,error_message,screenshot_storage_key,created_at,finished_at) values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          row.id,
          row.submission_id,
          row.status,
          row.error_message,
          row.retained_screenshot_key,
          row.created_at,
          row.finished_at
        ]
      );
    }
    for (const row of data.settings) {
      await client.query(`insert into app_settings (key,value,updated_at) values ($1,$2,$3)`, [
        row.key,
        row.value,
        row.updated_at
      ]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function copyObjects(keys: string[], data: Record<keyof typeof queries, Array<Record<string, any>>>) {
  const wranglerBucket = process.env.SOURCE_R2_BUCKET_NAME;
  const sourceS3 = wranglerBucket ? null : s3("SOURCE_");
  const destinationS3 = s3("");
  const sourceBucket = wranglerBucket ?? required("SOURCE_AWS_S3_BUCKET_NAME");
  const destinationBucket = required("AWS_S3_BUCKET_NAME");
  const optionalKeys = ["google/storage-state.json", "google/session-health.json"];
  const hints = objectHints(data);
  let requiredCopied = 0;
  let optionalCopied = 0;

  for (const key of [...keys, ...optionalKeys]) {
    const optional = optionalKeys.includes(key);
    const object = sourceS3
      ? await readS3Object(sourceS3, sourceBucket, key, optional)
      : await readWranglerObject(sourceBucket, key, optional, hints.get(key));
    if (!object) continue;
    const { bytes } = object;
    await destinationS3.send(
      new PutObjectCommand({
        Bucket: destinationBucket,
        Key: key,
        Body: bytes,
        ContentType: object.contentType,
        Metadata: object.metadata
      })
    );
    const head = await destinationS3.send(new HeadObjectCommand({ Bucket: destinationBucket, Key: key }));
    if (
      head.ContentLength !== bytes.byteLength ||
      (head.ContentType ?? null) !== (object.contentType ?? null) ||
      !equalMetadata(head.Metadata, object.metadata)
    ) {
      throw new Error(`Object verification failed for ${key}`);
    }
    if (optionalKeys.includes(key)) optionalCopied += 1;
    else requiredCopied += 1;
  }

  console.log(`Copied ${requiredCopied} retained objects and ${optionalCopied} optional Google objects.`);
  return { required: requiredCopied, optional: optionalCopied };
}

async function readS3Object(client: S3Client, bucket: string, key: string, optional: boolean) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch((error) => {
    if (optional && isNotFound(error)) return null;
    throw error;
  });
  if (!object?.Body) return null;
  return {
    bytes: await object.Body.transformToByteArray(),
    contentType: object.ContentType,
    metadata: object.Metadata
  };
}

async function readWranglerObject(
  bucket: string,
  key: string,
  optional: boolean,
  hint?: { contentType?: string; metadata?: Record<string, string>; expectedSize?: number }
) {
  const result = await run("npx", [
    "--yes",
    "wrangler@latest",
    "r2",
    "object",
    "get",
    `${bucket}/${key}`,
    "--pipe",
    "--remote"
  ]);
  if (result.code !== 0) {
    if (optional && /404|not found|does not exist/i.test(result.stderr)) return null;
    throw new Error(`Could not read retained R2 object ${key}`);
  }
  if (hint?.expectedSize !== undefined && result.stdout.byteLength !== hint.expectedSize) {
    throw new Error(`Source object size does not match the database record for ${key}`);
  }

  const metadata = { ...(hint?.metadata ?? {}) };
  if (key === "google/storage-state.json") metadata.savedAt = new Date().toISOString();
  if (key === "google/session-health.json") {
    const health = JSON.parse(result.stdout.toString("utf8")) as {
      checkedAt?: string;
      valid?: boolean;
    };
    if (health.checkedAt) metadata.checkedAt = health.checkedAt;
    if (typeof health.valid === "boolean") metadata.valid = String(health.valid);
  }

  return { bytes: result.stdout, contentType: hint?.contentType, metadata };
}

function objectHints(data: Record<keyof typeof queries, Array<Record<string, any>>>) {
  const hints = new Map<
    string,
    { contentType?: string; metadata?: Record<string, string>; expectedSize?: number }
  >();
  for (const row of data.files) {
    hints.set(String(row.r2_key), {
      contentType: String(row.content_type),
      expectedSize: Number(row.size_bytes),
      metadata: {
        originalName: String(row.filename),
        deleteAfter: new Date(row.delete_after).toISOString()
      }
    });
  }
  for (const row of data.runs) {
    if (row.retained_screenshot_key) {
      hints.set(String(row.retained_screenshot_key), { contentType: "image/png", metadata: {} });
    }
  }
  hints.set("google/storage-state.json", { contentType: "application/json", metadata: {} });
  hints.set("google/session-health.json", { contentType: "application/json", metadata: {} });
  return hints;
}

function run(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8")
      })
    );
  });
}

async function verify(
  data: Record<keyof typeof queries, Array<Record<string, any>>>,
  copiedObjects: number | null,
  expectedObjects: number
) {
  const counts = await destination.query(`
    select
      (select count(*) from auth_user)::int as users,
      (select count(*) from auth_account)::int as accounts,
      (select count(*) from invites)::int as invites,
      (select count(*) from submissions)::int as submissions,
      (select count(*) from guests)::int as guests,
      (select count(*) from guest_files)::int as files,
      (select count(*) from automation_runs)::int as runs,
      (select count(*) from app_settings)::int as settings
  `);
  const expected = {
    users: data.users.length,
    accounts: data.accounts.length,
    invites: data.invites.length,
    submissions: data.submissions.length,
    guests: data.guests.length,
    files: data.files.length,
    runs: data.runs.length,
    settings: data.settings.length
  };
  console.table([counts.rows[0], expected]);
  for (const [key, value] of Object.entries(expected)) {
    if (counts.rows[0][key] !== value) throw new Error(`Count verification failed for ${key}`);
  }
  if (copiedObjects !== null && copiedObjects !== expectedObjects) {
    throw new Error("Retained object count verification failed");
  }
  const relationships = await destination.query(`
    select
      (select count(*) from submissions s left join invites i on i.id = s.invite_id where i.id is null)::int as submissions_without_invites,
      (select count(*) from guests g left join submissions s on s.id = g.submission_id where s.id is null)::int as guests_without_submissions,
      (select count(*) from guest_files f left join guests g on g.id = f.guest_id where g.id is null)::int as files_without_guests,
      (select count(*) from automation_runs r left join submissions s on s.id = r.submission_id where s.id is null)::int as runs_without_submissions
  `);
  if (Object.values(relationships.rows[0]).some((value) => value !== 0)) {
    throw new Error("Foreign-key relationship verification failed");
  }
  console.log(
    copiedObjects === null
      ? "Migration verified. Object copy was intentionally skipped."
      : `Migration verified. Retained objects copied: ${copiedObjects}`
  );
}

function s3(prefix: string) {
  return new S3Client({
    endpoint: required(`${prefix}AWS_ENDPOINT_URL`),
    region: process.env[`${prefix}AWS_DEFAULT_REGION`] ?? "auto",
    forcePathStyle: process.env[`${prefix}AWS_S3_URL_STYLE`] === "path",
    credentials: {
      accessKeyId: required(`${prefix}AWS_ACCESS_KEY_ID`),
      secretAccessKey: required(`${prefix}AWS_SECRET_ACCESS_KEY`)
    }
  });
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isNotFound(error: unknown) {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NoSuchKey" || value.$metadata?.httpStatusCode === 404;
}

function equalMetadata(left?: Record<string, string>, right?: Record<string, string>) {
  const normalize = (value?: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(value ?? {})
        .map(([key, item]) => [key.toLowerCase(), item])
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    );
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

main()
  .finally(async () => {
    await source.end();
    await destination.end();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
