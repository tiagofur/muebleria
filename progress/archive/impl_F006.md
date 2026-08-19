# Handoff F006 — ui_catalogs

**Status:** implementation complete, tests green — **not marked `done`** (awaiting reviewer).  
**Feature status in feature_list.json:** `in_progress`

## Run the web app (exact command)

From the monorepo root:

```bash
cd /Users/tiagofur/dev/carpinteria/muebles && pnpm --filter @muebles/web dev
```

Then open **http://localhost:5173/**

Expected: tabs **Materiales / Cantos / Herrajes** with plantilla seed rows (e.g. `TAB-ARA-BLA`, `CAN-ARA-BLA`, `HER-BIS-CL`).

Alternative (preview production build):

```bash
cd /Users/tiagofur/dev/carpinteria/muebles && pnpm --filter @muebles/web build && pnpm --filter @muebles/web preview
```

## What was implemented

### Pure helpers — CAT-04 / CAT-05

- **File:** `packages/ui/src/catalogs/catalogHelpers.ts`
- `validateUniqueCode` — no two *active* items of the same type share a code (case-insensitive)
- `filterCatalogItems` — hide inactive in lists by default; toggle `showInactive`
- `filterActiveForPicker` — pickers hide inactive by default (`CatalogPicker`)

### Presentation components

| Component | Role |
|-----------|------|
| `CatalogTable` | Reusable table + row actions |
| `CatalogPicker` | Select with active-only filter |
| `MaterialsCatalog` | MaterialBoard ABM (table + form) |
| `EdgesCatalog` | EdgeBand ABM |
| `HardwareCatalog` | Hardware ABM |
| `catalogs.css` | Minimal shared styles |

UI is **controlled**: parent owns arrays; screens call `onCreate` / `onUpdate` / `onDeactivate` / `onReactivate`.  
No cost formulas in UI. Soft-delete = `active: false` (no hard delete).

### Storage seed for browser

- **Export subpath:** `@muebles/storage/seed` → pure `createSeedWorkspace` + `SCHEMA_VERSION` (no Node `fs`)
- Avoids pulling `JSONFileStorage` into the Vite bundle

### Web shell wiring

- **File:** `apps/web/src/App.tsx`
- Initial state: `createSeedWorkspace()` in memory
- Tabs: Materiales / Cantos / Herrajes
- IDs via `crypto.randomUUID()` (fallback for non-crypto envs)
- Spanish neutral labels

## Acceptance mapping

| Criterion | Evidence |
|-----------|----------|
| CRUD × 3 catalogs (CAT-01..03) | Materials/Edges/Hardware screens + shell handlers |
| Soft-delete; inactive hidden in pickers (CAT-05) | `onDeactivate` sets `active: false`; `filterActiveForPicker` / list toggle |
| Unique code client validation (CAT-04) | `validateUniqueCode` before save; tests |
| Seed visible first open (CAT-06) | `createSeedWorkspace()` on App mount; App.test asserts plantilla codes |

## Verification run

```text
pnpm --filter @muebles/ui test        → 14 passed
pnpm --filter @muebles/web test       → 4 passed
pnpm --filter @muebles/ui typecheck   → ok
pnpm --filter @muebles/web typecheck  → ok
pnpm --filter @muebles/web build      → ok (Vite production)
pnpm test / ./init.sh                 → all workspaces green
```

## Files touched

- `feature_list.json` — F006 `in_progress`
- `progress/current.md`
- `packages/ui/src/catalogs/*` (helpers, table, picker, 3 screens, css, index)
- `packages/ui/src/index.ts`, `index.test.ts`, `vitest.config.ts`
- `packages/storage/package.json` — `./seed` export
- `tsconfig.base.json` — `@muebles/storage/seed` path
- `apps/web/src/App.tsx`, `app.css`, `App.test.ts`, `main` unchanged, `index.html`
- `apps/web/package.json` — dep `@muebles/storage`
- `apps/web/vite.config.ts`, `vitest.config.ts`

## Reviewer notes

- Do **not** mark `done` until review APPROVED.
- Scope intentionally excludes F007 option groups, F008 modules, F009 quotation.
- Persistence is in-memory only in web shell for this feature (seed on reload); JSON file adapter remains desktop/Node path.
- CAT-04 uniqueness is among **active** codes of the same entity type (per PRD).
