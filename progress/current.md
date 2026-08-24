# Sesión

**Feature en curso:** #349 — Smart Parametric Furniture Library MVP & #350 — Hardware Placement/Machining Sync
**Inicio:** 2026-08-24
**Estado:** Implementado y verificado (ver `progress/implementation_F164.md`).
**Rama:** `feat/349-parametric-furniture-library`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Notas de sesión

- Auditoría arquitectónica completada y documentada en `docs/architecture/parametric-furniture-library.md` y `docs/adr/0002-parametric-furniture-library-architecture.md`.
- 7 entidades desacopladas modeladas en `smartFurnitureDomain.ts`.
- Motor de instanciación `instantiateFurniture` en `furnitureCompositionEngine.ts`.
- Sincronización y aislamiento de herrajes en `sketchupHardwareSync.ts`.
- 85 test files y 1087 tests en domain pasando al 100%, typecheck 7/7 workspaces limpio.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
