# Sesión

**Feature en curso:** #347 — manufacturing preflight (Milestone `minimum authoritative preflight`, P0)
**Inicio:** 2026-08-24
**Estado:** Milestone `minimum authoritative preflight` implementado y verificado (ver `progress/implementation_F163.md`). Desbloquea #349 y #350.
**Rama:** `feat/347-minimum-authoritative-preflight`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Notas de sesión

- #356 (parametric relationships and joint-driven machining) cerrado mediante PR #380 (merged).
- Milestone `minimum authoritative preflight` de #347 completado con 40 tests en el suite de SketchUp (1079 en domain) y typecheck 7/7 workspaces limpio.
- Siguiente paso: PR de milestone #347 y avance hacia #349 (biblioteca paramétrica MVP) / #350 (sincronización de herrajes).

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
