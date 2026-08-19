# Review — feature F005

**Veredicto:** APPROVED  
**Feature:** F005 — storage_layer  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F005.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `save()` atómico: `.tmp` + rename (PER-01, NFR-03) | PASS | `JSONFileStorage.save` (`packages/storage/src/jsonFileStorage.ts` L41–48): `mkdir` parent → `writeFile(`${filePath}.tmp`)` → `rename(tmp, filePath)`. Test “no leftover .tmp” + file exists (`workspace.test.ts` L62–76, L123–158). |
| 2 | `load()` seed si el archivo no existe | PASS | `load()` catches `ENOENT` → `createSeedWorkspace()` without writing (`jsonFileStorage.ts` L29–38). Test asserts seed shape + `fileExists(path) === false` (`workspace.test.ts` L47–60). |
| 3 | `schemaVersion` en JSON guardado (NFR-10) | PASS | `SCHEMA_VERSION = 1` (`seed.ts` L10); stamped on seed (`seed.ts` L17). Save test reads raw JSON: `parsed.schemaVersion === 1` and `"schemaVersion"` in payload (`workspace.test.ts` L62–76). |
| 4 | Unit tests con tempdir real (no mocks de fs) | PASS | `fs.mkdtemp` + `os.tmpdir` only (`workspace.test.ts` L5–17). No `vi.mock` / fs mocks in package. 8 storage tests + 1 export smoke. |
| 5 | Seed: MOD-GAB-01, MOD-CAJ-01 + catálogos plantilla | PASS | `createSeedWorkspace` uses `plantillaCatalogWithModules` from `@muebles/domain/fixtures` (`seed.ts` L7–20). Test checks materials/edges/hardware/optionGroups length > 0 and module codes (`workspace.test.ts` L30–44). Fixtures define both codes in `plantillaDemo.ts`. |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| storage = port + file adapter | PASS — `WorkspaceRepository` interface (`workspaceRepository.ts`); `JSONFileStorage` implements it (`jsonFileStorage.ts`) |
| storage may use Node `fs`, domain types | PASS — `node:fs/promises`, `node:path`; types `Workspace` / `Catalog` / `Project` from `@muebles/domain` |
| No react / electron / xlsx in storage | PASS — deps: `@muebles/domain` only (`package.json`) |
| domain remains pure (no fs) | PASS — seed data lives in domain fixtures; storage only imports types + fixtures for seed content |
| No `console.log` in production sources | PASS |
| Atomic write (no half-write workspace) | PASS — tmp then rename; architecture “No escribir el archivo de workspace a mitad de operación” |

Boundary notes (non-blocking):

1. **No schema validation / migrations on load** — `JSON.parse(raw) as Workspace` trusts file content. Documented in handoff (NFR-10 version field only for future migrations). Acceptable for F005 scope.
2. **`workspace.ts` is a thin re-export surface** of port/adapter/seed — matches feature description path `packages/storage/src/workspace.ts` while keeping modules split (`jsonFileStorage`, `seed`, `workspaceRepository`). Index also re-exports the same surface.

## Conventions

- camelCase modules: `jsonFileStorage.ts`, `workspaceRepository.ts`, `seed.ts` — PASS  
- `SCHEMA_VERSION` UPPER_SNAKE — PASS  
- Colocated `workspace.test.ts` + real tmp — PASS  
- Header one-line purpose comments + ESM + single quotes — PASS  
- Immutability on catalog/project updates: spread + `map`/`filter`, no in-place mutation (`jsonFileStorage.ts` L56–81) — PASS  
- Public API via `packages/storage/src/index.ts` — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 29/29 |
| Nivel 2 storage | PASS — 9/9 |
| Nivel 3 monorepo | PASS — all workspaces green via `./init.sh` and `pnpm test` |
| Nivel 4b storage integrity | PASS — round-trip asserts `ProjectItem.moduleId` ∈ catalog module ids (`workspace.test.ts` L78–121); catalog/project CRUD wrappers covered |
| Golden / excel | N/A for F005 (still green in monorepo) |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; 15 features, 1 in_progress
pnpm --filter @muebles/storage test    # 9/9
pnpm --filter @muebles/storage typecheck  # ok
pnpm test                              # all workspaces green
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F005)
- [x] Features `done` (F001–F004) con monorepo tests green
- [x] `progress/current.md` describe sesión F005 activa (handoff clear)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas ni accede a fs (no tocado)
- [x] `packages/excel` no importa react ni electron (no tocado en F005)
- [x] Errores del dominio son `DomainError` / subclases (storage no introduce error types nuevos; rethrows non-ENOENT)
- [x] Sin `console.log` de debug en sources de producción storage

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (29/29)
- [x] Storage: tempdir real (`mkdtemp`), atomic save, seed, schemaVersion, UUID relation integrity
- [x] Export fixture — N/A (F005 no toca excel; monorepo excel still green)
- [x] Golden motor (F003) still green within monorepo run

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en paquetes tocados (`packages/storage/src/*` only; no dist committed)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F005 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Load trusts JSON shape** — no runtime schema check / migration runner yet. Correct for F005; track when schemaVersion bumps.
2. **Atomicity coverage is behavioral, not crash-injected** — tests prove write path uses `.tmp` + rename and leaves no leftover tmp; they do not simulate process kill mid-write (OS-level rename atomicity is the design guarantee).
3. **`saveCatalog` / `saveProject` on missing file** materialize seed first via `load()` then write — intentional; first project save creates workspace with plantilla catalog.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F005 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F006 (`ui_catalogs`) como siguiente feature pending.
