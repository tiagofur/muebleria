# Sesión

**Feature en curso:** próxima — #356 parametric part relationships (P0, desbloqueado por F161)
**Inicio:** —
**Estado:** F161/#346 cerrado el 2026-08-24 (ver `progress/history.md`,
`progress/review_F161.md` y `progress/implementation_F161.md`); #346 listo para
cerrarse al mergearse el PR del slice 2.
**Rama:** por crear (`feat/356-…`)
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Notas de sesión

- F160 (bootstrap Granete for SketchUp) cerrado con host smoke real 7/7 en
  SketchUp Pro 2026.2 macOS; extensión y TestUp 2.5.4 quedan instalados en
  `~/Library/Application Support/SketchUp 2026/SketchUp/Plugins`.
- F161 (semantic metadata round-trip) cerrado: contrato ejecutable
  `granete.sketchup-authoring.v1` en packages/domain con 22 tests, golden
  round-trip y review APPROVED.
- Cadena P0 restante: #356 (relationships/joint-driven machining) → #347
  (preflight autoritativo) → #348 (PTX + taller, requiere #306).
- Rename repo-wide Muebles→Granete pendiente en #366.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
