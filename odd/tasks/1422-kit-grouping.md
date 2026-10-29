# ODD 1422 slice 1 — Agrupación real kit↔partes de diseño

Issue: https://github.com/tiagofur/muebleria/issues/1422 (status:approved 2026-10-29,
«hagamos» — slice 1; slice 2 plantillas queda en la issue).
Base: main `3ac7ab89`. Topología: Delegated Direct. Writer: sesión ZCode 2026-10-29 (única).
Rama: feat/1422-kit-grouping.

## Outcome observable

La lista de Herrajes muestra el juego como UNA fila con badge «4 partes de
diseño» (expandida, las partes anidadas); un chip oculta/muestra las partes.
El detalle de parte linkea a su kit y viceversa. El asistente escribe el
link al crear; RE-ejecutar el asistente sobre un juego legacy (p. ej.
`49402645`) vincula las partes reutilizadas — sin UI extra.

## Decisiones de diseño

- `hardwares.kit_hardware_id` UUID NULL (migración 000171, sin FK física —
  validación server-side fail-closed: kit debe existir en la org, no-self,
  y un kit no puede ser parte de otro kit).
- **Prevención de datos perdidos**: el draft del editor de herrajes lleva
  kitHardwareId (toDraft lo conserva; el payload lo repite) — editar una
  parte NO borra su link.
- Agrupación client-side (el catálogo ya carga completo): partes ocultas por
  defecto con chip «Partes de diseño»; kit con badge «N partes» y sección
  «Partes de este juego» en su detalle expandido; parte muestra «Parte de:
  <kit>».
- Re-vinculación legacy por RE-USO del asistente (idempotencia existente):
  al re-crear un juego cuyos códigos ya existen, las partes reutilizadas
  reciben kitHardwareId en la misma mutación. Sin UI nueva de vinculación.
- Sin guard de hardwareLines sobre partes (open question de la issue) — se
  decide en slice 2 con el flag design_only.

## Tareas

1. [x] domain TS: Hardware.kitHardwareId + validateHardwareKitLink (kit
       existe, no-self, kit-no-es-parte) + 3 tests. 2048/2048.
2. [x] OpenAPI kit_hardware_id (Hardware + HardwareWrite) + regenerate +
       drift 0.
3. [x] Go: struct + validateHardwareKitLink en POST/PUT (422
       HARDWARE_KIT_INVALID; nil-kit del stub tolerado) + storage 5 caminos +
       roundtrip test + API negativo. Migration 000171 (UUID NULL).
4. [x] Mapper TS + draft passthrough (editar una parte NO borra el link) +
       wizard escribe el link en partes NUEVAS y REUTILIZADAS (legacy
       49402645-style se vincula al re-ejecutar el asistente).
5. [x] UI: chip «Partes de diseño: ocultas/visibles» (búsqueda activa las
       muestra siempre), badge «N partes de diseño» en el kit, sección
       «Partes de este juego» en el detalle expandido, chip «Parte de
       <kit>» en la parte. CSS propio de badges.
6. [x] E2E: hardware-kit-grouping.spec.ts — legacy sin link → re-run del
       asistente vincula (readback kit_hardware_id en las 4 partes) →
       lista oculta por defecto + badge + chip + search encuentra +
       edición conserva el link.

## Verificación (V0/V1/V2) — evidencia congelada

- V0: typecheck ws 0 · gofmt limpio · drift 0 · migración aditiva (UUID NULL).
- V1: domain 2048/2048 · ui 275/275 · storage TS 276/276 · go api+domain+engine OK.
- V2: gate organization browser — hardware-kit-grouping **1 passed** +
  regresiones hardware-kit-wizard / agregado-recipe-authoring /
  hardware-design-parts **5 passed** (corrida combinada, PG desechable).
- Ronda de la fase: (1) faltaba la migración 000171 (queries sin columna →
  500 en el gate) — creada; (2) ids de parte del spec no eran UUID válidos
  (la columna es UUID); (3) nil-kit del stubStore → helper tolera nil.

## Entrega

`Refs #1422` + `Delivery: partial` (slice 2 plantillas dinámicas queda en
la issue; guard de hardwareLines sobre partes = open question).

## Slice 2 en rama apilada (feat/1422-kit-templates)

Plantillas de juego declaradas en el dominio (cajón/bisagra/jaladera con
slots, membresías, anclas y motion por plantilla); el asistente pregunta
«Tipo de juego» y arma slots/preview/agregado desde la plantilla
(bisagra → agregado PUERTA con motion rotate y memberships
body/actor:door). Offsets legacy del input solo en el template del cajón.
Tests: dominio 17/17, wizard 7/7, gate bisagra+grouping+wizard 3 passed
(assertion del spec de bisagra corregida: el link apunta al id GENERADO
del kit, no a una constante).
