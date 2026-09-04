# Implementación #395 / DT-11 — DesignRevision approval + ProductionRelease exacto

- Fecha: 2026-09-04 (America/Mexico_City)
- Modo: Demo Commercial Rescue
- Base: `main` @ `0eb53be6` (PR #550 / #394 DT-10 mergeado)
- Rama: `feat/395-design-approval-production-release`

## Qué se implementó

El límite completo AUTHORING → published DesignRevision → reconciliation →
APPROVAL → preflight → PRODUCTION RELEASE → baseline manufacturera inmutable.
Al terminar: Granete nunca manda a producción "lo último"; manda exactamente
la revisión aprobada y exactamente el estado de fabricación validado para ese
release (I6).

### Approval explícito de DesignRevision (migración 000118)

- `published ≠ approved`. Nueva transición `published → approved` explícita:
  `POST /api/designs/{designId}/revisions/{revisionId}:approve` (command
  router `{revisionId}:approve` al estilo #392), `RoleCanApproveDesignRevisions`
  (admin, gerente_ventas, ingeniero — vendedor publica pero NO autoriza
  producción), Idempotency-Key durable (`design.approve-revision`).
- El carve-out del trigger `protect_design_revision_immutability`: la ÚNICA
  mutación legal es `OLD.status='published' AND NEW.status='approved'` con
  `approved_by/approved_at` escritos exactamente una vez; columnas de
  snapshot, items, artefactos y provenance siguen inmutables (trigger +
  grants + RLS update policy owner-org).
- Idempotente: re-approve de una revisión ya aprobada = no-op que devuelve el
  estado actual (metadata de aprobación es historia, jamás se reescribe; sin
  segundo audit). `superseded` rechaza.
- Actor/timestamp 100% server-side (claims + NOW()); el body no lleva
  verdictos (§32).
- Audit `design_revision_approved` en la misma transacción (projectId,
  designId, revisionId, revisionNumber, sourceType, actor).

### ProductionRelease server-authoritative (migración 000119)

- Tabla `production_releases`: composite FKs same-project a
  `design_revisions(id, project_id)` y `quote_revisions(id, project_id)`,
  `manufacturing_fingerprint TEXT CHECK ^sha256-[0-9a-f]{64}$`,
  `release_number` único por proyecto, immutability trigger + `GRANT SELECT,
  INSERT` solamente, RLS read = project-organizations / insert = owner-org Y
  revisión approved (backstop RLS detrás del gate transaccional),
  `rls_policy_inventory` registrado. El blob OC-022 client-authored queda
  como legacy (`LegacyProductionRelease`): sin segundo aggregate, el nombre
  canónico `ProductionRelease` es el DT.
- `POST /api/projects/{projectId}/production-releases`
  (`RoleCanReleaseProduction`: admin, gerente_produccion, ingeniero — mapeo
  legacy `production_released`), `GET …/production-releases` y
  `GET …/production-releases/{releaseId}` (read `RoleCanAccessProjects`).
  Todo por OpenAPI generado (Go + TS client con Idempotency-Key default).
- UNA transacción decide todo (§29): lock del project row → revisión EXACTA
  (nunca latest, nunca working copy) misma-project y `approved` → baseline
  comercial EXACTA `accepted` (draft/superseded rechazan) → reconciliation
  #393 + clasificación #394 recomputadas server-side (conflict → bloqueo;
  requiresRequote → `commercial_baseline_outdated`, sin excepción demo §15) →
  preflight manufacturero autoritativo → fingerprint → numbering race-safe →
  INSERT → audit `production_release_created` (mismo tx) → proyección de
  staleness read-only.
- Idempotencia: mismo Idempotency-Key repele byte-idéntico el mismo release
  (nunca P2). Race: `FOR UPDATE` del project serializa numbering
  (`TestProductionRelease_ConcurrentCreationNumbering`); fingerprint y
  preflight derivan de rows immutables dentro del mismo tx (race §31 cerrada
  por construcción).

### Preflight manufacturero y fingerprint (autoridad server-side)

- `domain.RunManufacturingPreflight`: por ítem del revision exacto —
  definición existe en catálogo org, parámetros validados contra el contrato
  published (persisted definitions + proyección width/height/depth de #483,
  que los módulos legacy necesitan), material choices no vacías, sin
  identidades duplicadas, revisión no vacía. Fail-closed: cualquier issue
  bloquea el release completo (`ReleasePreflightBlockedError` con issues
  exactas en el 409). Sin PreflightV2: reutiliza `EvaluateFurnitureParameters`
  como única autoridad paramétrica.
- `domain.ManufacturingFingerprint`: `sha256-<64hex>` sobre JSON canónico de
  los ítems manufacturing-affecting (definition/version/parameters/
  materialChoices, ordenados por FurnitureInstanceID) — extiende el grupo
  manufacturing de #394. `transform/room` EXCLUIDOS deliberadamente: un cambio
  spatial-only produce el MISMO fingerprint y NO marca stale (§25). El
  fingerprint es server-computed (§19); el cliente jamás lo envía.

### Staleness post-release (§24–§26)

- `GET` releases devuelve `staleness`: comparación de fingerprint del release
  vs fingerprint de la última revisión publicada del mismo design
  (`manufacturingStale`, `currentDesignRevisionId/Number`). Proyección
  read-only: el row jamás muta. Nuevos requirements de producción = aprobar la
  nueva revisión + nuevo preflight + nuevo release (nunca retarget §27).

## Negative proofs persistidos (PostgreSQL real)

- `TestProductionRelease_CanonicalPinningNegativeProof`: P1 → R3/Q3; R4 con
  cambio manufacturero publicada después; P1 byte-identical (`to_jsonb`
  antes/después), pins intactos, staleness `manufacturingStale=true`,
  current=2; R4+Q3-stale → 409 `commercial_baseline_outdated`; flujo completo
  requote→accept→approve R4→P2 sin tocar P1.
- `TestProductionRelease_SpatialOnlyRevisionIsNotManufacturingStale`: R4
  spatial-only → mismo fingerprint → `manufacturingStale=false`.
- `TestProductionRelease_Gates`: unapproved → reject; quote draft → reject;
  parámetro inválido → preflight blocked (issue exacta); cross-project →
  fail-closed; design-first sin quote → OK.
- `TestProductionRelease_ApprovalLifecycleAndIdempotency`: replay no-op sin
  segundo audit; org B no ve la revisión; trigger rechaza revision_number,
  approved→published y DELETE.
- `TestProductionRelease_ReleaseRowsAreImmutableHistory`: UPDATE
  design_revision_id / fingerprint y DELETE imposibles hasta para el owner.
- `TestProductionRelease_MultiOrgRLS`: lectura sigue al project
  (explicitly-shared: org B fabricante lee), inserción cross-org imposible.
- `TestProductionRelease_MigrationFreshAndUpgrade`: 119 fresh vs 117+118+119
  upgrade: columnas, políticas, FORCE RLS, inventory.

## Cambios de nombre (sin cambio de comportamiento)

- `domain.ProductionRelease` (OC-022) → `domain.LegacyProductionRelease`
  (+`LegacyProductionReleaseCheck/Code`), convención `Legacy*` ya existente.
  El blob legacy y su flujo PUT quedan intactos para proyectos pre-DT.

## Integración de autoridad (review PR #551)

UNA autoridad de release para todos los consumidores de producción; el rename
solo NO bastaba (el blob seguía siendo la verdad de materials/costing/parts):

- **Punto único de resolución**: `storage.ResolveProjectReleaseAuthority` /
  `GetLatestProjectProductionRelease` — el release canónico #395 gana
  incondicionalmente cuando existe; el blob OC-022 queda SOLO como lectura de
  compatibilidad para proyectos sin release canónico (pre-DT). Los tres
  loaders de snapshot (material planning, job costing, quality) y el guard de
  revisión de part executions resuelven TODOS a través de este punto — nadie
  lee el blob directamente como verdad de release.
- **Writer legacy congelado**: `PUT /api/projects/{id}` preserva el blob
  almacenado cuando existe un release canónico (mismo patrón server-
  authoritative que `p.Installation`): el cliente no puede crear ni reescribir
  verdad de release una vez que la autoridad canónica existe.
- **Authority proof persistido**
  (`TestProductionRelease_AuthorityFeedsProductionConsumers`): con P1(R3/F3)
  + blob legacy coexistente, material planning y job costing resuelven
  exactamente `P1.ID` + `F3` (fingerprint autoritativo, no el token client) y
  quality resuelve `P1.ID`; el control (proyecto sin release canónico)
  mantiene el blob. En API: el guard de part executions rechaza piezas
  estampadas con la revisión legacy y acepta las estampadas con la canónica;
  el PUT freeze deja el blob intacto ante payloads forjados.
- **Preflight y fingerprint — UNA autoridad cada uno** (blockers 2-3): no
  existía preflight server-side de release (el #347 es TS sobre envelopes
  resueltos, sin endpoint; el subset resolve es de authoring) ni fingerprint a
  granularidad revisión (#477 es por envelope resolve no persistido; el
  legacy es token client). `RunManufacturingPreflight` delega la semántica
  paramétrica a `EvaluateFurnitureParameters` (única autoridad #483) y
  existencia de definición al catálogo — sin reglas duplicadas; el estado
  resuelto (#477/#347, reglas industriales) EXTENDERÁ este gate/baseline vía
  schema versionado, no un namespace paralelo. Boundary documentado en el
  código (`AUTHORITY NOTE`).

## Verificación

- `go test ./...` — verde contra PostgreSQL real (backend completo).
- `go vet ./...` — limpio.
- Dominio: fingerprint determinism/order-independence/spatial-only/
  manufacturing-change, preflight ready/blocked/legacy-projection, gate
  comercial, approval validation.
- API: permisos (aprove vs release vs editor), mapping de errores con
  blockers exactos, idempotent replay, router registration.
- `pnpm openapi:generate` + `pnpm openapi:check` — verde (Go + TS generados;
  DesignRevisionStatus ahora published|approved|superseded, con
  approved_by/approved_at).
- `pnpm test` + `pnpm typecheck` — verde (incl. paridad rbac TS
  `roleCanApproveDesignRevisions`/`roleCanReleaseProduction`).

## Hardening semántico del adapter (cleanup final PR #551)

El bridge canónico→legacy usaba el campo `LegacyProductionRelease.BOMFingerprint`
como transporte del fingerprint canónico — semánticamente incorrecto
(`ManufacturingFingerprint` y `BOMFingerprint` no son el mismo concepto).

- **`domain.ResolvedProductionRelease`**: forma neutra de la autoridad de
  release que consumen los subsistemas productivos (ReleaseID,
  DesignRevisionID, ManufacturingFingerprint, ReleasedBy/At, ProjectVersion
  como atributo de origen legacy). Canonical mapea directo
  (`ResolvedFromCanonicalRelease`) — el fingerprint viaja bajo su propio
  nombre. El blob OC-022 mapea SOLO dentro de
  `ResolveLegacyProductionRelease`: la única equivalencia
  `BOMFingerprint → ManufacturingFingerprint` del código vive ahí (fallback
  pre-DT).
- **Consumers** (solo el tipo que reciben, sin reescribir lógica):
  `MaterialPlanningSnapshot.ProductionRelease` y
  `JobCostingSnapshot.ProductionRelease` pasan a
  `*ResolvedProductionRelease`; `BuildCostBaseline` idem (congela
  `Source.ReleaseID/ProjectVersion/BOMFingerprint` — columna OC-080
  persistida conserva su nombre histórico, ahora alimentada por el
  fingerprint resuelto); quality y los guards de part executions usan
  `resolved.ReleaseID`.
- **Resultado**: la idea "canonical ManufacturingFingerprint almacenado/leído
  como LegacyProductionRelease.BOMFingerprint" desaparece del código
  productivo; `BOMFingerprint` queda confinado al adapter legacy (grep
  verificado: solo el adapter lo lee del aggregate legacy; costing/materials
  lo conservan como columna persistida PROPIA).
- **Proofs**: `TestProductionRelease_AuthorityFeedsProductionConsumers`
  (canonical wins P1/F3 con blob LEGACY/OLD-FP coexistente; fallback
  LEGACY/OLD-FP sin release canónico) +
  `TestResolvedProductionReleaseAdapters` (mapeos exactos) + guards de part
  executions (canonical/legacy). Sin cambios de tabla, fingerprint, preflight,
  approval ni wire contracts.
