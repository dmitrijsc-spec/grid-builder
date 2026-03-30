# Supabase (SciBo)

## What this does

Table **`scibo_grid_snapshots`** stores the published grid (desktop + mobile runtime packages). The browser uses the **anon** key and Row Level Security policies defined in the migration.

## Migrations (run in order)

1. `20260330120000_scibo_grid_snapshots.sql` — public shared room snapshots (`?room=`).
2. `20260330210000_scibo_user_grid_projects.sql` — **per-user builder projects** (requires login).

## Option A — Dashboard (fastest)

1. Open your project → **SQL Editor** → New query.
2. Paste each migration file **in order** and run.
3. **Project Settings → API**: copy **Project URL** and **publishable** (or **anon**) key into `.env` / `.env.local` (never commit secrets; see `.env.example`).

## Authentication

- Create users in **Authentication → Users** (e.g. “Add user” with email + password).  
- Disable **“Confirm email”** for invite-only flows if you don’t want email verification (project **Auth** settings).

## Option B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Use the same API URL and anon key in `.env`.

## Security note

Policies allow **anyone with the anon key** to read/write rows. Treat **`room` id** like a password. For production, replace with Edge Functions + service role or signed tokens.

## Large grids

If uploads fail (payload too large), next step is **Supabase Storage** (one object per `room`) instead of a `text` column.
