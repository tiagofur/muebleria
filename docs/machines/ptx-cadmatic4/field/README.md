# Muestras de campo saneadas — PTX del cliente

Dos archivos `.ptx` reales enviados por el cliente al propietario (2026-09-11),
generados por el optimizador que ellos usan (las notas internas referencian
archivos fuente propios con extensión `.cvj`). **Los originales no se commitean**
porque contienen identificadores y rutas privadas del cliente. El propietario
conserva los originales fuera del repositorio.

## Reglas de saneado

Los fixtures preservan la evidencia técnica necesaria para analizar el dialecto:

- misma estructura de líneas, CRLF, espacios tras las comas, líneas en blanco,
  comillas y trailing commas;
- celdas numéricas preservadas para CUTS/PATTERNS/OFFCUTS y magnitudes de
  MATERIALS/BOARDS/PARTS_REQ;
- sólo se reemplazaron strings identificatorios como títulos/refs, cliente,
  rutas, códigos de barras y nombres comerciales.

| Original | Saneado | Contenido observado |
|---|---|---|
| `R2201.PTX` | `01_muestra_a_saneada.ptx.txt` | 2 tableros, 5 piezas, 2 patrones, 1 offcut, FN 1/2/3/92 |
| `R7301.PTX` | `02_muestra_b_saneada.ptx.txt` | 1 formato, 12 piezas, 2 patrones (TYPE 0 y 1), 1 offcut, FN 1/2/3/92 |

Análisis de lo observado: [`../03_evidencia_campo.md`](../03_evidencia_campo.md).
Contrato conservador que Granete puede implementar sin inventar reglas:
[`../04_contrato_r3_refilados.md`](../04_contrato_r3_refilados.md).

## Límite de autoridad

Estas dos muestras prueban **qué produjo el optimizador del cliente en esos dos
casos**. No prueban por sí solas que:

- todo CADLink/CADmatic 4 requiera el mismo dialecto;
- todo offcut use FUNCTION 92;
- exista una fórmula universal para HEAD/recut;
- todos los giros de patrón usen el mismo mapping de lados.

Cuando una regla está respaldada además por el contrato Pattern Exchange se
registra como política del subconjunto r3; cuando no, el código debe fallar
cerrado o dejar el campo sin override.

## Advertencias

- Son **evidencia de dialecto**, no programas de máquina: no enviarlos a
  CADLink ni ejecutarlos.
- No constituyen validación del receptor: ningún PTX generado por Granete fue
  importado todavía en CADmatic 4.
- `supportStatus` permanece `NOT_TESTED` y el claim permanece `notClaimed`.