# Sesión

**Feature en curso:** próxima — #346 semantic metadata round-trip (P0, desbloqueado por F160)
**Inicio:** —
**Estado:** F160/#345 cerrado el 2026-08-24 (ver `progress/history.md` y
`progress/review_F160.md`); esperando arrancar #346.
**Rama:** por crear (`feat/346-…` o worktree dedicado)
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap` (disponible para limpieza)

## Notas de sesión

- F160 cerró con host smoke real en SketchUp Pro 2026.2 macOS: TestUp CI
  7/7 contra el RBZ instalado; 3 bugs de host encontrados y corregidos
  (AppObserver es clase; `Sketchup::Console#puts` privado + swap de `$stdout`
  en TestUp; grupos vacíos purgados por transacciones) — detalles en
  `progress/implementation_F160.md` §Host evidence.
- La extensión y TestUp 2.5.4 quedan instalados en
  `~/Library/Application Support/SketchUp 2026/SketchUp/Plugins` para futuros
  smokes.
- Rename repo-wide Muebles→Granete pendiente en #366.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
