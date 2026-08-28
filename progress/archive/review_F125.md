# Review — feature F125 (`dxf_cut_plan_export`)

**Commit:** `0b65565` (rama main) · **Fecha:** 2026-08-20 · **Revisor:** skill reviewer

**Veredicto:** CHANGES_REQUESTED

> El código en sí está sólido (DXF R12 estructuralmente válido, determinista,
> respeta boundaries, tests verdes). El rechazo es por **proceso**, no por
> código: trabajo no pusheado + `progress/current.md` desactualizado.

## Verificación ejecutada (por el revisor, no por fe)

- `pnpm test` completo: **2333 tests verdes** (domain 666, storage 126,
  excel 79, ui 1124, mobile 36, desktop 17, web 285).
- `pnpm typecheck`: verde en los 7 workspaces.
- `./init.sh`: exit 0.
- Validación estructural independiente de ambos golden con parser propio
  (pares código-valor íntegros, secciones HEADER/TABLES/ENTITIES ordenadas y
  balanceadas, `$ACADVER`=AC1009, LAYER con 2/70/62/6 y colores ACI 1–255,
  POLYLINE 66=1 + 70=1 + VERTEX≥2 + SEQEND, TEXT 8/10/20/40/1 con ≤250 chars
  y altura >0, LINE/CIRCLE completos, todas las capas usadas declaradas,
  coordenadas dentro de $EXTMIN/$EXTMAX). **TODO OK** en
  `cutPlanDxfSheets.expected.dxf` y `cutPlanDxfPieces.expected.dxf`.

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0 (verificado por el revisor).
- C2: [ ] `progress/current.md` sigue describiendo **F124** como sesión
  activa ("Feature: F124 … Plan F124") aunque F124 está `done` (commit
  `0972ed2`) y F125 es la `in_progress`. La feature F125 no tiene bitácora
  ni plan en `current.md` (AGENTS.md: "Documenta en progress/current.md
  mientras trabajas, no al final").
- C3: [x] Arquitectura respetada:
  - `dxfCutPlanExport.ts` importa solo **tipos** de `@muebles/domain` +
    `ValidationError`; sin react/electron/fs en runtime; sin dependencias
    nuevas (package.json sin cambios).
  - No calcula dominio: serializa posiciones ya calculadas; solo geometría
    de dibujo (flecha de veta, offsets de etiquetas) y `Math.round` para
    etiqueta de retazo.
  - `node:fs` solo en el test → consistente con `optimizerExport.test.ts`
    (golden contra fixture en `src/__fixtures__/`, conventions.md lo permite).
  - Sin `console.log` sueltos.
- C4: [x] Verificación real: golden tests (sheets + pieces) contra fixtures
  `.dxf` + aserciones estructurales (conteos POLYLINE/TEXT por capa, secciones,
  EOF, capas declaradas), sanitización ASCII, `ValidationError` accionable.
  Sin `.only`/`.skip`. Golden sin divergencia intencional.
- C5: [ ] **Trabajo no pusheado** (ver regla dura): `git ls-remote origin main`
  = `31fea24`; `git log origin/main..HEAD` = `0b65565` (F125) y `0972ed2`
  sin push. Working tree limpio. Feature `in_progress` en `feature_list.json`
  (correcto durante review).

## Puntos de foco pedidos por el líder

1. **Validez DXF R12: OK (no bloqueante).** Estructura de secciones y pares
   código-valor correcta; POLYLINE/VERTEX/SEQEND con flag 66/70 bien formados;
   TEXT/CIRCLE/LINE completos; tabla LAYER con colores ACI válidos y
   linetype CONTINUOUS (predefinido, aceptado sin tabla LTYPE en R12).
   Verificado con parser independiente sobre ambos fixtures.
2. **Determinismo: OK.** Sin `Date.now`/`new Date`/`Math.random` en el módulo
   (solo `Math.max`/`Math.round`); iteración sobre arrays de entrada y
   `Map.get` (nunca itera el Map). Golden estable entre corridas.
3. **Límites: OK.** Texto sanitizado a ASCII imprimible y truncado a ≤250
   (`dxfText`, dxfCutPlanExport.ts:52-59); coordenadas dentro de EXTMIN/EXTMAX
   (fila única con wrap a 6000mm en variante pieces); perforaciones omitidas
   en piezas rotadas y **documentado** en el docstring del módulo
   (dxfCutPlanExport.ts:13-14) + aserción en test (CIRCLE PERF = 2).
4. **Boundary: OK.** No calcula dominio; serializa `CutPlan` ya calculado.

## Cambios requeridos (bloqueantes para aprobar)

1. **`git push`** — `0b65565` (F125) y `0972ed2` NO están en origin/main
   (remoto verificado: `31fea24`). Regla dura del reviewer +
   docs/git-workflow.md: lo que no está pushed no existe. El commit ya está
   hecho; solo falta pushear.
2. **`progress/current.md`** — actualizar la sesión activa a F125: objetivo,
   plan y bitácora de la feature implementada (ahora describe F124, que ya
   cerró). Resolver junto con el push.

## Observaciones (no bloqueantes, para F126 o backlog)

1. **PERF mezcla caras de perforación** (`dxfCutPlanExport.ts:159-166`):
   `HoleDefinition.face` puede ser `top|bottom|left|right|front|back`
   (domain `partDrilling.ts:9`), y el writer dibuja **todos** los holes en el
   plano de la pieza sin filtrar ni distinguir cara. Para holes de canto
   (top/left/right…) o cara `back` (espejada), el círculo queda en una
   posición que no existe tal cual en la cara dibujada; dos holes de caras
   distintas pueden solaparse invisiblemente. El docstring documenta la
   proyección y la exclusión de rotadas, pero no la mezcla de caras.
   Sugerencia: filtrar a caras de plano (p.ej. solo `front`) o subcapas
   `PERF-FRONT`/`PERF-BACK`. La salida CAM autoritativa sigue siendo
   `partDrillingExport` (JSON/CSV), así que no bloquea.
2. **LF en vez de CRLF** (`pair()`, dxfCutPlanExport.ts:65-67): el spec DXF
   recomienda CR/LF; AutoCAD/ezdxf/QCAD aceptan LF-only, pero si algún CAM
  Legacy lo rechaza, el fix es una línea.
3. **'sheets' es una fila única, no grilla** (`buildSheetsVariant`, offset
   solo en X): la *descripción* de la feature dice "en grilla"; el
   *acceptance* solo exige "un bloque por tablero" (se cumple). Con muchos
   tableros el dibujo queda muy ancho. Ajustar wording o wrapar filas.
4. **Piezas angostas (<200mm) muestran solo 1 línea de etiqueta**
   (dxfCutPlanExport.ts:145-147): decisión razonable (la etiqueta no cabe);
   conviene tenerlo presente para F126 (labels legibles en nesting real).
5. **`UPDATE_GOLDEN`** es un patrón nuevo en el repo (sin precedente en
   `optimizerExport.test.ts`); inofensivo y útil, solo señalarlo.
6. **CutPlan fixture inline en el test** (~130 líneas) en vez de
   `__fixtures__/`: tolerado por precedencia del paquete
   (`cutPlanPdfExport.test.ts` también construye datos inline); los golden
   sí viven en `__fixtures__/`.

## Conclusión

Calidad técnica del writer DXF: **aprobada**. Bloqueo solo por push faltante
y `progress/current.md` stale. Con `git push` + actualización de
`current.md` (sin tocar código), esta feature queda en condiciones de
`APPROVED`.
