# Sesión

**Feature en curso:** F153 — quotes_reload_render_loop_338 (issue #338)
**Inicio:** 2026-08-24
**Rama:** `fix/338-quotes-reload-render-loop`

## Plan

1. Reproducir #338 en dev server (guest + selección + reload) sobre main actual.
2. Diagnóstico: confirmar/Descartar causa (eco URL↔selección, PR #342).
3. Desbloquear la Meta del issue: paso de reload in-browser en el smoke de
   benchmark (`proyectar-usability.spec.ts`).
4. Verificación completa + cierre del issue con evidencia.

## Hallazgo (2026-08-24)

**El loop de #338 ya está arreglado en main por el PR #342** (mergeado
2026-08-24 04:26 UTC, ~9h después de abierto el issue — por eso quedó abierto).

Evidencia del repro exacto sobre main (dev :5199, guest por UI, seed demo):

- Reload en `/quotes/proj-demo-plantilla` → el detalle queda estable: URL no
  cambia en 8 muestras/400ms, heading presente, sin rebote a la lista.
- Lista `/quotes` tras reload → dos capturas separadas 600ms son píxel-idénticas
  (cero churn) y el click en una card aterriza en el detalle
  (`/quotes/proj-cocina-lopez-demo`) — el canary original del issue.
- Causa raíz (pre-#342): `useProjectsScreenState` publicaba cada cambio de
  `selectedId` vía `onSelectionChange` incondicional; la shell re-navegaba y el
  restore re-publicaba → `/quotes ↔ /quotes/:id` en ciclo con remontajes.
  #342 lo reemplazó por el contrato de `useRoutableEntitySelection`
  (URL→estado sin re-notificar; sólo intención local publica).

Resto pendiente del issue (su Meta): la recarga in-browser a mitad de sesión
del smoke de benchmark estaba bloqueada por #338 (NOTA en
`tests/smoke/proyectar-usability.spec.ts:333`). F153 la desbloquea.

## Estado

- [x] Repro verificado (arriba)
- [x] Paso de reload en el smoke + corrida del smoke
- [x] Suite/typecheck
- [ ] Review + cierre issue #338

## Verificación (evidencia)

- `pnpm smoke:usability` verde (37.0s): las 11 tareas del script canónico +
  el paso nuevo de recarga in-browser a mitad de sesión — reload → sidebar →
  deep-link `/quotes/:id` abre el detalle directo → sesión proxy persistida
  (`edit-dimension.completedAt` presente) → click en "Proyectar" aterriza →
  studio reabierto con la corrida de 3 colocada (`countPlacedRows === runTotal`)
  → panel del facilitador re-oculto.
- `pnpm test` 3.041 tests verdes (ui 1.394, web 306, domain 1.035, storage
  155, excel 89, mobile 45, desktop 17); `pnpm typecheck` 0 errores.
- Repro manual del issue en dev :5199 (arriba): detalle estable 8 muestras,
  lista píxel-idéntica entre capturas, click post-reload aterriza.

## Archivos

- `tests/smoke/proyectar-usability.spec.ts` — NOTA de bloqueo reemplazada por
  el paso de reload (regresión in-browser de la familia de eco #338/#342/F152).
- `feature_list.json` — F153 registrada.
