# ODD 1130 — Entidad Opening Profile (épica #1128)

- **Issue**: #1130 (`status:approved`; depende de #1129, mergeado).
- **Base**: origin/main @ d20456ea.
- **Rama**: `feat/1130-opening-profile` (worktree
  `muebles-worktrees/1130-opening-profile`).

## Qué entrega

La entidad de catálogo Opening Profile (gola L/C, REACH…) con el contrato
fail-closed de #1129 como frontera: los parámetros de ficha son
opcionales-en-datos y REQUERIDOS-para-authoring — su ausencia es estado
BLOQUEADO (OQ-2), nunca default.

- **Migración 000160** (+down): `opening_profiles` org-scoped desde el
  nacimiento (patrón 000083), version para If-Match, CHECKs de enums y de
  geometría no-negativa, JSONB para body_modifiers (data por rol
  constructivo, #1052) y bom_members (referencias SKU + reglas de longitud,
  nunca un segundo resolver BOM).
- **Dominio Go**: `OpeningProfile` + `AuthoringReady`/`AuthoringBlocker`
  (razón explícita) + `ValidateOpeningProfile` (verified-implies-complete:
  ficha verificada sin los 4 parámetros o sin origen auditable rechaza el
  write).
- **Storage**: CRUD con If-Match (update/deactivate versionados), listado
  org-scoped, JSONB tipado.
- **API**: `GET/POST /api/catalog/opening-profiles` +
  `GET/PUT/DELETE /{id}` — lectura cualquier miembro, escritura rol
  catálogo, writes con `RequireIfMatch`.
- **TS**: entidad + mappers from/to (geométrica ausente = undefined, nunca
  0), fetch con catch para backends viejos, save loop con upsertGuarded,
  `Catalog.openingProfiles`.
- **Seeds**: los dos perfiles piloto Cymisa (GOLA-L-ALU superior, GOLA-C-ALU
  intermedia) nacen PENDING sin geometría con los SKUs del doc como
  referencias BOM — nada inventado; la ficha real (OQ-2) los habilita.

## Verificación

- Go: build/vet limpios; api suite (RBAC create vendedor 403, pending
  persiste, verified-sin-geometría rechazado en el write boundary); storage
  round-trip + If-Match + tenant (test PG `TestOpeningProfile_roundTripAndIfMatch`
  — SKIP local, corre en CI con PG desechable).
- TS: mapper test (geometría ausente = bloqueada nunca default), typecheck
  0, suite workspace verde.

## Reste explícito

- Valores reales de ficha: llegan del proveedor (OQ-2) y se cargan como
  update verificado con origen auditable — la entidad ya los exige.
- Consumo del resolver (#1131) y body modifiers (#1132): la entidad declara
  los datos, no la lógica.
