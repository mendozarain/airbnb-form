# Cozy Davao D-714

Guest registration and PMO submission app for one Airbnb unit. The codebase is intentionally small and conventional so it is easy to learn and review.

## Architecture

```text
Browser
  -> Amplify Hosting (React static site)
       -> /api/* rewrite
            -> API Gateway HTTP API -> Lambda (NestJS API)
                 -> Aurora PostgreSQL Serverless (Prisma, scales to zero)
                 -> S3 (guest IDs, screenshots; browsers upload/download with signed URLs)
                 -> SQS queues -> Lambda workers (Playwright / Google Forms, Hostex, AI review)
                 <- EventBridge Scheduler (07:00 / 12:00 / 20:00 reconcile, daily pricing, calendar, cleanup)
                 -> AgentMail email API
```

Everything runs in `ap-southeast-2` and costs close to nothing while idle. See [AWS deployment](#aws-deployment).

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

Requirements: Node.js 22, npm, PostgreSQL, and an S3-compatible bucket with a CORS rule that lets `http://localhost:5173` PUT and GET (browsers upload IDs with signed URLs).

```bash
npm install
cp backend/.env.example backend/.env
npm run migrate:dev --workspace backend
# Run the old in-process schedules locally (on AWS, SQS and EventBridge Scheduler do this):
echo 'RUN_INPROCESS_CRONS=true' >> backend/.env
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

### Automatic Google session recovery

The queue can recover an expired Google session through Browser Use Cloud. In Browser Use, connect a
read-only 1Password service account to the existing vault, create a persistent browser profile, and use
the Login item whose username is exactly `mendozarhainne@gmail.com`. The item must expose the standard
`username`, `password`, and `one-time-password` fields.

Set these variables in the app secret (or `backend/.env` locally):

```text
GOOGLE_ACCOUNT_EMAIL=mendozarhainne@gmail.com
BROWSER_USE_API_KEY=
BROWSER_USE_1PASSWORD_INTEGRATION_ID=
BROWSER_USE_1PASSWORD_VAULT_ID=
BROWSER_USE_1PASSWORD_ITEM_ID=
BROWSER_USE_PROFILE_ID=
```

The 1Password service-account token belongs only in the Browser Use integration screen. Do not put
`1PASSWORD_KEY`, `GMAIL_PASS`, or a TOTP secret in the app secret or repository environment files. Automatic
recovery remains off until an administrator enables it in Settings. A recovery run can read only the
three bound fields, is restricted to `accounts.google.com`, and is independently verified against the
PMO form before its storage state becomes active.

Open the PMO form in that everyday Chrome profile first, fully quit Chrome with `Cmd+Q`, then run the command. Upload the resulting `backend/google-storage-state.json` from Admin Settings.

## Authentication

Better Auth is mounted at `/api/auth`. Email/password signup is disabled. Existing administrators are migrated with their UUIDs, roles, and scrypt password hashes, but old sessions are intentionally discarded.

Generate the production secret once:

```bash
openssl rand -base64 32
```

CDK generates `BETTER_AUTH_SECRET` in Secrets Manager on first deploy; use your own value only locally.

## AWS deployment

Infrastructure is defined with CDK in [`infra/`](infra). One image built from `backend/Dockerfile` runs as four
Lambda functions:

| Function | Handler | Purpose |
| --- | --- | --- |
| `Api` | `backend/dist/lambda.handler` | NestJS behind API Gateway |
| `Worker` | `backend/dist/worker.handler` | Light jobs: webhooks, deliveries, AI review, chat, pricing, calendar |
| `BrowserWorker` | `backend/dist/worker.handler` | Playwright Google Form runs and Google session checks (3 GB, 15 min) |
| `Migrate` | `backend/dist/migrate.handler` | Creates the `cozy_app` database role and runs `prisma migrate deploy` |

### How background work runs

Nothing polls. Work that appears in Postgres (a queued submission, a pending AI check, a stored Hostex webhook, a
retry) sends a wake-up message to SQS (`backend/src/jobs`); the worker drains the row using the same
compare-and-set claims as before, so a duplicate or late message is harmless. A few schedules cover time-based work
and act as a safety net:

| Schedule (Asia/Manila) | Job |
| --- | --- |
| 07:00, 12:00, 20:00 | `hostex.reconcile`: sends invites that just became due, recovers a missed webhook, sweeps stuck rows |
| 08:00 | `pricing.automatic` (still gated by `ENABLE_HOSTEX_PRICING_AUTOMATION` and the Pricing pause switch) |
| 03:00 | `calendar.dailySync` |
| 02:17 | `automation.cleanup` |

Retries with backoff create a one-time schedule that deletes itself. Long admin actions (Google session check and
recovery, Hostex/booking/calendar sync, applying prices) return `202 { jobId }` and the UI polls
`GET /api/admin/jobs/:id`. Locally the same code runs in-process: set `RUN_INPROCESS_CRONS=true` to keep the old
`@Cron` behaviour, and leave `JOBS_QUEUE_URL` unset so wake-ups run immediately.

### First deployment

Prerequisites: Docker, Node.js 22, and AWS CLI credentials for the project account (`aws login`).

```bash
npm install
npx cdk bootstrap aws://<account-id>/ap-southeast-2 --app 'npx tsx infra/bin/app.ts'   # once
infra/scripts/create-database.sh            # once: Aurora Serverless, min 0 ACU, IAM auth only
npm run deploy --workspace infra -- -c dbHost=<host> -c dbClusterResourceId=<resource-id>
```

Then:

1. `infra/scripts/push-secrets.sh app.env` loads configuration (everything in `backend/.env.example` except
   `DATABASE_URL`, `PORT` and the `AWS_*` S3 keys) into Secrets Manager. Set `BETTER_AUTH_URL`, `PUBLIC_APP_URL`
   and `TRUSTED_ORIGINS` to the `AppUrl` stack output. Keep that file out of git.
2. Invoke the `Migrate` function once (and after every release that adds a migration):
   `aws lambda invoke --function-name <MigrateFunction output> /dev/stdout`.
3. `infra/scripts/deploy-frontend.sh` builds and publishes the site to Amplify Hosting.
4. Re-deploy with `-c appOrigin=<AppUrl>` to restrict the upload bucket's CORS to the site.

The Aurora cluster uses the express configuration: it has no VPC, is reached through an internet access gateway,
and accepts only IAM-token logins (`DB_IAM_AUTH=true`). It pauses after 5 idle minutes, so the first request after
a quiet period waits a few seconds for it to resume.

### CI/CD

GitHub Actions (`.github/workflows/ci.yml`) validates every pull request: typecheck, lint, unit and e2e tests, and
the production build. Pushes to `main` deploy through AWS CodeBuild (`buildspec.yml`), which runs `cdk deploy`, the
`Migrate` function, and the Amplify publish. It runs under its own IAM role inside the project account, so no AWS
keys are stored in GitHub. (The usual GitHub OIDC route is blocked: the managed guardrails deny `iam:*Provider*`.)

One-time setup, from [`infra/codebuild-cicd.yaml`](infra/codebuild-cicd.yaml):

```bash
aws codeconnections create-connection --provider-type GitHub --connection-name cozy-d714-github
# Authorize it once in the console: Developer Tools > Settings > Connections > Update pending connection
aws cloudformation deploy --stack-name CozyD714Cicd --template-file infra/codebuild-cicd.yaml \
  --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ConnectionArn=<connection arn>
```

Watch a deploy under CodeBuild > `CozyD714-Deploy` (logs in `/codebuild/CozyD714-Deploy`); the result also shows as a
status on the commit in GitHub. Only one build runs at a time, so two quick merges cannot fight over the stack lock.

### Moving data from Railway

Freeze Railway first (`ENABLE_BACKGROUND_WORKERS=false`). Dump the data with `pg_dump --data-only
--column-inserts --disable-triggers` and restore it into Aurora after the `Migrate` function has created the schema.
Copy bucket objects (`ids/`, `automation/`, `google/`) with `rclone` or `aws s3 sync` from the Railway bucket
credentials. The Google session pointers live in Postgres and the session files in S3, so both must move together.
Point the Hostex webhook at `https://<AppUrl>/api/webhooks/hostex`: the pinned secret digest travels with the
database, so no new bootstrap token is needed unless Hostex issues a new secret.

### Configuration

API variables are listed in `backend/.env.example`. In production, set `BETTER_AUTH_URL`, `PUBLIC_APP_URL`, and
`TRUSTED_ORIGINS` to the public frontend URL.

### Hostex tenant invite automation

The API can create `Tenant` registration links for accepted Hostex reservations and send them through the reservation conversation at 7 AM on the day before check-in. Configure:

```text
HOSTEX_ACCESS_TOKEN=<Hostex access token>
HOSTEX_PROPERTY_ID=12684960
HOSTEX_TIMEZONE=Asia/Manila
HOSTEX_WEBHOOK_SECRET=<optional explicit secret override>
HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN=<one-time high-entropy setup token>
ENABLE_HOSTEX_INVITE_AUTOMATION=false
```

Register `https://<AppUrl>/api/webhooks/hostex?setup=<bootstrap-token>` for `reservation_created`, `reservation_updated`, `message_created`, `property_availability_updated`, and `listing_calendar_updated`. The first authenticated callback stores only a SHA-256 digest of Hostex's assigned secret; later callbacks ignore the setup token and validate the pinned digest. Remove `HOSTEX_WEBHOOK_BOOTSTRAP_TOKEN` after the dashboard reports that the webhook is verified. Keep invite automation disabled until an admin has synced a user-approved test reservation, used **Send now**, and confirmed the message in both Hostex and the booking platform. Network-timeout deliveries remain `unknown` until an admin reconciles or explicitly accepts the duplicate-message risk.

The integrated pricing scheduler uses `ENABLE_HOSTEX_PRICING_AUTOMATION=false` as its master switch and an independent database pause control in **Pricing**. NestJS is the sole supported price publisher; the old Python entrypoint exits without reading credentials or submitting prices. An already deployed old image can still publish until its Railway cron is disabled.

### Tiered pricing rollout

Nightly rates start from the base (including configured weekend/event premiums) and retain 100%, 75%, 50%, 25%, then 0% of the gap above minimum at 31+, 15–30, 8–14, 3–7, and 0–2 Manila calendar days. The minimum is the published Airbnb nightly rate, before channel discounts and fees. Agoda and all Booking.com rate plans add 30% initially, adjustable independently between 20% and 40%; other platform ratios are preserved.

The first pricing-settings access upgrades legacy JSON settings to `vacancy-tiers-v1` in a transaction: preserve base/minimum, replace Agoda/Booking.com ratios with 1.30, remove obsolete controls, increment the settings version, write version history and an audit event, and pause database automation. Historical runs remain readable; legacy, outdated, and previous-day runs cannot be applied or retried. No table migration is needed. Previewed availability is checked again before publication, and booked/blocked dates are skipped.

For an authorized deployment:

1. Keep the API master switch off while deploying and comparing previews. Confirm that the settings upgrade paused automation and that every Booking.com rate plan and Agoda uses the intended markup.
2. Disable the existing Railway `hostex-pricing` cron and confirm no legacy execution remains in progress. Do not delete the service if the API still references its access-token variable.
3. Check preview tier boundaries and all platform prices against the live calendar. Apply a reviewed preview, then read back Hostex listing calendars; submission acceptance alone does not confirm OTA propagation.
4. Enable the API master switch, then enable **Pricing → Automation**. Verify one daily run at 8 AM Asia/Manila and inspect its per-listing results.
5. If publication fails, pause automation. Retry only same-day, current-version runs after resolving the failure; otherwise create a fresh preview. Do not restart the legacy publisher alongside NestJS.

Deployment, cron changes, and live publication require separate authorization; implementing this release locally performs none of those actions.

Use `npm run backfill:bookings --workspace backend -- --dry-run` before applying the strict legacy booking assignment with `--apply`.

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
