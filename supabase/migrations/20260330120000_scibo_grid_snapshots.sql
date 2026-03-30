-- SciBo: one row per shared “room” (?room= in the game URL). Payload mirrors localStorage runtime snapshot (JSON or lz-compressed).
-- Apply via Supabase Dashboard → SQL (new query), or: npx supabase db push (linked project).

create table if not exists public.scibo_grid_snapshots (
  id text primary key,
  payload text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.scibo_grid_snapshots is 'SciBo published grid runtime snapshot; id is secret room slug.';

create index if not exists scibo_grid_snapshots_updated_at_idx
  on public.scibo_grid_snapshots (updated_at desc);

-- Keep updated_at authoritative on the server (client no longer sends it).
create or replace function public.scibo_grid_snapshots_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scibo_grid_snapshots_set_updated_at on public.scibo_grid_snapshots;
create trigger scibo_grid_snapshots_set_updated_at
  before update on public.scibo_grid_snapshots
  for each row
  execute function public.scibo_grid_snapshots_set_updated_at();

alter table public.scibo_grid_snapshots enable row level security;

drop policy if exists "scibo_grid_snapshots_read" on public.scibo_grid_snapshots;
create policy "scibo_grid_snapshots_read"
  on public.scibo_grid_snapshots
  for select
  to anon, authenticated
  using (true);

drop policy if exists "scibo_grid_snapshots_insert" on public.scibo_grid_snapshots;
create policy "scibo_grid_snapshots_insert"
  on public.scibo_grid_snapshots
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "scibo_grid_snapshots_update" on public.scibo_grid_snapshots;
create policy "scibo_grid_snapshots_update"
  on public.scibo_grid_snapshots
  for update
  to anon, authenticated
  using (true)
  with check (true);
