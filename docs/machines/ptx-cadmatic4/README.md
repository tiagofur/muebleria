# PTX / CADmatic 4 — expediente de implementación

Issue de implementación: [#650](https://github.com/tiagofur/muebleria/issues/650).
Preparación documental solicitada por el propietario el 2026-09-10. Este directorio importa y adapta los artefactos de investigación de esa conversación; no implementa el serializador ni modifica código de producto.

## Alcance vigente

**Dos entregas técnicas: A → B.** Conservar el programa guillotina real y conectar la vista existente; después implementar el PTX documentado, aplicar el perfil CAD4 y verificar los bytes con un lector independiente.

**Fuera de #650:** generar las cinco cocinas y verificar con el cliente. El propietario realizará esas actividades y traerá los resultados. No son criterios de aceptación ni bloquean el cierre técnico de A+B. Sí están incluidos los fixtures pequeños y sintéticos necesarios para pruebas automatizadas.

Implementación no equivale a compatibilidad: `NOT_TESTED/notClaimed` permanece hasta evidencia externa. #348 y los dossiers de cliente conservan la autoridad para import/readback y sign-off; no se cierran ni se omiten sus gates productivos con esta preparación.

## Lectura

1. [Investigación y contrato](01_investigacion_y_contrato.md): fuentes primarias, localizadores, registros/códigos PTX, coordenadas y auditoría del código.
2. [Plan de implementación](02_plan_de_implementacion.md): A+B, criterios y prompt para empezar por el programa de corte compartido.
3. [Ejemplos parciales](examples/README.md): fragmentos propios y traza geométrica.
4. [Comprobación acotada](validation/verification_result.json): resultados del ejercicio y contraejemplo reducido.
5. [Manifiesto original de procedencia](source-artifact-manifest.json): checksums del paquete de conversación antes de adaptar documentos/índice. No describe los documentos editados de este PR; no usarlo como manifiesto de fabricación.
6. [Evidencia de campo y base para r3](03_evidencia_campo.md) (2026-09-11): dos muestras `.ptx` reales del cliente, saneadas en [field/](field/README.md) — trims por `MATERIALS.TRIM_*`, liberación de retazos `FUNCTION 92 + Xn`, y validación del HEADER/dialecto del candidato r2.

La investigación conserva un procedimiento de campo como contexto, expresamente fuera de alcance. El plan activo y #650 prevalecen sobre las antiguas referencias a una tercera entrega comercial.

## Artefactos no productivos

Los `.ptx.txt` son **parciales**: no enviarlos a CADLink, no renombrarlos para ejecutar ni usarlos como programas de máquina. No son las cinco cocinas. No se incluyen manuales del fabricante, licencias, información de clientes ni binarios del conversor. Los artefactos se publican descomprimidos para poder revisarlos; no se duplica el ZIP dentro de Git.

## Verificación documental

Desde la raíz del repo:

```sh
python3 docs/machines/ptx-cadmatic4/validation/verify_examples.py
```

Comprueba aritmética, disponibilidad de regiones, conservación de área, columnas de un fragmento y reproducción reducida de reglas de eje. **No importa TypeScript, no ejecuta suites del producto, no valida un PTX completo y no sustituye CADLink/CADmatic.** El futuro código debe convertir el contraejemplo en test real.

## Núcleo PTX documentado (código)

`packages/excel/src/ptx/` implementa el subconjunto documentado del formato
(HEADER, JOBS, PARTS_REQ, BOARDS, MATERIALS, PATTERNS, CUTS + OFFCUTS y
VECTORS cuando las pruebas los necesitan): modelo tipado, serialización
determinista, parser/readback independiente, validación de
relaciones/columnas/magnitudes y equivalencia. Demuestra
`records → serialize → bytes → parse → modelo equivalente` sin depender del
optimizador. Limitaciones registradas: columnas documentadas fuera del
subconjunto (p. ej. OFFCUTS más allá de `JOB_INDEX..WIDTH`, MATERIALS tras
`RULE4`) fallan cerrado por la ambigüedad de inventario de §9 de la
investigación; PARTS_INF/PARTS_UDI/PARTS_DST/PTN_UDI/NOTES no están
implementados.

Sobre ese núcleo, `ptx/compileCutPlan.ts` compila el CutPlan/CutProgram real
del optimizador en un `PtxDocument` validado con tabla inversa de índices
(hacia adelante y hacia atrás: cutId↔CUT_INDEX, pieza↔PART_INDEX,
hoja↔PTN_INDEX, retazo↔Xn), y `ptx/verifyCutPlanPtxReadback.ts` comprueba
semánticamente los bytes leídos contra el programa original re-ejecutado
(`optimizeCutPlan → compile → validate → serialize → parse → readback`). El
verifier es semánticamente independiente del compiler: importa sólo sus
tipos y re-deriva por separado (duplicado deliberado de comprobación cruzada)
la fase/FUNCTION, el preorder estructural, el TYPE, las liberaciones y las
líneas de vectores — un test de guard de fuente lo hace cumplir, de modo que
un bug industrial del writer no puede verificarse a sí mismo.
Decisiones de candidato documentadas en el módulo, no claims de receptor: la
fase de staging determina FUNCTION (fase 3 sobre X sigue siendo 3; fase > 3
falla cerrado), las filas CUTS van en preorder estructural con CUT_INDEX y
llevan SEQUENCE de ejecución independiente (como el fragmento 03), las
liberaciones de retazos son filas QTY_RPT=0, el exact-fit no genera filas
ficticias, DIMENSION siempre es la medida relativa conservada (280, no 734),
las magnitudes deben ser representables en la resolución configurada o
fallan cerrado, y los planes con refilados positivos se rechazan
(`ptx_compile.trim_unsupported`) porque no hay mapping documentado para
90..99 ni para head. Identidad ASCII crítica (códigos de material, CODE de
PARTS_REQ, claves de mapeo) falla cerrado (`ptx_compile.identity_not_ascii`)
en lugar de filtrarse: 'MDFÁ' y 'MDF' nunca se fusionan; el filtrado
determinista queda sólo para texto auxiliar. MATERIALS.BOOK emite el valor
conservador 1: el dossier sólo documenta que cuenta tableros [S03 pp.134–135]
y "total de tableros del job" NO está establecido.
`ptx/cutPlanPtxGolden.ts` congela un candidato real de laboratorio
etiquetado `LAB_FIXTURE NOT_MACHINE_VALIDATED`.

**Integración candidata (#650 PR 6):** el perfil `ptx-cadmatic-4@r2`
(`PTX_CADMATIC_4_CANDIDATE_PROFILE`, nueva revisión inmutable; r1 se conserva
como constante histórica) declara como dimensiones efectivas —con evidencia
de implementación en este repo— headerVersion 1, mm, ASCII+CRLF (elección
conservadora, no requisito del receptor), decimalPlaces 2 con preflight de
representabilidad exacta, includeVectors false, supportsPositiveTrim false y
el subconjunto FUNCTION 0..3; lo que sigue sin evidencia es del receptor
(fieldAvailability/recordOrdering/caracteres/nombres de archivo) y el estado
sigue NOT_TESTED. El adapter `granete-ptx` v1.1.0 rutea POR REVISIÓN EXACTA:
r2 → compilador documentado (preflight real: ready ⇒ serialize), cualquier
otra revisión → serializer legacy inalterado (golden #348 intacto). La
descarga EXISTENTE (#591: unified/by-material/ZIP + manifest con
cutPlan/profile/adapter/hash, claim `notClaimed`) entrega el candidato
cuando el usuario selecciona ese perfil; sin botón paralelo. Paridad
Go/TS actualizada (catálogo compartido). Todo sigue sin certificar
CADLink/CADmatic ni habilitar fabricación.

## Relación con autoridades existentes

Reutilizar [machine profiles/adapters](../../architecture/machine-profiles-and-adapters.md), selección #591, preflight #347 y trazabilidad de liberación. No crear otro optimizador ni convertir React en autoridad industrial. La gramática documentada permite implementar un candidato no productivo sin esperar campo; las capacidades concretas de la máquina, compatibilidad y permiso productivo no se infieren del manual.

El PR preparatorio utiliza `Refs #650`; no es entrega completa, no cierra la issue y no concede autorización de merge ni ejecución de máquinas.
