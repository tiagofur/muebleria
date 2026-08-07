# Sesión actual — QA de campo #251

- **Issue:** [#251](https://github.com/tiagofur/muebleria/issues/251) QA Proyectar SUPER 3D + módulo Producción
- **Branch:** `fix/qa-251-multi-space-field-bugs`
- **Inicio:** 2026-08-07

## Smoke automatizado

| Suite | Resultado |
|-------|-----------|
| `@muebles/domain` (filtros layout/elev/revision + full filter run) | ✅ 354 |
| `@muebles/ui` productionModuleRows / studio / preview | ✅ 508 (package filter) |
| `web` projectStore | ✅ 222 |
| typecheck ui + web | ✅ |

## Hallazgos (auditoría + fixes)

| Sev | Bug | Fix |
|-----|-----|-----|
| CRITICAL | `updateKitchenLayout` borraba layout multi-ambiente si top-level vacío | `isKitchenLayoutEmpty` mira `spaces[]` |
| CRITICAL | Elevaciones/pack solo muros del espacio activo | flatten all spaces en `buildProductionElevations` |
| HIGH | Fingerprint OP ignoraba islas + cambiaba al switch ambiente | all spaces + free coords; ignora `activeSpaceId` |
| HIGH | Filtro ambiente despiece por `moduleCode` incorrecto | `generateCutRows` / hardware sobre proyecto scoped |
| HIGH | `pieceCount` duplicaba piezas si mismo código en 2 líneas | split proporcional por qty |
| MEDIUM | Proyectar read-only persistía `activeSpaceId` al cambiar ambiente | `viewSpaceId` local |
| MEDIUM | Free-only (solo islas) caía a layout linear | `useKitchen` si hay free placements |

## Manual browser (pendiente ojo humano)

Ver `docs/projectar-smoke-checklist.md` §5 + flujo Producción accepted→hub→pack.

## Siguiente

PR con fixes #251; smoke WebGL manual del usuario.
