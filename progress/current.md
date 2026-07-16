# Sesión actual

- **Branch:** `feat/desktop-electron-38`
- **Issue:** [#38](https://github.com/tiagofur/muebleria/issues/38) — Desktop Electron host (F032)
- **Estado:** in_progress

## También hoy
- #34 responsive → PR #77 (`feat/ux-responsive-34`)
- Etapa 3 multi-usuario pausada; PR #76 ownership abierto aparte

## Hecho F032
- `electron/main.mjs` + `preload.cjs` (BrowserWindow, IPC save/write)
- `pnpm --filter @muebles/desktop dev:app` espera Vite y lanza Electron
- Web `deliverExcelFile` usa `window.electronAPI` (dialog nativo) o download browser
- docs/verification.md Nivel 6 + README

## Smoke
```
pnpm --filter @muebles/web dev
pnpm --filter @muebles/desktop dev:app
```
