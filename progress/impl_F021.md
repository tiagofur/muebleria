# Handoff — F021 ui_modules_cards_detail

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F021 — UI Muebles: cards + vista detalle + modal editor

## Summary

Redesigned `ModulesScreen` from side-by-side table + permanent form into **card grid → read-only detail → Modal LG editor** (design.md §4.2 / §4.3 LG / §5.3 cards). Domain cost formulas remain in the shell; UI only presents `costPreview` + new `moduleEstimates` props.

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Module list uses cards, not table | No `CatalogTable`; `module-card-grid` + `.module-card` buttons |
| 2 | Card shows code mono, name, board parts, hardware, estimated cost | Card UI + `moduleEstimates` sale prices from shell |
| 3 | Click card → read-only detail (parts + hardware) | `module-detail` view; no editor inputs |
| 4 | Edit in detail → Modal LG full editor | `Modal size="lg"` title “Editar mueble” |
| 5 | + Nuevo mueble → Modal LG empty form | Header / EmptyState CTA → `size="lg"` “Nuevo mueble” |
| 6 | Cost preview via domain in shell (props) | `App.tsx` `computeModuleCostPreview` + `moduleEstimates` map; UI never calculates |
| 7 | EmptyState when no modules | `EmptyState` icon `Package`, CTA “Nuevo mueble” |

## Controlled API

```ts
ModulesScreenProps {
  modules, optionGroups, hardware
  onCreate / onUpdate / onDelete / onDuplicate?
  onEditingChange?(moduleId | null)  // detail selection or edit target
  costPreview?, previewBlocked?, missingGroups?, groupLabels?
  moduleEstimates?: Record<moduleId, salePrice | null>  // NEW (F021)
}
```

- `onEditingChange`: detail selection when modal closed; edit id when modal open; `null` on list / create.
- `moduleEstimates`: shell map of sale prices (or `null` if blocked) for card footer.

## UX extras (within scope)

- Search (`SearchInput`, debounce 150ms) over code + name
- Detail: back, duplicate, delete, full cost preview panel
- Lucide: Package, Plus, Pencil, Copy, Trash2, ChevronLeft, Layers, Settings2

## Files touched

### New
- `packages/ui/src/modules/ModulesScreen.test.tsx` — 7 component tests
- `progress/impl_F021.md` — this handoff

### Modified
- `packages/ui/src/modules/ModulesScreen.tsx` — cards + detail + Modal LG
- `packages/ui/src/modules/modules.css` — card grid + detail styles (tokens only)
- `packages/ui/src/modules/moduleHelpers.ts` — `filterModulesByQuery`, `formatModuleMoney`
- `packages/ui/src/modules/moduleHelpers.test.ts` — helper tests
- `packages/ui/src/modules/index.ts` / `packages/ui/src/index.ts` — exports
- `packages/ui/src/index.test.ts` — F021 surface
- `apps/web/src/App.tsx` — `moduleEstimates` from domain previews
- `feature_list.json` — F021 → `in_progress`
- `progress/current.md` — session state

### Not modified
- `packages/domain/**` (no cost logic moved into UI)

## Verification run

```text
pnpm test → all green
  domain 60 · excel 14 · storage 17 · ui 122 · web 37 · desktop 7
pnpm --filter @muebles/ui typecheck → ok
pnpm --filter @muebles/web typecheck → ok
```

## Reviewer focus

1. Lista es cards (no tabla); click → detalle read-only.
2. Modal siempre `size="lg"` para create/edit.
3. Costo estimado en cards solo desde `moduleEstimates` (shell).
4. Tokens CSS / Lucide / EmptyState alineados a design.md.
5. No marcar `done` hasta APPROVED.
