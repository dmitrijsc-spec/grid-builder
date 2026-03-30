# SciBo

React + TypeScript + Vite casino-style UI: betting grid, stream shell, and a **grid builder** under `/dev/*` routes.

## Quick start

```bash
cp .env.example .env
# fill optional vars (Supabase, streams — see .env.example)
npm install
npm run dev
```

Open **http://localhost:5173** (game), **http://localhost:5173/dev/grid-builder** (builder). On LAN testing, use your machine IP and port shown in the terminal.

## Supabase (shared grid / playable link)

So people can open **`https://your-deploy/?room=your-secret`** and see the grid you publish from the builder:

1. Create a project at [supabase.com](https://supabase.com).
2. Run the SQL migration: **`supabase/migrations/20260330120000_scibo_grid_snapshots.sql`** (Dashboard → SQL Editor) or `supabase db push` after `supabase link` — see **`supabase/README.md`**.
3. Set in `.env` (and in your host’s env for production builds):

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (Dashboard → Project Settings → API → **anon public**)

4. In the builder, set **share room**, click **Copy link**, then **Update Game** after changes.

`room` acts like a shared secret (RLS is open to anon for demo). See `supabase/README.md` for security notes.

## GitHub

- Do **not** commit `.env`; only **`.env.example`** is tracked (see `.gitignore`).
- CI runs `lint` and `build` on push/PR to `main` / `master`.

## Scripts

| Command        | Description    |
|----------------|----------------|
| `npm run dev`  | Vite dev server |
| `npm run build`| Type-check + production bundle |
| `npm run lint` | ESLint         |
| `npm run preview` | Serve `dist` locally |

## Legacy

The **`convex/`** folder is unused by the app (historical); the runtime grid uses local storage + optional Supabase.
