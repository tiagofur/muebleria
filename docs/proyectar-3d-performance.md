# Performance budget — Proyectar 3D

> Fuente canónica de budgets, baseline y método de profiling del editor 3D.
> Regla madre (North Star §18): **no optimizar por folklore; medir antes y
> después**. Issue #312 (P3D-6). Toda feature que toca el hot path debe pasar
> por acá.

---

## 1. Escena de referencia

`packages/domain/src/__fixtures__/perfReferenceScene.ts` — generador puro y
versionado:

- 30 ítems / **26–27 instancias colocadas** en el espacio activo ("Cocina",
  3 muros + isla) + espacio "Office" con 7 colocaciones (resuelve BOM aunque
  no se renderice — ejerce el costo real de `resolveProject3DPreview`);
- **≥300 piezas** resueltas (cajoneras quantity 2), herrajes y materiales del
  catálogo LatAm del seed;
- test de conteo (`perfReferenceScene.test.ts`) impide que un cambio de
  catálogo adelgace la escena en silencio.

Se abre con el flag local `localStorage.muebles_seed_perf_reference = '1'`
(lo setea el smoke vía addInitScript) que agrega el proyecto
"Perf referencia 3D" al seed del workspace guest.

## 2. Cómo medir

```bash
pnpm smoke:perf          # smoke completo + gates + baseline JSON
# baseline → test-results/proyectar-perf-baseline.json
pnpm test -- project3dPreview.cacheGate   # gate CI determinista del cache BOM
```

Telemetría (`packages/ui/src/preview3d/perfTelemetry.ts`, agregada en
`window.__proyectarPerfSnapshot()`):

| Métrica | Origen | Qué detecta |
|---|---|---|
| `rendererMax.drawCalls/triangles` | `renderer.info` probe (cada 30 frames) | costo de render de la escena |
| `commits.count/maxMs` + byPhase | `<Profiler>` del studio (no-op en prod) | rerenders de React por interacción |
| `dragFeedback.p95Ms` | mark pointermove → rAF post-commit | latencia percibida de drag |
| `longTasks.p95Ms/count` | `PerformanceObserver('longtask')` | stutter del main thread |
| `bom.itemResolutions/cacheHits/missReasons` | `project3dPreviewStats` | re-resoluciones BOM (deuda N×resolveBom por layout-change) |

## 3. Hardware objetivo

Clase **laptop de taller con GPU integrada** (ej. MacBook Air M1/M2, Windows
con iGPU Ryzen/Vega). La máquina de referencia del baseline actual es Apple
Silicon (darwin arm64) en **build de desarrollo** (`vite dev`, React en dev) —
los valores de referencia son de esa configuración; re-baselinear en el
hardware piloto acordado y en build de producción antes de fijar targets
absolutos. Los gates hardware-independientes (commits de órbita,
re-resoluciones BOM, techos de draw calls) sí son estrictos en cualquier
máquina.

## 4. Presupuestos: objetivo vs gate actual

| Métrica | Objetivo (North Star §18) | Gate actual (baseline + margen) |
|---|---|---|
| Drag feedback p95 | < 100–150 ms | < 250 ms |
| Commits React por move | pocos y baratos | commit max < 250 ms |
| Órbita (input irrelevante) | 0 commits React | 0 commits (estricto) |
| Re-resoluciones BOM por layout-change | 0 | 0 (estricto, CI + runtime) |
| Draw calls escena referencia | — | < 1.500 |
| Long tasks p95 (interacción) | frame rate útil (< 150 ms) | < 350 ms (dev) |

## 5. Baseline (2026-08-23, Apple Silicon, build dev)

```
rendererMax: 538 drawCalls · 20.692 triangles · 564 geometries · 16 programs
commits:     43 total · max 5,6 ms (mount 1 · update 25 · nested 17)
drag:        feedback p95 146 ms · max 146 ms (16 muestras)
longTasks:   p95 136 ms · max 244 ms · 295 en la sesión (drag-phase p95 222)
órbita:      0 commits React en 6 drags derechos
BOM:         29 resoluciones frías + 6.409 cache hits en 74 resolves (0 en drag)
```

Lectura del baseline:

1. **React está sano** — commits baratos (≤5,6 ms) y la órbita no commitea.
   El cache BOM por contenido (`project3dPreview.ts`) eliminó la deuda
   N×resolveBom por move de drag (antes: 2.175 re-resoluciones en un drag;
   la identidad de catálogo cambiaba por render → cache claveado por firma de
   contenido por elemento).
2. **El costo está en el render, no en React**: p95 222 ms de long task por
   frame de drag con sólo ~21k triángulos. 538 draw calls (1 mesh + material
   físico por pieza, ghost wireframe por módulo) + shadow maps (direccional
   2048 + spot 1024 + ContactShadows) + HDRI. Es el gap principal →
   **follow-up P3D-6b (costo de render)**: batching/instancing de piezas por
   material, revisar shadows/ContactShadows y `dpr`/`preserveDrawingBuffer`.
3. Triángulos no son el problema (20k) — instancing ayuda por draw calls, no
   por GPU.

## 6. Checklist de profiling (obligatorio al tocar hot path)

1. Correr `pnpm smoke:perf` en main ANTES del cambio → guardar baseline.
2. Implementar el cambio (sin tocar fixture ni gates).
3. Correr de nuevo → comparar baseline contra baseline.
4. Si alguna métrica empeora > 20%: justificar el tradeoff en el PR o revertir.
5. Si el cambio es una optimización: mostrar antes/después en el PR (medir,
   no folklore).
6. Gates CI deterministas: cacheGate (0 re-resoluciones por layout-change) y
   conteo del fixture — fallan solos si la arquitectura del hot path regresa.

## 7. Deuda registrada

- **P3D-6b — costo de render** (long tasks por frame en drag/órbita): el
  baseline lo deja visible y medible; primera candidata: draw calls por pieza.
- Micro-churn conocido (no medido aisladamente, candidatos): `new THREE.Vector2/3`
  por evento de raycast; textura de grain por combinación tamaño/color.
- Re-baseline pendiente en hardware piloto + build de producción.
