# ODD 1219 — #1052 slice 2: construcción por componente en el motor

- **Issue**: #1219 (`status:approved` 2026-10-08; semántica propuesta por esta
  sesión y aprobada por el owner). Padre #1052 (slice 1 mergeado).
- **Base**: origin/main @ 87b67860 (incluye #1220: ítem 1-2 del resto de
  #1078).
- **Rama**: `feat/1052-s2-component-construction` (worktree
  `muebles-worktrees/1052-s2-component-construction`).

## Semántica implementada (la de la issue)

**Escalera del sistema de unión efectivo** (peldaño por autoridad, blancos no
gobiernan):
`relación explícita > componente (block slice 1) > familia de fábrica
(systemId) > default por kind`.

**Gate de caras declaradas**: el bloque `connectionFaces` del componente es
una declaración de capacidad física — un ancla cuyo `face` cae fuera de la
capacidad declarada mata la relación con `CONNECTION_FACE_INVALID` (fail-
closed, igual espíritu que STATION_SPAN_INVALID). Declaración vacía =
compatible con todo (componentes legacy); ancla sin cara no puede violar.

## Dónde vive

- `engine/joinery_system.go`: `EffectiveJoinerySystem` (pura, paridad por
  `contracts/joinerySystemResolution.contract.json` consumido por vitest y
  go test) + `resolveJoinerySystem` (lookups del maquinado) +
  `connectionFaceViolation`.
- `authoring_machining.go`: pre-paso del gate en el bucle de maquinado +
  escalera en `deriveRelationshipOperations` (el camino que hoy consume
  sistemas: shelf-support v1/KDT). La política entra tejida desde el resolve
  (`input.FactoryConstructionPolicy`).
- `FactoryJointRule.SystemId`: la familia de fábrica ahora PARSEA su
  systemId (structured + granular — el granular lo detectaba y lo
  descartaba). Los paneles #874 derivan por recetas y no ramifican por
  sistema hoy: el peldaño fábrica queda listo para cuando ramifiquen
  (nombrado, no es config muerta: el parse alimenta la escalera pura y el
  fixture).
- UI (`ComponentEditorJoineryPanel`): readout "Sistema efectivo" con
  provenance (componente/fábrica/biblioteca) junto al selector.

## Verificación

- Paridad: fixture compartido (5 casos escalera + 4 gate) en ambos stacks.
- Unit Go: componente `dowel-only` pisa el default (mismas tablas, sin
  minifix cams); gate bloquea cara no declarada; parse de systemId en ambos
  formatos + blank fail-closed.
- UI: readout con provenance (2 tests) + suite del panel 8/8.
- PG real: `TestComponentConstructionGovernsMachiningDelta` — dos gabinetes
  idénticos salvo el joinerySystemId persistido del entrepaño: el heredado
  taladra cams de minifix, el screw-only no y sigue taladrando tarugos
  (persistencia slice 1 → resolve → delta, un solo cable).
- Workspace: typecheck 0, suite JS 0; Go build/vet/integral verde.

## Reste explícito

- Los derivadores de panel (#874) no ramifican por sistema (recetas por
  contacto): el peldaño fábrica para floor/shelf/back-panel se activará
  cuando eso ocurra.
- connectionFaces gate aplica a relaciones de unión; no gatea placements
  manuales de herrajes.
