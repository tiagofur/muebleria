# PTX / CADmatic 4 — estado operativo v0.7

Issue base técnica: [#650](https://github.com/tiagofur/muebleria/issues/650).
Incrementos integrados: #661, #665, #691, #692. Hardening de cierre interno: #693.

## Estado vigente

```text
maturity: v0.7
machine: client-a-machine-b-hpp250@r1
profile: ptx-cadmatic-4@r3
adapter: granete-ptx@1.2.0
implementation: complete within supported subset
internal verification: complete
field validation: pending
supportStatus: NOT_TESTED
compatibility claim: notClaimed
```

**Cierre interno no equivale a compatibilidad de campo.** Granete puede producir y
verificar internamente un PTX r3 normal dentro del subconjunto documentado. Todavía
no existe evidencia de que CADLink/CADmatic 4 lo importe, de cuál sea el `.rlt`
resultante, de que el operador lo valide ni de que una HPP 250 ejecute el corte
físico. Esos cuatro hechos permanecen desconocidos y no se infieren por marca,
versión objetivo ni por tests internos.

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
| `packages/excel/src/machines/ptxAdapter.ts` | compatibilidad por perfil | `ptx-generic@r1` conserva el serializer legacy; CAD4 r2/r3 usan el compiler documentado. |
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
5. `packages/excel/src/ptx/`: compiler, validator, serializer, parser y verifier.
6. `contracts/machineOutputCatalog.contract.json`: catálogo compartido con paridad
   directa TS↔contrato↔Go.

Los documentos `01`, `03` y `04` son evidencia/decisiones históricas preservadas;
no se reescriben para simular validación posterior.

## Condición de cierre de #650

Tras completar #693, **#650 puede cerrarse técnicamente: SÍ**, siempre que el PR de
#693 esté integrado y sus checks exact-head estén verdes. Su alcance A+B y los
follow-ups internos necesarios quedaron implementados y verificados. El cierre no
promueve `NOT_TESTED`, no afirma compatibilidad y no sustituye #348 ni la evidencia
de campo pendiente. #693 no cierra #650 automáticamente.

## Próximo gate externo

Enviar un artefacto normal generado por producto sólo como candidato controlado y
no productivo, conservando PTX + manifest sin editar. Registrar de forma sanitizada:

1. importación real por CADLink hacia CADmatic 4;
2. `.rlt` o readback producido;
3. validación explícita del operador;
4. si corresponde, ejecución física controlada en HPP 250.

Sólo esa evidencia puede cambiar `NOT_TESTED/notClaimed`.

## Verificación documental

```sh
python3 docs/machines/ptx-cadmatic4/validation/verify_examples.py
```

Es una comprobación offline acotada; no sustituye TypeScript, CADLink ni CADmatic.
