# Review — feature F002

**Veredicto:** APPROVED  
**Feature:** F002 — domain_entities  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F002.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Existen todos los tipos del §7.1 del PRD | PASS | `packages/domain/src/types.ts`: `MaterialBoard`, `EdgeBand`, `Hardware`, `OptionGroup`, `EdgeAssignment`, `BoardPart`, `HardwareLine`, `Module`, `Project`, `ProjectItem` + resolución `ResolvedBom` / `QuoteBreakdown` / `ProductionCutRow` (+ DTOs intermedios). Contenedores `Catalog` / `Workspace` alineados a `technical_design.md` §1.1. |
| 2 | Los tipos son inmutables (`readonly` donde aplica) | PASS | Todos los campos de interfaces con `readonly`; arrays anidados `readonly T[]` (`optionIds`, `boardParts`, `hardwareLines`, `edges`, `items`, etc.). |
| 3 | `tsc --noEmit` pasa sin errores en `packages/domain` | PASS | `pnpm --filter @muebles/domain typecheck` y `build` → exit 0. |
| 4 | Test: importar y construir objetos de ejemplo | PASS | `packages/domain/src/types.test.ts` (6 casos) + `index.test.ts` (1) = 7 tests verdes; import desde `./index`. |

## Field alignment (PRD §7.1 ↔ technical_design §1.1 ↔ code)

Primary structural source: **technical_design §1.1** (per handoff + review brief). Product names **without** `*Schema` suffix (conventions / PRD).

| Entity | Key fields | Result |
|--------|------------|--------|
| `MaterialBoard` | id, code, name, thicknessMm, grainDefault, costPerM2, wastePercent?, notes?, active | PASS |
| `EdgeBand` | id, code, name, thicknessMm, costPerMl, notes?, active | PASS |
| `Hardware` | id, code, name, unit (`piece\|set\|meter`), costPerUnit, notes?, active | PASS |
| `OptionGroup` | id, code, name, kind, required, optionIds[] | PASS |
| `EdgeAssignment` | side (`L1\|L2\|W1\|W2`), enabled | PASS |
| `BoardPart` | id, code?, description, quantity, lengthMm, widthMm, grain, edges, optionRole | PASS |
| `HardwareLine` | id, quantity, descriptionOverride?, optionRole, hardwareId? | PASS |
| `Module` | id, code, name, externalDims?, baseLaborCost?, boardParts, hardwareLines, notes? | PASS |
| `Project` | id, name, clientName, currency, marginFactor, laborFixedCost, status, items, notes?, createdAt, updatedAt | PASS |
| `ProjectItem` | id, moduleId, quantity, optionChoices | PASS |
| `Catalog` / `Workspace` | materials/edges/hardware/optionGroups/modules; schemaVersion + catalog + projects | PASS |
| `ResolvedBom` | boardParts (+ materialId, edgeBandId?), hardwareLines (+ hardwareId required) | PASS |
| `QuoteBreakdown` | materialsCost, edgeTotal, hardwareTotal, directCost, laborModular, laborFixedCost, marginFactor, salePrice (PRD §13.3) | PASS |
| `ProductionCutRow` | quantity, lengthMm, widthMm, description, materialName, grain, L1–W2 (export A–J) | PASS |

### Intentional omissions (documented, non-blocking)

Aligned with implementer handoff; **not** defects for F002:

1. No `requiredOptionGroups[]` on `Module` — PRD notes derivable from roles; absent from technical_design §1.1.
2. No optional `materialId` default on `BoardPart` — PRD design/preview note only; not in §1.1.
3. No calculation logic / `engine.ts` — correctly deferred to F003.
4. PRD marks some catalog fields optional (`thicknessMm?`, `grainDefault?`); code follows §1.1 required numbers/booleans.

## Errors (`packages/domain/src/errors.ts`)

| Check | Result |
|-------|--------|
| `DomainError extends Error` + optional `context` | PASS |
| `ValidationError` / `ResolutionError` subclasses | PASS |
| `name` set; `Object.setPrototypeOf` for instanceof under ESM | PASS |
| Exported from `index.ts` | PASS |
| Hierarchy covered in tests | PASS (`types.test.ts` L220–232) |

## Exports (`packages/domain/src/index.ts`)

- All entity types + resolution DTOs re-exported as `export type { ... }`.
- Errors re-exported as values.
- `PACKAGE_NAME` retained from scaffold.
- Surface is sufficient for F003/F004 imports.

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| `packages/domain` no react / electron / fs / xlsx | PASS — `rg` found zero forbidden imports; only pure TS |
| Runtime deps | PASS — `package.json` has **no** `dependencies`; only `typescript` + `vitest` devDeps |
| No engine/cost formulas in types | PASS — structural contracts only |
| No `console.log` debug in domain sources | PASS |
| `packages/ui` / `excel` / `storage` untouched for this feature | N/A for F002 scope |

## Conventions

- TypeScript strict ESM, Vitest, single quotes — PASS  
- Interfaces `PascalCase`; unions for literals; module header comments — PASS  
- `*.test.ts` colocated with module — PASS  
- No `any` — PASS  
- IDs as `string` (UUID v4 documented in comments/docs; runtime generation later) — PASS  
- Immutability via `readonly` — PASS  

## Commands executed (reviewer)

```text
./init.sh                            # OK — [OK] Entorno listo. Puedes empezar a trabajar.
pnpm --filter @muebles/domain test   # OK — 7 tests (2 files)
pnpm --filter @muebles/domain typecheck  # OK
pnpm --filter @muebles/domain build      # OK (tsc --noEmit)
```

`./init.sh` also ran full monorepo `pnpm test` (all workspaces green).

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F002)
- [x] Feature `done` (F001) con tests que pasan en monorepo
- [x] `progress/current.md` describe la sesión activa de F002 (no basura)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas ni accede a fs (no tocado)
- [x] `packages/excel` no importa react ni electron (no tocado)
- [x] Errores del dominio son `DomainError` / subclases
- [x] Sin `console.log` de debug en sources de domain

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (7/7)
- [x] Export fixture — N/A (F002 no toca export)
- [x] Storage tmp — N/A (F002 no implementa storage; UUID integrity at load/save is F005)
- [x] Golden motor — N/A (F003/F011)

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en domain (`src/` only; no `dist/` committed)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F002 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **`ResolvedBom` / cut-row field names** may need small renames when F003/F004 map to Optimizer Spanish headers — excel package should map, domain stays English identifiers (correct boundary).
2. **`exactOptionalPropertyTypes`** still off in base tsconfig (noted by implementer); optionals behave as standard TS — fine for F002.
3. **verification.md §4b** mentions F002 for UUID integrity — that applies to storage/engine when relationships are persisted; F002 construction tests use UUID-shaped strings, which is appropriate for type-only scope.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F002 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar `progress/current.md` (o arrancar F003 en la misma sesión según proceso).
