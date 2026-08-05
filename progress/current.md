# Sesión actual — Muebles: slices 1–5 (auditoría perfecta)

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `wip/jd-w3-lateral-rotation-fix`
- **Inicio:** 2026-08-05

## Slices (auditoría muebles) — TODOS ✅

| # | Slice | Estado |
|---|--------|--------|
| 1 | Chrome híbrido (Agregar + BoardEditor) | ✅ |
| 2 | BoardEditor draft-aware | ✅ |
| 3 | Structure overrides JSONB persist | ✅ |
| 4 | Inspector 3D click/lista | ✅ |
| 5 | UI overrides por instancia | ✅ |

### Slice 5 — detalle
- `InstanceOverridesEditor`: disclosure “Avanzado: fórmulas y rotación”
- Integrado en **módulo** y **estructura** (lista de instancias)
- Helpers: `patchInstanceOverrides`, `cleanInstanceOverrides`, summary
- `moduleCompositionKey` incluye fórmulas del **draft** (no boardOverrides)
- `BoardEditor` recibe `compositionKey` separado para no pelear con el drag

## Tests
moduleHelpers, InstanceOverridesEditor, ModulesScreen, StructuresScreen, typecheck ui+web

## Siguiente
**Commit + push** de slices 1–5 (trabajo no pusheado en la branch).
