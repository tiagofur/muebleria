# PTX / CADmatic 4 — expediente de implementación

Issue base técnica: [#650](https://github.com/tiagofur/muebleria/issues/650).
Follow-up de refilados positivos: [#661](https://github.com/tiagofur/muebleria/issues/661).

Preparación documental iniciada por el propietario el 2026-09-10. Este directorio conserva investigación, evidencia y contratos de implementación; la compatibilidad real con CADLink/CADmatic sigue separada de la implementación interna.

## Alcance vigente

#650 entregó el candidato técnico r2: programa guillotina real, preview/instrucciones desde el mismo programa, PTX documentado, readback/verifier independiente, perfil efectivo y descarga existente. r2 sólo representa planes con `trim=0`.

#661 es el incremento r3: soportar **refilados positivos dentro de un subconjunto demostrado**, sin modificar r2 ni convertir observaciones de dos muestras en reglas universales.

**Fuera de #650/#661:** generar las cinco cocinas y verificar con el cliente. El propietario realizará esas actividades y traerá los resultados. Implementación no equivale a compatibilidad: `NOT_TESTED/notClaimed` permanece hasta evidencia externa. #348 y los dossiers de cliente conservan la autoridad para import/readback y sign-off.

## Lectura

1. [Investigación y contrato](01_investigacion_y_contrato.md): fuentes primarias, localizadores, registros/códigos PTX, coordenadas y auditoría del código.
2. [Plan de implementación](02_plan_de_implementacion.md): plan histórico A+B de #650 y criterios del programa de corte compartido.
3. [Ejemplos parciales](examples/README.md): fragmentos propios y traza geométrica.
4. [Comprobación acotada](validation/verification_result.json): resultados del ejercicio y contraejemplo reducido.
5. [Manifiesto original de procedencia](source-artifact-manifest.json): checksums del paquete de conversación antes de adaptar documentos/índice. No describe documentos editados posteriores; no usarlo como manifiesto de fabricación.
6. [Evidencia de campo y base segura para r3](03_evidencia_campo.md): dos muestras `.ptx` reales del cliente, saneadas en [field/](field/README.md); separa observación, inferencia y decisiones todavía abiertas.
7. [Contrato conservador de refilados r3](04_contrato_r3_refilados.md): resolución G1–G5, mapping soportado para `TRIM_TYPE=1`, proyección de raíz útil, política HEAD/recut y subconjunto `FUNCTION 92 + Xn`.

La secuencia de autoridad para r3 es:

```text
manual / contrato Pattern Exchange
+ evidencia de field/
+ CutProgram ejecutado de Granete
→ 03_evidencia_campo.md (qué observamos)
→ 04_contrato_r3_refilados.md (qué podemos implementar)
→ #661 (trabajo de producto)
```

Si el 03 y el 04 difieren en fuerza de una conclusión, **prevalece el 04 para implementación**, porque ya incorpora la revisión conservadora posterior.

## Artefactos no productivos

Los `.ptx.txt` de `examples/` son **parciales**: no enviarlos a CADLink, no renombrarlos para ejecutar ni usarlos como programas de máquina.

Los fixtures saneados de `field/` preservan evidencia estructural/numeral recibida del cliente, pero también son **evidencia**, no programas autorizados para ejecutar. Los originales con identificadores privados permanecen fuera del repo.

## Verificación documental

Desde la raíz del repo:

```sh
python3 docs/machines/ptx-cadmatic4/validation/verify_examples.py
```

Comprueba aritmética, disponibilidad de regiones, conservación de área, columnas de un fragmento y reproducción reducida de reglas de eje. **No importa TypeScript, no ejecuta suites del producto, no valida un PTX completo y no sustituye CADLink/CADmatic.**

## Núcleo PTX documentado (r2 integrado)

`packages/excel/src/ptx/` implementa el subconjunto documentado del formato
(HEADER, JOBS, PARTS_REQ, BOARDS, MATERIALS, PATTERNS, CUTS + OFFCUTS y
VECTORS cuando las pruebas los necesitan): modelo tipado, serialización
determinista, parser/readback independiente, validación de
relaciones/columnas/magnitudes y equivalencia.

`ptx/compileCutPlan.ts` compila el CutPlan/CutProgram real del optimizador en
un `PtxDocument` validado con tabla inversa de índices
(cutId↔CUT_INDEX, pieza↔PART_INDEX, hoja↔PTN_INDEX, retazo↔Xn), y
`ptx/verifyCutPlanPtxReadback.ts` comprueba semánticamente los bytes leídos
contra el programa original re-ejecutado. El verifier es deliberadamente
independiente de los helpers productivos del compiler.

Decisiones r2 relevantes:

- staging determina FUNCTION; fase 3 sigue siendo 3 independientemente del eje;
- CUT_INDEX conserva estructura y SEQUENCE conserva orden operativo;
- DIMENSION es relativa al subpanel (280, no 734);
- identidad ASCII crítica falla cerrado;
- magnitudes no representables fallan cerrado;
- `MATERIALS.BOOK=1` es política conservadora del candidato;
- refilados positivos fallan con `ptx_compile.trim_unsupported`.

El perfil `ptx-cadmatic-4@r2` y adapter `granete-ptx@1.1.0` conectan ese compiler con la ruta de descarga existente unified/by-material/ZIP, manteniendo `NOT_TESTED/notClaimed`.

## Nueva evidencia y r3

Las muestras de campo confirman para ese entorno varios supuestos de r2 (HEADER version 1, mm, origin 0, trim type 1, CUT_INDEX separado de SEQUENCE, FUNCTION 1/2/3), y aportan evidencia nueva de trims en `MATERIALS.TRIM_*` y de filas `FUNCTION 92 + Xn` asociadas a offcuts.

No obstante, dos muestras no son una especificación universal. El contrato r3 fija explícitamente qué parte puede implementarse ahora y qué debe quedar fail-closed.

Puntos centrales de `04_contrato_r3_refilados.md`:

```text
G1 RESOLVED
  DIMENSION sigue relativa; la diferencia ~10 mm observada corresponde al fixed rip trim.

G2 SPEC_POLICY_READY
  TRIM_TYPE=1, sin giro inicial: near/leading → fixed trim; far → minimum falling waste.

G3 PROFILE_POLICY
  HEAD/recut no se derivan de los cuatro márgenes; quedan sin override en la primera r3.

G4 RESOLVED
  trim total ya incluye kerf; el PTX compila desde una raíz útil y no emite otra vez las divisiones perimetrales.

G5 RESOLVED_SUBSET
  FUNCTION 92 + Xn sólo para un rest-side remnant de phase 2 que cumpla el contrato geométrico.
```

## Relación con autoridades existentes

Reutilizar [machine profiles/adapters](../../architecture/machine-profiles-and-adapters.md), selección #591, preflight #347 y trazabilidad de liberación. No crear otro optimizador ni convertir React en autoridad industrial.

r2 queda inmutable. r3 será otra revisión inmutable y sólo debe promoverse a un estado de evidencia superior después de importación/readback real en el entorno del cliente.