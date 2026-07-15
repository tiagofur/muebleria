# Handoff F005 — storage_layer

**Status:** implementation complete, tests green — **not marked `done`** (awaiting reviewer).  
**Feature status in feature_list.json:** `in_progress`

## What was implemented

### Port — `WorkspaceRepository`

- **File:** `packages/storage/src/workspaceRepository.ts`
- Methods: `load`, `save`, `getCatalog`, `saveCatalog`, `getProjects`, `saveProject`, `deleteProject`
- Types from `@muebles/domain`: `Workspace`, `Catalog`, `Project` (same shape as technical_design `WorkspaceSchema`)

### Seed — `createSeedWorkspace` + `SCHEMA_VERSION`

- **File:** `packages/storage/src/seed.ts`
- `SCHEMA_VERSION = 1` (NFR-10)
- Seed catalog/modules from `@muebles/domain/fixtures` → `plantillaCatalogWithModules`
- Includes materials, edges, hardware, optionGroups, **MOD-GAB-01**, **MOD-CAJ-01**
- `projects: []` on first open

### Adapter — `JSONFileStorage`

- **File:** `packages/storage/src/jsonFileStorage.ts`
- `constructor(filePath: string)`
- **`load()`:** read JSON; on `ENOENT` return seed (does not create file)
- **`save()` atomic (PER-01, NFR-03):** `mkdir` parent → write `{filePath}.tmp` → `rename` over target
- Catalog/project helpers: load-modify-save wrappers

### Surface exports

- `packages/storage/src/workspace.ts` — re-exports port + adapter + seed
- `packages/storage/src/index.ts` — public API

## Acceptance mapping

| Criterion | Evidence |
|-----------|----------|
| save() atomic (.tmp then rename) | `jsonFileStorage.save` + test “no leftover .tmp” after save |
| load() seed if missing | test “returns seed workspace when file is missing” |
| schemaVersion in saved JSON | test asserts field + `SCHEMA_VERSION` constant |
| Unit tests real tempdir | `fs.mkdtemp` / `tmpdir` only — no fs mocks |
| Seed MOD-GAB-01, MOD-CAJ-01 + plantilla catalogs | `createSeedWorkspace` test |

## Verification run

```text
pnpm --filter @muebles/storage test       → 9 passed
pnpm --filter @muebles/storage typecheck  → ok
pnpm test                                 → all workspaces green (after monorepo run)
```

## Files touched

- `feature_list.json` — F005 `in_progress`
- `progress/current.md`
- `packages/storage/src/workspaceRepository.ts` (new)
- `packages/storage/src/seed.ts` (new)
- `packages/storage/src/jsonFileStorage.ts` (new)
- `packages/storage/src/workspace.ts` (new)
- `packages/storage/src/workspace.test.ts` (new)
- `packages/storage/src/index.ts`
- `packages/storage/src/index.test.ts`
- `packages/storage/vitest.config.ts` — domain + fixtures aliases

## Reviewer notes

- Do **not** mark `done` until review APPROVED.
- No migrations yet: load parses JSON as-is; only seed stamps `schemaVersion: 1`.
- Production seed imports plantilla fixtures via `@muebles/domain/fixtures` (already exported for package use).
- Node `fs` only in storage package; no react/excel/electron.
