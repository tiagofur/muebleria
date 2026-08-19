# Review — feature F022

**Veredicto:** CHANGES_REQUESTED  
**Feature:** F022 — ui_projects_cards_detail  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F022.md`  
**Design:** `docs/design.md` §4.2 / §4.3 MD / §5.2 badges / §5.3 cards (+ EmptyState §4.5)

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Lista de proyectos usa cards, no tabla | PASS | No `CatalogTable`; `project-card-grid` + `.project-card` buttons (`ProjectsScreen.tsx` ~L615–648). RTL: “renders project list as rich cards (not a table)” |
| 2 | Card: nombre, cliente, badge status, nº muebles, precio total, fecha | **FAIL (runtime contract)** | UI still reads `project.clientName` (`ProjectsScreen.tsx` L628, L669; `projectHelpers.ts` L89, L165). Domain `Project` is `customerId` only (`packages/domain/src/types.ts` L138–153). Seed plantilla uses `customerId` (`plantillaDemo.ts` L499–523). With real domain data, card **cliente** is empty/undefined. Typecheck: `TS2339 Property 'clientName' does not exist on type 'Project'`. |
| 3 | Click card → detalle con back | PASS | `openDetail` → `project-detail` + “Volver a la lista”; list unmounted while detail shown. RTL covers selection + back |
| 4 | + Nuevo proyecto → Modal MD | PASS | `startCreate` + `<Modal size="md">` title “Nuevo proyecto” (L1007–1028) |
| 5 | Editar proyecto en detalle → Modal MD | PASS | `startEditMeta` + Modal MD “Editar proyecto” |
| 6 | + Agregar mueble → Modal MD módulo/qty/opciones | PASS | Modal MD “Agregar mueble” with module select, qty, option selects; `AddItemDraft.optionChoices` |
| 7 | Panel de totales en detalle (dominio vía props) | PASS | Sticky `project-totals--sticky`; `breakdown` props only; shell `projectEstimates` for cards |
| 8 | Export prominente; disabled + mensaje si validación | PASS | Primary Optimizer + secondary hardware; `exportDisabled` / `exportBlockMessage` / `ExportIssueList`. RTL blocked case |
| 9 | EmptyState sin proyectos | PASS | `EmptyState` icon `FileText`, title “No hay proyectos”, CTA “Nuevo proyecto” |
| 10 | Tests projectHelpers verdes | PASS (runtime) | `projectHelpers.test.ts` 17 green under vitest; **typecheck of same files fails** on `clientName` |

## Design spot-check (§4.2 / §4.3 MD / §5.2 / §5.3)

| Spec | Result | Notes |
|------|--------|-------|
| Cards for Proyectos (§5.3) | PASS | Card grid, not table |
| Lista → detalle → Editar modal (§4.2) | PASS | card → detail → Modal MD meta / add-item |
| Modal MD for project metadata (§4.3) | PASS | `size="md"` create/edit + add-item |
| Status badges (§5.2) | PASS | `badge-draft` / `quoted` / `accepted` + CSS tokens |
| EmptyState (§4.5) | PASS | FileText + title + CTA |
| Tokens / Lucide / reduced-motion | PASS | card CSS uses design tokens; Lucide `strokeWidth={1.5}`; `@media (prefers-reduced-motion: reduce)` on `.project-card` |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS for F022 touch set — no cost formulas moved into UI |
| UI no cost formulas / no fs / no xlsx | PASS — presentation + pure helpers; estimates from shell |
| Controlled shell contract | PASS intent — `projectEstimates` / `breakdown` from `apps/web` |
| Type-safe use of domain `Project` | **FAIL** — UI/web still on `clientName`; domain on `customerId` |

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system en card/detail (no hardcoded palette)
- D2: [x] Patrón cards + list→detail→edit modal (§4.2 / §5.3)
- D3: [x] Modal MD con Modal F018 (focus trap / Esc / backdrop inherited)
- D4: [x] Toasts N/A for this feature (App toast wiring from F019 untouched)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Card transitions respetan `prefers-reduced-motion`

## Checkpoints

- C1: [x] Harness files present; `./init.sh` exit 0 (tests monorepo green at review re-run)
- C2: [x] Una sola `in_progress` (F022); session documented
- C3: [ ] **Type/contract boundary broken** — `Project.clientName` used in UI/web while domain exports `customerId` (+ optional `Customer` catalog). PRD §7.1 still documents `clientName`; domain fixtures already migrated to `customerId`
- C4: [x] `pnpm --filter @muebles/domain test` 60/60 at final check; excel 14, storage 17, ui 136, web 37, desktop 7 green via `./init.sh`
- C5: [ ] Not closed — feature remains `in_progress` until re-review APPROVED

## Verification

| Level | Result |
|-------|--------|
| `./init.sh` / vitest monorepo | PASS (all packages) |
| `pnpm --filter @muebles/ui typecheck` | **FAIL** (~23 errors; F022 sources among them) |
| `pnpm --filter @muebles/web typecheck` | **FAIL** (~22 errors; App + F022 paths) |
| `pnpm --filter @muebles/domain typecheck` | FAIL residual (fixture drift elsewhere; not F022-owned) |
| `pnpm --filter @muebles/storage typecheck` | FAIL (`clientName` in workspace tests) |

Handoff claimed ui/web typecheck ok — **not true against current domain types**.

## Cambios requeridos (blocking)

1. **Alinear el campo cliente del `Project` end-to-end** (elegir una línea y cerrarla; no dejar ambas a medias):
   - **Preferida (PRD §7.1):** restaurar `clientName: string` en `packages/domain` `Project` y actualizar fixtures/duplicate que hoy usan solo `customerId`, **o**
   - **Si el modelo es `customerId`:** adaptar F022 + shell para resolver nombre de cliente (prop `customers` / lookup) y dejar de leer `project.clientName` en cards, detail, draft, search filter y App create/update.
2. **`pnpm --filter @muebles/ui typecheck` y `pnpm --filter @muebles/web typecheck` verdes** (mínimo; ideal monorepo typecheck).
3. **Criterio de aceptación #2 verificable con datos seed reales:** la card del proyecto plantilla debe mostrar un **nombre de cliente no vacío** (no `undefined` / string vacío).
4. Re-run `./init.sh` + typecheck; re-submit for review. **No marcar `done`** hasta APPROVED.

## Residual notes (non-blocking once contract fixed)

1. Feature refs cite `docs/design.md §6.2`; design.md has no §6.2 subsection — implementation correctly follows §4.2 / §4.3 MD / §5.2 / §5.3 (same pattern as F021/§6.3).
2. Some pre-existing raw rem in older project editor CSS; F022 card/detail blocks mostly tokenized.
3. CTA copy is “Nuevo proyecto” with Plus icon (not literal “+ Nuevo proyecto”) — matches intent.
4. Item qty/options edit inline in detail (add via Modal MD) — within scope per handoff.
5. Concurrent domain model churn (`customerId`, `MaterialBoard.widthMm/lengthMm/boardPrice`) is incomplete across packages; must not ship F022 on top of a split brain.

## Closeout

**Not closed.** `feature_list.json` F022 stays `in_progress`. No F023 work.
