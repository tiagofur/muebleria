# Sesión

**Feature en curso:** F159 — elevations_grouped_by_space (issue #254 reabierto)
**Inicio:** 2026-08-24
**Rama:** `feat/254-elevations-grouped-by-space` (desde origin/main post-PR #363)

## Plan

- #254 cerró aceptando prefijos; el dueño pidió el agrupado real ahora que el
  modelo ya tiene espacio en muros (#252) e islas (F158).
- Dominio: `spaceId`/`spaceName` en `ProductionWallElevation` (wallName crudo,
  sin prefijo) + helper puro `groupProductionElevationsBySpace`.
- UI: h5 por ambiente dentro de Elevaciones e Islas cuando multi-ambiente.
- PDF: iterar por grupos (muros+islas de cada ambiente juntos); línea
  "Ambiente" en páginas de muro sólo en multi-ambiente.
- Tests domain/UI/excel; suite + typecheck; review.

## Estado

- [x] #254 reabierto con comentario de trazabilidad.
- [ ] Implementación.
- [ ] Tests.
- [ ] Review.
