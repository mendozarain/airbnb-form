create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  public_token text,
  check_in date not null,
  check_out date not null,
  status text not null default 'open',
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references invites(id),
  guest_email text not null,
  building_code text not null,
  unit_number text not null,
  check_in date not null,
  check_out date not null,
  purpose text not null,
  owner_name text not null,
  owner_contact text not null,
  status text not null default 'ready_for_review',
  google_form_submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  full_name text not null,
  age integer not null,
  requires_id boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists guest_files (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  r2_key text not null,
  filename text not null,
  content_type text not null,
  size_bytes integer not null,
  delete_after timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  status text not null,
  error_message text,
  screenshot_r2_key text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
