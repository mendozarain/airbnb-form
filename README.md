# Cozy Davao D-714

Guest registration and PMO submission app for one Airbnb unit. The codebase is intentionally small and conventional so it is easy to learn and review.

## Architecture

```text
Browser
  -> Railway frontend (React + Caddy)
       -> /api/* proxy over Railway private network
            -> Railway API (NestJS)
                 -> Railway Postgres (Prisma)
                 -> Railway Bucket (S3 API)
                 -> Playwright / Google Forms
                 -> AgentMail email API
```

The Django mental map is:

| Django | NestJS |
| --- | --- |
| app | module |
| urls.py + views.py | controller |
| services.py | service |
| models.py | prisma/schema.prisma |
| migrations | prisma/migrations |
| permission class | Better Auth guard / `@Roles` |
| management command | `backend/scripts` |

## Folders

- `frontend/`: React, Vite, Tailwind, and shadcn/ui screens.
- `backend/`: NestJS modules, Prisma schema, automation, and migration commands.
- `shared/`: the small set of Zod contracts and domain types used by both apps.

## Local Setup

Requirements: Node.js 22, npm, PostgreSQL, and an S3-compatible bucket.

```bash
npm install
cp backend/.env.example backend/.env
npm run migrate:dev --workspace backend
npm run dev:api
npm run dev:frontend
```

Open `http://localhost:5173`. Vite proxies `/api` to Nest on port 3000.

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Capture a fresh Google browser session:

```bash
GOOGLE_FORM_URL='https://docs.google.com/forms/d/e/your-form-id/viewform' GOOGLE_CHROME_PROFILE='Default' npm run capture:google --workspace backend
```

Open the PMO form in that everyday Chrome profile first, fully quit Chrome with `Cmd+Q`, then run the command. Upload the resulting `backend/google-storage-state.json` from Admin Settings.

## Authentication

Better Auth is mounted at `/api/auth`. Email/password signup is disabled. Existing administrators are migrated with their UUIDs, roles, and scrypt password hashes, but old sessions are intentionally discarded.

Generate the production secret once:

```bash
openssl rand -base64 32
```

Store it as `BETTER_AUTH_SECRET` on the API service.

## Railway Services

Use four project resources:

- `frontend`: repository root with `RAILWAY_DOCKERFILE_PATH=frontend/Dockerfile`.
- `api`: repository root with `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`, one replica, private networking enabled.
- `Postgres`: referenced by the API as `DATABASE_URL`.
- `uploads`: Railway Bucket credentials injected into the API as the documented `AWS_*` variables.

Frontend variables:

```text
API_INTERNAL_URL=${{api.RAILWAY_PRIVATE_DOMAIN}}:3000
```

Railway injects the frontend `PORT`; Caddy listens on it automatically.

API variables are listed in `backend/.env.example`. In production, set `BETTER_AUTH_URL`, `PUBLIC_APP_URL`, and `TRUSTED_ORIGINS` to the public frontend URL. The API listens on port 3000 and does not need a public domain.

### Hostex tenant invite automation

The API can create `Tenant` registration links for accepted Hostex reservations and send them through the reservation conversation at 2 PM on the day before check-in. Configure:

```text
HOSTEX_ACCESS_TOKEN=${{hostex-pricing.HOSTEX_ACCESS_TOKEN}}
HOSTEX_PROPERTY_ID=12684960
HOSTEX_TIMEZONE=Asia/Manila
HOSTEX_WEBHOOK_SECRET=<optional explicit secret override>
HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN=<one-time high-entropy setup token>
ENABLE_HOSTEX_INVITE_AUTOMATION=false
```

Register `https://cozy-d714.up.railway.app/api/webhooks/hostex?setup=<bootstrap-token>` for `reservation_created`, `reservation_updated`, `message_created`, `property_availability_updated`, and `listing_calendar_updated`. The first authenticated callback stores only a SHA-256 digest of Hostex's assigned secret; later callbacks ignore the setup token and validate the pinned digest. Remove `HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN` after the dashboard reports that the webhook is verified. Keep invite automation disabled until an admin has synced a user-approved test reservation, used **Send now**, and confirmed the message in both Hostex and the booking platform. Network-timeout deliveries remain `unknown` until an admin reconciles or explicitly accepts the duplicate-message risk.

The integrated pricing scheduler uses `ENABLE_HOSTEX_PRICING_AUTOMATION=false` as its Railway master switch and an independent database pause control in **Pricing**. Leave the existing pricing cron active while comparing previews, then disable it before enabling the NestJS scheduler. Use `npm run backfill:bookings --workspace backend -- --dry-run` before applying the strict legacy booking assignment with `--apply`.

## Legacy Migration

Authenticate and link the Railway CLI first:

```bash
railway login
railway link
```

Apply the Railway schema, then inspect the source without writing:

```bash
npm run migrate:deploy --workspace backend
npm run migrate:legacy -- --dry-run
```

The migration command reads `SOURCE_DATABASE_URL`, `DATABASE_URL`, and destination `AWS_*` credentials. For source objects, either provide `SOURCE_AWS_*` credentials or run `npx wrangler login` and set `SOURCE_R2_BUCKET_NAME`. It refuses to run if the source has open invites/active submissions or the destination already contains app data.

Run the final copy:

```bash
npm run migrate:legacy
```

Only unexpired guest IDs, screenshots newer than 31 days, and Google session files are copied. Row relationships plus object sizes, content types, and metadata are verified without logging personal values.

Set the AgentMail API key and inbox directly in Railway so secrets do not pass through source control:

```bash
railway variable set --service api \
  AGENTMAIL_API_KEY="am_..." \
  AGENTMAIL_INBOX_ID="cozy-davao@agentmail.to" \
  EMAIL_REPLY_TO="you@example.com"
```

Keep the old providers untouched for seven days after acceptance. Decommission them only after both administrators can sign in, the complete guest flow passes, and Railway automation successfully submits and emails one registration.
