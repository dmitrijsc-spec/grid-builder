# Grid builder & runtime QA checklist

Use this when validating releases or large grid changes. Record **browser / OS / DPR** for visual issues.

**Automated baseline (CI / local):** `npm run lint` and `npm run build` should pass with no errors. ESLint disables `react-hooks/refs` for `GridCanvasBuilder.tsx` and `BettingGrid.tsx` where refs are read intentionally during render for animations.

## Builder (`/dev/grid-builder`)

- [ ] Create and switch projects; reload — data persists.
- [ ] Import SVG layers; move, resize, z-order, lock, rename.
- [ ] Toggle **Desktop** / **Mobile** — mobile fork creates `mobilePkg` on first use.
- [ ] **Open** / **Closed** preview matches tilt expectations on desktop.
- [ ] Layer states (default, hover, …) and global visibility (open/closed) behave as expected.
- [ ] **Update Game** completes without error; optional warning tooltip if atlas bake skipped.
- [ ] **Account** row shows Supabase sync when auth is on, or “Local only” when auth is off.

## Game (`/`)

- [ ] After **Update Game**, grid updates in a second tab without reload (same browser).
- [ ] Bet zones align with art; hover hit areas feel correct for layers with separate hover rects.
- [ ] Phase change (betting vs closed) uses correct global grid state and tilt when enabled.

## Cross-device

- [ ] **Dev + LAN:** Phone on same Wi‑Fi loads `http://<IP>:5173` and receives updates after **Update Game** (dev relay).
- [ ] **Room + deploy:** `?room=` matches builder share room; phone on cellular sees updates after publish.

## Visual quality

- [ ] Desktop: sharp SVG / inline rendering at target DPR.
- [ ] Mobile: acceptable sharpness; try `?mobileAtlas=1` or `?iosCanvas=1` if comparing paths.
- [ ] Very large grids: no silent failure — check **Update Game** detail tooltip for atlas errors.

## Legacy

- [ ] `/dev/grid-editor` shows deprecation and link to `/dev/grid-builder` (zones are edited in the full builder).
