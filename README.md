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

## AI ID review

Guest ID photos are sent to OpenRouter model `google/gemini-3.1-flash-lite`. Each request keeps
`provider.zdr`, `data_collection: deny`, and `require_parameters`, so OpenRouter may use only a
zero-data-retention endpoint that accepts the structured response. The model is asked whether the
ID plausibly belongs to the name the guest typed, including a shorter or reordered name. A
high-confidence mismatch is rejected only when the typed name does not overlap the printed name.
An unsure result, a low-confidence result, an unreadable image, or a file that is not a photo ID is
held for manual review. The model id is a code constant, not a database setting. The value stored on a review
row is the model used for that check.

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

### Demand-pace pricing

The daily job at 08:00 Asia/Manila prices the next 365 nights for D-714. It stays off until `ENABLE_HOSTEX_PRICING_AUTOMATION=true` and the Pricing screen is unpaused. Preview computes the calendar and stores it; it does not call Hostex write endpoints. Apply is the only path that publishes.

Ordinary nights use the configured weekday rate (default ₱2,750) and Friday/Saturday rate (default ₱3,400). The absolute floor is ₱2,300 and is used only when a weekday is still open inside three days and the next 14 nights are under 60% filled. Weekends in that same situation stop at ₱3,000. If the surrounding week is already busy, or a weekend has a booked neighbour, the rate rises instead. Nothing is priced above ₱5,000. These targets are settings, not constants in the formula.

Dated events replace that rate. The seed follows Proclamation No. 1427 for 2027 and the 2026 holidays still inside a 365-day horizon:

| Dates | Rate | Minimum stay |
| --- | --- | --- |
| Undas 30 Oct–2 Nov 2026 and 2027 | ₱3,500 | weekend rule |
| Pasko Fiesta 28–30 Nov 2026, 8 Dec 2026, 30 Nov 2027, 8 Dec 2027 | ₱3,400 | weekend rule |
| Christmas–New Year 19 Dec–2 Jan | ₱4,200 | 3 nights |
| 24, 25, 30 and 31 Dec | ₱4,800 | 3 nights |
| Chinese New Year 6 Feb 2027 | ₱3,500 | weekend rule |
| Araw ng Dabaw weekends, 12–21 Mar 2027 | ₱3,500 | weekend rule |
| Holy Week 24–28 Mar 2027 | ₱4,000 | 2 nights |
| Araw ng Kagitingan 9–11 Apr 2027 | ₱3,500 | weekend rule |
| Labor Day 1–2 May 2027, Independence Day 12–13 Jun 2027 | ₱3,400 | weekend rule |
| Kadayawan 7–24 Aug 2027 | ₱3,500 | 2 nights on Fri/Sat arrivals |
| National Heroes Day 28–30 Aug 2027 | ₱3,500 | weekend rule |

Eid'l Fitr and Eid'l Adha are not seeded; Proclamation 1427 says those dates come later. EDSA (25 Feb 2027) is a special working day and is not a priced event.

Minimum stay is an arrival rule: Sunday–Thursday arrivals are 1 night, Friday and Saturday arrivals are 2 nights (configurable). An open weekend arrival inside three days relaxes to 1 night. A one-night gap between bookings is always 1 night, including during Christmas. Event minimums do not relax early. The same `min_stay_on_arrival` value is queued for every listing.

Channel prices are the Airbnb night multiplied by that listing's ratio. Defaults are Booking.com 1.2, Agoda 1.2, and Hostex direct 1.0. Each Booking.com rate plan can differ. Airbnb stays at 1.0.

Weekly 10% and monthly 25% are stored as the recommended discounts. They are not pushed. Length-of-stay discounts on Airbnb are listing-wide, so they would also cut ₱4,800 nights. Booking.com, Agoda, and direct promotions are not on the endpoints this app calls.

The first read of older settings upgrades them to `demand-pace-v1`, pauses automation, and writes a settings version. Historical runs stay readable. A run from another day, another settings version, or the retired tier algorithm cannot be applied.

### What Hostex can set

Writes are asynchronous: HTTP success means the task was queued. Confirm the result in Hostex sync tasks. `POST /listings/prices` and `POST /listings/restrictions` are the calendar writes. `POST /listings/airbnb/price_and_rules` updates Airbnb's listing defaults and is synchronous with Airbnb.

| | Airbnb | Booking.com (each of the 3 rate plans) | Agoda | Hostex direct |
| --- | --- | --- | --- | --- |
| Nightly price | Yes, `/listings/prices` | Yes, same endpoint, per listing | Yes | Yes |
| Per-date minimum on arrival | Yes, `min_stay_on_arrival` | Yes | Yes | Yes |
| `min_stay_through` | No | Yes, unused. Arrival rules match Fri/Sat check-in | Yes, unused | No |
| Weekly / monthly discount | Listing-wide only. Not written, because peak dates cannot be excluded | Not on this API. Set in Booking.com | Not on this API. Set in Agoda | Not on this API |
| Extra guest ₱250 after 4 | Yes, `extra_guest_fee` and `max_guests` on apply | Manual in the channel | Manual | Manual |
| Listing default minimum | Set to 1 night on apply so a per-date rule can allow a weekday stay. `day_of_week_min_nights` is not used | No listing-rules endpoint. If the channel default is above 1, lower it in the extranet or a 1-night weekday can stay blocked | Same as Booking.com | Same as Booking.com |

Preview shows the price, the minimum stay, and the restriction batches that apply would queue. Export is available from the preview and from `GET /api/admin/pricing/runs/:id/export`.

For an authorized deployment, keep the master switch off, compare a preview with the live calendar, and only then apply. Do not enable the switch in the same change that introduces this algorithm.

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
