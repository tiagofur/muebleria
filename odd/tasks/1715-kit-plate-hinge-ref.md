# G-ODD — #1715: kit de bisagra de 2 partes, la base caía en el costado equivocado en puerta derecha

## Diagnóstico
Repro con la elección real del owner (BISAGRA=HER-BIS-QA1031) en MOD-DES-1P-DER: el
brazo (actor:door) cae bien (578.5), la **Copa (fija, actor:body) caía en x=15 (panel
izquierdo)**. Causa: la Copa declaraba `pos:min:0:-37:0` en su design_parts — la regla
#1702 («lado declarado manda») la anclaba al panel mínimo **en ambas manos**; el kit se
usa en las dos manos y la autoría pineaba una.

Primer diagnóstico (asset SKP unprepared de BIS-BLUM, una pieza) aplicaba a otro herraje —
retractado en la issue. El servidor es correcto y simétrico para el caso sin declaración
(heurística #1592, pinnada por los tests KitPlate*).

## Fix
Nuevo ref de etiqueta `pos:hinge:<x>:<y>:<z>`: en tablero de puerta el panel ancla es el
**lado de bisagra de esa puerta**, derivado del propio placement (el mismo umbral de la
heurística #1592: xMm ≤ w/2 ⇒ panel W−tSide; si no ⇒ tSide). Los offsets Y/Z de la
etiqueta viajan como deltas (applyKitPieceDepthHeightDeltas). Los refs min/max/center
conservan la semántica #1702 intacta; el resto de kits con `pos:` (MBOX, 49402645,
HER-LEV) no usa door boards con ref declarado distinto de min — HER-LEV-QA1031-BRAZO
queda con su comportamiento actual (su módulo QA no se tocó).

## Dato
`HER-BIS-QA1031-COPA` (499c8626) design_parts label → `pos:hinge:0:-37:0` vía API
(v18→v19; backups /tmp/granete-backup-1715/).

## Verificación
- Tests nuevos: TestKitPlateHingeRefMountsOnHingeSideWithDepthDelta (DER: x=785, delta
  −37 vs baseline sin etiqueta) + TestKitPlateHingeRefMirroredDoor (IZQ: x=15). Los 3
  tests #1592 originales sin cambios y verdes.
- go test engine + api OK (worktree desde origin/main 3d2da9aa).
- Readback HTTP (backend con el fix): puerta derecha copa x=585 (cara interior costado
  derecho W−T) + profundidad −37; puerta izquierda copa x=15 + profundidad −37.
- TS: parseKitPartPlacementLabel sin el caso hinge queda como seguimiento de paridad
  (el preview web muestra la base sin el desface hasta entonces) — anotado en la issue.
