# Sesión

**Feature cerrada:** F147 — proyectar_performance_budget (#312 P3D-6, meta #308)
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**SDD:** https://github.com/tiagofur/muebleria/issues/312#issuecomment-5387133235

## Resultado

Performance del editor 3D como requisito verificable (North Star §§17–18).
**Fixture de referencia** versionado (`perfReferenceScene`: 30 ítems / 27
instancias activas en 3 muros + isla + espacio Office que resuelve sin
renderizarse; ≥300 piezas; test de conteo impide adelgazarlo). **Telemetría**
`perfTelemetry.ts` en `window.__proyectarPerfSnapshot`: renderer.info probe,
Profiler del studio (no-op prod), longtask observer, latencia pointermove→frame
del drag y stats del cache BOM con missReasons. **Smoke `pnpm smoke:perf`**
con gates duros + baseline JSON + screenshot; flag local de seed
(`muebles_seed_perf_reference`) sin tocar seeds normales.

Optimizaciones medidas (no folklore): **cache de resolveItemBom por firma de
CONTENIDO** de catálogo — la versión por identidad fallaba 2.175 veces por
drag porque los selectores reconstruyen arrays por render; ahora layout-change
⇒ 0 re-resoluciones (gate vitest CI + gate runtime en smoke). Memo
`sceneModules`/`sceneWalls`, catálogo estable en ProjectModalsContainer, guard
de cámara en WallOcclusionTracker. **Órbita ⇒ 0 commits React** (gate §17.1,
botón derecho por construcción).

**Gap registrado (P3D-6b): costo de render** — frames de drag/órbita son long
tasks (p95 222ms dev build; 538 draw calls, materiales físicos + shadows; sólo
21k triángulos ⇒ el problema es draw calls, no GPU). Gates de ms calibrados al
baseline con objetivo documentado; `docs/proyectar-3d-performance.md` define
hardware objetivo, presupuesto objetivo-vs-gate, baseline y checklist de
profiling obligatorio para hot path.

## Verificación (evidencia)

- `pnpm test` 2.990 OK (domain 1.035 · storage 155 · excel 89 · ui 1.348 ·
  mobile 45 · desktop 17 · web 301); `pnpm typecheck` 0 errores.
- `pnpm smoke` 5/5 (F141–F145 existentes + perf nuevo 42s con gates verdes);
  baseline en `test-results/proyectar-perf-baseline.json` (538 drawCalls ·
  20.692 tris · commits max 5,6ms · drag p95 146ms · BOM 29 frías + 6.409
  hits · órbita 0 commits).
- Review APPROVED con 4 hallazgos corregidos (hooks violation movida antes
  del early return, cache por contenido, órbita botón derecho, shape del
  ResolvedBom) — `progress/review_F147.md`.

## Siguiente etapa

#314 (P3D-8) benchmark de usabilidad; P3D-6b (costo de render) queda
registrado como candidata paralela de alto impacto.
