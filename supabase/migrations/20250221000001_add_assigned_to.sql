-- Add assigned_to column to tender_flags
alter table public.tender_flags add column if not exists assigned_to text default '';
