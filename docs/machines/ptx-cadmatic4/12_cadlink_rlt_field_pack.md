# PTX / CADmatic 4 — CADLink preflight, parser .RLT y field pack reproducible

> Addendum de implementación de #792 (fase R5-J del plan #787). Este documento
> modela la fuente primaria CADLink, define el parser de resultados `.RLT`, el
> catálogo versionado de errores, el diagnóstico Granete y el field pack
> determinista. No publica `ptx-cadmatic-4@r5` ni `granete-ptx@1.4.0` (eso
> pertenece a #793), no envía ningún PTX al cliente y no reclama
> compatibilidad: `supportStatus` sigue `NOT_TESTED` / `notClaimed`.

Fuente primaria: ayuda Magi-Cut CADLink (V12 web help, `Cadlink.htm`),
https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm — la misma ayuda
referenciada por `06_dossier_r5_segundo_rechazo.md` §2. La Interface Guide V11
sigue siendo el contrato del FORMATO PTX; la ayuda CADLink gobierna el
COMPORTAMIENTO del conversor.

## 1. `/CAD4` — modo explícito

La ayuda documenta `/CAD4` como el modo que produce archivos de sierra
CADmatic 4 y señala que, si no se indica modo, el programa usa este modo por
defecto. Para la prueba controlada registramos la intención de forma explícita:

```text
/CAD4
```

Explícito no cambia el resultado esperado, pero deja la intención registrada en
el comando reproducible y en el manifest (`fieldTestMode: CAD4`).

## 2. `/RESULT` y el archivo `.RLT`

La ayuda documenta `/RESULT=[path]` como la ubicación para los archivos de
resultado (`.rlt`). Si se importa un único archivo nombrado, normalmente el
resultado puede volver como exit code; `/RESULT` (o `/RESULT=<path>`) fuerza la
creación de archivos de resultado. Para la prueba controlada exigimos `.RLT`:

```text
cadlink.exe "<candidate>.ptx" "<saw-output-dir>" /CAD4 /RESULT="<result-dir>" /UDI /INF
```

El README_FIELD_TEST del pack usa exactamente esa forma con placeholders —
nunca paths privados del cliente ni del entorno de desarrollo.

## 3. Formato `.RLT` para PTX ASCII

Para un PTX ASCII el `.RLT` contiene exactamente tres líneas:

```text
[error number]
[field number]
[line number]
```

Un import exitoso lee `0 / 0 / 0`. El parser `parseCadlinkRlt`
(`packages/excel/src/ptx/cadlinkRlt.ts`) es tipado, independiente y fail-closed:

- acepta CRLF y LF, y permite un único newline final;
- exige exactamente tres valores enteros (signo permitido: los códigos
  documentados incluyen `-1..-4`);
- rechaza contenido extra no vacío, una línea en blanco adicional, un CR suelto,
  bytes no imprimibles/no ASCII y formatos incompletos (`cadlink_rlt.*`);
- sin OCR, heurísticas ni valores inferidos.

`0 / 0 / 0` → `SUCCESS`. `error=0` con `field!=0` o `line!=0` →
`INCONSISTENT_RESULT` (`cadlink.inconsistent_result`): nunca se trata como
éxito silencioso.

## 4. Catálogo versionado de errores CADLink

`CADLINK_ERROR_CATALOG_V1` se construye sólo desde la fuente primaria (nada
inventado). Códigos documentados:

| Nº | Significado documentado (verbatim) | Código Granete | Scope |
|---:|---|---|---|
| -1 | No security key (or incorrect modules for mode) | `cadlink.no_security_key` | GENERAL |
| -2 | Access denied to source path (read) | `cadlink.access_denied_source` | GENERAL |
| -3 | Access denied to destination path (write) | `cadlink.access_denied_destination` | GENERAL |
| -4 | Program initialisation error | `cadlink.initialization_error` | GENERAL |
| 0 | Import successful | `cadlink.import_success` | GENERAL |
| 1 | File not found | `cadlink.file_not_found` | GENERAL |
| 2 | Bad format | `cadlink.bad_format` | GENERAL |
| 3 | Too many jobs | `cadlink.too_many_jobs` | GENERAL |
| 4 | Duplicate jobs | `cadlink.duplicate_jobs` | GENERAL |
| 5 | Too many part types | `cadlink.too_many_part_types` | GENERAL |
| 6 | Too many board types | `cadlink.too_many_board_types` | GENERAL |
| 7 | Too many patterns | `cadlink.too_many_patterns` | GENERAL |
| 8 | Too many cuts | `cadlink.too_many_cuts` | GENERAL |
| 9 | Illegal part index | `cadlink.illegal_part_index` | GENERAL |
| 10 | Illegal board index | `cadlink.illegal_board_index` | GENERAL |
| 11 | Illegal pattern index | `cadlink.illegal_pattern_index` | GENERAL |
| 12 | Illegal cut index | `cadlink.illegal_cut_index` | GENERAL |
| 13 | Illegal Offcut index | `cadlink.illegal_offcut_index` | GENERAL |
| 14 | Cadplan - Too many parts to optimise | `cadlink.cadplan_too_many_parts` | GENERAL |
| 15 | Cadplan - Too many boards to optimise | `cadlink.cadplan_too_many_boards` | GENERAL |
| 16 | Cadplan - Optimiser fatal error | `cadlink.cadplan_fatal_error` | GENERAL |
| 17 | Illegal material index | `cadlink.illegal_material_index` | GENERAL |
| 18 | CADmatic 3 - Job name not valid (contains spaces or > 8 chrs) | `cadlink.cad3_invalid_job_name` | CAD3_SPECIFIC |
| 19 | CADmatic 3 - Part, board or material code too long (> 25 chrs) | `cadlink.cad3_code_too_long` | CAD3_SPECIFIC |
| 20 | CADmatic 3 - Illegal pattern type (no templates allowed) | `cadlink.cad3_illegal_pattern_type` | CAD3_SPECIFIC |
| 21 | CADmatic 3 - Illegal recuts. Pattern number in field value | `cadlink.cad3_illegal_recuts` | CAD3_SPECIFIC |

Reglas del catálogo:

- `18..21` quedan clasificados como `CAD3_SPECIFIC` documentado: son códigos
  del modo CADmatic 3, NO problemas esperados del modo `/CAD4` de esta prueba.
- Un entero desconocido NO se rechaza en el parser: se parsea, se clasifica
  `UNKNOWN_ERROR` y se diagnostica `cadlink.unknown_error`, conservando
  evidencia de futuras versiones de CADLink.

## 5. Significado de field/line — y lo que NO hacemos

La fuente primaria sólo dice "field number" y "line number". No documenta si el
índice de campo es basado en 0 o en 1, ni si incluye la celda de familia, ni la
base del número de línea. Por tanto:

- `fieldNumber` se conserva VERBATIM en el diagnóstico (`CadlinkRltDiagnosis`).
  Nunca se convierte automáticamente en `fieldName = MAT_INDEX` o similar.
- `lineNumber` también se conserva verbatim. Lo único que derivamos —sólo desde
  los bytes reales del candidato— es el contexto de la línea reportada:
  `ptxLineContextAt(bytes, line)` interpreta el número como índice 1-based de
  las líneas de texto del PTX y reporta la familia (`CUTS`, `MATERIALS`, …)
  únicamente cuando la primera celda de esa línea es una familia PTX documentada
  (tabla del parser), junto con el hash SHA-256 de la línea cruda y su conteo de
  celdas. Si la línea está fuera de rango o no es identificable, no se inventa
  nada.
- El diagnóstico nunca inventa causa raíz: `error 2 = Bad format` NO significa
  automáticamente "HEADER incorrecto" si line/field no lo demuestran.

Diagnóstico ejemplo (estructura real de `diagnoseCadlinkRlt`):

```text
outcome           = FAILURE
diagnosticCode    = cadlink.illegal_part_index
errorNumber       = 9
documentedMeaning = Illegal part index
fieldNumber       = 8        (verbatim, sin mapping a nombre)
lineNumber        = 42       (verbatim)
ptxLine.family    = CUTS     (derivado de los bytes, línea 42)
candidateSha256   = 239e9f…
```

Nunca incluye datos privados adicionales del cliente.

## 6. `/UDI /INF` — orden de information boxes

La ayuda documenta `/INF=[n-m]` (rango de campos PARTS_INF) y `/UDI=[n-m]`
(rango de campos PARTS_UDI), y que el orden interno por defecto es `/UDI /INF`
— primero los campos PARTS_UDI (hasta 60), después los PARTS_INF. Ese orden
cambia el orden de las information boxes del `.SAW`.

Nuestra intención de field test usa el default documentado:

```text
/UDI /INF
```

salvo evidencia futura del receiver. `PARTS_UDI` = hasta 60 campos definidos
por el usuario; `PARTS_INF` = campos fijos de información de pieza. Ni el
README ni el manifest afirman que las opciones fueron efectivas (ver §7).

## 7. `cadlink.ini` — riesgo de override completo

La fuente primaria es explícita: si CADLink encuentra `cadlink.ini` en el
directorio del programa (el que contiene `cadlink.exe`), ignora TODAS las
opciones de línea de comando y usa el ini.

No aceptamos la inferencia "el comando dice `/CAD4 /RESULT` ⇒ la configuración
efectiva fue `/CAD4 /RESULT`". El field report del README exige registrar:

```text
cadlinkIniPresent:        true | false | unknown
effectiveOptionsVerified: true | false
```

y el manifest declara `cadlinkIniOverrideRisk` en `cadlinkIntent`. Si existe
ini: registrar que existe, capturar sólo las opciones relevantes saneadas, no
copiar credenciales ni paths sensibles al repo, y ejecutar únicamente bajo
configuración autorizada por el operador.

## 8. Field pack — estructura y determinismo

`buildCadlinkFieldPack` (`packages/excel/src/ptx/cadlinkFieldPack.ts`) produce
un pack determinista (misma entrada ⇒ mismos bytes, archivo por archivo):

```text
<candidate>.ptx
manifest.json
expected_identity.json
README_FIELD_TEST.txt
CHECKSUMS.sha256
+ imágenes de label opcionales (sólo si existen realmente)
```

Pipeline fail-closed — si cualquier gate falla, NO existe pack
(`CadlinkFieldPackError`, códigos `field_pack.*` estables):

```text
opciones + identity pins no-vacíos
→ parse independiente (parsePtxDocumentBytes)
→ validatePtxDocument
→ strict spec preflight (#788)
→ receiver policy presente (#790)
→ receiver/product semantic readback (#791)
→ udiPictureRef resuelto a archivo real o bloquea
→ hashes → archivos
```

No existe la ruta "PTX inválido → generar pack igualmente". No se crea un
segundo verifier: se reusan parse/validate/spec-preflight/readback existentes.

### 8.1 Identity pins obligatorios

El pack exige pins explícitos del caller (`CadlinkFieldPackIdentityPins`):
machine profile id/revision, output compatibility profile id/revision/digest,
postprocessor adapter id/version/implementation digest. `#792` NO publica
identidades productivas: los tests usan pins `LAB_TEST_ONLY` inequívocos. #793
suministrará `ptx-cadmatic-4@r5` / `granete-ptx@1.4.0` reales; el mapper
`cadlinkFieldPackIdentityPinsFromSelection` acepta un `MachineOutputSelection`
estructural (digest `null` ⇒ falla cerrado como pin faltante, nunca comodín).

### 8.2 Hashing sin circularidad

```text
manifest.json          → contiene hash+byteLength del PTX y metadata del payload
expected_identity.json → identidades esperadas; NO contiene hash del manifest
CHECKSUMS.sha256       → hashes de PTX, manifest.json, expected_identity.json,
                         README_FIELD_TEST.txt e imágenes, ordenados por nombre
```

Serialización determinista: `canonicalJson` (claves ordenadas, sin whitespace)
+ newline final para los JSON; README ASCII CRLF; CHECKSUMS LF estilo
`sha256sum` (separador de dos espacios). Sin timestamps, sin fecha actual, sin
paths absolutos, sin hostname, sin nombre de usuario.

### 8.3 Imágenes de label

#789 permite `udiPictureRef` pero no genera imágenes. Por tanto: sin imágenes
reales no se añade ninguna — nada de PNG placeholders ni imágenes vacías ni
copias privadas del cliente. Cada imagen debe tener nombre determinista (basename
ASCII seguro, sin `..`, sin paths absolutos) y hash incluido; cualquier
`udiPictureRef` debe resolver a un archivo real del pack o el builder bloquea
(`field_pack.picture_missing`). La generación visual queda fuera de #792.

### 8.4 README_FIELD_TEST.txt

Generado desde código, ASCII simple (entorno Windows antiguo), con secciones:
(A) NO cortar — "THIS TEST IS IMPORT/CONVERSION ONLY / DO NOT START THE SAW /
DO NOT CUT MATERIAL" (también en español) y NO ejecutar el `.SAW`; (B) verificar
hashes antes; (C) intención de comando `/CAD4 /RESULT /UDI /INF` con
placeholders; (D) warning MAYÚSCULAS de `cadlink.ini`; (E) procedimiento seguro
directorio controlado, sin tocar el ini productivo sin autorización, campo de
reporte `cadlinkIniPresent`/`effectiveOptionsVerified`; (F) "RETURN THE .RLT
FILE" como evidencia primaria (+ exit code y existencia del `.SAW` si es
posible).

No usamos `/DELETE`: conservamos el PTX original, el `.RLT` y toda la evidencia.

## 9. Readback de resultados de campo

`analyzeCadlinkFieldResult({ rltBytes, ptxBytes, expectedIdentity })` es la API
que #793/#348 consumirá tras la prueba real. Devuelve:

```text
SUCCESS | FAILURE | INCONSISTENT_RESULT | UNKNOWN_ERROR
+ diagnóstico estructurado (diagnoseCadlinkRlt)
+ verificación de identidad (¿el PTX intentado es exactamente el revisado?)
```

Un `.RLT` malformado lanza `CadlinkRltParseError`: evidencia ilegible no es un
outcome. La función NUNCA cambia `supportStatus` (`supportStatusPolicy:
'field-evidence-only'`): un `0/0/0` en test no promueve `NOT_TESTED`; sólo la
evidencia real de un field attempt podrá hacerlo bajo su issue.

## 10. Límites #792 vs #793/#348

- #792 implementa OFFLINE: parser, catálogo, diagnóstico, builder,
  instrucciones y tests. NO ejecuta CADLink (propietario) ni lo instala en CI.
- Los fixtures son sintéticos/ LAB: golden r5 #791
  (SHA `239e9f7c…`, 3303 bytes, sin modificar), muestras saneadas ya
  autorizadas y `.RLT` sintéticos. Nada privado del cliente entra al repo.
- #792 no cambia `profiles.ts` productivo, versión de adapter, routing, catálogo
  de salida, `supportStatus` ni claim de compatibilidad, y no envía PTX al
  cliente.
- #793 publicará las identidades r5 productivas, generará el ÚNICO field pack
  real y ejecutará el intento de campo; #348 gobierna la aceptación/evidencia
  del receptor.

## 11. Cobertura de tests

`cadlinkRlt.test.ts` (21): success CRLF/LF, bad format 2/0/12 con familia
derivada de la línea 12 real, illegal part 9/8/42, illegal material 17/4/23,
CRLF/LF, tercera línea faltante, no-entero, línea extra no vacía, línea en
blanco extra, CR suelto, no-ASCII, vacío, código entero desconocido, éxito con
field/line ≠ 0 ⇒ inconsistente, 18..21 CAD3_SPECIFIC, unicidad/completitud del
catálogo, SHA del candidato, línea fuera de rango.

`cadlinkFieldPack.test.ts` (29): los 25 puntos de aceptación del issue (pack
válido del golden r5, byte-exactitud entre builds, SHA del PTX exacto
`239e9f7c…`, bytes/SHA del manifest exactos, checksums exactos re-hasheados,
expected identity, pins byte-for-byte, receiverPolicyId, README determinista
con `/CAD4` `/RESULT` `/UDI /INF`, warning `cadlink.ini`, NO CUT/NO SAW, sin
`/DELETE` instructivo, sin paths absolutos/usuarios/timestamps, pictures
vacías válidas, PTX corrupto, mutación spec título>25, mutación receiver
RULE1 6→7, mutación semántica 92→93, política faltante, pin faltante, digest
vacío) + bloqueo de `udiPictureRef` sin imagen real, filenames inseguros y la
API `analyzeCadlinkFieldResult` (éxito, fallo estructurado, mismatch de
identidad, `.RLT` malformado).

## 12. Verificación

```sh
pnpm --filter @granete/excel test
pnpm typecheck
python3 scripts/verify_affected.py --base origin/main --plan
```

El golden #791 NO se modifica (regresión custodiada por su test de manifest).
r2/r3/r4/r5-LAB siguen byte-exact.
