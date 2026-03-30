-- Per-user builder state (compressed GridProjectsState). Only authenticated users (JWT) can access their row.

create table if not exists public.scibo_user_grid_projects (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.scibo_user_grid_projects is 'SciBo grid builder projects per user; payload is lz16-compressed JSON.';

create or replace function public.scibo_user_grid_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scibo_user_grid_projects_touch_updated_at on public.scibo_user_grid_projects;
create trigger scibo_user_grid_projects_touch_updated_at
  before update on public.scibo_user_grid_projects
  for each row
  execute function public.scibo_user_grid_touch_updated_at();

alter table public.scibo_user_grid_projects enable row level security;

drop policy if exists "scibo_user_grid_select_own" on public.scibo_user_grid_projects;
create policy "scibo_user_grid_select_own"
  on public.scibo_user_grid_projects
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_insert_own" on public.scibo_user_grid_projects;
create policy "scibo_user_grid_insert_own"
  on public.scibo_user_grid_projects
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_update_own" on public.scibo_user_grid_projects;
create policy "scibo_user_grid_update_own"
  on public.scibo_user_grid_projects
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_delete_own" on public.scibo_user_grid_projects;
create policy "scibo_user_grid_delete_own"
  on public.scibo_user_grid_projects
  for delete
  to authenticated
  using (auth.uid() = user_id);
