import { Hono } from "hono";
import { cors } from "hono/cors";
import { nanoid } from "nanoid";
import {
  adminSubmissionSchema,
  authEmailSchema,
  createPasswordSchema,
  createInviteSchema,
  guestSubmissionSchema,
  MINOR_ID_CUTOFF
} from "@cozy-d-714/shared";
import { hashToken, sqlFor } from "./db";
import type { AppEnv } from "./env";
import { getBrowserLivePreview, submitGoogleForm, type GoogleFormFile } from "./googleForm";
import { isExplicitlyBlockedAdminEmail, requireAdmin } from "./auth";
import { hashBetterAuthPassword } from "./password";
import { checkGoogleSession, getGoogleSessionStatus, saveUploadedGoogleStorageState } from "./googleSession";
import { DEFAULT_EMAIL_TEMPLATE, sendEntrancePassEmail, type EmailTemplate } from "./email";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const allowedOrigins = c.env.APP_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
  const middleware = cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  });
  return middleware(c, next);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/password-state", async (c) => {
  const body = authEmailSchema.parse(await c.req.json());

  if (isExplicitlyBlockedAdminEmail(body.email, c.env.ADMIN_EMAILS)) {
    return c.json({ exists: false, hasPassword: false });
  }

  const sql = sqlFor(c.env);
  const rows = await sql`
    select
      u.id,
      exists (
        select 1
        from neon_auth.account a
        where a."userId" = u.id
          and a."providerId" = 'credential'
          and a.password is not null
      ) as has_password
    from neon_auth."user" u
    where lower(u.email) = lower(${body.email})
    limit 1
  `;
  const user = rows[0];

  return c.json({
    exists: Boolean(user),
    hasPassword: Boolean(user?.has_password)
  });
});

app.post("/api/auth/create-password", async (c) => {
  const body = createPasswordSchema.parse(await c.req.json());

  if (isExplicitlyBlockedAdminEmail(body.email, c.env.ADMIN_EMAILS)) {
    return c.json({ error: "This email is not allowed for admin access" }, 403);
  }

  const sql = sqlFor(c.env);
  const users = await sql`
    select id, email
    from neon_auth."user"
    where lower(email) = lower(${body.email})
    limit 1
  `;
  const user = users[0];

  if (!user) {
    return c.json({ error: "Ask the owner to add this user in Neon first" }, 404);
  }

  const credentialAccounts = await sql`
    select id, password is not null as has_password
    from neon_auth.account
    where "userId" = ${user.id}
      and "providerId" = 'credential'
    limit 1
  `;

  if (credentialAccounts[0]?.has_password) {
    return c.json({ error: "This account already has a password. Please sign in." }, 409);
  }

  const hashedPassword = await hashBetterAuthPassword(body.password);

  if (credentialAccounts[0]) {
    await sql`
      update neon_auth.account
      set password = ${hashedPassword}, "updatedAt" = now()
      where id = ${credentialAccounts[0].id}
    `;
  } else {
    await sql`
      insert into neon_auth.account (
        "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
      )
      values (${user.id}, 'credential', ${user.id}, ${hashedPassword}, now(), now())
    `;
  }

  return c.json({ ok: true });
});

app.use("/api/admin/*", requireAdmin);

app.get("/api/admin/me", (c) => c.json({ admin: c.get("admin") }));

app.get("/api/admin/settings/status", async (c) => {
  return c.json(await getGoogleSessionStatus(c.env));
});

app.get("/api/admin/settings/email-template", async (c) => {
  return c.json({ template: await getEmailTemplate(c.env) });
});

app.post("/api/admin/settings/email-template", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html.trim() : "";

  if (!subject || !html) {
    return c.json({ error: "Subject and HTML body are required." }, 400);
  }

  if (subject.length > 180) {
    return c.json({ error: "Subject must be 180 characters or fewer." }, 400);
  }

  if (html.length > 60_000) {
    return c.json({ error: "HTML body is too large." }, 400);
  }

  const template = { subject, html };
  await saveEmailTemplate(c.env, template);
  return c.json({ template });
});

app.get("/api/admin/browser/live-preview", async (c) => {
  try {
    return c.json(await getBrowserLivePreview(c.env));
  } catch (error) {
    return c.json({ available: false, error: error instanceof Error ? error.message : "Could not load live preview" }, 500);
  }
});

app.post("/api/admin/submissions/:id/reset-submitting", async (c) => {
  const sql = sqlFor(c.env);
  const rows = await sql`
    update submissions
    set status = 'ready_for_review'
    where id = ${c.req.param("id")}
      and status = 'submitting'
    returning id
  `;

  if (!rows[0]) {
    return c.json({ error: "Submission is not currently stuck submitting" }, 409);
  }

  await sql`
    insert into automation_runs (submission_id, status, error_message, finished_at)
    values (${c.req.param("id")}, 'reset_to_ready_for_review', 'Manually reset stale submitting status', now())
  `;

  return c.json({ ok: true });
});

app.post("/api/admin/google-session/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("storageState");

    if (!(file instanceof File)) {
      return c.json({ error: "Upload a Playwright storageState JSON file." }, 400);
    }

    const storageState = JSON.parse(await file.text());
    return c.json(await saveUploadedGoogleStorageState(c.env, storageState));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not upload Google session" }, 400);
  }
});

app.post("/api/admin/google-session/check", async (c) => {
  try {
    return c.json(await checkGoogleSession(c.env));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not check Google session" }, 500);
  }
});

app.post("/api/admin/invites", async (c) => {
  const body = createInviteSchema.parse(await c.req.json());
  const token = nanoid(32);
  const tokenHash = await hashToken(token);
  const expiresAt = body.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const sql = sqlFor(c.env);
  await ensureInvitePublicTokenColumn(c.env);

  // Django analogy: this route is closest to a class-based view's `post()`.
  // The SQL insert is doing what `Invite.objects.create(...)` would do in Django.
  await sql`
    insert into invites (token_hash, public_token, check_in, check_out, expires_at)
    values (${tokenHash}, ${token}, ${body.checkIn}, ${body.checkOut}, ${expiresAt})
  `;

  const guestUrl = `${publicAppOrigin(c.env.APP_ORIGIN, c.env.PUBLIC_APP_ORIGIN)}/invite/${token}`;
  return c.json({ token, guestUrl, expiresAt });
});

app.get("/api/admin/invites", async (c) => {
  await ensureInvitePublicTokenColumn(c.env);
  const sql = sqlFor(c.env);
  const rows = await sql`
    select id, public_token, check_in, check_out, status, expires_at, created_at
    from invites
    where status = 'open'
    order by created_at desc
    limit 50
  `;
  const origin = publicAppOrigin(c.env.APP_ORIGIN, c.env.PUBLIC_APP_ORIGIN);

  return c.json({
    invites: rows.map((row) => ({
      id: row.id,
      guestUrl: row.public_token ? `${origin}/invite/${row.public_token}` : null,
      checkIn: row.check_in,
      checkOut: row.check_out,
      status: new Date(row.expires_at as string) < new Date() ? "expired" : "pending",
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }))
  });
});

app.delete("/api/admin/invites/:id", async (c) => {
  const sql = sqlFor(c.env);
  const rows = await sql`
    delete from invites
    where id = ${c.req.param("id")}
      and status = 'open'
    returning id
  `;

  if (!rows[0]) {
    return c.json({ error: "Pending invite does not exist" }, 404);
  }

  return c.json({ ok: true });
});

app.get("/api/invites/:token", async (c) => {
  const tokenHash = await hashToken(c.req.param("token"));
  const sql = sqlFor(c.env);
  const rows = await sql`
    select id, check_in, check_out, status, expires_at
    from invites
    where token_hash = ${tokenHash}
    limit 1
  `;
  const invite = rows[0];

  if (!invite) {
    return c.json({ error: "Invite does not exist" }, 404);
  }

  if (invite.status !== "open" || new Date(invite.expires_at as string) < new Date()) {
    return c.json({ error: "Invite is expired or already used" }, 410);
  }

  return c.json({
    token: c.req.param("token"),
    checkIn: invite.check_in,
    checkOut: invite.check_out,
    buildingCode: c.env.BUILDING_CODE,
    unitNumber: c.env.UNIT_NUMBER,
    ownerName: c.env.OWNER_NAME,
    ownerContact: c.env.OWNER_CONTACT,
    minorIdCutoff: Number(c.env.MINOR_ID_CUTOFF || MINOR_ID_CUTOFF)
  });
});

app.post("/api/invites/:token/submission", async (c) => {
  const payload = guestSubmissionSchema.parse(await c.req.json());
  const tokenHash = await hashToken(c.req.param("token"));
  const sql = sqlFor(c.env);
  const invites = await sql`
    select id, check_in, check_out, status, expires_at
    from invites
    where token_hash = ${tokenHash}
    limit 1
  `;
  const invite = invites[0];

  if (!invite || invite.status !== "open" || new Date(invite.expires_at as string) < new Date()) {
    return c.json({ error: "Invite is expired or already used" }, 410);
  }

  const submissionRows = await sql`
    insert into submissions (
      invite_id, guest_email, building_code, unit_number, check_in, check_out,
      purpose, owner_name, owner_contact
    )
    values (
      ${invite.id}, ${payload.guestEmail}, ${c.env.BUILDING_CODE}, ${c.env.UNIT_NUMBER},
      ${invite.check_in}, ${invite.check_out}, ${payload.purpose},
      ${c.env.OWNER_NAME}, ${c.env.OWNER_CONTACT}
    )
    returning id
  `;
  const submissionId = submissionRows[0].id as string;
  const cutoff = Number(c.env.MINOR_ID_CUTOFF || MINOR_ID_CUTOFF);

  const missingAdultId = payload.guests.find((guest) => guest.age >= cutoff && !guest.idFileKey);
  if (missingAdultId) {
    return c.json({ error: `Valid ID is required for ${missingAdultId.fullName}` }, 400);
  }

  for (const guest of payload.guests) {
    const guestRows = await sql`
      insert into guests (submission_id, full_name, age, requires_id)
      values (${submissionId}, ${guest.fullName}, ${guest.age}, ${guest.age >= cutoff})
      returning id
    `;
    const guestId = guestRows[0].id as string;

    if (guest.idFileKey) {
      const object = await c.env.ID_BUCKET.head(guest.idFileKey);
      await sql`
        insert into guest_files (guest_id, r2_key, filename, content_type, size_bytes, delete_after)
        values (
          ${guestId},
          ${guest.idFileKey},
          ${object?.customMetadata?.originalName ?? guest.idFileKey.split("/").at(-1) ?? "guest-id"},
          ${object?.httpMetadata?.contentType ?? "application/octet-stream"},
          ${object?.size ?? 0},
          now() + interval '1 month'
        )
      `;
    }
  }

  await sql`
    update invites
    set status = 'submitted', submitted_at = now()
    where id = ${invite.id}
  `;

  return c.json({ submissionId, status: "ready_for_review" }, 201);
});

app.post("/api/invites/:token/files", async (c) => {
  const tokenHash = await hashToken(c.req.param("token"));
  const sql = sqlFor(c.env);
  const rows = await sql`
    select id, status, expires_at
    from invites
    where token_hash = ${tokenHash}
    limit 1
  `;
  const invite = rows[0];

  if (!invite || invite.status !== "open" || new Date(invite.expires_at as string) < new Date()) {
    return c.json({ error: "Invite is expired or already used" }, 410);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return c.json({ error: "File is required" }, 400);
  }

  if (file.size > 100 * 1024 * 1024) {
    return c.json({ error: "File is too large. Maximum size is 100 MB." }, 400);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `ids/${invite.id}/${crypto.randomUUID()}-${safeName}`;

  await c.env.ID_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      originalName: file.name,
      deleteAfter: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  return c.json({ key, filename: file.name, size: file.size });
});

app.get("/api/admin/submissions", async (c) => {
  const sql = sqlFor(c.env);
  const status = c.req.query("status");
  const statusFilter = status === "ready_for_review"
    ? sql`status in ('ready_for_review', 'submitting', 'failed', 'submitted_email_failed')`
    : status === "done"
      ? sql`status in ('submitted', 'submitted_email_sent')`
    : status
      ? sql`status = ${status}`
      : sql`status in ('ready_for_review', 'submitting', 'failed', 'submitted_email_failed', 'rejected', 'submitted', 'submitted_email_sent')`;
  const rows = await sql`
    select id, guest_email, check_in, check_out, status, created_at
    from submissions
    where ${statusFilter}
    order by created_at desc
    limit 50
  `;
  return c.json({ submissions: rows });
});

app.get("/api/admin/submissions/:id", async (c) => {
  const sql = sqlFor(c.env);
  const rows = await sql`
    select
      s.*,
      coalesce(
        json_agg(
          json_build_object(
            'id', g.id,
            'fullName', g.full_name,
            'age', g.age,
            'requiresId', g.requires_id,
            'files', coalesce(files.files, '[]'::json)
          )
          order by g.created_at
        ) filter (where g.id is not null),
        '[]'
      ) as guests
    from submissions s
    left join guests g on g.submission_id = s.id
    left join lateral (
      select json_agg(
        json_build_object(
          'filename', gf.filename,
          'contentType', gf.content_type,
          'sizeBytes', gf.size_bytes,
          'url', '/api/admin/files/' || gf.id
        )
      ) as files
      from guest_files gf
      where gf.guest_id = g.id
    ) files on true
    where s.id = ${c.req.param("id")}
    group by s.id
    limit 1
  `;
  const submission = rows[0];

  if (!submission) {
    return c.json({ error: "Submission not found" }, 404);
  }

  return c.json({ submission });
});

app.get("/api/admin/files/:id", async (c) => {
  const sql = sqlFor(c.env);
  const rows = await sql`
    select r2_key, filename, content_type
    from guest_files
    where id = ${c.req.param("id")}
    limit 1
  `;
  const file = rows[0];

  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }

  const object = await c.env.ID_BUCKET.get(file.r2_key as string);

  if (!object) {
    return c.json({ error: "File is missing from storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": String(file.content_type ?? "application/octet-stream"),
      "Content-Disposition": `inline; filename="${String(file.filename).replace(/"/g, "")}"`
    }
  });
});

app.post("/api/admin/submissions/:id/confirm", async (c) => {
  try {
  const sql = sqlFor(c.env);
  const rows = await sql`
    select
      s.*,
      coalesce(
        json_agg(json_build_object('fullName', g.full_name, 'age', g.age) order by g.created_at) filter (where g.id is not null),
        '[]'
      ) as guests,
      coalesce(
        json_agg(
          json_build_object(
            'r2Key', gf.r2_key,
            'filename', gf.filename,
            'contentType', gf.content_type
          )
        ) filter (where gf.id is not null),
        '[]'
      ) as id_files
    from submissions s
    left join guests g on g.submission_id = s.id
    left join guest_files gf on gf.guest_id = g.id
    where s.id = ${c.req.param("id")}
    group by s.id
    limit 1
  `;
  const row = rows[0];

  if (!row) {
    return c.json({ error: "Submission not found" }, 404);
  }

  const parsedSubmission = adminSubmissionSchema.parse({
    guestEmail: row.guest_email,
    buildingCode: row.building_code,
    unitNumber: row.unit_number,
    checkIn: toIsoDateString(row.check_in),
    checkOut: toIsoDateString(row.check_out),
    purpose: row.purpose,
    ownerName: row.owner_name,
    ownerContact: row.owner_contact,
    acceptedRules: true,
    guests: row.guests
  });
  const idFiles: GoogleFormFile[] = [];

  for (const file of row.id_files as Array<{ r2Key: string; filename: string; contentType: string }>) {
    const object = await c.env.ID_BUCKET.get(file.r2Key);

    if (!object) {
      return c.json({ error: `ID file is missing from storage: ${file.filename}` }, 500);
    }

    idFiles.push({
      filename: file.filename,
      contentType: file.contentType,
      bytes: await object.arrayBuffer()
    });
  }

  const submission = { ...parsedSubmission, idFiles };

  await sql`update submissions set status = 'submitting' where id = ${c.req.param("id")}`;
  const result = await submitGoogleForm(c.env, submission);
  let finalStatus = result.ok ? "submitted" : result.retryable ? "ready_for_review" : "failed";
  let emailError: string | null = null;

  if (result.ok && result.screenshotKey) {
    try {
      const receipt = await c.env.ID_BUCKET.get(result.screenshotKey);

      if (!receipt) {
        throw new Error("Entrance pass screenshot was not found in storage.");
      }

      await withTimeout(
        sendEntrancePassEmail(c.env, submission.guestEmail, {
          filename: "matina-enclaves-entrance-pass.png",
          contentType: "image/png",
          bytes: await receipt.arrayBuffer()
        }, await getEmailTemplate(c.env)),
        45_000,
        "Gmail SMTP timed out while sending the entrance pass."
      );
      finalStatus = "submitted_email_sent";
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Could not email entrance pass.";
      finalStatus = "submitted_email_failed";
    }
  }

  await sql`
    insert into automation_runs (submission_id, status, error_message, screenshot_r2_key, finished_at)
    values (${c.req.param("id")}, ${finalStatus}, ${result.error ?? emailError}, ${result.screenshotKey ?? null}, now())
  `;

  await sql`
    update submissions
    set status = ${finalStatus}
    where id = ${c.req.param("id")}
  `;

  return c.json({ ...result, emailSent: finalStatus === "submitted_email_sent", emailError }, result.ok ? 200 : 500);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return c.json({ error: error instanceof Error ? error.message : "Could not confirm submission" }, 500);
  }
});

app.post("/api/admin/submissions/:id/reject", async (c) => {
  const sql = sqlFor(c.env);
  const rows = await sql`
    update submissions
    set status = 'rejected'
    where id = ${c.req.param("id")}
      and status in ('ready_for_review', 'failed')
    returning id
  `;

  if (!rows[0]) {
    return c.json({ error: "Submission cannot be rejected" }, 409);
  }

  return c.json({ ok: true });
});

app.delete("/api/admin/submissions/:id", async (c) => {
  const sql = sqlFor(c.env);
  const submissionId = c.req.param("id");

  const files = await sql`
    select gf.r2_key
    from guest_files gf
    join guests g on g.id = gf.guest_id
    where g.submission_id = ${submissionId}
  `;
  const screenshots = await sql`
    select screenshot_r2_key
    from automation_runs
    where submission_id = ${submissionId}
      and screenshot_r2_key is not null
  `;
  const rows = await sql`
    delete from submissions
    where id = ${submissionId}
    returning id
  `;

  if (!rows[0]) {
    return c.json({ error: "Submission not found" }, 404);
  }

  const r2Keys = [
    ...files.map((file) => String(file.r2_key)),
    ...screenshots.map((run) => String(run.screenshot_r2_key))
  ];

  await Promise.all(r2Keys.map((key) => c.env.ID_BUCKET.delete(key).catch(() => undefined)));

  return c.json({ ok: true, deletedFiles: r2Keys.length });
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(cleanupOrphanUploads(env));
  }
};

async function cleanupOrphanUploads(env: AppEnv["Bindings"]) {
  const sql = sqlFor(env);
  let cursor: string | undefined;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let deleted = 0;

  do {
    const listed = await env.ID_BUCKET.list({ prefix: "ids/", cursor });
    cursor = listed.truncated ? listed.cursor : undefined;

    const candidates = listed.objects.filter((object) => object.uploaded < cutoff);
    if (candidates.length === 0) continue;

    const keys = candidates.map((object) => object.key);
    const referencedRows = await sql`
      select r2_key
      from guest_files
      where r2_key = any(${keys})
    `;
    const referenced = new Set(referencedRows.map((row) => String(row.r2_key)));
    const orphanKeys = keys.filter((key) => !referenced.has(key));

    await Promise.all(orphanKeys.map((key) => env.ID_BUCKET.delete(key).then(() => {
      deleted += 1;
    }).catch(() => undefined)));
  } while (cursor);

  if (deleted > 0) {
    console.log(`Deleted ${deleted} orphan ID upload(s).`);
  }
}

function publicAppOrigin(appOrigin: string, publicAppOriginValue?: string) {
  if (publicAppOriginValue) {
    return publicAppOriginValue.replace(/\/+$/, "");
  }

  return appOrigin.split(",")[0].trim().replace(/\/+$/, "");
}

function toIsoDateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function ensureAppSettingsTable(env: AppEnv["Bindings"]) {
  const sql = sqlFor(env);
  await sql`
    create table if not exists app_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `;
}

async function ensureInvitePublicTokenColumn(env: AppEnv["Bindings"]) {
  const sql = sqlFor(env);
  await sql`alter table invites add column if not exists public_token text`;
}

async function getEmailTemplate(env: AppEnv["Bindings"]): Promise<EmailTemplate> {
  await ensureAppSettingsTable(env);
  const sql = sqlFor(env);
  const rows = await sql`
    select value
    from app_settings
    where key = 'email_template'
    limit 1
  `;
  const value = rows[0]?.value as Partial<EmailTemplate> | undefined;

  return {
    subject: typeof value?.subject === "string" && value.subject.trim() ? value.subject : DEFAULT_EMAIL_TEMPLATE.subject,
    html: typeof value?.html === "string" && value.html.trim() ? value.html : DEFAULT_EMAIL_TEMPLATE.html
  };
}

async function saveEmailTemplate(env: AppEnv["Bindings"], template: EmailTemplate) {
  await ensureAppSettingsTable(env);
  const sql = sqlFor(env);
  await sql`
    insert into app_settings (key, value, updated_at)
    values ('email_template', ${JSON.stringify(template)}::jsonb, now())
    on conflict (key) do update
    set value = excluded.value,
        updated_at = now()
  `;
}
