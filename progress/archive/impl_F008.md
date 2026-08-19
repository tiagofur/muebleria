# Handoff — F008 ui_module_editor

**Status:** implemented, tests green, **not marked done** (awaiting reviewer)  
**Date:** 2026-07-15

## Acceptance map

| Criterion | Evidence |
|-----------|----------|
| CRUD de módulos (MOD-01 a MOD-04) | `ModulesScreen` — create/update/delete; code, name, notes, external dims, baseLaborCost; board parts (qty, L, A, grain, L1/L2/W1/W2, optionRole); hardware lines (qty, role or fixed hardwareId, descriptionOverride). Wired in `apps/web` App state. |
| Picker optionRole solo grupos disponibles | `optionGroupsForBoardParts` (kind board\|edge) + `optionGroupsForHardware` (kind hardware). Selects in editor only list those groups. Tests in `moduleHelpers.test.ts` + `App.test.ts`. |
| Preview de costo con motor de dominio (MOD-06) | Shell builds single-item project with `defaultOptionChoicesForModule` + `canShowPricePreview` + `calcProjectBreakdown`; passes `costPreview` / `previewBlocked` / `missingGroups` as props. UI does **not** calculate. |
| MOD-GAB-01 y MOD-CAJ-01 seed con roles (MOD-07) | Already in `createSeedWorkspace` / plantilla fixtures. Asserted via `SEED_MODULE_CODES` + App test (INTERIOR/FRENTE/BISAGRA; CORREDERA on CAJ). |

## Files touched

### New
- `packages/ui/src/modules/moduleHelpers.ts`
- `packages/ui/src/modules/moduleHelpers.test.ts`
- `packages/ui/src/modules/ModulesScreen.tsx`
- `packages/ui/src/modules/modules.css`
- `packages/ui/src/modules/index.ts`
- `progress/impl_F008.md`

### Updated
- `packages/ui/src/index.ts` — re-exports F008 surface
- `packages/ui/src/index.test.ts`
- `apps/web/src/App.tsx` — tab «Muebles» + domain cost preview wiring
- `apps/web/src/App.test.ts` — MOD-06/07 + optionRole picker tests
- `feature_list.json` — F008 `in_progress`
- `progress/current.md`

## Architecture notes

- UI package: **no cost formulas** — only displays `QuoteBreakdown` props from shell.
- Shell (`apps/web`) maps `ModuleDraft` → `Module`, owns modules array (controlled).
- Hardware line modes: `role` (optionRole from hardware groups) or `fixed` (catalog hardwareId, optionRole `FIXED`).
- Module soft-delete not required; hard delete via `onDelete` (same as option groups).
- MOD-05 duplicate intentionally **out of scope** (F015).

## Verify

```bash
./init.sh
# or
pnpm test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web typecheck
```

## Web run command

```bash
pnpm --filter @muebles/web dev
```

Open the app → tab **Muebles**:
1. List shows seed **MOD-GAB-01** and **MOD-CAJ-01**.
2. Edit MOD-GAB-01 → board part optionRole picker shows INTERIOR/FRENTE (board groups); hardware role picker shows BISAGRA/CORREDERA.
3. Cost preview panel shows domain sale price with default option choices (first member of each required group).
4. Nuevo mueble → add pieces/hardware → Guardar → appears in list.

## Out of scope (intentionally)

- Module duplicate (F015 / MOD-05)
- Full quotation CRUD (F009)
- Export Optimizer UI (F010)

## Reviewer checklist hints

- [ ] Controlled props: parent owns `modules`
- [ ] Spanish labels / English identifiers
- [ ] UI does not implement m² / margin / sale formulas
- [ ] optionRole pickers filtered by available groups
- [ ] Seed modules present with correct roles
- [ ] Do not mark `done` until review APPROVED
