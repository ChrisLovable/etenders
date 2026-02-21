-- Tender flags table: stores user flags (interested, reviewed, tendered, not_interested, comment) per tender
create table if not exists public.tender_flags (
  tender_number text primary key,
  interested boolean default false,
  reviewed boolean default false,
  tendered boolean default false,
  not_interested boolean default false,
  comment text default '',
  updated_at timestamptz default now()
);

-- Enable RLS (optional - for future auth)
alter table public.tender_flags enable row level security;

-- Allow anonymous read/write for now (no auth)
create policy "Allow anonymous access" on public.tender_flags
  for all using (true) with check (true);

-- Index for future queries
create index if not exists idx_tender_flags_updated on public.tender_flags(updated_at desc);
