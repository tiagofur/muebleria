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
- Slice 2: **MERGEADO** (PR #1334, main b494072f): board en la banda del gola (ancho completo ×
  profundidad × alto, rol FRENTE) + espejo BOM como BoardPart + fail-closed por componente
  ausente/inactivo. Proyección: OpeningMembers.ComponentMembers desde el pin. NOTA de proceso:
  había trabajo SIN commitear de otro agente en el checkout compartido (authoring_fixed_shelf.go,
  joinery_system_contract_test.go) — se dejó intacto, commit solo con rutas explícitas.
- Slice 3 (bevel 45°): **IMPLEMENTADO** — rama `feat/1327-door-bevel` sobre main b494072f.
  - Declaración: `bevel_angle_deg`/`bevel_size_mm`/`bevel_at` en `OpeningBodyModifier` (JSONB
    aditivo) + contrato camelCase + esquema OpenAPI (`OpeningProfileBodyModifier`,
    `ManufacturingRoutingBevel` nuevo) + regeneración + editor React (sección «Bisel 45° en la
    puerta», ángulo 45 constante) con round-trip que PRESERVA un bisel declarado por API.
  - Resolver: efecto `bevel` — ángulo+tamaño+posición completos, SÓLO 45° (v1), top_front/bottom_front
    coherente con la frontera; rechaza mezclas depth+bevel y notch+bevel (hueco cerrado: un modifier
    con campos de saque Y de bisel sin `effect` entraba al caso notch y tragaba el bisel en silencio).
  - Fixture compartido: casos I/J (resolución top/bottom) + 5 inválidos; Go y TS en verde (una autoridad).
  - Layout: `LayoutBevel` (prisma bounding + ángulo + edge) materializado en las puertas por
    `applyOpeningBevelsToBoards` (rol `door` único consumidor, fail-closed en rol/between/no-cabe;
    el ancho del wedge es estricto — la puerta de 18 mm no admite patas de 18).
  - Mecanizado: op `<board>:bevel-<n>` con payload `bevel` (nunca caja rectangular) y provenance
    openingProfile; mueve el fingerprint y es determinista.
  - Release routing: intent neutral `bevel` congelado + validación fail-closed (wedge presente,
    sin holes/routing, 45°, edge conocido, extents positivos, provenance openingProfile).
  - Consumidor externo honesto: `composeFrozenDrilling` (pack web) RECHAZA explícito
    (`OPERATION_NOT_REPRESENTABLE`) una op bevel — nunca la dropea en silencio; CNC real queda para
    el adaptador que evidencie corte angular («estructura primero, CNC después»).
  - Verificación: engine+domain Go verdes; storage round-trip JSONB del bisel en suite completa
    (backend-test.sh, contenedor efímero); vitest domain 1977 + ui 2248 + web export-pack 16;
    typecheck workspace; check_openapi_drift OK; rake verify plugin verde (extensión sin cambios).
