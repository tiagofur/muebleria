# Handoff F010 — ui_export

**Status:** implementado, tests verdes — **pendiente de review** (no marcado `done`).

## Qué se hizo

Pipeline de export Optimizer desde la UI de cotización:

1. **Validación** `collectExportIssues(project, catalog)` (domain) — lista accionable VAL-01..07 / opciones / VAL-05.
2. **Cut list** `generateCutRows` → **XLSX** `optimizerExport` (excel, sin herrajes EXP-05).
3. **Web (EXP-07):** download browser via Blob + `<a download>`.
4. **Desktop (EXP-06):** `ElectronAPI.showSaveDialog` + `writeExcelFile` + adapter testeado con mocks.

## Archivos clave

| Área | Path |
|------|------|
| Domain issues | `packages/domain/src/exportIssues.ts` (+ test) |
| UI botón + lista | `packages/ui/src/projects/ProjectsScreen.tsx`, `ExportIssueList.tsx` |
| Web pipeline | `apps/web/src/exportOptimizer.ts`, wiring en `App.tsx` |
| Desktop IPC/API | `apps/desktop/src/electronApi.ts`, `ipcHandlers.ts`, `exportAdapter.ts`, `preload.ts` |

## Cómo probar export web

```bash
cd /Users/tiagofur/dev/carpinteria/muebles
pnpm --filter @muebles/web dev
```

1. Abrir la app en el browser (Vite).
2. Ir a **Proyectos**.
3. Crear o editar un proyecto; agregar ítem **MOD-GAB-01** (la semilla trae defaults de opciones al agregar).
4. Completar opciones requeridas si el picker las pide.
5. Clic **Exportar Optimizer** → descarga `optimizer-{nombre}.xlsx`.
6. Probar bloqueo: vaciar opciones de un ítem y exportar → lista roja con módulo / pieza / campo / opción.

Tests sin UI:

```bash
pnpm --filter @muebles/web test
# buildOptimizerExport + downloadOptimizerXlsx mock
```

Smoke XLSX:

```bash
node packages/excel/src/__fixtures__/smokeExport.mjs
# → /tmp/optimizer_smoke.xlsx
```

## Desktop (notas)

- **Código completo y testeado** con deps inyectables (sin instalar el binario Electron en CI).
- Contrato: `ElectronAPI` = `showSaveDialog` + `writeExcelFile` (`docs/technical_design.md` §4).
- Preload: `registerElectronApi(contextBridge, ipcRenderer)` expone `window.electronAPI`.
- Main: `createDesktopExcelApi({ showSaveDialog, writeFile })` — al empaquetar:

```ts
import { dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { createDesktopExcelApi } from '@muebles/desktop';

const excelApi = createDesktopExcelApi({
  showSaveDialog: (opts) => dialog.showSaveDialog(opts),
  writeFile: (path, data) => fs.writeFile(path, data),
});
// ipcMain.handle('excel:showSaveDialog', …)
// ipcMain.handle('excel:writeExcelFile', …)
```

- Adapter renderer: `exportOptimizerDesktop(bytes, defaultPath, api)`.
- Tests: `pnpm --filter @muebles/desktop test` (mocks de diálogo/write).
- **No** hay BrowserWindow/e2e Electron en este slice; el path de diálogo+write está unit-testeado.

## Acceptance

| Criterio | Evidencia |
|----------|-----------|
| Export web (download) | `buildOptimizerExport` + `downloadOptimizerXlsx` + App `onExport` |
| Export desktop (dialog) | `exportOptimizerDesktop` + `createExcelIpcHandlers` tests |
| Lista accionable si falla validación | `ExportIssueList` + `collectExportIssues` (module/part/field) |
| Bloqueo opciones / VAL-05 / VAL-06 | domain + web tests |
| EXP-05 sin herrajes | sin cambios; `generateCutRows` / excel tests existentes |

## Verificación

```bash
./init.sh   # OK
pnpm test   # domain 38, ui 55, excel 7, storage 9, web 23, desktop 7
```

## Fuera de scope (intencional)

- No marcar F010 `done` (reviewer).
- No F011 seed rework / F012 snapshot.
- No empaquetado Electron completo (window/main lifecycle).
