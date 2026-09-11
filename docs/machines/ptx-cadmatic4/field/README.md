# Muestras de campo saneadas — PTX del cliente

Dos archivos `.ptx` reales enviados por el cliente al propietario (2026-09-11),
generados por el optimizador que ellos usan (las notas internas referencian
archivos fuente propios con extensión `.cvj`). **Los originales no se commitean**
(política #504: contienen nombre del cliente, rutas de su servidor y números de
orden/proyecto). El propietario conserva los originales fuera del repositorio.

## Reglas de saneado

Los fixtures preservan **exactamente** la estructura dialectal de los originales:

- misma cantidad de líneas, mismos CRLF, mismos espacios tras las comas,
  mismas líneas en blanco entre familias, mismas comillas y trailing commas;
- **toda celda numérica es byte-idéntica** (CUTS/PATTERNS/OFFCUTS completos y
  todas las medidas de MATERIALS/BOARDS/PARTS_REQ): la evidencia dimensional
  no fue tocada;
- sólo se reemplazaron strings identificatorios: títulos/refs de proyecto y
  orden, nombre del cliente, ruta del servidor, códigos de barras, nombres
  comerciales de cantos/materiales y ambiente.

| Original | Saneado | Contenido |
|---|---|---|
| `R2201.PTX` | `01_muestra_a_saneada.ptx.txt` | 2 tableros, 5 piezas, 2 patrones, 1 offcut, FN 1/2/3/92 |
| `R7301.PTX` | `02_muestra_b_saneada.ptx.txt` | 1 formato de tablero, 12 piezas, 2 patrones (TYPE 0 y 1), 1 offcut, FN 1/2/3/92 |

Análisis y conclusiones: [`../03_evidencia_campo.md`](../03_evidencia_campo.md).

## Advertencias

- Son **evidencia de dialecto**, no programas de máquina: no enviarlos a
  CADLink ni ejecutarlos.
- No constituyen validación del receptor: nada de esto fue importado todavía
  en CADmatic 4. `supportStatus` del perfil sigue `NOT_TESTED`.
