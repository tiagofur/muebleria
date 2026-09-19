# PTX / CADmatic 4 — estado operativo: r4 rechazado en campo, r5 en preparación

Issue base técnica: [#650](https://github.com/tiagofur/muebleria/issues/650).
Incrementos integrados: #661, #665, #691, #692. Hardening de cierre interno: #693.
Dialecto r4 tras el primer rechazo CADLink: #781. Reconstrucción r5: META #787, con investigación y plan en `06_dossier_r5_segundo_rechazo.md` y `07_plan_r5_receiver_labels_cnc.md`. Semántica CUTS/diferencial/golden r5: #791 en `11_cuts_semantics_differential_golden_r5.md`.

## Estado vigente

```text
internalMaturity: v0.8
fieldGate: BLOCKED_AFTER_SECOND_REJECTION
machine: client-a-machine-b-hpp250@r1
latest field-tested profile: ptx-cadmatic-4@r4
latest field-tested adapter: granete-ptx@1.3.0
r4 field result: REJECTED
next candidate: r5 PLANNED, not implemented yet
supportStatus: NOT_TESTED
compatibility claim: notClaimed
physical cut: prohibited until later gate
```

**Cierre interno no equivale a compatibilidad de campo.** Ya existe evidencia real de que los candidatos previos de Granete, incluido r4, fueron rechazados por el flujo CADLink/CADmatic 4 del cliente. No existe todavía una conversión exitosa, un `.rlt` de éxito, una validación semántica del operador ni un corte físico controlado. La etiqueta `internalMaturity` describe el pipeline interno; no debe interpretarse como nivel de compatibilidad de campo.

## Subconjunto implementado

La cadena usa una sola verdad de corte:

```text
CutPlan + CutProgram ejecutable
→ preview e instrucciones derivadas del mismo programa (#650)
→ compiler PTX tipado + parser/readback independiente (#650)
→ trims perimetrales r3 y FUNCTION 92/Xn acotada (#661)
→ scheduler y invariantes reforzados (#665)
→ selección exacta sin fallback silencioso (#691)
→ readiness contra CutPlan activo + identidad multi-sheet + manifest (#692)
→ guards, digests, paridad y documentación de cierre interno (#693)
```

Capacidades entregadas:

- programa guillotina ejecutable, staging FUNCTION 0/1/2/3 y dimensiones relativas;
- `TRIM_TYPE=1`, `VECTORS=off` y trims positivos sólo en el frame fijo r3;
- `MATERIALS.TRIM_FRIP/VRIP/FXCT/VXCT` desde geometría ejecutada, sin duplicar
  refilos en `CUTS`; HEAD/recut siguen ausentes;
- `FUNCTION 92 + Xn` sólo para el remanente rest-side de phase 2 demostrado,
  con orden productor → liberación → recut dependiente;
- readback semántico independiente, incluidos terminales descartados
  `waste + liberated=true`, más mutation proofs;
- identidad de remanente `(sheetIndex, regionId)` y generación multi-sheet;
- descarga unified/by-material/ZIP y Production Pack bajo la misma selección;
- manifest determinista con hashes y pins exactos de máquina, perfil y adapter;
- stale profile/digest, loading, error, configuración bloqueada y CutPlan no
  representable fallan cerrado antes de entregar bytes.

r2 y r3 conservan sus bytes, revisiones y digests históricos. El hardening #693
no cambia trims, FUNCTION 92, scheduler, perfiles ni identidad del adapter.

## Autoridad y fallback legacy

La generación normal sólo permite el serializer legacy cuando la autoridad
confirma `NO_OUTPUT_CONFIGURED`. Los estados loading, error, stale, configured o
blocked nunca caen al legacy.

Auditoría de callers:

| Caller | Clasificación | Regla vigente |
|---|---|---|
| `apps/web/src/exportCutPlanPtx.ts` | compatibilidad intencional | Sólo lo invoca el branch confirmado-empty de `runWithCuttingOutputAuthority`. |
| `apps/web/src/exportProductionPack.ts` | compatibilidad intencional | Misma autoridad que descarga directa; cualquier otro estado bloquea el pack. |
| `packages/excel/src/machines/ptxAdapter.ts` | compatibilidad por perfil | `ptx-generic@r1` conserva el serializer legacy; CAD4 r2/r3/r4 usan el compiler documentado. |
| `packages/excel/src/ptxCutPlanExport.ts` | implementación legacy | Serializer y agrupación por material reutilizados únicamente por las rutas anteriores. |
| `packages/excel/src/machines/outputSelectionResolver.ts` | utilidades compartidas | Reutiliza agrupación/nombres, pero genera sólo mediante el adapter seleccionado; nunca llama al serializer legacy. |
| `packages/excel/src/index.ts` | API pública de compatibilidad | Re-exporta símbolos; no decide autoridad ni fallback. |
| `packages/excel/src/ptxValidationFixture.ts` | evidencia/test-only | Genera el fixture auditado #348; no participa en generación normal seleccionada. |
| tests que inyectan `generateLegacy` | test-only | Prueban la frontera confirmed-empty y los negativos loading/error/blocked/stale. |

No se detectaron callers productivos muertos que deban borrarse en #693. El retiro
será válido sólo cuando **todos los talleres soportados hayan migrado a una
selección exacta y ningún flujo confirmed-empty dependa del legacy**. Hasta entonces
se conserva explícitamente; no se elimina por heurística ni por edad.

## Lectura y autoridad

1. [Investigación y contrato](01_investigacion_y_contrato.md): fuentes primarias,
   localizadores, registros/códigos PTX y auditoría original.
2. [Plan histórico](02_plan_de_implementacion.md): plan A+B de #650; no es estado actual.
3. [Evidencia de campo](03_evidencia_campo.md): observaciones de dos muestras reales
   saneadas, sin extrapolación universal.
4. [Contrato r3](04_contrato_r3_refilados.md): autoridad del subconjunto de trims y 92.
5. [Contrato r4](05_contrato_r4_field_dialect.md): segundo candidato preparado tras el primer rechazo; hoy es evidencia histórica de un candidato que también fue rechazado en campo.
6. [Dossier r5](06_dossier_r5_segundo_rechazo.md): investigación web + comparación contra R2201/R7301 + defectos confirmados y preguntas abiertas tras el segundo rechazo.
7. [Plan r5](07_plan_r5_receiver_labels_cnc.md): implementación por fases del receiver HPP250/CAD4, etiquetas, PARTS_INF/UDI, puente CNC y preflight CADLink.
8. [Strict spec preflight](08_spec_preflight_r5.md): validador independiente de límites documentados Pattern Exchange antes de serializar (#788, fase R5-A) — diccionario §20 de la Interface Guide con localizadores, fail-closed sin truncar y lector estructural del dialecto externo (R2201/R7301).
9. [PARTS_INF/UDI y etiquetas](09_parts_inf_labels_cnc.md): modelo tipado de las familias de etiqueta, proyección industrial congelada por pieza física, mapping Granete → PARTS_INF con autoridad por campo y puente de identidad CNC DRAWING/BARCODE (#789, fase R5-B).
10. [Receiver HPP250/CAD4](10_receiver_profile_hpp250_cad4.md): política lab-only para #790; autoridad de MATERIALS, orden de records, BOARDS/JOBS/PATTERNS/CUTS shape y límites CADLink sin publicar un perfil/adaptador r5 productivo.
11. [CUTS semantics/differential/golden r5](11_cuts_semantics_differential_golden_r5.md): addendum #791 que separa `FUNCTION` de `PART_INDEX`, acota `92 + Xn`, resume R2201/R7301 por propiedades y documenta el golden LAB/TEST con SHA/conteos.
12. `packages/excel/src/ptx/`: compiler, validator, serializer, parser y verifier.
13. `contracts/machineOutputCatalog.contract.json`: catálogo compartido con paridad
   directa TS↔contrato↔Go.

Los documentos `01`–`05` preservan investigación/decisiones históricas y no se reescriben para simular que conocían los resultados posteriores. `06` y `07` gobiernan el discovery y el plan de r5.

## Condición de cierre de #650

Tras completar #693, **#650 puede cerrarse técnicamente: SÍ**, siempre que el PR de
#693 esté integrado y sus checks exact-head estén verdes. Su alcance A+B y los
follow-ups internos necesarios quedaron implementados y verificados. El cierre no
promueve `NOT_TESTED`, no afirma compatibilidad y no sustituye #348 ni la evidencia
de campo pendiente. #693 no cierra #650 automáticamente.

## Próximo gate externo

**No enviar otro PTX al cliente todavía.** Primero completar el plan r5: strict spec preflight (#788 ✓), PARTS_INF/UDI/etiquetas/identidad CNC (#789 ✓), receiver profile HPP250/CAD4 (#790), CUTS diferencial (#791), field pack con `/RESULT` (#792) e integración final (#793). La siguiente prueba debe pedir idealmente sólo el `.rlt` o confirmación de éxito, no otra ronda manual de interpretación de popups.

Sólo una conversión CADLink exitosa, seguida de revisión semántica del operador, puede cambiar `NOT_TESTED/notClaimed`.

## Verificación documental

```sh
python3 docs/machines/ptx-cadmatic4/validation/verify_examples.py
```

Es una comprobación offline acotada; no sustituye TypeScript, CADLink ni CADmatic.
