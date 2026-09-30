# ODD — #775 [P1][LIB-4] Organization manufacturing-library overlays with conflict-safe Granete upstream updates

**Issue**: https://github.com/tiagofur/muebleria/issues/775  
**Title**: [P1][LIB-4] Organization manufacturing-library overlays with conflict-safe Granete upstream updates  
**Status**: COMPLETED  
**Lane**: ODD  
**Base**: `feat/774-lib3-sketchup-sqlite-runtime` @ `3afcf293`  
**Branch**: `feat/775-lib4-library-overlays-rebase`  
**Writer**: tiagofur

---

## Outcome

Enable organizations to customize Granete Standard manufacturing libraries through lightweight, versioned overlays without physically duplicating the catalog, and safely rebase those customizations onto newer upstream Granete Standard releases using a deterministic 3-way rebase engine that detects semantic conflicts:

1. **Lightweight Overlay Representation**:
   - `library_overlays` stores only customized parameters/rules (JSONB) and organization-owned custom resource references.
   - Preserves canonical shared content identity; no second copy of the catalog.
2. **Three-Way Rebase Engine (`OLD BASE`, `NEW BASE`, `CUSTOM`)**:
   - Upstream updates in untouched areas automatically merge into candidate releases.
   - Customer customizations in unchanged upstream areas are preserved.
   - Collisions on the same field or cross-field dependency incompatibilities generate explicit `library_overlay_conflicts` records and block candidate activation.
3. **Safe Conflict Resolution & Immutable Publication**:
   - Resolving conflicts allows choosing: `keep_custom`, `adopt_upstream`, `custom_value`, or `replace_resource`.
   - Resolution produces a new immutable candidate release via the #773 deterministic compiler without modifying historical releases.
4. **Strict Multi-Tenant Isolation & Server Authority**:
   - RLS policies and service checks enforce that Organization A cannot inspect or mutate Organization B's overlays, drafts, or conflicts.
   - Granete Standard remains strictly immutable and unalterable by tenant overlays.

---

## Acceptance Criteria (from issue #775)

- [x] Crear overlay A de un release exacto Standard sin copiar todas las definiciones.
- [x] A personaliza valor industrial permitido y agrega recurso propio; B y Standard no cambian.
- [x] Política tipada y versiones quedan bajo el overlay; no segundo almacén de perfiles.
- [x] Read model/API exponen valores efectivos, origen, restricciones y capacidades para #875; defaults compatibles alcanzan muebles sin edición individual.
- [x] Nuevo upstream no conflictivo conserva personalización y recursos propios tras validación.
- [x] Conflicto mismo campo, dependencia entre campos o cambio estructural bloquea activación y permite resolución explícita segura.
- [x] Resolver conflicto publica nuevo release con provenance/audit, dejando inmutable el anterior.
- [x] Usuario autorizado de fábrica edita/activa el alcance soportado; usar no concede editar; no permisos sobre Standard.
- [x] A no consulta/edita drafts/conflictos/recetas de B por UUID/hash; SQL runtime y API lo demuestran.
- [x] Concurrencia/retry/publish failure no pierden overrides ni dejan estado parcialmente activo.
- [x] Cambiar default/activar/rebase no altera historial; actualización de contexto editable es explícita.
- [x] Fresh+upgrade, RLS, contratos generados y browser de los consumidores pertinentes; pruebas AC01–AC03 y AC09–AC12 de la documentación.
- [x] El hito interno y el autoservicio de #875 se reportan separados; no declarar experiencia final por completar sólo backend o staff admin.

---

## Negative Proof (Review must fail if)

- Creating an overlay clones the full definition graph into a second tenant catalog.
- Rebase silently overwrites customer customizations when upstream changes the same field.
- Conflicting rebase is automatically activated or published without explicit human resolution.
- Resolving a conflict mutates or overwrites historical releases.
- Organization A can access, read, or resolve Organization B's overlay or conflicts by guessing UUIDs.
- Tenant overlay can mutate Granete Standard definitions directly.
- Updating an active library changes historical quotes, revisions, or production releases.

---

## Explicit Exclusions

- Universal visual library/script editor.
- Private arbitrary external forks / ZIP imports.
- Marketplace & commercial add-on billing.
- Implementation of client-side self-service UX (#875 delivers the frontend UI on top of this API).
- Batch historical project migration guessing customer intent.

---

## Architecture & Data Flow

```text
               ┌────────────────────────────────────────────────────────┐
               │              Granete Standard Releases                 │
               │  Release 1.0.0 (OLD BASE)    Release 1.1.0 (NEW BASE)  │
               └───────────┬────────────────────────────┬───────────────┘
                           │                            │
                           │  branched                  │
                           ▼                            │
               ┌───────────────────────┐                │
               │  Organization Overlay │                │
               │  - overrides (CUSTOM) │                │
               │  - custom_resources   │                │
               └───────────┬───────────┘                │
                           │                            │
                           ▼                            ▼
               ┌────────────────────────────────────────────────────────┐
               │            3-Way Rebase Engine (Backend Go)            │
               │  - untouched upstream + custom -> keep custom          │
               │  - upstream changed + untouched -> adopt upstream      │
               │  - both changed same path -> CONFLICT                  │
               │  - cross-path dependency collision -> CONFLICT         │
               └───────────┬────────────────────────────┬───────────────┘
                           │                            │
              No Conflicts │                            │ Conflicts Found
                           ▼                            ▼
               ┌───────────────────────┐   ┌────────────────────────────┐
               │ Publish Candidate Rel │   │ library_overlay_conflicts  │
               │ via #773 Compiler     │   │ - Status: pending_review   │
               └───────────────────────┘   │ - Blocks activation        │
                                           └────────────┬───────────────┘
                                                        │ Explicit Resolution
                                                        │ (keep / adopt / edit)
                                                        ▼
                                           ┌────────────────────────────┐
                                           │ Resolved Candidate Release │
                                           │ Immutable in releases table│
                                           └────────────────────────────┘
```

---

## Tasks

### T1 — Database Schema & RLS Policies (`000141_manufacturing_library_overlays.up.sql`) [COMPLETED]
**Files**:
- `backend-go/db/migration/000141_manufacturing_library_overlays.up.sql`
- `backend-go/db/migration/000141_manufacturing_library_overlays.down.sql`
- Schema:
  - `library_overlays`: `id`, `organization_id`, `library_id`, `base_release_id`, `status`, `overrides (JSONB)`, `custom_resource_ids (JSONB)`, `created_at`, `updated_at`.
  - `library_overlay_conflicts`: `id`, `overlay_id`, `organization_id`, `old_base_release_id`, `new_base_release_id`, `conflict_type`, `path`, `old_base_value (JSONB)`, `new_base_value (JSONB)`, `custom_value (JSONB)`, `status`, `resolution_action`, `resolved_value (JSONB)`, `resolved_by`, `resolved_at`, `created_at`.
  - RLS: strict `organization_id = app_current_organization_id()` on all tables, registered in `rls_policy_inventory` as `'tenant-owned'`.

### T2 — Three-Way Rebase Domain Engine (`internal/domain/library_rebase.go`) [COMPLETED]
**Files**:
- `backend-go/internal/domain/library_rebase.go`
- `backend-go/internal/domain/library_rebase_test.go`
- Pure domain logic without I/O:
  - Diff calculation between OLD BASE and NEW BASE.
  - Diff calculation between OLD BASE and CUSTOM.
  - Automatic merge of disjoint fields.
  - Conflict detection on common paths and cross-path dependencies (e.g., panelThickness vs joint depth).
  - Conflict resolution applicator.

### T3 — Storage Layer & Multi-Tenant Isolation [COMPLETED]
**Files**:
- `backend-go/internal/storage/overlay_store.go`
- `backend-go/internal/storage/overlay_store_test.go`
- CRUD operations for overlays and conflict records with transactional integrity.
- Integration tests running against ephemeral PostgreSQL 16 proving RLS isolation:
  - Tenant A cannot read Tenant B's overlay or conflicts.
  - Direct SQL as `granete_app` cannot bypass RLS.

### T4 — Overlay & Rebase Service Layer [COMPLETED]
**Files**:
- `backend-go/internal/application/overlay_service.go`
- `backend-go/internal/application/overlay_service_test.go`
- Orchestrates overlay lifecycle:
  - `CreateOverlay`: validates base release exists and belongs to Standard.
  - `UpdateOverrides`: validates permitted override paths, rejects unauthorized structural edits.
  - `Rebase`: loads Old Base and New Base manifests, runs 3-way engine, records conflicts or prepares candidate release.
  - `ResolveConflict`: applies resolution action, checks if all conflicts resolved.
  - `PublishEffectiveRelease`: compiles final manifest via #773 `ManifestCompiler` and inserts immutable release.

### T5 — API Endpoints, OpenAPI Contract & Verification Suite [COMPLETED]
**Files**:
- `contracts/openapi/granete-api.v1.yaml`
- `backend-go/internal/api/overlay_handlers.go`
- `backend-go/internal/api/overlay_handlers_test.go`
- `backend-go/internal/api/routes.go`
- Endpoints:
  - `POST /api/manufacturing-libraries/overlays`
  - `GET /api/manufacturing-libraries/overlays/{id}`
  - `PATCH /api/manufacturing-libraries/overlays/{id}`
  - `POST /api/manufacturing-libraries/overlays/{id}/rebase`
  - `GET /api/manufacturing-libraries/overlays/{id}/conflicts`
  - `POST /api/manufacturing-libraries/overlays/{id}/conflicts/{conflictId}/resolve`
- Generated OpenAPI artifacts: types, client, server routes with 0 drift.
- Comprehensive negative proofs: cross-tenant access rejection (404), draft base release rejection (400), invalid path rejection (400).

---

## Verification Plan

| Level | What | Pass Condition | Result |
|---|---|---|---|
| V0 | `python3 scripts/factory_preflight.py` | Tools OK, branch clean | PASS |
| V0 | `python3 scripts/check_openapi_drift.py` | 0 drift | PASS (0 drift, schemas current) |
| V0 | `pnpm run typecheck` | 0 TypeScript errors | PASS (7 workspace packages) |
| V1 | `go test ./internal/domain -run 'Test(ExecuteThreeWayRebase\|Flatten\|ApplyConflictResolution)'` | All 3-way merge and conflict cases pass | PASS (6 tests) |
| V1 | `bash scripts/backend-test.sh -v ./internal/storage -run 'TestOverlayStore'` | Storage and RLS isolation pass on test DB | PASS (4 tests against PostgreSQL 16) |
| V1 | `go test ./internal/api -run 'TestHandle.*LibraryOverlay'` | API endpoints, error taxonomy, and auth pass | PASS (25 tests) |
| V2 | `scripts/pilot-gate.sh --fresh-container` | Database migration fresh+upgrade + RLS inventory pass | PASS (141 migrations, multi-org isolation verified) |
