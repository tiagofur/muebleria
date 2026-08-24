# Sesión

**Features cerradas:** F153 — quotes_reload_render_loop_338 (issue #338)
**Inicio:** 2026-08-24 · **Cierre:** 2026-08-24
**Reviews:** `progress/review_F153.md` (APPROVED)
**Rama:** `fix/338-quotes-reload-render-loop` (pusheada)

## Resultado

**#338 ya estaba arreglado en main por el PR #342** (eco URL↔selección en
`useProjectsScreenState`; mergeado ~9h después de abierto el issue, por eso
quedó abierto sin verificar). Repro exacto sobre main, dev :5199 guest:

- reload en `/quotes/proj-demo-plantilla` → detalle estable, URL sin rebote
  (8 muestras/400ms);
- lista `/quotes` tras reload → capturas píxel-idénticas (cero churn) y click
  en card aterriza (`/quotes/proj-cocina-lopez-demo`).

Entregable de F153 — la Meta del issue que seguía bloqueada: la **recarga
in-browser a mitad de sesión** del smoke de benchmark
(`proyectar-usability.spec.ts`). El paso nuevo ejercita reload → sidebar →
deep-link al detalle → sesión proxy persistida en localStorage (antes sólo
cubierta en unit) → click que aterriza → studio reabierto con la corrida de 3
colocada → panel re-oculto. Regresión in-browser de la familia de eco
(#338/#342/F152).

## Verificación (evidencia)

- `pnpm smoke:usability` verde (37.0s) con el paso nuevo.
- `pnpm test` 3.041 verdes (ui 1.394, web 306, domain 1.035, storage 155,
  excel 89, mobile 45, desktop 17) — corrido 2×; `pnpm typecheck` 0 errores.

## Notas

- `UsabilityBenchmarkPanel.expanded` no persiste: tras reload el panel vuelve
  expandido y hay que ocultarlo de nuevo (el smoke lo hace).

## Siguientes pasos (backlog auditoría, sin cambios)

1. Chevron de affordance en tablas expandibles de catálogo.
2. Estructuras: Desactivar/Eliminar al overflow "Más".
3. Continuar revisión: Estructuras, Componentes, catálogos, Clientes, Vitrina.
