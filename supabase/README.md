# Supabase Setup for eTenders

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project
2. Wait for the project to be provisioned

## 2. Run the migration

In the Supabase Dashboard → SQL Editor, run the migration:

```sql
-- From supabase/migrations/20250220000000_create_tender_flags.sql
create table if not exists public.tender_flags (
  tender_number text primary key,
  interested boolean default false,
  reviewed boolean default false,
  tendered boolean default false,
  not_interested boolean default false,
  comment text default '',
  updated_at timestamptz default now()
);

alter table public.tender_flags enable row level security;

create policy "Allow anonymous access" on public.tender_flags
  for all using (true) with check (true);

create index if not exists idx_tender_flags_updated on public.tender_flags(updated_at desc);
```

Or use the Supabase CLI: `supabase db push`

## 3. Get your credentials

Dashboard → Project Settings → API:
- **Project URL** → `SUPABASE_URL`
- **service_role key** (secret) → `SUPABASE_SERVICE_KEY`

## 4. Configure environment

**Local:** Copy `.env.example` to `.env` and add your values.

**Netlify:** Site settings → Environment variables → Add:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

## 5. Behavior

- When both env vars are set, flags are stored in Supabase
- When not set, the app falls back to the JSON file (localStorage sync)
- No code changes needed in the frontend
