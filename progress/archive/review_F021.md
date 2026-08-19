# Review — feature F021

**Veredicto:** APPROVED  
**Feature:** F021 — ui_modules_cards_detail  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F021.md`  
**Design:** `docs/design.md` §4.2 / §4.3 LG / §5.3 cards (+ EmptyState §4.5)

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Lista de módulos usa cards, no tabla | PASS | No `CatalogTable`; `module-card-grid` + `.module-card` buttons (`ModulesScreen.tsx` L1023–1055). Source guard in `ModulesScreen.test.tsx` |
| 2 | Card: código mono, nombre, nº piezas, nº herrajes, costo estimado | PASS | Code `module-card__code` + `var(--font-mono)`; name; Layers/Settings2 stats; `moduleEstimates` via `estimateLabel` + `formatModuleMoney`. RTL: card mod-1 shows 2 piezas / 1 herraje / 202.50; mod-2 “Sin estimado” |
| 3 | Click card → detalle read-only (piezas + herrajes) | PASS | `openDetail` → `module-detail`; board/hardware sections; no description inputs. Test “opens read-only detail from a card click” |
| 4 | Editar en detalle → Modal LG editor completo | PASS | `startEdit` + `<Modal size="lg">` title “Editar mueble”; dialog class `ui-modal--lg`. Test “opens Modal LG editor from detail Editar” |
| 5 | + Nuevo mueble → Modal LG form vacío | PASS | Header CTA + EmptyState `startCreate` → Modal LG “Nuevo mueble”, code/name empty. Plus icon + label “Nuevo mueble” |
| 6 | Preview de costo vía motor de dominio en shell | PASS | `App.tsx` `computeModuleCostPreview` + `moduleEstimates` map (`salePrice`); UI only formats/displays props. No cost formulas in `packages/ui` |
| 7 | EmptyState cuando no hay módulos | PASS | `EmptyState` icon `Package`, title “No hay módulos”, CTA “Nuevo mueble”. Test empty modules |

### Design spot-check (§4.2 / §4.3 LG / §5.3)

| Spec | Result | Notes |
|------|--------|-------|
| Cards for Muebles (§5.3) | PASS | Card grid, not table |
| Lista → detalle read-only → Editar modal (§4.2) | PASS | card → detail → Modal LG |
| Modal LG for complex module editor (§4.3) | PASS | `size="lg"` create/edit |
| EmptyState icon + title + CTA (§4.5) | PASS | Package + Nuevo mueble |
| Search + debounce 150ms | PASS | `SearchInput` + `useDebouncedValue`; helper `filterModulesByQuery` |
| Tokens on new card/detail CSS | PASS | surfaces/borders/text/shadow/space/radius/duration/ease vars on F021 blocks |
| Lucide `strokeWidth={1.5}` | PASS | Package, Plus, Pencil, Copy, Trash2, ChevronLeft, Layers, Settings2 |
| Card transitions + reduced-motion | PASS | `.module-card` transitions; `@media (prefers-reduced-motion: reduce)` disables |
| Focus-visible | PASS | `box-shadow: var(--shadow-focus)` |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS — no domain package changes |
| UI no cost formulas / no fs / no xlsx | PASS — presentation + pure helpers only (`formatModuleMoney` = toFixed) |
| Controlled shell contract | PASS — create/update/delete/duplicate + `moduleEstimates` / `costPreview` from shell |
| No debug `console.log` | PASS in F021 sources |

## Conventions

- PascalCase screen + camelCase helpers — PASS  
- Colocated `modules.css` + RTL component tests — PASS  
- Exported helpers `filterModulesByQuery` / `formatModuleMoney` — PASS  
- Spanish UI strings; English identifiers — PASS  
- Domain estimates stay in `apps/web` shell — PASS  

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system en card/detail (no hardcoded palette)
- D2: [x] Patrón cards + list→detail→edit modal (§4.2 / §5.3)
- D3: [x] Modal LG con Modal F018 (focus trap / Esc / backdrop inherited)
- D4: [x] Toasts N/A for this feature (App toast wiring from F019 untouched)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Card transitions respetan `prefers-reduced-motion`

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Una sola `in_progress` (F021) at review time; session documented; post-close → done + idle → F022
- C3: [x] Boundaries respetados
- C4: [x] Tests monorepo verdes (domain 60, excel 14, storage 17, ui 122, web 37, desktop 7)
- C5: [x] Closeout: `history.md` entry, `feature_list` F021=`done`, `current.md` idle → F022, `close_F021.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. Feature refs cite `docs/design.md §6.3`; design.md has no §6.3 subsection — implementation correctly follows §4.2 / §4.3 LG / §5.3 cards.
2. Older module editor CSS still uses some raw rem spacing (pre-F021 pattern); F021 card/detail blocks use tokens for colors/shadows/radius/type.
3. One inline `style={{ marginTop: '0.65rem' }}` on notes field in editor form — cosmetic.
4. `moduleEstimates` recomputes domain preview for every module when catalog changes — correct boundary; acceptable for current catalog size.
5. CTA copy is “Nuevo mueble” with Plus icon (not literal “+ Nuevo mueble” string) — matches acceptance intent.

## Verification

| Level | Result |
|-------|--------|
| Nivel 2 ui | PASS — 122/122 (incl. 7 ModulesScreen + helpers filter/format) |
| Nivel 2 web | PASS — 37/37 |
| Nivel 1 domain / excel / storage / desktop | PASS — 60 / 14 / 17 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, storage 17, ui 122, web 37, desktop 7
```

## Verdict rationale

All seven acceptance criteria pass against source, design §4.2/§4.3 LG/§5.3, architecture boundaries (domain cost only in shell), and green monorepo tests. Modules list is cards → read-only detail → Modal LG editor with EmptyState and shell-driven estimates. No required changes.
