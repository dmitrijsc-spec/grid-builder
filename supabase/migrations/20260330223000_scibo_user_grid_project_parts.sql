-- Chunked payload for large grid projects (many inline SVGs). Main row stays small; body is split across parts.

alter table public.scibo_user_grid_projects
  add column if not exists parts_count integer not null default 0;

comment on column public.scibo_user_grid_projects.parts_count is '0 = full lz16 payload in `payload`; >0 = join `scibo_user_grid_project_parts` by part_index.';

create table if not exists public.scibo_user_grid_project_parts (
  user_id uuid not null references auth.users (id) on delete cascade,
  part_index integer not null,
  content text not null,
  primary key (user_id, part_index)
);

comment on table public.scibo_user_grid_project_parts is 'Continuation slices of GridProjectsState (lz16) when cloud row exceeds API size limits.';

alter table public.scibo_user_grid_project_parts enable row level security;

drop policy if exists "scibo_user_grid_parts_select_own" on public.scibo_user_grid_project_parts;
create policy "scibo_user_grid_parts_select_own"
  on public.scibo_user_grid_project_parts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_parts_insert_own" on public.scibo_user_grid_project_parts;
create policy "scibo_user_grid_parts_insert_own"
  on public.scibo_user_grid_project_parts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_parts_update_own" on public.scibo_user_grid_project_parts;
create policy "scibo_user_grid_parts_update_own"
  on public.scibo_user_grid_project_parts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "scibo_user_grid_parts_delete_own" on public.scibo_user_grid_project_parts;
create policy "scibo_user_grid_parts_delete_own"
  on public.scibo_user_grid_project_parts
  for delete
  to authenticated
  using (auth.uid() = user_id);
