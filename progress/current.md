# Sesión

**Feature en curso:** F162 / #356 — parametric part relationships and joint-driven machining (P0)
**Inicio:** 2026-08-24
**Estado:** Implementación y verificación de F162/#356 completa (ver `progress/implementation_F162.md`). Listo para commit/review.
**Rama:** `feat/356-parametric-relationships`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Notas de sesión

- Documentación canónica de arquitectura sincronizada en `docs/architecture/`:
  - `domain-model.md` (FurnitureDefinition, FurnitureInstance, Components, Library vs Catalog)
  - `manufacturing-feature-model.md` (ManufacturingFeature con coordenadas locales por pieza/cara y provenance)
  - `smart-furniture-engine.md` (Motor paramétrico por parámetros y reglas, nunca escalado 3D)
  - `3d-asset-library.md` (Separación catálogo vs biblioteca de activos)
- F162 (#356) implementado y verificado con 1073 tests en domain pasando al 100% y typecheck limpio (7/7 workspaces).
- Siguiente hito en la cadena: #347 (manufacturing preflight — milestone `minimum authoritative preflight` sobre fixture #356).

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
