-- Employee group: members who receive notifications (email, phone, etc.)
create table if not exists public.employee_group (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text default '',
  employee_number text default '',
  created_at timestamptz default now()
);

alter table public.employee_group enable row level security;

create policy "Allow anonymous access" on public.employee_group
  for all using (true) with check (true);

create unique index if not exists idx_employee_group_email on public.employee_group(lower(email));
