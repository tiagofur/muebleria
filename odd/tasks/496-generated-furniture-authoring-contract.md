# ODD — #496 [P0] Generated furniture, authoring and Design API contract with versioned cross-surface schema parity

**Issue**: https://github.com/tiagofur/muebleria/issues/496  
**Title**: [P0] Generated furniture, authoring and Design API contract with versioned cross-surface schema parity  
**Status**: IN_PROGRESS  
**Lane**: ODD  
**Base**: `main` @ `1194bddc` (post #497, #775, #929 all merged)  
**Branch**: `feat/496-generated-furniture-authoring-contract`  
**Writer**: tiagofur

---

## Outcome

Reconcile the authoritative API contracts across Go, TypeScript (React / `@granete/storage`), and Ruby (SketchUp extension) for:
1. **Furniture definitions catalog**: `GET /api/furniture/definitions`.
2. **Authoritative composition layout**: `GET /api/furniture/definitions/{definitionId}/layout`.
3. **Stateless semantic authoring resolve**: `POST /api/furniture/authoring/resolve`.
4. **Structured error envelope**: `ContractIssue` with code, path, severity, and remediation context.
5. **Cross-surface schema parity & drift enforcement**: Automated OpenAPI and JSON Schema generation with zero uncommitted drift.

This unblocks #497 (React Typed Parameter and Catalog Workspace) by providing fully typed generated clients without handwritten `fetch` calls, type casts, or duplicated business logic.

---

## Acceptance Criteria (from issue #496)

- [ ] Current furniture definition, layout and authoring resolve endpoints exist in the generated API authority (`contracts/openapi/granete-api.v1.yaml`).
- [ ] OpenAPI references/reuses the versioned authoring JSON Schema instead of restating an incompatible shape.
- [ ] TypeScript generated client (`packages/storage`) can call all current furniture endpoints without handwritten `fetch`/casts.
- [ ] Go responses and generated/runtime validators agree on valid and invalid fixtures.
- [ ] Ruby consumes the same schema identity/version and shared corpus without hand-maintained divergent payloads.
- [ ] CI detects drift in spec, generated code and referenced schemas (`scripts/check_openapi_drift.py`).
- [ ] Error behavior is code-driven and preserves structured preflight/authoring context (`ContractIssue`).
- [ ] Capability/version mismatch is rejected before SketchUp host mutation.
- [ ] Current stateless resolve remains deterministic and creates no Project business records.
- [ ] The contract can be extended for #385–#395 without introducing a second Design authoring model.

---

## Negative Proof (Review must fail if)

- React calls furniture endpoints through handwritten `fetch` casts or a parallel DTO instead of the generated client.
- OpenAPI and `sketchupAuthoringResolve.schema.json` describe different payloads or drift.
- Ruby accepts a schema/version rejected by Go/TypeScript.
- Endpoint behavior or error handling depends on localized message text instead of stable error codes.
- A version mismatch reaches `FurnitureBuilder` or mutates host metadata.
- A web JWT is accepted as a SketchUp credential merely because the payload is valid.
- A temporary `SketchUpProject` or local business identity is added to bypass #384 / Gate A.

---

## Explicit Exclusions

- Full React UI implementation of the catalog/parameter editor (assigned to #497).
- Persistent Project/Design furniture identity (#385–#395).
- Machine output post-processing (#348, #351).
- Universal visual script editor.

---

## Architecture & Data Flow

```text
 ┌────────────────────────────────────────────────────────┐
 │   contracts/openapi/granete-api.v1.yaml                │
 │   - GET  /api/furniture/definitions                    │
 │   - GET  /api/furniture/definitions/{id}/layout        │
 │   - POST /api/furniture/authoring/resolve              │
 │   - Shared schemas: AuthoringResolve, ContractIssue    │
 └──────────────────────────┬─────────────────────────────┘
                            │
              python3 scripts/generate_openapi.py
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│ packages/storage (TS)     │       │ backend-go (Go)           │
│ - generated/client.ts     │       │ - api/openapi/generated/  │
│ - generated/types.ts      │       │ - api/routes.go           │
│ - consumed by React (#497)│       │ - api/authoring_resolve.go│
└───────────────────────────┘       └─────────────┬─────────────┘
                                                  │
                                                  ▼
                                    ┌───────────────────────────┐
                                    │ apps/sketchup-extension   │
                                    │ - authoring_resolve_      │
                                    │   contract.rb             │
                                    │ - same schema ID/version  │
                                    └───────────────────────────┘
```

---

## Scope Adjustment (post #497 review)

#497 PRs (#930–#936) already landed the following in `granete-api.v1.yaml`:
- `GET /catalog/modules` + `POST` (create)
- `GET /catalog/modules/{moduleId}` + `PUT` (If-Match guarded)
- `FurnitureParameterDefinition` + binding/relationship/family schemas
- Drift gate extension for catalog-module surface
- Generated TS client (`listCatalogModules`, `getCatalogModule`, `createCatalogModule`, `updateCatalogModule`)
- Cross-surface golden `furnitureAuthoringCrossSurface.fixture.json`
- `POST /api/furniture/authoring/preview` (Go + TS — intentionally NOT in YAML; golden-pinned)

**Remaining scope** (what #497 did NOT touch):
1. `GET /api/furniture/definitions` — public SketchUp catalog projection
2. `GET /api/furniture/definitions/{definitionId}/layout` — geometric layout for SketchUp
3. `POST /api/furniture/authoring/resolve` — the canonical stateless resolve (preview is #497; resolve is #496)
4. `ContractIssue` structured error schema
5. Ruby SketchUp contract adapter formal alignment

---

## Tasks

### T1 — OpenAPI Contract: 3 SketchUp-facing endpoints
**Files**:
- `contracts/openapi/granete-api.v1.yaml`
- Add paths:
  - `/furniture/definitions` (GET) — SketchUp catalog
  - `/furniture/definitions/{definitionId}/layout` (GET) — geometric layout
  - `/furniture/authoring/resolve` (POST) — stateless canonical resolve
- Add components/schemas:
  - `WorkshopFurnitureCatalogEnvelope`
  - `WorkshopFurnitureDefinition` (reuse `FurnitureParameterDefinition` already in spec)
  - `FurnitureDefinitionLayout`
  - `AuthoringResolveRequest`
  - `AuthoringResolveResponse`
  - `ContractIssue` (structured error: code, path, severity, remediation)

### T2 — Drift Gate Extension
**Files**:
- `scripts/check_openapi_drift.py`
- Extend existing drift gate (already updated by #497) to enforce the 3 new endpoints.
- Align JSON schema with `sketchupAuthoringResolve.schema.json` — verify zero drift.

### T3 — TypeScript Generated Client
**Files**:
- `packages/storage/src/openapi/generated/client.ts`
- `packages/storage/src/openapi/generated/types.ts`
- Run `pnpm openapi:generate` after T1; verify typecheck across all workspace packages.

### T4 — Go Backend Error Model Alignment
**Files**:
- `backend-go/internal/api/authoring_resolve.go`
- `backend-go/internal/api/furniture.go`
- `backend-go/internal/api/furniture_layout.go`
- Structured `ContractIssue` error envelopes with stable codes (`SCHEMA_VERSION_UNSUPPORTED`, `AUTHENTICATION_REQUIRED`, etc.).
- Capability/version mismatch rejected BEFORE host mutation.

### T5 — Cross-Surface Contract Tests
**Files**:
- `backend-go/internal/api/authoring_resolve_test.go`
- `backend-go/internal/api/furniture_test.go`
- `backend-go/internal/api/furniture_layout_test.go`
- `apps/sketchup-extension/test/unit/authoring_resolve_contract_test.rb`
- Validate Go, TypeScript and Ruby agreement on resolve golden and invalid corpora.

---

## Verification Plan

| Level | What | Pass Condition |
|---|---|---|
| V0 | `python3 scripts/factory_preflight.py` | Tools OK, branch clean |
| V0 | `python3 scripts/check_openapi_drift.py` | 0 drift |
| V0 | `pnpm run typecheck` | 0 TypeScript errors |
| V1 | `go test ./internal/api -run 'Test(AuthoringResolve\|Furniture)'` | All furniture API contract tests pass |
| V1 | `bundle exec rake test TEST=test/unit/authoring_resolve_contract_test.rb` | SketchUp Ruby contract adapter passes |
| V2 | `scripts/pilot-gate.sh --fresh-container` | Multi-tenant and operational gates pass |
