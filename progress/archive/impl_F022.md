# Handoff — F022 ui_projects_cards_detail

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F022 — UI Cotizaciones: cards ricas + detalle + modales MD

## Summary

Redesigned `ProjectsScreen` from table list + full-page create/edit form into **card grid → quotation detail (back) → Modal MD** for project metadata and add-item (design.md §4.2 / §4.3 MD / §5.2 badges / §5.3 cards). Domain cost formulas remain in the shell; UI only presents `breakdown` + new `projectEstimates` props.

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Project list uses cards, not table | No `CatalogTable`; `project-card-grid` + `.project-card` buttons |
| 2 | Card: name, client, status badge, item count, total price, updated date | Card UI + `StatusBadge` + `projectEstimates` |
| 3 | Click card → full detail with back | `project-detail` + “Volver a la lista”; list unmounted while detail shown |
| 4 | + Nuevo proyecto → Modal MD metadata | `Modal size="md"` title “Nuevo proyecto” |
| 5 | Editar proyecto in detail → Modal MD | `Modal size="md"` title “Editar proyecto” |
| 6 | + Agregar mueble → Modal MD module/qty/options | `Modal size="md"` with picker + option selects |
| 7 | Totals panel prominent (domain via props) | Sticky aside `project-totals--sticky`; sale price hero |
| 8 | Export prominent; disabled + message on validation | Primary Optimizer + secondary hardware; disabled when `previewBlocked`/`exportBlocked`; message + `ExportIssueList` |
| 9 | EmptyState no projects | `EmptyState` icon `FileText`, CTA “Nuevo proyecto” |
| 10 | projectHelpers tests green | 17 helper tests + 9 component tests |

## Controlled API

```ts
ProjectsScreenProps {
  projects, modules, optionGroups, materials, edges, hardware
  onCreate / onUpdate / onDelete / onDuplicate?
  onAddItem / onUpdateItem / onRemoveItem
  onSelectionChange?(projectId | null)  // detail selection (list → null)
  breakdown?, previewBlocked?, missingGroups?, groupLabels?
  onExport?, onExportHardware?, exportErrors?, exportBusy?, exportBlocked?
  projectEstimates?: Record<projectId, salePrice | null>  // NEW (F022)
}
```

- `onSelectionChange`: fires with detail `selectedId` or `null` on list (shell breakdown target).
- `projectEstimates`: shell map of sale prices (or `null` if blocked) for card footer; prefers `priceSnapshot` when present.
- `AddItemDraft` now includes `optionChoices` (modal-driven).

## UX extras (within scope)

- Search (`SearchInput`, debounce 150ms) over name + client
- Inline confirm for delete project / remove item
- Colored status badges: draft / quoted / accepted (design §5.2)
- Lucide: FileText, Package, Plus, Pencil, Copy, Trash2, ChevronLeft

## Files touched

### New
- `packages/ui/src/projects/ProjectsScreen.test.tsx` — 9 component tests
- `progress/impl_F022.md` — this handoff

### Modified
- `packages/ui/src/projects/ProjectsScreen.tsx` — cards + detail + Modal MD
- `packages/ui/src/projects/projects.css` — card grid, badges, sticky totals (tokens only)
- `packages/ui/src/projects/projectHelpers.ts` — filter/money/badge + AddItemDraft.optionChoices
- `packages/ui/src/projects/projectHelpers.test.ts` — helper tests
- `packages/ui/src/projects/index.ts` / `packages/ui/src/index.ts` — exports
- `packages/ui/src/index.test.ts` — F022 surface
- `apps/web/src/App.tsx` — `projectEstimates` from domain breakdown / snapshot
- `feature_list.json` — F022 → `in_progress`
- `progress/current.md` — session state

### Not modified
- `packages/domain/**` (no cost logic moved into UI)

## Verification run

```text
pnpm --filter @muebles/ui test → 136 green (incl. projectHelpers 17 + ProjectsScreen 9)
pnpm --filter @muebles/ui typecheck → ok
pnpm --filter @muebles/web typecheck → ok
pnpm --filter @muebles/web test → 37 green
pnpm test → monorepo green (see final run)
```

## Reviewer focus

1. Lista es cards (no tabla); click → detalle con back (no form permanente).
2. Modales siempre `size="md"` para create/edit meta y add-item.
3. Precio en cards solo desde `projectEstimates` (shell); totales desde `breakdown`.
4. Status badges con clases §5.2; tokens CSS / Lucide / EmptyState.
5. Export disabled + mensaje cuando preview bloqueado / exportBlocked.
6. **No marcar `done`** hasta APPROVED.

## Note on design.md §6.2

Feature references `docs/design.md §6.2`; that subsection does not exist as a screen map (same as F021/§6.3). Implementation follows §4.2 list→detail, §4.3 Modal MD, §5.2 badges, §5.3 cards.
