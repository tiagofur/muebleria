# ODD — #1327 Gola italiano: tira de melamina como componente del perfil + corte 45°

Issue: https://github.com/tiagofur/muebleria/issues/1327 (status:approved 2026-10-14)
Lane: Delegated Direct — 3 slices, un PR cada una. Este artifact es la memoria de ejecución.

## Decisiones de diseño (owner + arquitectura)

- La tira ES un tablero: material/color de la puerta, va al despiece, renderiza como panel.
- El perfil de apertura la referencia como BOM member tipo componente (`component_id` en vez de
  `hardware_id`); viaja congelada en el pin como cualquier member.
- El material de la tira resuelve por el **rol de la puerta** (option role FRENTE del módulo) —
  color de puerta automático, sin dato nuevo en el member.
- El descuento de puerta del perfil gola italiano usa el campo #1316 (`door_reduction_mm`).
- El corte 45° de la puerta = body modifier nuevo (efecto `bevel`) con consumidor de routing
  (pipeline #1304 reusado).

## Slices

### Slice 1 — Member tipo componente (contrato + editor) — ESTE PR
- `OpeningBOMMember.ComponentID` (jsonb aditivo, sin migración — el map es JSONB).
- Spec OpenAPI `OpeningProfileBOMMember.component_id` + regeneración.
- Editor React: los members dejan de ser read-only — ABM con clave + tipo (herraje|componente) +
  referencia + regla + unidad + spacing/dims opcionales. Round-trip preservado en edición.
- Tests: draft round-trip con member componente; storage JSONB round-trip.
- NO incluye consumo (layout/BOM) — slice 2.

### Slice 2 — La tira como board en el layout + despiece (PR siguiente)
- `OpeningMembersFromFrozenPin` proyecta el member componente → el layout pass agrega una **board
  derivada** en la banda del gola (ancho del mueble, alto/espesor del componente, material FRENTE).
- BOM: la misma board entra al despiece como BoardPart (material + cantos), espejo #1305.
- Plugin: renderiza como panel nativo (es un LayoutComponent — sin cambio de plugin esperado).

### Slice 3 — Corte 45° de la puerta (PR siguiente)
- Efecto `bevel` declarado por el perfil (análogo a la muesca #1287): resolver + fail-closed.
- Consumidor: op de routing sobre la puerta (pipeline #1304), estructura primero, CNC después.

## No-goals (por issue)

8006 metálico intacto; §13.4 con fabricante abierto; mecanizado de la tira misma.

## Estado

- Slice 1: **MERGEADO** (PR #1333).
- Slice 2: **EN PR #1334 — CI 22/22 verde** (HEAD a15aa455, rama feat/1327-strip-board): board en
  la banda del gola (ancho completo × profundidad × alto, rol FRENTE) + espejo BOM como BoardPart +
  fail-closed por componente ausente/inactivo. Proyección: OpeningMembers.ComponentMembers desde el
  pin. NOTA de proceso: había trabajo SIN commitear de otro agente en el checkout compartido
  (authoring_fixed_shelf.go, joinery_system_contract_test.go) — se dejó intacto, commit solo con
  rutas explícitas.
- Slice 3 (bevel 45°): pendiente — **diseño de ejecución completo abajo** (sesión fresca).

### Slice 3 — diseño de ejecución (listo para implementar)

**3a. Declaración (resolver, Go + TS paridad + fixture):**
- `OpeningContractBodyModifier`/entity ganan `bevel_mm *float64` (pierna del triángulo 45°, mm).
- Reglas: sólo frontera `top`; sólo rol `door` (el frente, como la muesca usa `lateral`);
  `bevel_mm > 0`; debe caber en el espesor de la puerta (fallar si `bevel_mm >= thickness`).
- Efecto resuelto: `ResolvedOpeningBodyModifier{Effect: "bevel", BevelMm, ProfileHeightMm?}` —
  identidad `bevel|door|top`, dedupe/conflicto como la muesca.
- Fail-closed: bevel en bottom/between, rol fuera de vocabulario, size inválida.

**3b. Consumidor (routing, pipeline #1304 reusado):**
- v1 NO modifica la geometría 3D de la puerta (el borde superior queda tapado por la tira) —
  el corte viaja como **op de routing estructurada** en el release program, exactamente como las
  route ops de la muesca (`release_routing.go`): op `bevel_45` sobre la pieza puerta, lado top,
  `size_mm = bevel_mm`, a lo ancho de la pieza, provenance perfil+versión.
- El CNC adapter (KDT/BHX) traduce la op en su formato — misma frontera que las muescas.

**3c. Aceptación:**
- Perfil con bevel → resolve lo lleva → release routing program congela la op sobre la puerta con
  provenance → fail-closed (bottom, rol equivocado, size ≥ espesor).
- Paridad TS + fixture (`openingBodyModifiers.contract.json` caso bevel + inválidos).
- El 8006 metálico sin bevel queda byte a byte (regresión).
