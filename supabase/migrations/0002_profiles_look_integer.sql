-- O visual (shared/looks.ts) usa até 30 bits e não cabe em smallint.
alter table public.profiles alter column look type integer;
