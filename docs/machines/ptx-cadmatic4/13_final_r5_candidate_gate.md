# 13 — Candidato final r5 y gate pre-campo (#793)

Estado: **NOT_TESTED / notClaimed**. Este documento describe el candidato
productivo `ptx-cadmatic-4@r5` / `granete-ptx@1.4.0` listo para UNA prueba
controlada de importación CADLink/CADmatic 4. NO declara compatibilidad; el
resultado de campo vuelve a #348 y sólo eso puede promover el soporte.

## 1. Identidad industrial nueva

| Elemento | Identidad | Valor |
| --- | --- | --- |
| Profile | `ptx-cadmatic-4@r5` | digest `3d3d215bf45859b6bf74ea931fc34e9d2b99e16ed346f67a33f68da482534c6b` |
| Adapter | `granete-ptx@1.4.0` | implementationDigest `8c13f67bfc8f1354984b90bbea1a3719b91905b62d63af570eec3d83a52a7916` |
| Receiver policy | `HPP250-CAD4-R5-CANDIDATE` | política #790 (BOOK=3, KERF 4.4/4.4, RULE 6/1/1/1, TRIM geometry, recut OMIT) |
| TITLE | `GRANETE-R5-FIELD-TEST` | 21 caracteres (límite documentado 25) |
| Soporte | `NOT_TESTED` / `notClaimed` | nunca promovido por serializar |

r2/r3/r4 quedan como constantes históricas inmutables (digests y goldens
intactos; ver §7). Una selección persistida en r4/1.3.0 muestra el blocker
stale accionable y **nunca** se retargetea a r5/1.4.0 automáticamente. La
identidad 1.3.0 (`e856f8e8…`) se conserva como evidencia en
`PTX_ADAPTER_1_3_0_HISTORICAL_IDENTITY`.

## 2. Dimensiones r5 (todas llegan a bytes o a un gate)

Base r4 probada (`05_contrato_r4_field_dialect.md`) más las decisiones r5 ya
implementadas por #788–#792:

```text
strictSpecPreflight      = pattern-exchange-v1      → compile + serializePtxDocumentBytesSpecChecked
partsReqDimensionPolicy  = part-local-pre-rotation-cut → PARTS_REQ por marco local (rotación no muta identidad)
partsUdi                 = structural               → una fila PARTS_UDI por pieza, INFO vacío sin autoridad
receiverPolicy           = HPP250-CAD4-R5-CANDIDATE  → MATERIALS del receiver productivo
```

`PTX_COMPILER_R5_REQUIRED_DIMENSIONS` exige las cuatro en el adapter; un valor
no implementado BLOQUEA (`SERIALIZER_NOT_IMPLEMENTED`) — ninguna opción es
decorativa. La política LAB `HPP250_CAD4_R5_LAB` queda congelada por el golden
#791 y NO se reutiliza.

## 3. Autoridad de labels productiva (el hueco que #793 cierra)

Ruta (la MISMA que una liberación real):

```text
ProductionRelease (verdad congelada del servidor)
→ ReleaseCuttingDemandView (demanda frozen)
→ ManufacturingLabelProjection (domain, NEUTRAL — sin tipos PTX/Excel)
→ ResolvedCuttingJob.manufacturingLabels + partLabels (mapeadas en export)
→ compileCutPlanToPtxDocument(partLabels) → PARTS_INF / PARTS_UDI
```

- El builder `manufacturingLabelProjectionFromDemand` (domain) comparte la
  MISMA iteración congelada que `releaseCutRowsFromDemand` (orden por ordinal
  frozen, códigos #781, sufijos `-C<n>` idénticos a `unrollRows`).
- El mapeo export es `ptxPartLabelsFromManufacturingProjection` (única fuente
  productiva de `partLabels`); reusa las validaciones #789 (ASCII, autoridad
  de canto, CORE_MAT, BARCODE2 = código de fabricación).
- Room queda vacío (la demanda frozen no lo lleva). ORDER = `R<releaseNumber>`.
- **CNC**: `hasCncMachining` sólo con autoridad explícita
  (`ManufacturingMachiningAuthority` por partId). Sin autoridad → DRAWING y
  BARCODE1 vacíos (nunca inferidos por nombre/descripción/tipo). Hoy el flujo
  web no transporta autoridad de mecanizado → los PTX productivos del release
  salen sin DRAWING; el wiring real de mecanizado pertenece al follow-up de
  campo (#348 y siguientes).
- **Scope CNC**: `manufacturingCncScope(releaseBase)` — derivado exclusivamente
  de `releaseId + designRevisionId + manufacturingFingerprint` (frozen). Mismo
  código + otra liberación → DRAWING distinto (sin colisiones entre releases).

## 4. Hard gates r5 (fail-closed, sin fallback)

Con `ptx-cadmatic-4@r5` es imposible terminar en `generatePtxString` legacy o
en r4/ptx-generic. Gates en orden:

1. `ptx_compile.label_authority_missing` — sin proyección neutral o sin
   `partLabels` mapeadas.
2. Cobertura 1:1 proyección ↔ partLabels (`label_missing` /
   `label_code_unknown` si divergen).
3. `ptx_compile.release_identity_missing` — plan sin `CutPlan.releaseBase`.
4. `ptx_compile.release_identity_mismatch` — proyección de otra liberación, o
   scope CNC que no se deriva de su propia base frozen.
5. Compile preflight real (programa, fases, kerf, ASCII, magnitudes,
   labels↔PARTS_REQ) — `canSerialize().ready === true` garantiza `serialize()`.
6. Serialize SOLO vía `serializePtxDocumentBytesSpecChecked` (#788): no
   existen bytes r5 sin pasar el preflight estricto de Pattern Exchange.

## 5. Ruta productiva y catálogo

- `generateSelectedCuttingOutput(plan, selection, mode, { manufacturingLabels })`
  mapea la proyección, la adjunta al job y re-evalúa el gate sobre el job
  etiquetado; by-material filtra proyección+labels al subconjunto del grupo.
- El flujo release web (ShellView → EngineeringWorkspace →
  ProductionOrderOptimizationPanel → useExportHandlers) pasa la proyección
  cuando la demanda frozen está verificada; sin ella el botón queda bloqueado
  con el motivo exacto.
- Catálogo: `contracts/machineOutputCatalog.contract.json` y el mirror Go
  (`backend-go/internal/domain/machineoutputselection.go`) publican CADmatic 4
  CURRENT = r5 y `granete-ptx` = 1.4.0 (test de paridad TS↔JSON↔Go).
- `KNOWN_OUTPUT_PROFILES` selecciona r5; `PTX_CADMATIC_4_R4_PROFILE` sigue
  exportado para historia/tests.

## 6. Field pack final de revisión

Generado por `packages/excel/src/ptx/r5ReviewFieldPack.generate.test.ts`
(sólo con `GRANETE_R5_REVIEW_PACK_DIR`, skip en CI) desde el fixture frozen
representativo `r5FieldCandidateFixture.ts` (sin datos privados, con autoridad
CNC explícita de fixture) por la MISMA ruta productiva. Salida local
(ignorada por git): `artifacts-local/ptx-r5-final-review/`
(`<G12hex>.ptx`, `manifest.json`, `expected_identity.json`,
`README_FIELD_TEST.txt`, `CHECKSUMS.sha256`). NO se envía: revisión
independiente primero (nuevo PTX vs Pattern Exchange spec vs R2201/R7301
saneados vs manifest vs CutPlan/readback).

Registro de la generación actual (recomputable con el comando del §8):

```text
PTX        GC238DCD30E18.ptx
sha256     6e40939c406046fe91c852d6a72f35e824af91fd2b4c72dc4a2e41542764aa2a
bytes      2284
records    JOBS 1 · PARTS_REQ 7 · PARTS_INF 7 · PARTS_UDI 7 · BOARDS 3 ·
           MATERIALS 2 · OFFCUTS 1 · PATTERNS 3 · CUTS 15
manifest   sha256 d09f91801a0156004c656180c7a5d5636857b4f693311b25271a60c1ebdf5e3a
identity   sha256 7f47dfc073ab5b2d7087ccdda129369b22940e01339eb2217c4982d9c3fcc777
checksums  sha256 40c9345120a4fa74e78e40f430a1f9485a55f69185a0cc60e49ac9a0d6fcf9b0
```

El README conserva el contrato #792 (`/CAD4 /RESULT /UDI /INF`, warning
cadlink.ini, DO NOT START THE SAW / DO NOT CUT / RETURN THE .RLT, sin
`/DELETE`). Resultado esperado de CADLink: `0/0/0` — sin afirmar que ocurra.

## 7. Identidades históricas preservadas

| Revisión | Profile digest | Golden bytes sha256 |
| --- | --- | --- |
| r2 | `822221a6…` | `6f72cce4…` |
| r3 | `4998b6a5…` | `f5e51ff7…` |
| r4 | `94401b8c…` | `92209bfb…` |
| r5 LAB (#791) | — | `239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932` (3303 bytes) |

El golden LAB r5 NO se modificó; el candidato productivo usa identidad frozen
real (fixture representativo) y por eso difiere del LAB.

## 8. Reproducción y verificación

```bash
pnpm --filter @granete/excel test
pnpm --filter @granete/domain test
pnpm typecheck
pnpm test
python3 scripts/factory_preflight.py
python3 scripts/verify_affected.py --base origin/main --plan

# Field pack de revisión (local, nunca committear artifacts-local/):
GRANETE_R5_REVIEW_PACK_DIR="$PWD/artifacts-local/ptx-r5-final-review" \
  pnpm --filter @granete/excel exec vitest run src/ptx/r5ReviewFieldPack.generate.test.ts
```

## 9. Known unknowns / instrucciones para la revisión independiente

- `supportStatus` NOT_TESTED: ningún resultado de campo existe; el éxito de
  CADLink se registra en #348 con .RLT + evidencia, y sólo eso promueve.
- Room y autoridad CNC no viajan hoy en la demanda frozen del release web
  (campos vacíos, no inventados); el fixture del pack sí ejerce la autoridad
  CNC explícita para demostrar DRAWING/BARCODE1 deterministas.
- Reviewer: leer el diff real; verificar (a) digestos recomputados, (b) bytes
  del pack contra spec preflight + readback independiente, (c) que r2/r3/r4/
  LAB r5 sigan byte-exactos, (d) que ninguna ruta r5 pueda caer al legacy.
