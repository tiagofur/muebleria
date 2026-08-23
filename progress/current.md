# Sesión

**Feature en curso:** F148 — proyectar_usability_benchmark (#314 P3D-8, meta #308)
**Inicio:** 2026-08-23 · **SDD:** https://github.com/tiagofur/muebleria/issues/314#issuecomment-5387642499

## Plan

- Telemetría `usabilityBenchmark.ts` (packages/ui): tareas canónicas v1 (11 pasos
  de #314 + targets), timeline append-only auto+facilitador, persistencia que
  sobrevive recargas, export JSON, `window.__proyectarUsability`.
- Costuras instrumentadas en el studio (insert/búsqueda/move/duplicate/align/
  dimensión/opción/materiales/ambiente/undo/presentar/BOM/clicks) — no-op sin
  sesión activa.
- Panel de facilitador gateado por flag `muebles_usability_benchmark` (patrón
  seed perf): marcas por tarea, +ayuda/+error, export.
- Smoke `pnpm smoke:usability`: script canónico completo con UI real (regresión
  permanente) + JSON proxy a test-results.
- Protocolo canónico `docs/proyectar-3d-usability-benchmark.md` + roadmap/AGENTS/
  verification. #314 queda abierto hasta las sesiones reales.
