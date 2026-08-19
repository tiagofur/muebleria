# Closeout — F013 hardware_list_export

**Date:** 2026-07-15  
**Status:** closed (`done`)

F013 (export lista de herrajes: `generateHardwareList` agrega qty línea × qty ítem por `hardwareId` sin piezas de tablero; XLSX hoja `Herrajes` + CSV opcional con Código/Descripción/Unidad/Cantidad/Costo unit./Costo total; web pipeline `buildHardwareListExport` con el mismo gate de integridad que Optimizer; UI botón **Lista de herrajes**) was self-verified green (domain 52/52, excel 14/14, ui 55/55, web 30/30, storage 17, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F013.md` (acceptance EXP-08 + purchase-usable format + C1–C4 pass; no required changes; residual notes non-blocking — desktop does not wire `onExportHardware`, UI download XLSX only, `collectExportIssues` shared with Optimizer, live catalog costs not snapshot, no RTL click test), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F014 (`waste_percent`, phase 3) still pending and not started.

## Key artifacts
- Domain: `HardwarePurchaseRow`, `generateHardwareList(project, catalog)`
- Excel: `hardwareListExport`, `hardwareListExportCsv`, `HARDWARE_LIST_HEADERS`
- Web: `exportHardwareList.ts` (`buildHardwareListExport`, `downloadHardwareListXlsx`); `App.handleExportHardwareList`
- UI: `ProjectsScreen` `onExportHardware` + button next to Optimizer export
- Handoff / review: `progress/impl_F013.md`, `progress/review_F013.md`

## Next
- F014 — waste_percent (pending; not started)
