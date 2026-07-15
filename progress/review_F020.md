# Review — feature F020

**Veredicto:** APPROVED  
**Feature:** F020 — ui_catalogs_modal_list  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F020.md`  
**Design:** `docs/design.md` §4.2 / §4.5 / §4.6 / §5.3 (+ §4.3 Modal SM)

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Ningún catálogo muestra form inline permanente al lado de la tabla | PASS | Materials / Edges / Hardware / OptionGroups: form only inside `<Modal size="sm">`. `.catalog-layout` is single-column flex (`catalogs.css`); CSS guard rejects permanent side-form grid |
| 2 | SearchInput filtra en tiempo real con debounce 150ms | PASS | `SEARCH_DEBOUNCE_MS = 150`; catalogs use `useDebouncedValue(search)` → `filterCatalogItems(..., { query })`; SearchInput + debounce tests in `catalogListPrimitives.test.tsx` |
| 3 | Chips Todos/Activos/Inactivos reemplazan checkbox “mostrar inactivos” | PASS | `StatusChips` on Materials/Edges/Hardware; sources `not.toMatch(/Mostrar inactivos/)`; OptionGroups: search only (no `active` field) — correct |
| 4 | Crear material/canto/herraje/grupo abre modal SM | PASS | `startCreate` → `modalOpen` + empty draft; all four screens `size="sm"` |
| 5 | Editar abre modal SM precargado | PASS | `startEdit` → draft from entity; titles “Editar material/canto/herraje/grupo” |
| 6 | EmptyState con Lucide + CTA cuando no hay ítems | PASS | `EmptyState` icon 48px `strokeWidth={1.5}`; Layers / Edges / Hardware / ToggleLeft + CTA → `startCreate` |
| 7 | Hover en row revela botones de acción (sin columna permanente visible) | PASS | `.catalog-table__actions { opacity: 0 }` + reveal on `:hover` / `:focus-within` / expanded; header “Acciones” visually-hidden; touch `(hover: none)` always shows |
| 8 | Tests existentes de helpers siguen verdes | PASS | `catalogHelpers.test.ts` 16 (status/query + legacy `showInactive`); monorepo green |

### Design spot-check (§4.2 / §4.5 / §4.6 / §5.3)

| Spec | Result | Notes |
|------|--------|-------|
| Lista → click row → detalle read-only → Editar modal | PASS | `onRowClick` expands detail; Edit opens Modal SM |
| EmptyState icon + title + CTA | PASS | §4.5 structure |
| SearchInput placeholders específicos | PASS | “Buscar materiales…”, cantos, herrajes, grupos |
| Status chips Todos/Activos/Inactivos | PASS | default filter `active` |
| Debounce 150ms | PASS | constant + hook tests |
| Tabla para catálogos densos (§5.3) | PASS | CatalogTable retained |
| Modal SM for catalog CRUD (§4.3) | PASS | `size="sm"` + sticky footer Cancelar/Guardar |
| Validation errors inline (not toast) | PASS | `catalog-form__error` in modal body |
| Tokens only on new primitives CSS | PASS | searchInput / statusChips / emptyState use vars only |
| Lucide `strokeWidth={1.5}` | PASS | Search, X, Plus, Pencil, Eye/EyeOff, Trash2, empty icons |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS — no domain package changes |
| UI no cost formulas / no fs / no xlsx | PASS — presentation + pure helpers only (`costPerM2` is form field display, not engine) |
| Controlled shell contract | PASS — App.tsx props unchanged (create/update/deactivate/reactivate/delete still shell-owned) |
| No debug `console.log` | PASS in F020 sources |

## Conventions

- Shared primitives under `packages/ui/src/common/` with colocated CSS + RTL/jsdom tests — PASS  
- Exported from `@muebles/ui` (`SearchInput`, `StatusChips`, `EmptyState`, `useDebouncedValue`, `SEARCH_DEBOUNCE_MS`) — PASS (`index.ts` + export surface test)  
- Helpers extended with status/query while preserving legacy `showInactive` — PASS  
- Spanish UI strings; English identifiers — PASS  

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system en primitivas nuevas (no hardcoded palette)
- D2: [x] Patrón lista → detalle → editar modal (§4.2); tabla para catálogos (§5.3)
- D3: [x] Modales SM con Modal F018 (focus trap / Esc / backdrop inherited)
- D4: [x] Toasts N/A for this feature (validation stays inline; App toast wiring from F019 untouched)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Row action opacity uses `--transition-opacity`; modal/toast reduced-motion already F018/F019

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Una sola `in_progress` (F020) at review time; session documented; post-close → done + idle → F021
- C3: [x] Boundaries respetados
- C4: [x] Tests monorepo verdes (domain 60, excel 14, storage 17, ui 112, web 37, desktop 7)
- C5: [x] Closeout: `history.md` entry, `feature_list` F020=`done`, `current.md` idle → F021, `close_F020.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. Actions still occupy a table column cell for layout, but chrome is visually-hidden and actions opacity-0 until hover/focus/expand — matches acceptance intent (“revela en hover”, no permanent visible actions column).
2. Option groups correctly omit StatusChips (no `active` on OptionGroup).
3. Pre-existing `.btn--danger { border-color: hsl(0 55% 85%); }` in `catalogs.css` (F016 residual); not introduced as new palette drift in F020 primitives.
4. Catalogs debounce via `useDebouncedValue` on parent state rather than SearchInput’s `onDebouncedChange` — same 150ms contract.
5. No full-screen RTL suite per catalog screen; coverage is helpers + primitives + CSS/source guards + monorepo green — acceptable for this refactor scope.

## Verification

| Level | Result |
|-------|--------|
| Nivel 2 ui | PASS — 112/112 (incl. 11 catalog list primitives + 16 helpers) |
| Nivel 2 web | PASS — 37/37 |
| Nivel 1 domain / excel / storage / desktop | PASS — 60 / 14 / 17 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, storage 17, ui 112, web 37, desktop 7
```

## Verdict rationale

All eight acceptance criteria pass against source, design §4.2/§4.5/§4.6/§5.3, architecture boundaries, and green monorepo tests. Shared list primitives + modal SM refactor of four catalog screens is complete. No required changes.
