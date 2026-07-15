# Handoff F013 — hardware_list_export

**Status:** implemented, tests green — awaiting reviewer  
**Feature:** F013 — Export lista de herrajes (EXP-08)  
**Do not mark `done` without reviewer approval**

## Acceptance

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Lista con qty × ítem de proyecto (EXP-08) | `generateHardwareList` multiplies `hardwareLine.quantity * item.quantity`, aggregates by `hardwareId`; tests GAB×1 known qtys + ×2 / item qty 3 |
| 2 | Formato usable para compras | XLSX columns `Código \| Descripción \| Unidad \| Cantidad \| Costo unit. \| Costo total` + optional CSV; UI button **Lista de herrajes** |

## What changed

### Domain (`packages/domain`)
- `HardwarePurchaseRow` type (`types.ts`)
- `generateHardwareList(project, catalog)` (`engine.ts`):
  - resolveBom per item → hardware lines only
  - qty = line.qty × item.qty; sum by hardwareId
  - lineCost = qty × costPerUnit
  - sort by code then description
  - no board parts; empty → `ValidationError`
- Exports from `index.ts`

### Excel (`packages/excel`)
- `hardwareListExport(rows)` → XLSX sheet `Herrajes`
- `hardwareListExportCsv(rows)` → UTF-8 CSV same columns
- Headers: `HARDWARE_LIST_HEADERS`

### Web shell (`apps/web`)
- `exportHardwareList.ts`: `buildHardwareListExport` (collectExportIssues → generate → xlsx), `downloadHardwareListXlsx`, `hardwareListFileName`
- `App.tsx`: `handleExportHardwareList` + `onExportHardware`

### UI (`packages/ui`)
- `ProjectsScreen`: prop `onExportHardware`; button next to Optimizer export
- CSS: `.project-totals__exports`

## Tests (all green)

- Domain: 6 new `generateHardwareList` cases (+ type shape)
- Excel: 6 hardwareListExport / CSV cases
- Web: `exportHardwareList.test.ts` + App F013 cases
- Full monorepo: `pnpm test` OK (domain 52, excel 14, web 30, …)

## Reviewer notes

- Same export validation as Optimizer (`collectExportIssues`) — project must resolve fully before purchase list
- Desktop does not wire hardware export yet (web only, shared UI prop ready)
- Unit labels in XLSX: Pieza / Juego / Metro (Spanish, matches catalog UI)

## Out of scope (not done)

- F014 waste UI
- F015 duplicate module/project
- Desktop Electron dialog for hardware list
