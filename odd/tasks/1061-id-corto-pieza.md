# ODD — #1061 ID corto de pieza (≤10 chars): despiece ↔ etiqueta ↔ filename CNC

- **Issue**: tiagofur/muebleria#1061 (`status:approved`; naming cerrado con el
  owner en la demo KDT 2026-10-04, go de cola 2026-10-16).
- **Lane**: Delegated Direct. Un escritor. Sesión de implementación aparte.
- **Base**: moverse sobre main ≥ `64ce0e2d`.

## Decisión de naming (owner, demo 2026-10-04 — autoridad)

UNA función de nombre para todo formato (XML KDT, DXF, MPR, etiqueta/barcode):
**el ID del despiece** — ordinal de mueble congelado + secuencia de pieza
(`1-P01`). Cara como sufijo A/B SOLO si la pieza tiene programas en dos caras
(`1-P01-A.xml` / `1-P01-B.xml`); piezas de una cara sin sufijo (`1-P04.xml`).
Nada de prefijos por formato ni por máquina (el `K` del serializer KDT no va).

## Diseño resuelto (esta investigación)

1. **Autoridad del ID**: `${workshopOccurrenceOrdinal}-P${seq}` — el ordinal
   es la posición de la unidad en el orden congelado de la liberación
   (`ReleaseCuttingDemandUnitView.workshopOccurrenceOrdinal`, #781: "la
   autoridad compartida detrás de los workshop codes"); `P${seq}` es la
   secuencia por unidad del demand congelado (`part_code`). Único por
   liberación por construcción: (ordinal, seq). La función de naming vive en
   **domain** (`packages/domain/src`), fail-closed ante duplicados.
2. **Estado actual de los tres formatos** (a reemplazar):
   - KDT: `kdtArtifactFileName` = `K<hex12>.xml`, hash de
     jobId+pieceCode+face (`outputSelectionResolver.ts:557-582`).
   - MPR: `mprArtifactFileName` = `M<hex12>.mpr`, mismo hash.
   - DXF por pieza: `generateDxfByPiece` =
     `${proyecto}_${partCode}_${módulo}_${labelRef}.dxf` con sufijo `_N` de
     colisión (`dxfCutPlanExport.ts:594-640`).
3. **El pieceCode del job real YA es código de taller** —
   `composeFrozenDrilling` propaga `legacy.pieceCode` (proyecto desde
   `projectDrilling.ts:219` `pieceCode: link.labelRef`, forma
   `MOD-...-P01`, sin ordinal). **El ID nuevo requiere el ordinal**:
   - KDT/MPR: `composeFrozenDrilling` debe adjuntar el ordinal por pieza.
     Join disponible: los routing units del snapshot llevan
     `furniture_instance_id`/`furniture_definition_id` y el demand congelado
     mapea unidad→ordinal. Nuevo campo en el pattern (p.ej.
     `workshopOrdinal`), nunca re-derivado del live.
   - El serializer KDT/MPR es agnóstico del nombre (el filename lo arma el
     loop de `generateSelectedMachiningOutput` llamando a
     `kdtArtifactFileName(jobId, piece.pieceCode, face)`) — la revisión r3
     es SOLO confirmar que no hay acoplamiento hash/nombre dentro del
     serializer (verificado: el nombre no entra al XML; el manifest lleva
     la correspondencia pieza→archivo).
4. **DXF**: los rows del flujo de liberación (`releaseCutRowsFromDemand`)
   tienen el ordinal a mano — agregar `workshopId` (`1-P01`) como campo del
   row y que `generateDxfByPiece` lo use como fileName base cuando venga
   (fallback al nombre largo para el flujo legacy no-liberado).
5. **Labels**: `exportPieceLabels` → barcode = `1-P01` (mismo helper de
   domain). Verificar el campo exacto del barcode en el template actual.
6. **Re-pin kit K4 (#1005/#1016)**: fixtures con filenames `K<hex12>`
   pineados (valores esperados + protocolo de campo + hashes si los hay) →
   regenerar con los nombres nuevos. El kit K4 ya se re-pineó una vez
   (r3/r2 del serializer): mismo procedimiento.
7. **Colisiones**: la función falla cerrado si (ordinal, seq, cara) se
   repite en una liberación — jamás sufijo `_N` tipo legacy.

## Aceptación (mapeada a la issue)

- [ ] Despiece muestra el ID corto por pieza, único por liberación.
- [ ] Etiqueta con barcode = ID corto.
- [ ] KDT/DXF/MPR con filenames = ID corto (≤10 chars) sin colisiones.
- [ ] Paridad/contratos actualizados (labels authority, serializers) y kit
      K4 re-pineado.

## Preguntas abiertas para la sesión de implementación

1. **Semántica de `part_code` del demand**: confirmar server-side que la
   secuencia Pnn es per-unidad (reset por unidad) y no global del release —
   el par (ordinal, seq) debe ser total.
2. **Despiece UI**: columna nueva vs reemplazo de labelRef — decisión de
   presentación; el ID corto es proyección de taller, la identidad profunda
   (`partId`) no cambia (exclusión de la issue).
3. ** Orden de los tests del kit K4**: regenerar fixtures ANTES de tocar
   los filename functions para ver el diff completo esperado.
