# cozy-d-714

Version 1.0.0

One-time guest registration links for guest booking stays, with an admin review step before submitting the restricted PMO Google Form.

## Structure

- `frontend/` - Vite + React + Formik guest/admin UI.
- `backend/` - Cloudflare Worker + Hono API.
- `shared/` - shared Zod schemas and TypeScript types.

## Local setup

```bash
bun install
bun dev:frontend
bun dev:backend
```

The backend needs these before real use:

```bash
wrangler secret put DATABASE_URL
wrangler secret put GMAIL_SMTP_USER
wrangler secret put GMAIL_SMTP_APP_PASSWORD
```

For local Worker dev, copy `backend/.dev.vars.example` to `backend/.dev.vars` and put your Neon URL there. The real `.dev.vars` file is ignored by git.

For local frontend auth, copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_NEON_AUTH_URL` from the Neon Auth configuration page.

Create the Neon tables with `backend/schema.sql`.

## Cloudflare

`backend/wrangler.jsonc` defines:

- `ID_BUCKET` - R2 bucket for temporary ID uploads and automation screenshots.
- `BROWSER` - Cloudflare Browser Run binding for Playwright automation.
- Cron cleanup for orphan ID uploads older than 24 hours.

The production flow fills the restricted Google Form with Browser Run, uploads the guest IDs, captures the filled form before submit, submits the Google Form, then emails the entrance-pass screenshot and check-in guide to the guest.

## Admin Auth

Admin pages use Neon Auth. The frontend signs in through `VITE_NEON_AUTH_URL`, then sends a Neon Auth JWT to the Worker. The Worker verifies that JWT against the Neon Auth `/jwt` JWKS endpoint before serving `/api/admin/*`.

Set `ADMIN_EMAILS` to a comma-separated allowlist, or assign the `admin` role in Neon Auth. If `ADMIN_EMAILS` is empty, any signed-in Neon Auth user can access admin routes, which is useful during local setup but too loose for production.

## Release 1

- Mobile-friendly guest registration flow with one-time invite URLs.
- Admin review, reject, delete, pending, ready, rejected, and done tabs.
- Temporary ID storage in R2 with 24-hour cleanup for abandoned uploads.
- Browser Run automation for the restricted PMO Google Form.
- Gmail SMTP delivery for the entrance pass and editable HTML check-in guide.
