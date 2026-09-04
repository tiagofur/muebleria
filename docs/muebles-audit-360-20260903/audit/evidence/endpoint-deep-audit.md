# Critical endpoint deep audit

21 deliberately selected critical demo endpoints, NOT all 265 inventory routes.

Reviewed handler source plus roles, dependency definitions and existing backend/Web/SketchUp/operational reports. Automated extraction adds traceable supporting lines; it is not runtime authorization proof.

## Release boundary

No new standalone manufacturing release route invented. Legacy production_release crosses generic PUT /api/projects/{id}, covered by OP-02; immutable DesignRevision publish is a distinct concern.

## EP-01 — POST /api/auth/login

Purpose: Identity session entry
Auth/roles: Public, auth rate limiter; active account/password and selectable membership checks; no-store
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: email/password, transport and optional organization slug hint
Validation: Uniform invalid-credentials response; organization hint resolves active scope, multi-membership returns selection-required scope
Side effects: Creates session/refresh family through issuance helpers and login audit; no business project
Web/SketchUp: Web login; SketchUp now uses device flow rather than credential sharing
Problems: No new defect asserted; do not show tokens in portal
Evidence: backend-go/internal/api/handlers.go:517-705; backend-go/internal/api/routes.go:102
Storage: GetUserByEmail (backend-go/internal/storage/users.go:31-33); ListMembershipsByUser (backend-go/internal/storage/organizations.go:190-227); UpdateLastLogin (backend-go/internal/storage/users.go:50-65)
Responses: respondWithJSON(w, http.StatusOK, response); respondWithJSON(w, http.StatusOK, response)
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/handlers_test.go:2518; backend-go/internal/api/middleware_test.go:458; backend-go/internal/api/login_org_test.go:72; backend-go/internal/api/auth_transport_test.go:22; backend-go/internal/api/furniture_test.go:315
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-02 — POST /api/auth/select-org

Purpose: Select organization in existing session
Auth/roles: Authenticated session; active membership + active org + nonempty role grants; support sessions denied; no-store
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: organization_id generated request
Validation: MembershipNotSelectable on forbidden target; tenant actor changed only after authoritative selection
Side effects: Session scope/token update and required audit share request transaction
Web/SketchUp: Web organization switch; not a SketchUp credential handoff
Problems: Current browser tenant cache guarantees require consumer/runtime proof
Evidence: backend-go/internal/api/handlers.go:706-864; backend-go/internal/api/routes.go:161
Storage: GetActiveMembership (backend-go/internal/storage/organizations.go:228-237); GetUserByID (backend-go/internal/storage/users.go:93-95); UpdateAuthSessionScope (backend-go/internal/storage/auth_sessions.go:128-192)
Responses: respondWithJSON(w, http.StatusOK, response)
Errors/helpers: ApiErrorCodeMembershipNotSelectable, ApiErrorCodeSessionRevoked, respondWithAPIError, respondWithError, respondWithInternalError
Tests: backend-go/internal/api/session_registry_test.go:226; backend-go/internal/api/login_org_test.go:241
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-03 — GET /api/projects

Purpose: List visible quotes/projects
Auth/roles: RoleCanAccessProjects, then owner filter and manufacturing/cost redaction
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: No pagination parameters consumed in handler
Validation: Storage scoped list then actor owner filter; no mutation
Side effects: Read-only full project collection
Web/SketchUp: Web quotes/project dashboards via apiWorkspaceRepository
Problems: BE-004 / OPS-08: unbounded heavy response; measured scale UNKNOWN
Evidence: backend-go/internal/api/handlers.go:1252-1323; backend-go/internal/api/routes.go:342
Storage: CreateProject (backend-go/internal/storage/projects.go:987-1061); ListProjects (backend-go/internal/storage/projects.go:359-499)
Responses: respondWithJSON(w, http.StatusOK, filtered); respondWithJSON(w, http.StatusCreated, p)
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/quote_line_furniture_instances_test.go:32; backend-go/internal/api/model_binding_contract_test.go:53; backend-go/internal/api/projectEvents_test.go:38; backend-go/internal/api/handlers_test.go:1864; backend-go/internal/api/siteSurvey_test.go:76; backend-go/internal/api/internal_messages_test.go:81; backend-go/internal/api/middleware_test.go:268; backend-go/internal/api/designs_test.go:43; backend-go/internal/api/design_binding_test.go:60; backend-go/internal/api/projectOwnership_test.go:60; backend-go/internal/api/reconciliation_test.go:41; backend-go/internal/api/partExecutions_test.go:81
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-04 — POST /api/projects

Purpose: Create draft quotation/project
Auth/roles: RoleCanMutateProjects; actor-createdBy and owner resolver; org ownership authorization
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: domain.Project JSON; customer/items/material option UUIDs
Validation: Required related IDs validated; status forced draft, default currency MXN; duplicate key conflict
Side effects: CreateProject persists new aggregate
Web/SketchUp: Web create quote via apiWorkspaceRepository
Problems: No route-level durable idempotency wrapper on this legacy aggregate route
Evidence: backend-go/internal/api/handlers.go:1252-1323; backend-go/internal/api/routes.go:343
Storage: CreateProject (backend-go/internal/storage/projects.go:987-1061); ListProjects (backend-go/internal/storage/projects.go:359-499)
Responses: respondWithJSON(w, http.StatusOK, filtered); respondWithJSON(w, http.StatusCreated, p)
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/quote_line_furniture_instances_test.go:32; backend-go/internal/api/model_binding_contract_test.go:53; backend-go/internal/api/projectEvents_test.go:38; backend-go/internal/api/handlers_test.go:1864; backend-go/internal/api/siteSurvey_test.go:76; backend-go/internal/api/internal_messages_test.go:81; backend-go/internal/api/middleware_test.go:268; backend-go/internal/api/designs_test.go:43; backend-go/internal/api/design_binding_test.go:60; backend-go/internal/api/projectOwnership_test.go:60; backend-go/internal/api/reconciliation_test.go:41; backend-go/internal/api/partExecutions_test.go:81
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-05 — PUT /api/projects/{id}

Purpose: Save project and legacy status/production-release state
Auth/roles: Actor ownership; RoleCanMutateProjects normally, RoleCanMarkProduced/reopen permissions for transitions
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: Full domain.Project; id path; status and embedded production_release
Validation: Preserves installation/org ownership; role-specific produced change; freezes structure pins; checks appended event/closeout gates
Side effects: UpdateProject replaces aggregate; legacy release fields travel here, not a dedicated release command
Web/SketchUp: Web projectStore patch/changeProjectStatus via saveProject
Problems: OP-01 frozen quote price and OP-02 generic physical-state writer; OP-03 optimistic Web success. Dedicated immutable manufacturing release endpoint NOT established
Evidence: backend-go/internal/api/handlers.go:1373-1551; backend-go/internal/api/routes.go:345
Storage: DeleteProject (backend-go/internal/storage/projects.go:1242-1258); GetFullCatalog (backend-go/internal/storage/projects.go:163-293); GetProjectByID (backend-go/internal/storage/projects.go:754-985); UpdateProject (backend-go/internal/storage/projects.go:1134-1240)
Responses: respondWithJSON(w, http.StatusOK, p); respondWithJSON(w, http.StatusOK, p); respondWithJSON(w, http.StatusOK, map[string]string{"message": "project deleted"})
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/handlers_test.go:713; backend-go/internal/api/projectOwnership_test.go:151
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-06 — GET /api/furniture/definitions

Purpose: Catalog definitions for authoring library
Auth/roles: Authenticated user and active organization license; extension allowlisted read
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: Authenticated catalog read; no body
Validation: User/org validation, assembles modules and catalog dependencies into definitions response
Side effects: Read-only catalog hydration
Web/SketchUp: SketchUp catalog provider and generated Web client availability
Problems: OPS-07 sequential full-family loads; SU-06 consumer cache staleness
Evidence: backend-go/internal/api/furniture.go:21-137; backend-go/internal/api/routes.go:236
Storage: GetOrganizationByID (backend-go/internal/storage/organizations.go:60-63); GetUserByID (backend-go/internal/storage/users.go:93-95); ListAgregados (backend-go/internal/storage/agregados.go:15-40); ListCategories (backend-go/internal/storage/categories.go:12-42); ListComponents (backend-go/internal/storage/components.go:13-68); ListHardwares (backend-go/internal/storage/materials.go:309-353); ListMaterialBoards (backend-go/internal/storage/materials.go:183-239); ListMaterialCategories (backend-go/internal/storage/materialCategories.go:18-48); ListModules (backend-go/internal/storage/projects.go:1259-1359); ListOptionGroups (backend-go/internal/storage/materials.go:355-408); ListStructures (backend-go/internal/storage/structures.go:200-271)
Responses: respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/furniture_layout_test.go:90; backend-go/internal/api/furniture_test.go:60; backend-go/internal/api/authoring_resolve_test.go:170; backend-go/internal/api/devices_test.go:141
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-07 — GET /api/furniture/definitions/{definitionId}/layout

Purpose: Authoritative native furniture layout
Auth/roles: Authenticated user, active scoped organization license
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: definitionId; dimensions query; choice.ROLE material IDs
Validation: Module lookup, layoutDimsFromQuery and material-aware resolution; nil module 404; invalid dimensions 400
Side effects: Pure geometry/domain resolution; no furniture instance created
Web/SketchUp: SketchUp catalog provider layout load
Problems: SU-03 consumer fallback on nil layout; real host placement still needs proof
Evidence: backend-go/internal/api/furniture_layout.go:30-136; backend-go/internal/api/routes.go:239
Storage: GetModuleByID (backend-go/internal/storage/projects.go:1444-1566); GetOrganizationByID (backend-go/internal/storage/organizations.go:60-63); GetUserByID (backend-go/internal/storage/users.go:93-95); ListAgregados (backend-go/internal/storage/agregados.go:15-40); ListComponents (backend-go/internal/storage/components.go:13-68); ListHardwares (backend-go/internal/storage/materials.go:309-353); ListMaterialBoards (backend-go/internal/storage/materials.go:183-239); ListStructures (backend-go/internal/storage/structures.go:200-271)
Responses: 
Errors/helpers: respondWithError, respondWithInternalError
Tests: backend-go/internal/api/furniture_layout_test.go:89; backend-go/internal/api/authoring_resolve_test.go:788
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-08 — POST /api/furniture/authoring/resolve

Purpose: Rich stateless authoring/machining resolution
Auth/roles: Authenticated user + active license; explicit extension POST allowlist
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: Versioned semantic snapshot JSON; Content-Type application/json; no query parameters
Validation: Strict schema/version/content-type/body/query checks; occurrence identities, relationship intent, preflight and fingerprint
Side effects: No project/FurnitureInstance persistence; returns accepted/rejected resolution envelope
Web/SketchUp: SketchUp provider has transport; rich authoring UI remains disconnected (SU-04)
Problems: SU-04 disconnected interaction; SU-05 compiled machining profile limits; successful API is not enabled operator workflow
Evidence: backend-go/internal/api/authoring_resolve.go:41-380; backend-go/internal/api/routes.go:244
Storage: GetOrganizationByID (backend-go/internal/storage/organizations.go:60-63); GetUserByID (backend-go/internal/storage/users.go:93-95)
Responses: 
Errors/helpers: respondWithInternalError
Tests: backend-go/internal/api/furniture_test.go:417; backend-go/internal/api/authoring_resolve_test.go:211
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-09 — POST /api/projects/{projectId}/designs

Purpose: Create logical design under project
Auth/roles: RoleCanMutateProjects and authenticated tenant
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: CreateDesignRequest and project UUID; Idempotency-Key
Validation: UUID validation, generated body; storage owns linked project/Design identity
Side effects: CreateProjectDesign command with actor/request context and durable receipt
Web/SketchUp: Generated Web/Ruby client; operator usage requires calling UI path evidence
Problems: No native UI completion inferred from generated client
Evidence: backend-go/internal/api/designs.go:196-266; backend-go/internal/api/routes.go:375
Storage: CreateDesign (backend-go/internal/storage/designs.go:95-191); ListDesignsByProject (backend-go/internal/storage/designs.go:205-244)
Responses: respondWithJSON(w, http.StatusOK, dtos); respondWithJSON(w, http.StatusCreated, toDesignDTO(*design))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignError, respondWithError, respondWithInternalError
Tests: backend-go/internal/api/model_binding_contract_test.go:127; backend-go/internal/api/designs_test.go:40
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-10 — PUT /api/designs/{designId}/working-copy

Purpose: Persist mutable design working copy
Auth/roles: RoleCanAccessProjects in actual PUT handler (not RoleCanMutateProjects)
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: UpdateDesignWorkingCopyRequest; base_revision_id, source_type, furniture-instance items and parameters/materials
Validation: Valid design/base/FI/definition UUIDs, source-type enum, storage command validation
Side effects: Replaces working copy through UpdateDesignWorkingCopy; does not mutate immutable revisions
Web/SketchUp: SketchUp working-copy synchronization; Web generated client
Problems: Permission uses access-project predicate; report as actual contract, not presumed escalation without role policy proof
Evidence: backend-go/internal/api/designs.go:387-506; backend-go/internal/api/routes.go:378
Storage: GetDesignWorkingCopy (backend-go/internal/storage/designs.go:935-998); UpdateDesignWorkingCopy (backend-go/internal/storage/designs.go:1000-1180)
Responses: respondWithJSON(w, http.StatusOK, toDesignWorkingCopyDTO(*wc)); respondWithJSON(w, http.StatusOK, toDesignWorkingCopyDTO(*wc))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignError, respondWithError
Tests: backend-go/internal/api/designs_test.go:269
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-11 — POST /api/designs/{designId}/revisions

Purpose: Publish immutable revision from working state
Auth/roles: RoleCanMutateProjects; auth tenant receipt wrapper
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: PublishDesignRevisionRequest base_revision_id/source_type; Idempotency-Key
Validation: Design/base UUIDs; storage publication checks working items and revision lineage
Side effects: PublishDesignRevision creates exact immutable revision and audit context
Web/SketchUp: Generated Web/Ruby client; distinct from staged artifact publish
Problems: Not equivalent to manufacturing approval/release or machine-compatible outputs
Evidence: backend-go/internal/api/designs.go:293-359; backend-go/internal/api/routes.go:381
Storage: ListDesignRevisions (backend-go/internal/storage/designs.go:874-907); PublishDesignRevision (backend-go/internal/storage/designs.go:372-447)
Responses: respondWithJSON(w, http.StatusOK, dtos); respondWithJSON(w, http.StatusCreated, toDesignRevisionDTO(*rev))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignError, respondWithError
Tests: backend-go/internal/api/designs_test.go:138
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-12 — GET /api/designs/{designId}/revisions/{revisionId}

Purpose: Read exact historical revision
Auth/roles: RoleCanAccessProjects with tenant-scoped storage
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: designId and revisionId UUIDs
Validation: Exact IDs; errors routed through respondWithDesignError
Side effects: Read-only immutable selected revision
Web/SketchUp: Web revision surface and SketchUp generated transport
Problems: Do not replace selected revision with implicit latest in consumers
Evidence: backend-go/internal/api/designs.go:360-386; backend-go/internal/api/routes.go:382
Storage: GetDesignRevision (backend-go/internal/storage/designs.go:842-872)
Responses: respondWithJSON(w, http.StatusOK, toDesignRevisionDTO(*rev))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignError, respondWithError
Tests: backend-go/internal/api/design_publish_test.go:356; backend-go/internal/api/designs_test.go:138
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-13 — POST /api/designs/{designId}/publish:prepare

Purpose: Start staged immutable revision publication
Auth/roles: RoleCanMutateProjects; no-store + durable receipt
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: PrepareDesignPublishRequest.manifest; Idempotency-Key
Validation: Design UUID and ParseDesignPublishManifest; authoritative working-item matching delegated to store
Side effects: Creates staging session/manifest; lazy expired staging cleanup may leave file orphans on IO failure
Web/SketchUp: SketchUp publication flow; generated client
Problems: Preparation alone is not a published revision or manufacturing release
Evidence: backend-go/internal/api/design_publish.go:142-193; backend-go/internal/api/routes.go:398
Storage: PrepareDesignPublish (backend-go/internal/storage/design_publish.go:122-221)
Responses: respondWithJSON(w, http.StatusCreated, toDesignPublishSessionDTO(*result.Session))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignPublishError, respondWithError
Tests: backend-go/internal/api/design_publish_test.go:66
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-14 — POST /api/designs/{designId}/publish/{sessionId}:finalize

Purpose: Finalize staged revision only with required artifacts
Auth/roles: RoleCanMutateProjects; no-store + durable receipt; wildcard command dispatch
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: designId/sessionId UUIDs; Idempotency-Key
Validation: Required artifact metadata and file existence/size checks before transactional finalize
Side effects: FinalizeDesignPublish commits immutable revision; retry receipt returns same outcome
Web/SketchUp: SketchUp publish workflow; generated client
Problems: Static proof only; real host upload/save/reopen not repeated here
Evidence: backend-go/internal/api/design_publish.go:431-494; backend-go/internal/api/routes.go:400
Storage: FinalizeDesignPublish (backend-go/internal/storage/design_publish.go:485-652); GetDesignPublishSession (backend-go/internal/storage/design_publish.go:303-323)
Responses: respondWithJSON(w, http.StatusCreated, toDesignRevisionDTO(*rev))
Errors/helpers: ApiErrorCodeBadRequest, respondWithAPIError, respondWithDesignPublishError, respondWithError
Tests: backend-go/internal/api/design_publish_test.go:306
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-15 — POST /api/projects/{projectId}/reconciliation

Purpose: Compare exact quote and design revisions by physical identity
Auth/roles: RoleCanAccessProjects; authenticated tenant storage
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: quoteRevisionId/designRevisionId + projectId UUIDs
Validation: Reject invalid UUIDs, cross-project comparison, missing revisions and corrupt snapshots
Side effects: Read-only deterministic differences/counts; no automatic overwrite/release
Web/SketchUp: Web reconciliation generated client; SketchUp endpoint availability is not UI proof
Problems: Comparison does not approve, accept changes or release physical production
Evidence: backend-go/internal/api/reconciliation.go:19-72; backend-go/internal/api/routes.go:389
Storage: ReconcileProject (backend-go/internal/storage/reconciliation.go:350-532)
Responses: respondWithJSON(w, http.StatusOK, toReconciliationResultDTO(result))
Errors/helpers: ApiErrorCodeBadRequest, ApiErrorCodeConflict, ApiErrorCodeNotFound, respondWithAPIError, respondWithError
Tests: backend-go/internal/api/reconciliation_test.go:39
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-16 — POST /api/projects/{id}/parts/{partId}/advance

Purpose: Advance one physical piece operation
Auth/roles: Production/export/mark-produced role union plus assigned sector; factory-only wrapper
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: operation_type or advance=true; operator_name/machine_id/notes
Validation: Operation vocabulary/current sequence and part belongs to project; scanner resolves current preassembly op
Side effects: MutateProjectPartExecutions updates piece plus floor events and readiness under mutation boundary
Web/SketchUp: Web floor queue/scanner through apiWorkspaceRepository
Problems: OP-02: separate generic project save path can overwrite dedicated result; endpoint transaction alone is insufficient
Evidence: backend-go/internal/api/partExecutions.go:197-330; backend-go/internal/api/routes.go:422
Storage: GetProjectByID (backend-go/internal/storage/projects.go:754-985); MutateProjectPartExecutions (backend-go/internal/storage/partExecutions.go:30-121)
Responses: respondWithJSON(w, http.StatusOK, map[string]interface{}{
Errors/helpers: respondWithError, respondWithMutationError
Tests: backend-go/internal/api/partExecutions_test.go:66
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-17 — POST /api/projects/{id}/quality/qc/{unitId}

Purpose: Record furniture-unit QC checklist
Auth/roles: roleCanManageQuality; factory-only wrapper
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: checklist[{code,passed}], notes/photo IDs; project/unit path
Validation: Nonempty checklist, valid check codes, unit exists in project; passed state derives from checklist
Side effects: MutateProjectQuality persists QC record, stamps actor/time and constructs quality view
Web/SketchUp: Web QualityScreen/quality API path; not SketchUp authoring
Problems: Does not prove machine inspection or physical quality; no new dedicated-route defect asserted
Evidence: backend-go/internal/api/quality.go:493-595; backend-go/internal/api/routes.go:441
Storage: MutateProjectQuality (backend-go/internal/storage/quality.go:27-128)
Responses: respondWithJSON(w, http.StatusOK, view)
Errors/helpers: respondWithError, respondWithMutationError
Tests: backend-go/internal/api/materialPlanningQuality_test.go:293
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-18 — PUT /api/projects/{id}/installation

Purpose: Save installation visits/issues/punch work
Auth/roles: roleCanManageInstallation; factory-only wrapper
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: Installation job command body; project path
Validation: Domain installation validation and mutation path; generic project PUT preserves stored installation
Side effects: MutateProjectInstallation persists dedicated job state/events
Web/SketchUp: Web installation editor through apiWorkspaceRepository
Problems: Readiness and client closeout remain separate actions, not one generic saved=true
Evidence: backend-go/internal/api/installation.go:157-239; backend-go/internal/api/routes.go:447
Storage: GetProjectByID (backend-go/internal/storage/projects.go:754-985); MutateProjectInstallation (backend-go/internal/storage/installation.go:29-113)
Responses: respondWithJSON(w, http.StatusOK, buildInstallationView(project, project.Installation)); respondWithJSON(w, http.StatusOK, view)
Errors/helpers: respondWithError, respondWithMutationError
Tests: backend-go/internal/api/installation_test.go:59
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-19 — POST /api/projects/{id}/installation/closeout

Purpose: Complete installation, record signoff, close project
Auth/roles: RoleCanAppendProjectEvent specific to mapped action; factory-only wrapper
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: action complete_installation/sign_off/close; signer and note fields
Validation: All units installed/no open visits for completion; EvaluateCloseoutReadiness for signoff/close; signer required
Side effects: MutateProjectInstallation emits milestone and closeout state; repeated completion conflict
Web/SketchUp: Web closeout through apiWorkspaceRepository
Problems: Physical completion/signature evidence is external; API state not proof customer actually signed
Evidence: backend-go/internal/api/installation.go:240-396; backend-go/internal/api/routes.go:448
Storage: GetProjectByID (backend-go/internal/storage/projects.go:754-985); MutateProjectInstallation (backend-go/internal/storage/installation.go:29-113)
Responses: respondWithJSON(w, http.StatusConflict, map[string]interface{}{; respondWithJSON(w, http.StatusOK, map[string]interface{}{
Errors/helpers: respondWithError, respondWithMutationError
Tests: backend-go/internal/api/installation_test.go:59
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-20 — PUT /api/picking

Purpose: Set material dispatch state for project
Auth/roles: RoleCanMarkPicking = admin or almacen; authenticated tenant
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: project_id, material herrajes/tableros/cintillas, status pendiente/despachado
Validation: Allowed material/status, nonempty project ID, project exists; server markedAt/By
Side effects: UpsertProjectPicking only; does NOT debit stock in this request
Web/SketchUp: Web purchasingStore → apiWorkspaceRepository
Problems: BE-002 canonical / WEB-01 corroboration: separate stock/picking writes; control-flow reproduction in defect-proofs.json
Evidence: backend-go/internal/api/projectPicking.go:53-106; backend-go/internal/api/routes.go:493
Storage: GetProjectByID (backend-go/internal/storage/projects.go:754-985); UpsertProjectPicking (backend-go/internal/storage/projectPicking.go:42-52)
Responses: respondWithJSON(w, http.StatusOK, pick)
Errors/helpers: respondWithError
Tests: backend-go/internal/api/projectPicking_test.go:23
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## EP-21 — POST /api/stock/movements

Purpose: Record stock ledger movement or exact dispatch reversal
Auth/roles: RoleCanManageStock = admin or almacen; authenticated tenant
Tenant: AuthMiddleware validates session/membership and establishes tenant transaction/RLS context; resource-specific storage evidence below. Login is anonymous issuance; select-org explicitly changes actor scope. No live cross-tenant request repeated in this subtask.
Input: kind/material_id/type/quantity/project_id/note/reverts_id
Validation: Kind/type and delta validation; linked project; reversal same material/exact amount/original despacho; duplicate reversal conflict
Side effects: RecordStockMovement updates ledger/balance; actor stamped; no picking status write
Web/SketchUp: Web purchasingStore/stock UI → apiWorkspaceRepository
Problems: BE-002 canonical: ordinary retry fresh dispatch not combined with picking receipt; no database failure reproduced here
Evidence: backend-go/internal/api/stock.go:112-243; backend-go/internal/api/routes.go:499
Storage: GetProjectByID (backend-go/internal/storage/projects.go:754-985); GetStockMovementByID (backend-go/internal/storage/stock.go:58-75); GetStockMovementByRevertsID (backend-go/internal/storage/stock.go:76-97); GetUserByID (backend-go/internal/storage/users.go:93-95); RecordStockMovement (backend-go/internal/storage/stock.go:98-118)
Responses: respondWithJSON(w, http.StatusCreated, saved)
Errors/helpers: respondWithError
Tests: backend-go/internal/api/stock_test.go:107
Coverage: SOURCE_DEEP_REVIEW_WITH_RUNTIME_UNKNOWN. Source presence only; no endpoint runtime test executed by this inventory worker. Parent runtime reports remain separate.
UNKNOWN: Exact actor/tenant routed happy/denied/stale/retry response for this endpoint not executed here. Native Web/SketchUp behavior must be taken from runtime-ui.json or explicit host evidence, not inferred from this row.

## Limits

No DB, HTTP invocation, security attack, install or product changes.
15–25 endpoint depth target fulfilled with 21 selected endpoints; remaining routes remain inventory-level rather than individually deep-reviewed.
Complete role-by-method/storage-error/runtime exhaustiveness not claimed; explicit remaining proof per row.

## Curated role and caller anchors

### EP-01

Roles: No independent role whitelist in this reviewed handler; identity/session/license boundaries above apply. See middleware extension allowlist for restricted token transport.

Callers: packages/storage/src/openapi/generated/client.ts:116

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-02

Roles: No independent role whitelist in this reviewed handler; identity/session/license boundaries above apply. See middleware extension allowlist for restricted token transport.

Callers: packages/storage/src/openapi/generated/client.ts:119

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-03

Roles: admin, gerente_ventas, vendedor, ingeniero, produccion, gerente_produccion

Callers: packages/storage/src/apiWorkspaceRepository.ts:609

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-04

Roles: admin, gerente_ventas, vendedor

Callers: packages/storage/src/apiWorkspaceRepository.ts:625

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-05

Roles: General save: admin, gerente_ventas, vendedor; produced/reopen use their separate predicates; owner scope still applies

Callers: packages/storage/src/apiWorkspaceRepository.ts:639

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-06

Roles: No independent role whitelist in this reviewed handler; identity/session/license boundaries above apply. See middleware extension allowlist for restricted token transport.

Callers: apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:311

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-07

Roles: No independent role whitelist in this reviewed handler; identity/session/license boundaries above apply. See middleware extension allowlist for restricted token transport.

Callers: apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:259

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-08

Roles: No independent role whitelist in this reviewed handler; identity/session/license boundaries above apply. See middleware extension allowlist for restricted token transport.

Callers: apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:279

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-09

Roles: admin, gerente_ventas, vendedor

Callers: packages/storage/src/openapi/generated/client.ts:185

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-10

Roles: admin, gerente_ventas, vendedor, ingeniero, produccion, gerente_produccion

Callers: packages/storage/src/openapi/generated/client.ts:190; apps/sketchup-extension/src/granete_for_sketchup/connection/project_furniture.rb:104

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-11

Roles: admin, gerente_ventas, vendedor

Callers: packages/storage/src/openapi/generated/client.ts:193

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-12

Roles: admin, gerente_ventas, vendedor, ingeniero, produccion, gerente_produccion

Callers: packages/storage/src/openapi/generated/client.ts:194

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-13

Roles: admin, gerente_ventas, vendedor

Callers: packages/storage/src/openapi/generated/client.ts:195; apps/sketchup-extension/src/granete_for_sketchup/connection/design_publish.rb:161

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-14

Roles: admin, gerente_ventas, vendedor

Callers: packages/storage/src/openapi/generated/client.ts:196; apps/sketchup-extension/src/granete_for_sketchup/connection/design_publish.rb:189

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: SOURCE_TRANSPORT. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-15

Roles: admin, gerente_ventas, vendedor, ingeniero, produccion, gerente_produccion

Callers: packages/storage/src/openapi/generated/client.ts:187

Web: GENERATED_OR_RELATED_SURFACE_ONLY. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-16

Roles: admin, gerente_ventas, gerente_produccion, ingeniero, produccion; sector checks remain

Callers: packages/storage/src/apiWorkspaceRepository.ts:1001

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-17

Roles: admin, gerente_produccion, produccion

Callers: packages/storage/src/apiWorkspaceRepository.ts:2278

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-18

Roles: admin, gerente_ventas, gerente_produccion, produccion

Callers: packages/storage/src/apiWorkspaceRepository.ts:1139

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-19

Roles: complete: admin, gerente_ventas, gerente_produccion, produccion; sign_off/close: admin, gerente_ventas, gerente_produccion

Callers: packages/storage/src/apiWorkspaceRepository.ts:1164

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-20

Roles: admin, almacen

Callers: packages/storage/src/apiWorkspaceRepository.ts:1723

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

### EP-21

Roles: admin, almacen

Callers: packages/storage/src/apiWorkspaceRepository.ts:1788

Web: SOURCE_CONSUMER. SketchUp: NO_DIRECT_CALLER_ESTABLISHED_IN_THIS_ROW. Curated actual transport anchor. Generated client availability alone does not prove an operator screen invokes it.

