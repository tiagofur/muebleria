# Handoff — F002 domain_entities

## Status

Implemented and self-verified. **Not marked `done`** — awaiting reviewer.

## What was created

| Path | Role |
|------|------|
| `packages/domain/src/types.ts` | All domain interfaces + literal unions + resolution DTOs |
| `packages/domain/src/errors.ts` | `DomainError`, `ValidationError`, `ResolutionError` |
| `packages/domain/src/index.ts` | Re-exports types + errors + `PACKAGE_NAME` |
| `packages/domain/src/types.test.ts` | Construction tests for every entity + error hierarchy |

## Naming decision

- Product names **without** `*Schema` suffix (`MaterialBoard`, not `MaterialBoardSchema`), matching PRD §7.1 / feature list / conventions.
- Field shapes aligned to `docs/technical_design.md` §1.1 (primary structural source).
- Resolution DTOs minimal readonly shapes from PRD §7.1 sketch + §13 aggregates + Optimizer cut-row contract (for F003/F004 imports later). **No calculation logic.**

## Types included

**Unions:** `HardwareUnit`, `OptionGroupKind`, `Grain`, `EdgeSide`, `ProjectStatus`, `OptionChoices`

**Catalog:** `MaterialBoard`, `EdgeBand`, `Hardware`, `OptionGroup`

**Module:** `EdgeAssignment`, `BoardPart`, `HardwareLine`, `ExternalDims`, `Module`

**Project:** `ProjectItem`, `Project`

**Containers:** `Catalog`, `Workspace`

**Resolution DTOs:** `ResolvedBoardPart`, `ResolvedHardwareLine`, `ResolvedBom`, `QuoteBreakdown`, `ProductionCutRow`

**Errors:** `DomainError` / `ValidationError` / `ResolutionError` (classes with optional `context`)

## Acceptance mapping

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Todos los tipos del §7.1 | `types.ts`: MaterialBoard, EdgeBand, Hardware, OptionGroup, EdgeAssignment, BoardPart, HardwareLine, Module, Project, ProjectItem + ResolvedBom family |
| 2 | Inmutables (`readonly`) | All entity fields `readonly`; nested arrays `readonly T[]` |
| 3 | `tsc --noEmit` en domain | `pnpm --filter @muebles/domain typecheck` → exit 0 |
| 4 | Test: importar y construir ejemplos | `types.test.ts` (6 cases) — all entities + errors |

## Commands / results

```text
pnpm --filter @muebles/domain test       → 7 tests passed (2 files)
pnpm --filter @muebles/domain typecheck  → exit 0
pnpm --filter @muebles/domain build      → exit 0 (tsc --noEmit)
```

## Intentional omissions (out of F002 / later features)

- No `engine.ts` / `resolveBom` / cost formulas (F003).
- No `requiredOptionGroups[]` on Module (PRD notes it as derivable; absent from technical_design §1.1).
- No optional `materialId` default on `BoardPart` (PRD note only; not in technical_design §1.1).
- No `exportName` on materials (PRD §14 export nicety; not in §1.1 schema).
- No storage seed / UUID generation runtime deps.

## Residual risks

- `ResolvedBom` / `QuoteBreakdown` / `ProductionCutRow` field names may need small adjustments when F003/F004 implement engine/export if product prefers different property names for Optimizer mapping.
- `ProductionCutRow` uses English identifiers (`materialName`, `L1`…); excel package will map to Spanish headers at export time (correct boundary).
- `exactOptionalPropertyTypes` is off in base tsconfig; optional fields behave as standard TS optionals.

## Reviewer checklist hints

- Confirm product names (no `*Schema`) and readonly discipline.
- Confirm no engine logic leaked into domain package.
- Confirm exports from `@muebles/domain` cover F003 import surface.
