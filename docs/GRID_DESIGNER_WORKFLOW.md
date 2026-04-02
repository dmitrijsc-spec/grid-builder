# Grid designer workflow

This document describes how the **Grid Builder** connects to the **live game** and to **remote devices**.

## Routes

| URL | Purpose |
|-----|---------|
| `/` | Game shell with `BettingGrid` (uses the latest **published** runtime snapshot when available). |
| `/dev/grid-builder` | Full canvas builder: layers, zones, desktop/mobile packages, animations. |
| `/dev/grid-runtime-compare` | Utility to compare runtime layouts. |
| `/dev/grid-editor` | Legacy zone-only tool — use the grid builder instead (see deprecation notice on that route). |

## Two different “cloud” concepts

1. **Account projects (Supabase)** — When auth is enabled, your **builder project list** syncs to `scibo_user_grid_projects` (and parts table for large payloads). This is your editable source of truth across machines logged into the same account.
2. **Shared runtime snapshot (Supabase)** — A separate payload keyed by a **room id** (`scibo_grid_snapshots`). The game can poll this so phones and deployed URLs see the same grid **without** the Vite dev server.

## Publishing to the game (Update Game)

Click **Update Game** in the builder to:

1. Save projects to durable storage (and to the account cloud when configured).
2. Bake desktop/mobile runtime atlases when the grid content changed (with fallbacks if atlas bake fails).
3. Write the **runtime snapshot** to `localStorage` and dispatch events so other tabs on the same machine update.
4. In **development**, POST the snapshot to the Vite **LAN relay** so other devices on the same Wi‑Fi can poll it.
5. If Supabase is configured **and** a share room id is set (or `VITE_GRID_CLOUD_ROOM`), upload the snapshot for remote play.

## Testing on another device

### Same machine

Open the game in another tab; after **Update Game**, the grid updates via `CustomEvent` / `BroadcastChannel`.

### Same Wi‑Fi (local dev only)

1. Run `npm run dev` (Vite listens on all interfaces — see `vite.config.ts`).
2. On your phone, open `http://<computer-LAN-IP>:5173`.
3. On the computer, click **Update Game** — the phone picks up changes via the dev relay (polling in `BettingGrid`).

`npm run preview` (production build) **does not** include the dev relay — use the shared room flow below.

### Deployed URL or any network

1. Apply Supabase migrations for `scibo_grid_snapshots` and set `VITE_SUPABASE_URL` + anon key in the host environment.
2. Set a **share room id** in the builder header (stored in this browser) or set `VITE_GRID_CLOUD_ROOM` for a default.
3. Open the game as `https://your-host/?room=your-room-id` on each device.
4. After **Update Game**, devices polling that room receive the snapshot.

## URL flags for QA (game)

| Query | Effect |
|-------|--------|
| `?room=` | Selects Supabase snapshot room (overrides env default). |
| `?forceMobile=1` / `?forceDesktop=1` | Overrides automatic desktop vs mobile layout detection. |
| `?mobileAtlas=1` | Uses baked atlas path on mobile (when published). |
| `?iosCanvas=1` | iOS WebKit canvas fallback path. |

## Security note

The demo RLS policies on `scibo_grid_snapshots` allow anon read/write by room id — treat the room string as a **shared secret**. Tighten policies for production if needed.
