-- Add reviewed_by to track who last changed the status
alter table public.tender_flags add column if not exists reviewed_by text default '';
