# Sesión

**Feature cerrada:** F148 — proyectar_usability_benchmark (#314 P3D-8, meta #308)
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**SDD:** https://github.com/tiagofur/muebleria/issues/314#issuecomment-5387642499

## Resultado

Kit de benchmark de usabilidad para #314 (el issue queda ABIERTO hasta las
sesiones reales). **Telemetría** `usabilityBenchmark.ts` (packages/ui, patrón
perfTelemetry): tareas canónicas v1 (11 pasos del script con targets
iniciales), timeline append-only auto+facilitador con contexto de tarea,
persistencia localStorage que sobrevive recargas (re-adhiere captura de
clicks), export JSON y `window.__proyectarUsability`. **Costuras** del studio
instrumentadas (búsqueda/insert/move/command-intent/dimensión/opción/
materiales tableros+ambiental/ambientes/undo-redo/presentar/BOM/clicks) —
todas no-op sin sesión. **Panel de facilitador** gateado por flag
`muebles_usability_benchmark` (ShellView), costo cero sin flag. **Summarizer**
puro (mediana por tarea, ayudas/errores/retrocesos/clicks, metRatio de
targets). **Smoke `pnpm smoke:usability`**: script canónico completo con UI
real (incluye dnd HTML5 sintético para materiales) — regresión permanente de
script-completable; exporta JSON `source:"proxy"` (data truth). **Protocolo**
`docs/proyectar-3d-usability-benchmark.md` (métricas operacionalizadas,
facilitador sin coaching, encuesta post, targets recalibrables, baseline
proxy). Roadmap §10/AGENTS/verification/design actualizados.

**Hallazgos registrados:** #338 (render loop guest+selección+reload,
preexistente — aislado con diagnóstico; bloquea recarga in-browser a mitad de
sesión, persistencia cubierta en unit) y "piso sólo aplica por drag" (dato de
fricción para sesiones reales, documentado en el protocolo).

## Verificación (evidencia)

- `pnpm test` 3.019 OK (domain 1.035 · storage 155 · excel 89 · ui 1.381 ·
  mobile 45 · desktop 17 · web 301); `pnpm typecheck` 0 errores.
- `pnpm smoke`: studio F141/F143/F144/F145 + **usabilidad nuevo verde (38–56s,
  11/11 tareas, 74 eventos, JSON proxy exportado)**. `smoke:perf` falló
  inicialmente SOLO en G2 (drag p95) por **entorno**: falla idéntica en `main`
  (328 ms) con load 11+ del software del usuario; **verde en el retry con load
  ~5.8** — 6/6 efectivos (nota: smoke:perf da falsos negativos con máquina
  cargada; ver `progress/review_F148.md`).
- Review APPROVED con 1 hallazgo corregido (clicks tras recarga) —
  `progress/review_F148.md`.

## Siguiente etapa

Ejecutar las **sesiones reales** según `docs/proyectar-3d-usability-benchmark.md`
(#314 abierto): reclutar 3–5 participantes del taller, facilitador con panel,
exportar JSONs a `progress/benchmark/sessions/`, analizar con
`summarizeUsabilitySessions` y recalibrar targets/reordenar #309–#313/#277–#297
con evidencia. Paralelas candidatas: #338 (fix render loop) y P3D-6b.
