# Review — feature F153 (issue #338)

**Veredicto:** APPROVED

**Rama:** `fix/338-quotes-reload-render-loop` (pusheada, commit `245d2bd`)

## Alcance revisado

- `tests/smoke/proyectar-usability.spec.ts` — NOTA de bloqueo (#338) reemplazada
  por un paso real de recarga in-browser a mitad de sesión.
- `feature_list.json` — alta de F153 (`in_progress`).
- `progress/current.md` — sesión + evidencia.

La feature NO toca código de producto: el bug #338 ya estaba cerrado en main
por el PR #342 (contrato de selección de `useProjectsScreenState`), y la sesión
lo verificó con el repro exacto del issue antes de escribir una línea. El
entregable real de F153 es la Meta del issue que quedaba bloqueada: la
validación de recarga in-browser del kit de benchmark (#314).

## Checkpoints

- C1: [x] Harness completo; `init.sh` tiene el guardrail conocido OC-001
  (docs/verification.md) — la verificación real se hizo directa: `pnpm test`
  (×2, exit 0), `pnpm typecheck` (0 errores), `pnpm smoke:usability` (verde).
- C2: [x] Una sola feature `in_progress` (F153); features `done` con suites
  verdes; `current.md` describe la sesión activa con evidencia.
- C3: [x] Sin cambios en packages/*: sólo spec de Playwright + docs. Sin
  boundaries nuevos, sin `console.log`.
- C4: [x] Verificación real: repro manual del issue en navegador (deep-link
  estable, lista píxel-idéntica, click aterriza — evidencia en current.md);
  smoke con el paso nuevo verde (37s, ejercita reload → sesión proxy persistida
  → deep-link al detalle → reapertura del studio → corrida colocada → panel);
  suite 3.041 verde; domain 1.035/1.035.
- C5: [x] Sin archivos sin trackear sospechosos; historia/estado/current
  limpios se completan en el commit de cierre gated en esta aprobación.

## Notas de revisión

1. **El paso de reload es la regresión correcta para la familia de eco**
   (#338 / #342 / F152): cubre las tres condiciones que el bug interrumpía —
   recarga con selección activa, sesión de benchmark persistida en
   localStorage (antes sólo probada en unit con
   `simulateUsabilityReloadForTests`) y clicks que aterrizan post-reload.
2. El paso re-oculta el panel del facilitador tras el reload porque
   `expanded` no persiste (verificado en `UsabilityBenchmarkPanel.tsx:82`) —
   sin esto, el panel taparía la biblioteca en las tareas 6+.
3. Afirma `countPlacedRows === runTotal` (la corrida de 3 colocada por la
   tarea 4): valida que el trabajo del participante sobrevive el reload vía
   la persistencia real del workspace guest (localStorage → repo
   `saveProject`), no un atajo de estado.
4. Diff atómico: 3 archivos, una feature, sin trabajo ajeno mezclado.

## Cambios requeridos

Ninguno.
