# Review — feature F124 (`cnc_nesting_engine`)

**Veredicto:** CHANGES_REQUESTED (solo por trabajo no pushed; el código está aprobado)

**Commit:** `9a0aa9f` (rama `main`)

## Checkpoints

- C1: [x] Archivos base y docs existen; `pnpm test` y `pnpm typecheck` verificados por el revisor.
- C2: [x] Solo F124 en `in_progress`; `progress/current.md` describe la sesión activa.
- C3: [x] `packages/domain` puro: `nesting.ts`/`pieces.ts` solo imports relativos de TS (sin react/fs/xlsx). Sin `console.log`. Archivos ~297/70 líneas (dentro del budget ~500). Comentarios explican el porqué (inflado 4 lados, sort largest-first, subset disjunto). Identificadores en inglés.
- C4: [x] `pnpm --filter @muebles/domain test` 666/666 verde (incluye 5 tests nuevos de nesting y los 7 de guillotine intactos). No toca export ni storage. Golden tests del motor no afectados.
- C5: [ ] **`git push` pendiente: main está 3 commits ahead de origin/main** (`9a0aa9f`, `ca8814d`, `fc02f62`). Regla dura del reviewer / `docs/git-workflow.md`: lo no pushed no existe. `progress/history.md` y cierre de sesión quedan para el cierre.

## Aceptación (los 7 criterios verificados de forma independiente)

1. [x] `CutStrategy` opcional en `CutPlanConfig` (types.ts:43,70) y `CutPlanSheet.strategy?` (types.ts:166). `DEFAULT_TOOL_SPACING_MM = 8` con justificación (fresa 6mm + 2mm safety).
2. [x] Motor MaxRects correcto. **Stress test del revisor: 200 seeds aleatorios × spacing {0,2,4,8,12}** — sin solapes, dentro del área útil (trims), holgura ≥ spacing en ≥ 1 eje entre todo par de piezas, todas las piezas colocadas (cuando entran solas en un tablero), remanentes disjuntos entre sí y de piezas, piezas+remanentes ≤ área útil, `instructions=[]`, `strategy='cnc-nesting'`. La garantía "≥ spacing en un eje" es la físicamente correcta para fresa (canal de corte en un eje basta). El inflado 4-lados en `splitFreeRects` + poda por contención mantiene el invariante MaxRects sin pérdida de espacio.
3. [x] Dispatch aditivo (`guillotine.ts:545-555`); diff confirma camino sierra byte-idéntico salvo dispatch + `strategy` en `buildSheetModels` (default `'saw-guillotine'`). `optimizer.test.ts` no fue modificado y pasa.
4. [x] Veta: rotación solo con `allowRotationNoGrain && grain === 0` (nesting.ts:161-165); verificado también en stress (grain=1 nunca rota; rotadas intercambian dimensiones de verdad).
5. [x] Fixture determinista kerf 12 vs spacing 4: sierra 3 tableros → nesting 1 (aritmética documentada en el test).
6. [x] `instructions: []` + `strategy` registrada; remanentes con fórmula de retazo útil idéntica a guillotine.
7. [x] `pnpm test` verde (domain 666/666; web 285/285 en segunda corrida — ver nota de flake) + `pnpm typecheck` verde en todos los workspaces.

## Diseño UI/UX

No aplica (feature 100% en `packages/domain`; no toca `packages/ui` ni CSS).

## Cambios requeridos (bloqueantes)

1. **`git push`** antes de cerrar la sesión. `main` está 3 commits ahead de `origin/main` (`git log origin/main..HEAD`). Sin esto el cierre no procede (regla dura del skill reviewer / `docs/git-workflow.md`).

## Observaciones no bloqueantes (para F125/F126 o hardening futuro)

1. `nesting.ts:85-91` (`isUsefulRemnantRect`) duplica la fórmula de retazo útil — con el `0.24` m² mágico — que ya estaba inlineda 3× en `guillotine.ts` (líneas 188-191, 417-420, 442-445). Ahora son 4 copias; riesgo de drift. Extraer helper/constante compartida (p. ej. en `pieces.ts`).
2. Piezas más grandes que el área útil se descartan silenciosamente (`nesting.ts:288-291` `break`). Es paridad exacta con el comportamiento preexistente de sierra (`guillotine.ts:577-580`), no una regresión de F124, pero es deuda compartida: un `DomainError` con partCode sería mejor en ambos motores.
3. `nesting.test.ts:148-152`: aserción vía `expect(string).toContain('ok')` es un patrón hacky para obtener mensaje de diagnóstico; vitest soporta `expect(valor, mensaje)`. Cosmético.
4. Flake detectado (no relacionado con F124, el commit no toca `apps/web`): 2 tests de `apps/web/src/designSystemShell.test.ts` (login/logout gate, F057) hicieron timeout bajo la carga paralela del `pnpm test` completo (6.4s > 5s); pasan en aislamiento (1.1s) y en segunda corrida completa. Sugerencia: subir `testTimeout` de esos tests en una feature de hardening aparte.

## Evidencia de verificación del revisor

- `pnpm --filter @muebles/domain test` → 58 archivos, 666/666 verde.
- Stress test scratch (200 seeds, borrado tras la corrida): invariantes MaxRects sin fallos.
- `pnpm test` completo: primera pasada 2 timeouts flaky en apps/web (F057); rerun de `apps/web` 285/285 verde.
- `pnpm typecheck`: verde en domain, ui, storage, excel, web, desktop, mobile.
- `git status` limpio; `main...origin/main [ahead 3]`.
