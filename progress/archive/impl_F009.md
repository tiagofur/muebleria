# Handoff — F009 ui_quotation

**Status:** implemented, tests green, **not marked done** (awaiting reviewer)  
**Date:** 2026-07-15

## Acceptance map

| Criterion | Evidence |
|-----------|----------|
| CRUD de proyectos (PRJ-01 a PRJ-03) | `ProjectsScreen` — list create/edit/delete; meta (name, client, currency, margin, labor fija, status, notes, dates). Add module × qty ≥ 1 from catalog. Per-item option pickers for required groups only. Wired in `apps/web` workspace.projects. |
| Picker de opciones solo del grupo (OPT-04, PRJ-03) | `groupsForModuleItem` + `optionsForGroup` (kind members ∩ group.optionIds; empty optionIds → []). Tests in `projectHelpers.test.ts` + `App.test.ts`. |
| Totales en vivo al cambiar opciones (PRJ-06, UX-03) | Shell `computeSelectedProjectBreakdown` → `canShowProjectPricePreview` + `calcProjectBreakdown`; passes `breakdown` / `previewBlocked` / `missingGroups`. Item option changes call `onUpdateItem` immediately. UI displays materials/edge/hardware/direct/labor modular/labor fija/margin/salePrice. |
| Dos ítems mismo mueble, distintas opciones (PRJ-10) | Add item does not block duplicate `moduleId`. Test with two MOD-GAB-01 lines and different INTERIOR choices. |
| Cambio de opción no toca módulo maestro (PRJ-09) | Only `ProjectItem.optionChoices` updated via callbacks; Module never mutated. Asserted in App test. |

## Files touched

### New
- `packages/ui/src/projects/projectHelpers.ts`
- `packages/ui/src/projects/projectHelpers.test.ts`
- `packages/ui/src/projects/ProjectsScreen.tsx`
- `packages/ui/src/projects/projects.css`
- `packages/ui/src/projects/index.ts`
- `progress/impl_F009.md`

### Updated
- `packages/ui/src/index.ts` — re-exports F009 surface
- `packages/ui/src/index.test.ts`
- `apps/web/src/App.tsx` — tab «Proyectos» + domain breakdown wiring + project/item CRUD
- `apps/web/src/App.test.ts` — PRJ/OPT/UX wiring tests
- `feature_list.json` — F009 `in_progress`
- `progress/current.md`

## Architecture notes

- UI package: **no cost formulas** — only displays `QuoteBreakdown` props from shell.
- Shell owns `workspace.projects[]`; controlled callbacks for project and item mutations.
- Seed `projects: []` — create from UI.
- Export Optimizer button is **disabled placeholder** (F010).
- No snapshot freeze (F012).

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

Open the app → tab **Proyectos**:
1. **Nuevo proyecto** → nombre/cliente → Crear proyecto.
2. **Abrir cotización** → Agregar ítem (MOD-GAB-01 × 1) → pickers INTERIOR/FRENTE/BISAGRA.
3. Totales (en vivo) show domain sale price when options complete.
4. Add second line with same module, change INTERIOR → both lines allowed; totals recalculate; module master unchanged.
5. Export button visible but disabled (F010).

## Out of scope (intentionally)

- Full Optimizer export UI (F010)
- Snapshot freeze (F012)
- Persistence to disk from web shell (still in-memory seed)

## Reviewer checklist hints

- [ ] Controlled props: parent owns `projects`
- [ ] Spanish labels / English identifiers
- [ ] UI does not implement m² / margin / sale formulas
- [ ] Option pickers filtered by group optionIds
- [ ] Two items same moduleId with different choices allowed
- [ ] Do not mark `done` until review APPROVED
