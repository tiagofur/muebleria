# Review — Issue #650 · PR 3: vista previa e instrucciones desde el programa real

**Veredicto:** CHANGES_REQUESTED
**Identidad:**
- Issue: #650 (incremento PR 3); incremento previo: PR #654 (integrado en `origin/main@a11996bc`, verificado).
- HEAD revisado: `3a6906a9fb5370eec7f20061168bf7123597d0cb` (rama local `feat/650-cut-program-preview`, base `origin/main@a11996bc`).
- Scope: 13 archivos, +2111/−386 (dominio: `cutProgramProjection.ts` nuevo + `types.ts`/`guillotine.ts`/`index.ts`; UI: `ProductionBoardView.tsx`, `ProductionBoardSvg.tsx`, `productionBoardLayout.ts`, `ProductionOrderOptimizationPanel.tsx`; tests; `progress/current.md`; smoke Playwright).
- Agente: revisor (skill `reviewer`), modelo builtin:zai-coding-plan/GLM-5.3. No se modificó código del implementador.

**Evidencia (comandos propios, HEAD `3a6906a9`):**

| Comando | Resultado |
|---|---|
| `pnpm --filter @granete/domain test` | ✅ 104 archivos / 1398 tests |
| `pnpm --filter @granete/ui test` | ✅ 160/1698 (una primera corrida abortó sin test roto identificado; 2 corridas consecutivas verdes) |
| `pnpm --filter @granete/web test` | ✅ 35/444 |
| `pnpm --filter @granete/excel test` | ❌ **1 fallo**: `cutPlanPdfExport.test.ts` → `WinAnsi cannot encode "→" (0x2192)` (30 archivos, 164 pasan) |
| `pnpm typecheck` | ✅ 7/7 proyectos, 0 errores |
| `pnpm openapi:check` | ✅ sin drift |
| `git diff --check` | ✅ limpio |
| `pnpm smoke` (suite completa, incluye spec nuevo) | ✅ 15/15; `cut-program-preview.spec.ts` 1/1 |
| `git log origin/main..HEAD` / `git ls-remote --heads origin` | ❌ 1 commit **sin push**; la rama no existe en el remoto |

## Checkpoints

- C1: [x] Archivos base y docs/skills presentes. (`./init.sh` no ejecutado; suites por paquete sí.)
- C2: [ ] El test de un consumidor de una feature previa done (PDF export de cut plan) quedó **roto** por este diff (ver Cambio requerido 1). 1 sola feature `in_progress` en `feature_list.json` ✓; `progress/current.md` describe la sesión activa ✓.
- C3: [x] Boundaries respetados: dominio sin react/fs/xlsx (imports de `cutProgramProjection.ts` sólo locales); UI sin fórmulas industriales (`productionBoardLayout.ts` delega 100% en `projectSheetCutProgram`); errores vía `ValidationError`; sin `console.log`/`any` en líneas añadidas.
- C4: [ ] Suite `@granete/excel` en rojo (test de fixture PDF contra plan real de `optimizeCutPlan`). El resto de suites verificadas por mí.
- C5: [x] Working tree limpio, sin untracked sospechosos; `progress/history.md` con entradas; sesión activa documentada en `current.md` (pendiente de cierre).

## Diseño UI/UX (design.md §8 — aplica: toca `packages/ui/src/`)

- D1: [ ] Tokens: código **nuevo** con hex inline — banners (`rgba(239, 68, 68, 0.1)`, `#ef4444`, `#b91c1c` en `ProductionBoardView.tsx:205-226`), step-info (`#d97706`, `#16a34a` en `ProductionBoardView.tsx:395-412`) y `var(--accent-muted, #eff6ff)` / `var(--accent-primary, #3b82f6)` en `ProductionOrderOptimizationPanel.tsx:580-581` donde **esos tokens no existen** en `tokens.css` (el fallback hex es el que pinta). La leyenda con hex era preexistente; lo nuevo no lo es.
- D2: [x] Reutiliza `ProductionBoardView`/`ProductionBoardSvg`/panel existentes; no crea pantalla nueva.
- D3: [x] Sin modales nuevos.
- D4: [x] Sin toasts nuevos.
- D5: [ ] Iconos: emojis como iconos en código nuevo (`ℹ️`, `⚠️`, `⚡`, `◀`, `▶` en banners/botones). §3.7 exige Lucide (`Info`, `TriangleAlert`, `Zap`, `ChevronLeft`/`ChevronRight` ya en el mapa de iconos).
- D6: [x] Sin animaciones nuevas (nada que wrappear).
- D7: [ ] Gate §8: "solo tokens" falla (D1); "una acción primaria por contexto" comprometida — banner "Regenerar plan" (`btn--primary`) y sidebar "Regenerar Plan" (`btn--primary`) visibles a la vez para el mismo estado missing; `Vista general` alterna a `btn--primary` en el step-nav. Además `btn--tiny` (`ProductionOrderOptimizationPanel.tsx:560`) no existe en CSS (clase muerta compensada con px inline).
- D8: [x]/[ ] A11y mayormente cuidada (li con `role="button"`, `tabIndex`, Enter/Space, `aria-current`, `aria-label` en prev/next); copy `1er CORTE` ALL-CAPS no es sentence case (§7.1) — el label lo acuña el dominio (`cutProgramProjection.ts:423-424`).

## Cambios requeridos

1. **[Bloqueante] Test rojo en consumidor downstream.** `packages/excel` `cutPlanPdfExport.test.ts` falla: `WinAnsi cannot encode "→"`. El `→` (U+2192) fue introducido por este commit en la descripción de instrucción con retazo (`packages/domain/src/optimizer/cutProgramProjection.ts:258`); el PDF export usa fuentes estándar WinAnsi y el test construye un plan real con `optimizeCutPlan` + `DEFAULT_CUT_PLAN_CONFIG` (produce al menos una instrucción con retazo). El encargo (§5) exige "tests de los consumidores afectados" ante cualquier ajuste de `CutInstruction`; la evidencia del implementador declaró domain/ui/web pero **omitió `@granete/excel`** (y `pnpm test` completo lo habría detectado). Fix: copy WinAnsi-safe en las descripciones del dominio (p. ej. "→" por texto plano) o sanitizado explícito en el export; y añadir la suite excel a la evidencia. Regla dura del reviewer: no se aprueba con tests rojos.
2. **[Bloqueante] Trabajo no pushed.** `3a6906a9` no está publicado (la rama local trackea `origin/main`, "ahead 1"; `git ls-remote` no encuentra `feat/650-cut-program-preview`). No hay PR abierto. Push + PR antes de cerrar (regla dura; `docs/git-workflow.md`).
3. **Nombres de cutId como autoridad industrial.** `isTrimDivision` (`cutProgramProjection.ts:209`) decide "refilado" por `cutId.startsWith('trim:')`. El encargo (§5) dice explícitamente "No interpretes nombres cutId como autoridad industrial… si falta una distinción indispensable, añade solamente el metadato neutral mínimo". Para refilados con resto sólido la vía estructural existe (hoja waste liberada), pero en **kerf-only y blade-exit no hay hoja** (el margen entero es banda) y el nombre es el único detector — programas de otra procedencia (round-trip/PTX futuro) se clasificarían como rip/separación con fase y copy incorrectos, silenciosamente. Añadir el metadato neutral mínimo (p. ej. flag en la división) y dejar el nombre fuera de la decisión.
4. **Etiquetas de lado Y contradicen el dibujo.** El dominio declara bottom en el origen Y (`cutProgramBuilder.ts:262-265`) y las instrucciones dicen "inferior (Y=0)" / "superior" (`cutProgramProjection.ts:243-245`), pero el SVG dibuja con transform identidad (Y=0 arriba). La banda del "inferior" aparece en el borde **superior** de pantalla. 2 de 4 lados con palabra humana invertida respecto a lo visible; el encargo pedía comprobar los cuatro lados. La transformación única se respeta (bien), pero el copy de lados debe coincidir con lo que el operador ve (etiquetas por posición de pantalla o flip único de Y en el SVG).
5. **Casos mínimos de aceptación sin prueba (§7 del encargo):**
   - "Varios tableros/materiales con IDs locales repetidos": sin test (los IDs `'board'`, `'trim:left'`, etc. se repiten por tablero; hoy es estructuralmente seguro porque cada vista proyecta un solo tablero, pero el caso pedido no está demostrado).
   - "Cambio de tablero y regeneración sin selección o traza obsoleta": implementado (panel resetea `selectedStepIndex` en `handleGenerateCutPlan` y cambio de tablero; efecto por `sheetIdentityKey`), **sin test**.
   - El test "retazo útil 500 × 796 de la regresión de #654" (`cutProgramProjection.test.ts:242`) no reproduce esa regresión: usa otros inputs (1000×500 + 600×500 sobre 2440×1830) y sólo aserta `areaM2 >= 0.24`. El caso exacto 500×796 sigue cubierto únicamente por el test preexistente `optimizerCutProgram.test.ts:193` (R3 de #654). Ajustar nombre/aserción o reproducir los inputs reales.

## Observaciones (no bloqueantes)

- Primera corrida de `@granete/ui test` abortó (exit 1) sin test rojo identificable; dos corridas consecutivas completas pasaron. Posible flake por carga; monitorear.
- `✂` (U+2702) en `primaryCut.label` del dominio: hoy sólo consume SVG, pero es otro carácter no-WinAnsi que no debe llegar a export PDF/PTX.
- Descripción de refilado "10 mm (disco: 4 mm)" muestra margen total + disco; el sólido (6) queda en `restRect` estructurado. Correcto semánticamente; opcional hacerlo explícito en el copy.
- `useEffect` de reset usa `handleSelectStep` sin incluirlo en deps: funciona (deps intencionales por `sheetIdentityKey`) pero exige el lint excluido; documenar o usar `useCallback`.
- Excelente: la heurística de reconstrucción X/Y desaparece de la UI (−283 líneas en `productionBoardLayout.ts`); `executeCutProgram` es la única fuente; proyección memoizada (no re-ejecuta por render); estados `missing`/`invalid`/`cnc-nesting` honestos y probados; kerf nominal vs consumido diferenciados (`toolFootprintRect` 998..1002 vs `kerfBandRect` 998..1000, testeado); `leadingBand` con banda 6..10 y área útil desde 10 (exacto al ejemplo del encargo); contrato `CutInstruction` sólo aditivo.

## Fronteras declaradas por el implementador (verificadas como no tocadas)

- PTX/serializador, perfiles CADmatic, adaptadores, descargas: sin cambios (`packages/excel/src/machines/*` intactos; `ptxCutPlanExport.test.ts` verde).
- Backend/APIs/migraciones/persistencia: sin cambios en el diff.
- No se afirma VALIDATED ni compatibilidad física: correcto, la vista es fiel al programa planificado.
