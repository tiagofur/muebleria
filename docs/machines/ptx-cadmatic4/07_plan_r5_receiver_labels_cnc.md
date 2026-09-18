# PTX / CADmatic 4 — plan r5: receiver profile, etiquetas y puente CNC

> Autoridad de implementacion propuesta despues del segundo rechazo real de CADLink.
> Leer primero 06_dossier_r5_segundo_rechazo.md, 05_contrato_r4_field_dialect.md y field/README.md.
> r4 queda congelado como evidencia. Este plan produce una nueva revision r5.

## 1. Resultado final esperado

    ProductionRelease exacta
    -> frozen manufacturing pieces
    -> CutPlan/CutProgram unico
    -> receiver profile HPP250/CAD4
    -> PTX r5 spec-valid + receiver-compatible
    -> metadata completa de etiquetas
    -> referencia CNC estable
    -> strict preflight
    -> PTX + manifest + field pack
    -> CADLink /CAD4 /RESULT

La implementacion no termina cuando los tests pasan. Termina cuando existe un candidato r5 que cumple la gramatica documentada, transporta etiquetas utiles, no inventa semantica, usa el dialecto observado cuando corresponde, falla cerrado antes de exportar y conserva provenance exacta.

## 2. Principios no negociables

1. Una sola verdad industrial: release -> ocurrencia fisica -> pieza fisica -> manufacturing code -> PTX part index -> label -> CNC drawing ref.
2. r4 es inmutable: no cambiar profile, adapter, digests, golden ni bytes historicos.
3. Separar Pattern Exchange core, receiver profile HPP250/CAD4 y product policy Granete.
4. Si falta un dato requerido: BLOCK. Nunca guess, truncate, silent omit ni fallback legacy.
5. Ninguna sub-tarea puede declarar compatibilidad de campo.

## 3. R5-0 — congelar evidencia

Antes de cambiar bytes:

- registrar GD8754F0B9995.ptx como segundo candidato rechazado;
- conservar SHA-256 y manifest;
- mantener originales R2201/R7301 fuera del repo;
- usar solo fixtures saneados;
- no volver a enviar r4;
- mantener NOT_TESTED / notClaimed.

## 4. R5-A — strict PTX spec preflight

Crear un validador independiente del writer.

Debe cubrir al menos:

- HEADER.VERSION;
- HEADER.TITLE <= 25;
- UNITS 0/1;
- ORIGIN 0..3;
- TRIM_TYPE 0/1;
- indices PART/BOARD/PATTERN/CUT/OFFCUT consecutivos y referenciales;
- limites de textos relevantes del Interface Guide;
- required prefix vs optional trailing fields;
- empty field vs omitted trailing field;
- referencias Xn validas;
- material/job scope correcto.

Fixture negativo obligatorio: el title r4 de 43 chars.

Acceptance:

- R2201/R7301 saneados pasan el parser compatible con su shape;
- r2/r3/r4 historical bytes no cambian;
- el writer r5 no puede producir algo que el preflight rechace.

## 5. R5-B — modelo industrial de etiqueta por pieza fisica

Crear o reutilizar una proyeccion de dominio equivalente a:

    ManufacturingPieceLabelData
      furnitureInstanceId
      projectItemId
      partId
      manufacturingPartCode
      partName
      cutLengthMm / cutWidthMm
      finishedLengthMm / finishedWidthMm
      materialCode / materialName
      edgeBottom / edgeTop / edgeLeft / edgeRight
      faceFinish / backFinish / coreMaterial
      furnitureCode / furnitureName
      furnitureWidth/Height/Depth
      furnitureOccurrenceOrdinal
      room
      barcodePrimary / barcodeSecondary
      cncDrawingRef
      pictureRef

Los nombres exactos pueden adaptarse al dominio existente.

Regla: si existe release, estos datos no se reconstruyen desde catalogo live.

## 6. R5-C — PARTS_INF completo

Implementar la familia tipada en records/parser/serializer/validator/readback.

Mapping inicial:

| Campo | Fuente |
|---|---|
| DESC | nombre humano de pieza |
| LABEL_QTY | politica explicita, inicialmente 1 por pieza fisica |
| FIN_LENGTH / FIN_WIDTH | medida terminada |
| ORDER | referencia corta de obra/release |
| EDGE1..4 | cantos canonicos |
| EDG_PG1..4 | solo con operacion real |
| FACE_LAM / BACK_LAM / CORE | acabados/material si hay autoridad |
| DRAWING | cncDrawingRef |
| PRODUCT | codigo de mueble/modulo |
| PROD_INFO | nombre de mueble |
| PROD_WIDTH/HGT/DEPTH | dimensiones del mueble |
| PROD_NUM | ordinal fisico congelado |
| ROOM | ambiente congelado si existe |
| BARCODE1 | token de scan/CNC |
| BARCODE2 | manufacturing part code o tracking token |
| COLOUR | acabado/color normalizado |

Campos sin autoridad quedan vacios. No inventar.

Debe existir test de orientacion pieza -> EDGE1/2/3/4.

## 7. R5-D — PARTS_UDI receiver profile

No copiar codigos como 2WE2LE sin entenderlos.

Primera politica posible, solo si queda documentada:

    INFO1 = pictureRef
    INFO2 = edge summary controlado por Granete o blank
    INFO3 = face/finish code
    INFO4 = back/finish code

Si se genera imagen:

- nombre ASCII corto y determinista;
- hash en manifest;
- lifecycle junto al PTX;
- nunca autoridad geometrica.

Documentar dependencia de CADLink /INF, /UDI y cadlink.ini.

## 8. R5-E — puente CNC durable

Definir cncDrawingRef corto, ASCII, determinista y unico dentro de la release.

Contrato:

    physical piece
    <-> manufacturingPartCode
    <-> cncDrawingRef
    <-> barcode
    <-> futuro MPR/MPRX

PARTS_INF.DRAWING usa cncDrawingRef cuando exista.
BARCODE1 puede usar la misma referencia o un scan token explicito.

Una pieza sin mecanizado real puede dejar DRAWING vacio. No generar programas falsos.

La generacion BHX/woodWOP queda fuera de esta fase, pero la identidad queda preparada.

## 9. R5-F — receiver profile HPP250/CAD4

Crear un perfil explicito, no constants dispersas.

Debe gobernar como minimo:

- title max;
- cadlink mode CAD4;
- record order;
- politica MATERIALS;
- BOOK/MAX_BOOK;
- kerf;
- trims;
- RULE1..4;
- PARTS_INF/UDI;
- NOTES;
- CUT comments;
- optional row shape.

Para cada campo MATERIALS elegir una sola autoridad:

- FROM_MACHINE_PROFILE
- FROM_MATERIAL
- FROM_CUTPLAN_GEOMETRY
- OMIT_NO_OVERRIDE

Los valores observados BOOK=3, kerf 4.4, trims y RULE1=6/RULE2-4=1 son evidencia fuerte del receptor, no constantes universales.

Revisar coherencia entre MATERIALS.BOOK, PATTERNS.MAX_BOOK y el plan fisico real.

## 10. R5-G — semantica correcta CUTS 90..99

Refactor conceptual:

    FUNCTION = semantica de fase / trim-waste
    PART_INDEX = referencia a pieza u offcut

No modelar FUNCTION 92 como sinonimo universal de offcut release.

Mantener 92 + Xn en el receiver donde la evidencia lo soporta.

Tests obligatorios:

- 90/91/92/93 corresponden a fase;
- Xn se valida independientemente;
- r5 solo emite combinaciones permitidas;
- r2/r3/r4 no cambian.

## 11. R5-H — shape y orden del dialecto del cliente

Si nueva investigacion no contradice, el receiver r5 debe preferir el orden observado en ambas muestras:

    HEADER
    JOBS
    PARTS_REQ
    PARTS_INF
    PARTS_UDI
    BOARDS
    MATERIALS
    NOTES
    OFFCUTS
    PATTERNS/CUTS...

Clasificarlo RECEIVER_EVIDENCED, no standard universal.

Para el receiver r5 omitir CUT comments internos salvo justificacion.

Elegir conscientemente los trailing optionals de JOBS/BOARDS/PATTERNS/CUTS. No dejar que la forma sea accidental.

## 12. R5-I — differential fixtures y golden

No copiar byte por byte los archivos del cliente.

Comparar propiedades:

- familias;
- indices;
- shapes;
- field limits;
- mapping PARTS_INF;
- politica PARTS_UDI;
- MATERIALS receiver policy;
- OFFCUTS/Xn;
- ordering.

Agregar un golden r5 generado desde pipeline real que cubra:

- al menos 2 muebles;
- piezas con y sin canto;
- pieza con y sin CNC ref;
- 2 materiales;
- multi-sheet;
- offcut 92/Xn;
- barcode;
- PARTS_INF;
- PARTS_UDI;
- title cerca del limite;
- manifest.

## 13. R5-J — CADLink preflight y field pack

Antes de download:

    serialize
    -> independent parse
    -> spec limits
    -> receiver invariants
    -> semantic readback
    -> manifest hash
    -> PASS

Si falla, no entregar PTX.

Field pack:

    Gxxxxxxxxxxxx.ptx
    manifest.json
    README_FIELD_TEST.txt
    expected_identity.json
    optional label pictures

README_FIELD_TEST debe instruir CADLink con /CAD4 y /RESULT.

Implementar parser pequeño de RLT:

    error
    field
    line
    -> diagnostic code/message

Versionar el catalogo de errores CADLink desde la fuente primaria.

## 14. R5-K — identidad y versionado

Esperado, sujeto a las reglas automaticas existentes:

    profile: ptx-cadmatic-4@r5
    adapter: granete-ptx@1.4.0

Actualizar atomicamente profile descriptor/digest, adapter descriptor/version/digest, shared contract, Go mirror, TS catalog, golden SHA, browser fixture y manifest tests.

r2/r3/r4 quedan exactos.

## 15. UX de confianza

Antes de exito real, la UI debe decir equivalente a:

    CADmatic 4 — candidato r5, validacion de campo pendiente

No usar “compatible”.

Errores deben ser accionables, por ejemplo:

- HEADER title exceeds 25 chars;
- missing label edge authority;
- duplicate CNC drawing ref;
- material receiver profile incomplete.

## 16. Investigacion adicional obligatoria para el agente

Antes de inventar bytes, buscar en este orden:

1. Interface Guide / ayuda CADLink;
2. documentacion HOLZMA/HOMAG de la epoca;
3. documentacion Magi-Cut de labels/machining;
4. muestras saneadas;
5. foros solo como corroboracion.

Preguntas abiertas:

- orden de familias especifico de CADLink 4;
- campos BOARDS/PATTERNS que CAD4 consume aunque sean opcionales;
- limites historicos exactos de CADLink 4.0/4.1;
- mapping de PARTS_INF.DRAWING a etiqueta/config CADmatic 4;
- naming efectivo HPP250 -> BHX en instalaciones antiguas;
- semantica del UDI compacto de las muestras;
- cadlink.ini historico;
- que campos MATERIALS afectan import versus ejecucion.

Cada hallazgo nuevo entra a 06_dossier con URL/localizador y una clase:

    SPEC_REQUIRED
    RECEIVER_EVIDENCED
    PRODUCT_POLICY
    UNKNOWN

STOP RULE:

    sin evidencia -> blank / configurable / fail closed
    nunca “probably” -> hardcoded bytes

## 17. Gate antes de volver a pedir prueba al cliente

No enviar nada hasta que todo esto sea PASS:

- r5 spec preflight;
- title <=25;
- identidad estable de todas las piezas;
- PARTS_INF;
- politica PARTS_UDI explicita;
- machine/material profile completo;
- differential suite R2201/R7301;
- historical r2/r3/r4 immutable;
- manifest exacto;
- field pack con /RESULT;
- CI exact HEAD;
- revision independiente.

## 18. Gate de exito real

Nivel 1 — CADLink:

    RLT = 0 / 0 / 0
    SAW generated

Nivel 2 — CADmatic operator review:

- materiales;
- dimensiones;
- orden de cortes;
- cantidades;
- labels;
- identidad mueble/pieza;
- cantos;
- barcode/drawing ref.

Nivel 3 — no-cut machine dry review.

Nivel 4 — physical controlled cut, fuera de la primera validacion r5.

## 19. Definition of Done

r5 queda listo para campo cuando existe:

    documented PTX compliance
    + receiver-specific HPP250/CAD4 policy
    + full label information
    + durable CNC bridge
    + strict fail-closed preflight
    + differential evidence from R2201/R7301
    + immutable historical revisions
    + reproducible field pack

La confianza no viene de “mas tests” en abstracto. Debemos poder explicar cada byte relevante, su autoridad, su limite y como se verifica antes de tocar CADLink.
