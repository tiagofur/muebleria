# Judgment Day — WIP 3D / espacial (2026-07-17)

**Contexto histórico:** revisión del branch `feat/presets-measure-100` (modelo paralelo de `Component` + `spatialPlacement` + preview3d propio).

## Estado tras rebase en main (2026-07-17)

`main` ya incorporó arquitectura **diferente y canónica** para el mismo problema de producto:

| En el branch (obsoleto) | En `main` (fuente de verdad) |
|-------------------------|------------------------------|
| `spatialPlacement.ts` + `Component.xFormula` | `spatial.ts` + `originX/Y/ZFormula` en piezas / slots |
| `packages/ui/src/preview3d/*` (corrida cotización) | `packages/ui/src/modules/preview3d/Module3DPreview.tsx` |
| Issues #125–#130 abiertos sobre el branch | Parcialmente **superseded** por #107 / #124 y PRs #117–#123 |

**Este documento se conserva** como bitácora del juicio y mapa a issues.  
**No reintroducir** el stack del branch encima de `spatial.ts` / `Module3DPreview` sin SDD.

## Round 1 (histórico) — resumen

| Bucket | Count |
|--------|------:|
| CRITICAL confirmed | 3 |
| WARNING (real) confirmed | 8 |

### CRITICAL (histórico)

| ID | Issue | Nota post-main |
|----|-------|----------------|
| JD-C1 | #125 | Re-evaluar contra mappers de `origin_*` / furniture components en main |
| JD-C2 | #126 | Re-evaluar motor Go vs fórmulas de assembly en main |
| JD-C3 | #127 | Cotización 3D multi-módulo sigue siendo gap de producto (#133) |

### WARNING (histórico)

#128–#130 apuntaban a poses, mesh, color de material y fallback CSS del **stack del branch**. En main el viewer de módulo usa `roleColors` y assembly resuelto; no copiar fixes del branch a ciegas.

## Round 2 / resolución de conflictos PR #143

La rama se **rebaseó sobre `main`**: se descartó el código conflictivo del branch (duplicaba #117–#124) y se mantuvo el valor de producto en **docs** (`app-excellence.md`, este informe, PRD §6.7).

### Acciones recomendadas sobre issues #125–#130

1. **Cerrar o reescribir** cada issue tras auditoría en `main` (¿sigue el bug en la arquitectura canónica?).  
2. Si el bug no existe en main → cerrar como *superseded by #124 / #120*.  
3. Si existe en forma nueva → editar el cuerpo del issue con paths actuales.

## Referencias

- PR espacial + 3D módulo: https://github.com/tiagofur/muebleria/pull/124  
- Plan App Excellence: `docs/app-excellence.md` · META [#132](https://github.com/tiagofur/muebleria/issues/132)  
- Layout cocina: [#133](https://github.com/tiagofur/muebleria/issues/133)
