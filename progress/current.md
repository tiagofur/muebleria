# Sesión actual

- **Branch:** `feat/furniture-components-101-103`
- **Features:** F055 spatial S1 + F056 / #107 Module3DPreview
- **Estado:** in_progress

## Hecho

- S1: resolveAssembly, fórmulas T/i/n, UI espacial, migración 000018
- F056: Module3DPreview (three + R3F) en detalle de mueble
- Shell: `resolveAssembly` → `assemblyPreview` prop

## Verificación

- domain + geometry unit tests
- ui tests (viewer may skip WebGL in jsdom; pure geometry covered)
- typecheck ui/web
