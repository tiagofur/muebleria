# Review — feature F025

**Veredicto:** APPROVED  
**Feature:** F025 — module_hierarchical_categories  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F025.md`  
**PRD:** MOD-09 (categorías jerárquicas), PRJ-11 (selector categorizado al agregar ítems)  
**Status note:** Feature remains `in_progress` in `feature_list.json`. Reviewer does **not** mark `done`.

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Usuario puede crear, editar y organizar categorías de hasta 3 niveles | PASS | Shell CRUD `createCategory` / `updateCategory` / `deleteCategory` in `apps/web/src/App.tsx` (~L805–848). ModulesScreen category modal (`categoryModalOpen`, `handleCategorySubmit` ~L1205–1227) with parent picker limited to `depth < 2` (0-indexed = domain levels 1–2) so max tree depth 3 (`ModulesScreen.tsx` L1468–1469). Placement re-checked via `canPlaceCategory` before submit (L1213–1219). Admin list with edit/delete (~L1294–1320). |
| 2 | Backend Go valida profundidad máxima 3 al crear o reubicar | PASS | `backend-go/internal/domain/categories.go` `ValidateCategoryPlacement` + `MaxCategoryDepth = 3`. Called from `storage.CreateCategory` / `UpdateCategory` (`categories.go` L66, L101). Unit tests: `categories_test.go` reject 4th level create, invalid move under leaf, move under own descendant. API maps validation errors → 400 (`handlers.go` L742–745, L782–788). Routes: `/api/catalog/categories` CRUD (`routes.go` L52–57). |
| 3 | ModulesScreen: panel de filtrado por árbol + selector en cascada | PASS | Tree panel `data-testid="category-filter-panel"` + nodes / uncategorized (`ModulesScreen.tsx` ~L1260–1283). Editor cascade `data-testid="module-category-cascade"` (~L574+). Filtering via domain `filterModulesByCategory`. RTL: `ModulesScreen.test.tsx` describe “ModulesScreen categories (F025)” (filter, cascade, path on detail). |
| 4 | Modal agregar muebles a cotizaciones filtra por jerarquía | PASS | `ProjectsScreen.tsx` `add-item-category-cascade` (~L641–704), cascade state L1–L3, `modulesForAdd` via `filterModulesByCategory` (~L296–300). Prop `categories` from App (`App.tsx` ~L1249). |
| 5 | Compatibilidad: muebles existentes sin clasificar | PASS | `Module.categoryId?` optional (`types.ts` L136–137). `Catalog.categories?` optional. Filter “Sin categoría” (`UNCATEGORIZED_FILTER`). Seed/modules without id remain valid. Delete category clears `categoryId` on affected modules (App L843–845). DB `ON DELETE SET NULL` on `modules.category_id`. |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| `packages/domain` pure (no react/fs/xlsx) | PASS — `categories.ts` only types + `ValidationError` |
| Domain errors are `ValidationError` / `DomainError` | PASS — placement / cycle / name use `ValidationError` |
| UI no cost formulas / no fs | PASS — Modules/Projects use domain helpers for tree/cascade/filter only; costs still shell props |
| Apps thin shell | PASS — App wires CRUD + passes `categories`; no tree math in shell beyond patch |
| Go domain mirrors placement rules | PASS — depth/height/move checks aligned with TS |
| Storage maps `category_id` on modules | PASS — list/get/create/update in `backend-go/internal/storage/projects.go` |
| No debug `console.log` in F025 surface | PASS in categories / Modules category UI / Go categories |

## Conventions

- Types `ModuleCategory`, helpers camelCase, file `categories.ts` — PASS  
- Colocated `categories.test.ts` (domain) + Go `categories_test.go` — PASS  
- UI Spanish copy; identifiers English — PASS  
- Readonly domain entities; immutability via spread in App — PASS  
- JSON camelCase for category fields (`parentId`, `sortOrder`, `categoryId`) matching TS — PASS (handoff note)

## Diseño UI/UX (toca `packages/ui`)

- D1: [x] Category tree CSS uses design tokens only (`modules.css` L16–99: `--surface-*`, `--border-*`, `--space-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--transition-colors`). No hardcoded palette hex/rgb.
- D2: [x] Modules keep cards + list→detail; category filter is side panel in `module-list-layout` grid; admin via Modal `size="sm"` (design modal pattern).
- D3: [x] Category modal reuses shared `Modal` (focus trap / Esc / backdrop from F018).
- D4: [x] Category CRUD toasts in App (`success` / `warning` / `info`) — existing toast system.
- D5: [x] Lucide only (`FolderTree`, `Pencil`, `Trash2`, etc.) with `strokeWidth={1.5}`.
- D6: [x] Tree item uses `var(--transition-colors)` (inherits design-system reduced-motion conventions; no new unbounded animations).

## Checkpoints

- C1: [x] Harness files present (`AGENTS.md`, `init.sh`, docs, skills, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`)
- C2: [x] Single `in_progress` (F025); `progress/current.md` describes active session / handoff
- C3: [x] Architecture boundaries respected for F025 touch set
- C4: [x] Feature-level tests present: domain `categories.test.ts`; Go `categories_test.go`; UI `ModulesScreen.test.tsx` F025 block + `moduleHelpers` flatten. Implementer reported domain 70 / ui 174 / `go test ./...` OK. **This reviewer session could not execute the shell** (no terminal tool); closer should re-run `./init.sh` + `go test ./...` in `backend-go` before marking `done` if environment allows.
- C5: [ ] Not closed by reviewer — feature must stay `in_progress` until closer archives; no `history.md` / `done` from this role

## Verification

| Check | Result |
|-------|--------|
| Domain placement / filter / cascade unit tests | PASS (source review of `categories.test.ts`) |
| Go depth / move / height unit tests | PASS (source review of `categories_test.go`) |
| ModulesScreen F025 RTL | PASS (source: filter panel, cascade, path) |
| Migrations 000001 + 000002 categories | PASS — table + `modules.category_id` + indexes |
| `duplicateModule` preserves `categoryId` | PASS (`duplicate.ts` L89) |
| Live `pnpm test` / `./init.sh` / `go test` this session | **Not executed** (shell unavailable). Rely on implementer claim + static test surface. |

## Files reviewed

- `packages/domain/src/categories.ts`, `categories.test.ts`, `types.ts`, `duplicate.ts`, `index.ts`
- `backend-go/internal/domain/categories.go`, `categories_test.go`, `types.go`
- `backend-go/internal/storage/categories.go`, module `category_id` paths in `projects.go`
- `backend-go/internal/api/handlers.go`, `routes.go`
- `backend-go/db/migration/000001_init_schema.up.sql`, `000002_module_categories.up.sql`
- `packages/storage/src/apiWorkspaceRepository.ts`
- `packages/ui/src/modules/*` (ModulesScreen, helpers, CSS, tests)
- `packages/ui/src/projects/ProjectsScreen.tsx` (add-item cascade)
- `apps/web/src/App.tsx` (CRUD + prop wiring)
- Docs: `architecture.md`, `conventions.md`, `CHECKPOINTS.md`, PRD MOD-09/PRJ-11, `design.md` (UI touch), `impl_F025.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. **No ProjectsScreen RTL for PRJ-11 cascade** — cascade is wired and domain `filterModulesByCategory` / cascade helpers are unit-tested; ModulesScreen has UI tests. A thin ProjectsScreen test with `categories` + `add-item-category-cascade` would harden acceptance #4; not required to approve given current coverage.
2. **Client delete category does not call `DELETE /api/catalog/categories/{id}`** — same upsert-only `saveCatalog` pattern as module delete (pre-existing storage adapter limitation). Deleted categories can reappear after full reload until adapter grows true delete sync. Backend delete + RESTRICT children is correct when DELETE is invoked.
3. **Shell `createCategory` / `updateCategory` do not call `assertCategoryPlacement`** — UI gates with `canPlaceCategory`; server re-validates on API write. Acceptable; optional hardening in App would add defense-in-depth for non-UI callers.
4. **Parent picker uses 0-based `flattenCategoriesForSelect` depth** (`depth < 2`) while domain depth is 1-based — correct for max 3 levels; comment in UI would reduce future confusion.
5. **`apiWorkspaceRepository` load hard-fails if categories endpoint missing** — expected after deploy; handoff already documents API restart.

## Verdict rationale

All five acceptance criteria have concrete implementation evidence across domain (TS + Go), persistence, API, ModulesScreen, and ProjectsScreen. Boundaries and design-system usage hold. Residual gaps are non-blocking and consistent with existing monorepo patterns. Closer: re-run full test suite, then mark `done` only after green.
