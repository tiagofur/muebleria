# Implementation #500 / WEB-DT-1 — Project Furniture matrix and physical-unit traceability

- Fecha: 2026-09-05
- Rama: `feat/500-web-dt1-project-furniture-matrix` (base `main@587961fd`)
- Tracker: #396 (#384). Coordinado con #496 (boundary mínimo) y #389 (semántica pending/placed).

## Decisión de boundary #496 (verificación exigida por la issue)

Verificado exclusivamente si el generated API boundary necesario para #500
existía y era suficiente:

- **Ya existía**: `listProjectFurnitureInstances` (identidad/origen/lifecycle/
  display server-computado, terminal incluido), `listQuoteLineFurnitureInstances`,
  designs (`listProjectDesigns`, `getDesignWorkingCopy`, `listDesignRevisions`
  con items inline), `reconcileProjectDesign` (proyección contextual exacta),
  releases (`listProjectProductionReleases` con staleness).
- **Faltaba**: cualquier lectura de QuoteRevisions por proyecto (sólo existía
  `:requote`, que exige base previa). Sin ella no hay selector de contexto
  comercial exacto ni presencia comercial por unidad.

Gap mínimo completado dentro de este vertical (NO se implementó ni cerró #496):

- `GET /api/projects/{projectId}/quote-revisions` → `listProjectQuoteRevisions`
  → `QuoteRevisionDetail[]` (header inmutable + `createdAt` + items por unidad).
- Schemas nuevos `QuoteRevisionDetail` + `QuoteRevisionItem` (join key
  estrictamente `furnitureInstanceId`; snapshot comercial: definición,
  versión, parámetros, materiales, lifecycle). `QuoteRevision` existente NO se
  tocó (cero ripple a `:requote`).

## Backend

- `domain/reconciliation.go`: `QuoteRevisionItem`, `QuoteRevisionDetail`
  (embed + CreatedAt + Items).
- `storage/quote_revisions.go`: `ListQuoteRevisionsByProject` — valida uuid,
  verifica visibilidad del proyecto espejando la política RLS en SQL plano
  (owner/sales/manufacturing), orden determinista (revision_number ASC, luego
  furniture_instance_id), JSON corrupto → `ErrInvalidRevisionSnapshot`
  (fail-closed), proyecto visible sin revisiones → lista vacía (no 404).
- `api/quote_revisions.go`: handler GET con guard `RoleCanAccessProjects`,
  404 uniforme (sin oráculo de existencia), mapeo a DTO generado.
- `routes.go`: registro bajo authMW (read-only).

## Web (React)

- `packages/ui/src/digitalThread/furnitureMatrix.ts` — derivación pura:
  presencia placed/pending por join `furnitureInstanceId` contra el contexto
  de diseño seleccionado (working copy o revisión publicada exacta) — misma
  semántica que el panel #389 del plugin; agrupamiento `Unidad i de N` por
  definición (fallback origen, paridad con plugin); presencia comercial sólo
  del snapshot de la QuoteRevision seleccionada; reconciliación SOLO espejo
  del resultado server; lifecycle terminal queda visible como historia;
  defaults de vista (revisión más nueva / primer diseño en working) que se
  pinean apenas aplican.
- `packages/ui/src/digitalThread/ProjectFurnitureScreen.tsx` — pantalla
  server-backed (React Query + `GraneteApiClient` generado): barra de contexto
  exacto (selectores cotización/diseño/contexto + referencia de release con
  staleness), tarjetas de resumen (activas, cotizadas, en diseño, pendientes,
  requieren atención, retiradas/canceladas), filtros (búsqueda, origen,
  presencia, lifecycle, sólo atención), tabla una fila por unidad física,
  drawer de detalle con procedencia completa (ID técnico sólo en detalle),
  parámetros/materiales del snapshot comercial, diferencias de reconciliación
  y pin de release. Estados distintos: loading/stale/empty/no-results/
  forbidden(403)/not-found(404)/error. Read-only.
- Claves de query tenant-scoped: `projectFurnitureQueryKeys(sessionScopeKey,
  projectId)`; el shell remonta por `organizationKeys.all(sessionScope)`
  (switch de org invalida todo el server state del tenant previo).
- Ruta: `/quotes/:id/muebles` con contexto pineado en query
  (`?qrev=&design=&rev=work|<revisionId>`) — `projectFurniturePath` /
  `projectFurnitureFromPath` en `apps/web/src/routes.ts`. Entrada: menú
  "Hilo digital → Muebles del proyecto" en ProjectDetailView. Guest sin
  token → hint honesto "Iniciá sesión…".

## Pruebas

- Backend handler (sin DB): guard por rol, round-trip DTO con items por
  unidad (incluye unidad sin definición → ausencia de referencia, convención
  absent-when-null), 404 uniforme, lista vacía, uuid inválido, sin leak de
  costos/precios.
- Backend storage (PostgreSQL real, app role): orden/estados/provenance,
  snapshot round-trip, lectura compartida manufacturing org, org no
  relacionada y cross-tenant → `ErrQuoteRevisionNotFound`, corrupt JSON
  fail-closed, proyecto visible sin revisiones → vacío.
- UI pura (13): qty=3 → 3 identidades distintas con Unidad i de N (sin usar
  QuoteLine id como identidad), colocación parcial (2 placed / 1 pending),
  orígenes mixtos + duplicado con padre, presencia comercial exacta por
  revisión seleccionada (cambio de revisión = retarget explícito),
  reconciliación sólo espejo server (nunca inventa quoted_not_modeled),
  unidades terminales visibles, presencia desde revisión publicada exacta,
  filtros, defaults, release.
- UI pantalla (11): sólo cliente generado (source proof + sin fetch manual),
  claves con scope/tenant, qty=3 en DOM, placed/pending desde working copy,
  revisión exacta pineada vía onContextChange y sin POST /reconciliation sin
  revisión publicada exacta, badges de reconciliación server, honestidad sin
  diseño, estados empty/no-results/forbidden/cross-tenant distintos, pin de
  release.
- Rutas web (apps/web): parser/builder del path con contexto pineado +
  round-trip + lookalikes rechazados + mapeo a nav quotes.

## Verificación ejecutada

- `pnpm openapi:generate` + `pnpm openapi:check`: sin drift.
- `pnpm typecheck`: verde (monorepo).
- `pnpm test`: verde (ui 1532+, web 415+).
- `GOFLAGS='-p=1' go test ./... -count=1` (backend-go, PostgreSQL 5445 real): verde.

## Fuera de alcance (explícito)

- #496 completo (sólo se cerró el gap mínimo de lectura descrito arriba).
- Mutaciones desde la matriz (cancel/split/merge/reassign) — la vista es
  read-only por decisión de la issue.
- #501 Designs/artefactos y #502 reconciliación/requote/approval/release
  como flows con UI (la matriz sólo los muestra como contexto).
- Nacimiento HTTP de la PRIMERA QuoteRevision (hoy storage-level, igual que
  antes); la vista degrada honestamente a "Sin revisiones de cotización".
