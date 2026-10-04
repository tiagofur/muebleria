# ODD — #1052 slice 1: persistencia del bloque construcción del componente

## Scope aprobado

Issue #1052 (status:approved, decisión del owner: opción B por slices).
Slice 1: constructiveRole / connectionFaces / joinerySystemId pasan a dato
persistido del componente (entity + API + storage + round-trip web). El
motor NO consume el bloque en este slice (slice 2 aparte, coordina con #874).
Las estaciones/márgenes siguen siendo excepción del overlay de fábrica (#875).

## Cambios

- Migración 000152: `components.construction jsonb` (NULL = hereda todo).
- Go domain: `Component.Construction *ComponentConstruction` (rol, caras,
  sistema). `engine.ValidateComponent` valida vocabulario (fail-closed).
- Go storage: columna en List/Get/Create/Update (jsonb NULL-safe).
- TS domain: `Component.construction?` (tipos de factoryConstructionPolicy).
- TS storage: `componentToApi`/`componentFromApi` (clave wire `construction`).
- Web: `componentToDraft` siembra `constructionOverride` desde la entity;
  `draftToComponent` emite el bloque; `draftWithStoredException` MERGEA
  entity + excepción de estaciones (antes reemplazaba).
- El CRUD de componentes vive fuera del spec acotado v1 (como sus campos
  hermanos) — sin regeneración de cliente en este slice.

## Riesgos / no goals

- `duplicateComponent` hace spread — construction viaja gratis.
- Releases/manifests: campo aditivo; manifests nuevos lo incluyen sólo si
  está seteado. No se toca el resolve.
- JoineryPanel: sin cambios (los select ya editan el draft; estaciones
  siguen con su botón de excepción explícito).

## Verificación

- V0: drift check verde; `pnpm typecheck` 7/7 verde.
- V1: suite Go completa `scripts/backend-test.sh ./...` VERDE en PG descartable
  real (api 21.9s, storage 475.8s con TestComponentConstruction_roundTrip,
  pilotreadiness 184.6s); validación de vocabulario (engine) y round-trips TS:
  storage 251/251, web 583/583, ui 2120/2120.
- V2 (owner): editar caras+sistema en Construcción → Guardar → reabrir sin
  F5 y con F5 → persiste; Duplicar conserva el bloque.

## Entrega

Slice 1 completo. Resta slice 2 (#1052): consumo del bloque por el engine
(semántica por definir, coordinar con #874). PR con `Refs #1052 +
Delivery: partial`.
