# Issue #661 — entrega: CADmatic 4 r3 con refilados positivos (MATERIALS.TRIM_* + FUNCTION 92)

- Approval: prompt del propietario (2026-09-11) implementando #661 según el DoD vigente y
  `docs/machines/ptx-cadmatic4/04_contrato_r3_refilados.md` (autoridad de implementación).
- Precondición verificada: PR documental #662 MERGED (merge commit `734a7b4e`) en
  `origin/main@6495085b`. Branch `feat/661-cadmatic4-r3-trims`. Single writer.
- Result: `IMPLEMENTED_PENDING_REVIEW`.

## Alcance completado

1. **Trim planner/proyección r3** (`compileCutPlan.ts`, nuevo `planSheetTrimProjection`):
   derivado exclusivamente del `CutProgramTrace` ejecutado (nunca de UI). Camina la cadena
   de divisiones `trim=true` desde el tablero crudo hasta una **raíz útil única**; cada
   margen es `parentExtent − keptExtent` de la geometría ejecutada (total que incluye
   kerf, G4). Mapping G2 por eje + `leadingBand` (no por nombre): y+leading→`TRIM_FRIP`,
   y+far→`TRIM_VRIP`, x+leading→`TRIM_FXCT`, x+far→`TRIM_VXCT`. El CutProgram original
   nunca se modifica: es una proyección de lectura.
2. **Fail closed** con códigos específicos (fin de `trim_unsupported` genérico para r3):
   `ptx_compile.trim_structure_invalid` (trim fuera del prefijo; banda descartada que no
   es desperdicio liberado), `ptx_compile.trim_frame_unsupported` (dos refilos del mismo
   lado del frame fijo — exigiría TYPE=1/transformación no implementada),
   `ptx_compile.trim_mapping_ambiguous` (hojas del mismo material con márgenes ejecutados
   distintos: una fila MATERIALS no puede representarlos), `ptx_compile.trim_geometry_mismatch`
   (margen no representable). Sin opción r3 (`supportsPositiveTrim`), r2 mantiene
   `trim_unsupported` byte a byte.
3. **MATERIALS.TRIM_***: los cuatro slots con `undefined → celda vacía` (lado sin refilo
   ejecutado) y `0 → "0"` preservados; `TRIM_HEAD/TRIM_FRCT/TRIM_VRCT` siempre AUSENTES
   (G3: vacío = sin override, nunca 0). Serializer/parser ya distinguían vacío de cero.
4. **Staging reset en la raíz útil**: `planCutProgramDivisions(trace, usableRoot)` siembra
   `usableRoot = generación 1`; las divisiones de trim proyectadas no consumen fases PTX.
   `CUTS.DIMENSION` sigue relativo al subpanel (G1); BOARDS conserva dimensiones brutas;
   las divisiones perimetrales no se emiten como CUTS (sin double counting).
5. **FUNCTION 92 + Xn (G5)**: sólo rest-side terminal de productor phase-2/FUNCTION-2 con
   extent conocido y lado kept productivo (división consumidora o pieza). Fila física:
   `FUNCTION=92, QTY_RPT=1, QTY_PARTS ausente (celda vacía), SEQUENCE>0`. Todo lo demás
   conserva la fila relacional r2 (`QTY_RPT=0/SEQUENCE=0`) sin conversión automática.
   Guard de duplicado `ptx_compile.offcut_release_duplicate` en el compiler y en el
   verifier (`release.offcut_duplicate`); `QTY_PARTS` ahora es opcional en el modelo
   (`PtxCutRecord.producedQuantity?: number`; parser CUTS required 9→8; bytes r2 intactos).
6. **PTX event scheduler** (`schedulePtxExecutionEvents`): eventos `division` y
   `offcut_release`; preserva el orden relativo del programa e inserta cada 92 justo tras
   su productor phase-2 (antes de todo recut dependiente). SEQUENCE contiguas 1..M.
   `CUT_INDEX` sigue siendo preorder estructural independiente; los tests cubren la
   divergencia. El verifier re-deriva el schedule con una formulación distinta
   (claves fraccionarias `producer.order + 0.5`).
7. **Parser/validator**: `PTX_SUPPORTED_CUT_FUNCTION_CODES = [0,1,2,3,92]` (no 90/91/93..99,
   no 4..9, no 81). Validator de fila 92: `QTY_RPT=1`, `SEQUENCE>0`, `PART_INDEX` debe ser
   `Xn`, `QTY_PARTS` ausente, `DIMENSION>0` (`INVALID_FUNCTION_SEMANTICS`).
8. **Verifier independiente** (`verifyCutPlanPtxReadback`): re-deriva por separado
   proyección de trims (cadena + mapping + márgenes), raíz útil, staging, preorder, TYPE,
   releases con elegibilidad 92, schedule, `MATERIALS.TRIM_*` (incluye ausencia de
   HEAD/FRCT/VRCT) y extensiometría desde bytes (BOARDS brutas − TRIM_* del material =
   raíz útil). Guard de fuente actualizado: el verifier no importa los nuevos helpers del
   compiler (`planSheetTrimProjection`, `schedulePtxExecutionEvents`).
9. **Mutation tests M1–M8** (`trimR3.test.ts`): TRIM_FRIP/VRIP alterados, CUTS conservando
   un trim (double counting), FUNCTION 92→2, X1→X2, DIMENSION alterada, 92 antes del
   productor, 92 tras el recut dependiente, mismo Xn dos releases físicas —
   `validatePtxDocument` puede quedar verde y el verifier FALLA con código específico.
10. **Golden r3** (`cutPlanPtxGoldenR3.ts/.test.ts`): generado de un `optimizeCutPlan`
    REAL (1220×800, trims 10/10/10/10, kerf 4, piezas A 800×350 / B 350×500 / C 232×300,
    minRemnant 300/400). Demuestra: `MATERIALS TRIM_* = 10` con HEAD/FRCT/VRCT ausentes,
    sin CUTS perimetrales, un `FUNCTION 92 X1 DIM 564` con `QTY_PARTS` vacío,
    productor `place-3-1` (phase-2 cross) < 92 < recut dependiente `place-3-2` (phase-3),
    `CUT_INDEX ≠ SEQUENCE`, serialize→parse→`verifyCutPlanPtxReadback === []`.
    Etiquetas: `LAB_FIXTURE`, `NOT_MACHINE_VALIDATED`, título `GRANETE-PTX-CANDIDATE
    NOT_MACHINE_VALIDATED`; los PTX del cliente NO se usan como golden.
11. **Casos RED-first**: 10/10/10/10+kerf4, asimétrico 10/5/8/12, trim==kerf (4), trim<kerf
    (3, blade-exit), trim cero (bytes idénticos a r2), estructura inválida, frame no
    soportado, 92 elegible, kept-side/phase-1 no elegibles, duplicado Xn, scheduler
    productor<92<recut. RED demostrado: 28 tests fallaban con `trim_unsupported` antes del fix.
12. **Profile/adapter/paridad**: `ptx-cadmatic-4@r3` (digest
    `4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537`,
    `supportsPositiveTrim=true`, `supportedFunctions='0,1,2,3,92'`, mismo frame r2 en el
    resto; `supportStatus NOT_TESTED`). Adapter `granete-ptx@1.2.0` (descriptor v3, digest
    `954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236`) ruta r2 Y r3 al
    compilador documentado; r2 inmutable (constante exportada, pin histórico → bloqueo
    stale accionable, nunca retarget automático; mismo precedente r1→r2).
    `contracts/machineOutputCatalog.contract.json` + catálogo embebido Go actualizados
    (paridad exacta id/revision/digest/adapter/version/implementationDigest/supportStatus).
13. **Selección/descarga/manifest/UI**: sin nuevo botón ni sistema de selección;
    `generateSelectedCuttingOutput` → adapter → unified/by-material/ZIP probados con el
    tuple r3; manifest conserva cutPlan identity/version, profile id/revision, adapter
    id/version/digest, sha256, `validationStatus NOT_TESTED`, `claim notClaimed`.
    UI `Candidato — no validado en máquina` / `Listo` sigue viva; un plan representable
    con trim>0 ya no bloquea por refilo (el preflight real compila).

## Verificación ejecutada

- `@granete/excel`: 39 archivos / 335 tests + 3 skipped (incluye trimR3 30, goldenR3 6,
  golden r2 4 intactos, route/adapter/profiles/resolver).
- `@granete/domain`: 105 archivos / 1407 tests. `@granete/ui`: 161 / 1719.
  `@granete/web`: 35 / 445. `@granete/storage`: 12 / 191. `apps/desktop`: 3 / 17.
  `apps/mobile`: 10 / 73.
- `pnpm typecheck`: 7/7 paquetes OK. `pnpm openapi:check`: sin drift. `git diff --check`: limpio.
- `go test ./...` (backend-go): domain/api/storage de machine-output VERDES
  (paridad de catálogo incluida). Los tests DB-gated de `internal/storage` auth
  (`TestAuthMFA_*`, `TestAuthRefresh_*`) fallan por infraestructura local
  (PostgreSQL `SQLSTATE 57P01` durante migraciones) — verificado IDÉNTICO en worktree
  limpio de `origin/main`: fallo pre-existente, no introducido por este PR. No se declara
  PASS de una capa no ejecutada.
- Browser E2E (`tests/organization/machine-output-selection.spec.ts`) actualizado al
  tuple r3/1.2.0; la ejecución real del gate de navegador no fue posible en este entorno
  por la misma indisponibilidad de PostgreSQL (gate requiere Go+PG real; no `t.Skip`
  disfrazado: se reporta como no ejecutado).

## Fuera de scope (confirmado)

Cotización/Diseño, Proyectar/SketchUp, optimizer/preview/instructions (cero cambios),
CADmatic 3/5, SAW, MPR, drilling, `PATTERNS.TYPE=1`, BOOK/MAX_BOOK>1, PARTS_INF/UDI,
NOTES, parser tolerante de PTX externos, cinco cocinas, CADLink, claim de máquina.
