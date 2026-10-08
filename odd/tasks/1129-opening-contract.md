# ODD 1129 — Contrato Opening/Front v1 + fixtures de paridad (épica #1128)

- **Issue**: #1129 (`status:approved` — parte del programa OPEN-FRONT
  aprobado; doc: `docs/architecture/opening-front-system.md` + ADR-0009).
- **Base**: origin/main @ 87b67860.
- **Rama**: `feat/1129-opening-contract` (worktree
  `muebles-worktrees/1129-opening-contract`).

## Qué entrega

El contrato canónico v1 (`granete.opening-front.v1`) que separa intención
declarativa de resultado resuelto, con un fixture golden único para
A/B/C/Baseline consumido idénticamente por TS y Go:

- **Fixture compartido** `contracts/openingFrontResolution.contract.json`:
  3 casos de resolución (A 325/325 con gola L; B 152/153/306 con L superior
  + C entre z2:z3 y resto determinista; Baseline 360/360), 2 casos
  bloqueados (C por OQ-3; datasheet pendiente de OQ-2) y 5 inválidos
  fail-closed.
- **Matemática canónica v1** documentada en el fixture: available =
  front − Σ(reducción+holgura); height_i = floor(available×ratio_i/Σ);
  resto 1 mm por zona desde la ÚLTIMA hacia arriba
  (`remainderZonePolicy=last_zone_first`, fija en v1); salidas enteras en
  mm; offsets medidos dentro de la región disponible (los grips consumen
  fuera, listados en boundaries).
- **TS**: `packages/domain/src/openingFront.ts` (tipos + resolver puro +
  códigos de error tipados) con test de contrato.
- **Go**: `engine/opening_front.go` (espejo exacto, códigos idénticos) con
  test de contrato contra el mismo fixture.

## Decisiones de contrato

- Los perfiles del fixture A/B llevan valores placeholder de OQ-2 marcados
  como ENTRADAS verificadas sólo para fijar la matemática; el bloqueo real
  por datasheet pending está probado como caso dedicado (nunca se inventan
  datos: el authoring resuelto exige `verified`).
- El caso C (bottom_overhang) resuelve BLOCKED
  (OPENING_OVERHANG_EVIDENCE_PENDING) hasta evidencia de OQ-3 — intención
  válida, resolución honesta.
- Zona desconocida en un boundary tiene código propio
  (OPENING_BOUNDARY_UNKNOWN_ZONE), distinto de no-adyacente (INVALID).

## Verificación

- TS: tsc 0; contrato 11/11; suite del workspace en verde.
- Go: build + engine/api/storage suites verdes (PG-dependientes SKIP
  local, corren en CI).
- Pendiente en CI: la matriz completa.

## Reste / siguientes slices del programa

#1130 (entidad Opening Profile con fichas reales de Cymisa — cierra OQ-2
cuando el owner aporte la ficha), #1131 (resolver en el authoring resolve),
#1132-#1138 según el orden del doc §11. Este slice no toca resolver del
authoring ni UI: es contrato + matemática + paridad.
