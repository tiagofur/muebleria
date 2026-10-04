package api

import (
	"net/http"
)

// Contrato: aprobaciones de DesignRevision y ProductionRelease con gates
// (#395/#502/#739/#740) — snapshots congelados, nunca latest implícito.
func registerReleaseRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// #395 / DT-11: DesignRevision approval and ProductionRelease pinned to
	// the exact approved revision + manufacturing fingerprint. Approval is an
	// explicit lifecycle transition (publish never auto-approves; replay is
	// idempotent). Release runs the whole §17 gate server-side in one
	// transaction and inserts immutable history — a retried release replays
	// the same row, and later revisions never mutate it.
	mux.Handle("POST /api/designs/{designId}/revisions/{revisionCommand...}", noStoreMiddleware(authMW(server.RequireIdempotency("design.approve-revision", designRevisionCommandRouter(map[string]http.Handler{
		"approve": http.HandlerFunc(server.HandleDesignRevisionApprove),
	})))))
	// #502 / WEB-DT-3: read-only authoritative preflight evaluation for the
	// exact revision — POST mirrors the reconcileProjectDesign compute-read
	// precedent; no idempotency key because nothing mutates.
	mux.Handle("POST /api/designs/{designId}/revisions/{revisionId}/preflight", noStoreMiddleware(consistentReleaseCatalogMiddleware(authMW(http.HandlerFunc(server.HandleDesignRevisionPreflight)))))
	// #502 / WEB-DT-3: always-gated production approval — exact accepted
	// QuoteRevision + exact DesignRevision, enforced by the release gate
	// chain. The generic body-less design approve stays a separate concept.
	// The wildcard must occupy an entire segment (same reason as the
	// designRevisionCommandRouter above), so the revisionId:command segment
	// is captured and split by the same router.
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/revisions/{revisionCommand...}", noStoreMiddleware(consistentReleaseCatalogMiddleware(authMW(server.RequireIdempotency("design.approve-revision-for-production", designRevisionCommandRouter(map[string]http.Handler{
		"approve-for-production": http.HandlerFunc(server.HandleProjectDesignRevisionApproveForProduction),
	}))))))
	mux.Handle("GET /api/projects/{projectId}/production-releases", authMW(http.HandlerFunc(server.HandleProjectProductionReleases)))
	mux.Handle("POST /api/projects/{projectId}/production-releases", noStoreMiddleware(consistentReleaseCatalogMiddleware(authMW(server.RequireIdempotency("production.release", http.HandlerFunc(server.HandleProjectProductionReleases))))))
	mux.Handle("GET /api/projects/{projectId}/production-releases/{releaseId}", authMW(http.HandlerFunc(server.HandleProjectProductionRelease)))
	// #739: frozen cutting demand of the exact release (engineering
	// preparation input). Read-only projection of the private manufacturing
	// snapshot — the mutable project/catalog is never consulted.
	// #781 — frozen manufacturing occurrence authority of the EXACT release.
	// Engineering opens a specific release; the workshop-occurrence projection
	// must come from THAT release, never from "latest". Projects without a
	// release don't hit this endpoint — the frontend skips the query.
	mux.Handle("GET /api/projects/{projectId}/production-releases/{releaseId}/workshop-occurrences", authMW(http.HandlerFunc(server.HandleProjectWorkshopOccurrences)))
	mux.Handle("GET /api/projects/{projectId}/production-releases/{releaseId}/cutting-demand", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleProjectProductionReleaseCuttingDemand))))
	mux.Handle("GET /api/projects/{projectId}/production-releases/{releaseId}/manufacturing-snapshot", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleProjectProductionManufacturingSnapshot))))
	// #740 PR 1: durable Engineering state of the exact release. Reads never
	// write; start is idempotent; complete is final, version-guarded (If-Match)
	// and requires the frozen routing evidence. None of it authorizes
	// materials or physical work.
	mux.Handle("GET /api/projects/{projectId}/production-releases/{releaseId}/engineering", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleProjectProductionReleaseEngineering))))
	mux.Handle("POST /api/projects/{projectId}/production-releases/{releaseId}/engineering:start", noStoreMiddleware(authMW(server.RequireIdempotency("engineering.start", http.HandlerFunc(server.HandleProjectProductionReleaseEngineeringStart)))))
	mux.Handle("POST /api/projects/{projectId}/production-releases/{releaseId}/engineering:complete", noStoreMiddleware(authMW(server.RequireIdempotency("engineering.complete", http.HandlerFunc(server.HandleProjectProductionReleaseEngineeringComplete)))))
}

// Contrato: planta — floor scan (F089/F092), ejecución física (OC-030..034),
// material planning, calidad, instalación, costing, survey, eventos y
// actividad de producción; todo factory-only vía mfgOnly (#327).
func registerManufacturingRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler, mfgOnly func(http.HandlerFunc) http.HandlerFunc) {
	// Floor scan & item floor status (PROD-3.1 / F089-RN / F092): mobile scan-to-advance, loading status checklist.
	mux.Handle("POST /api/projects/{id}/floor-scan", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectFloorScan))))
	mux.Handle("GET /api/projects/{id}/loading-status", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectLoadingStatus))))
	mux.Handle("PATCH /api/projects/{id}/items/{itemId}/floor-status", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectItemFloorStatus))))
	mux.Handle("GET /api/projects/{id}/floor-events", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectFloorEvents))))

	// Physical production execution (OC-030..OC-034, #301): piece operations
	// and module unit transitions with server-side gates, RBAC and audit.
	mux.Handle("GET /api/projects/{id}/part-executions", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectPartExecutions))))
	mux.Handle("PUT /api/projects/{id}/part-executions", authMW(mfgOnly(http.HandlerFunc(server.HandleGeneratePartExecutions))))
	mux.Handle("POST /api/projects/{id}/parts/{partId}/advance", authMW(mfgOnly(http.HandlerFunc(server.HandleAdvancePartOperation))))
	mux.Handle("POST /api/projects/{id}/parts/{partId}/rework", authMW(mfgOnly(http.HandlerFunc(server.HandlePartRework))))
	mux.Handle("POST /api/projects/{id}/units/{unitId}/advance", authMW(mfgOnly(http.HandlerFunc(server.HandleAdvanceModuleUnit))))
	mux.Handle("POST /api/projects/{id}/units/{unitId}/assembly-override", authMW(mfgOnly(http.HandlerFunc(server.HandleAssemblyOverride))))

	// Material planning (OC-050..OC-054, #302): requirements from the released
	// BOM, reservations, shortage and the evidence-backed materials release.
	mux.Handle("GET /api/projects/{id}/materials", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectMaterials))))
	mux.Handle("POST /api/projects/{id}/materials/derive", authMW(mfgOnly(http.HandlerFunc(server.HandleMaterialsDerive))))
	mux.Handle("POST /api/projects/{id}/materials/reserve", authMW(mfgOnly(http.HandlerFunc(server.HandleMaterialsReserve))))
	mux.Handle("POST /api/projects/{id}/materials/consume", authMW(mfgOnly(http.HandlerFunc(server.HandleMaterialsConsume))))
	mux.Handle("POST /api/projects/{id}/materials/release", authMW(mfgOnly(http.HandlerFunc(server.HandleMaterialsRelease))))

	// Quality & rework (OC-060..OC-062, #302): issues, rework actions with
	// job costing and the per-unit QC gate — server-authoritative.
	mux.Handle("GET /api/projects/{id}/quality", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectQuality))))
	mux.Handle("POST /api/projects/{id}/quality/issue", authMW(mfgOnly(http.HandlerFunc(server.HandleQualityIssue))))
	mux.Handle("POST /api/projects/{id}/quality/issue/{issueId}/transition", authMW(mfgOnly(http.HandlerFunc(server.HandleQualityIssueTransition))))
	mux.Handle("POST /api/projects/{id}/quality/rework", authMW(mfgOnly(http.HandlerFunc(server.HandleQualityRework))))
	mux.Handle("POST /api/projects/{id}/quality/qc/{unitId}", authMW(mfgOnly(http.HandlerFunc(server.HandleQualityUnitQc))))
	mux.Handle("POST /api/projects/{id}/quality/qc/{unitId}/override", authMW(mfgOnly(http.HandlerFunc(server.HandleQualityUnitQcOverride))))

	// Installation job (OC-070..OC-074, #303): visits, field issues, punch
	// items and gated closeout — server-authoritative with audit events.
	mux.Handle("GET /api/projects/{id}/installation", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectInstallation))))
	mux.Handle("PUT /api/projects/{id}/installation", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectInstallation))))
	mux.Handle("POST /api/projects/{id}/installation/closeout", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectInstallationCloseout))))

	// Job costing (OC-080..OC-084, #304): baseline frozen from quote snapshot
	// + release, time entries, other actuals and the estimate vs actual view.
	mux.Handle("GET /api/projects/{id}/costing", authMW(mfgOnly(http.HandlerFunc(server.HandleProjectCosting))))
	mux.Handle("POST /api/projects/{id}/costing/baseline", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingBaseline))))
	mux.Handle("POST /api/projects/{id}/costing/labor-rate", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingLaborRate))))
	mux.Handle("POST /api/projects/{id}/costing/time", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingTime))))
	mux.Handle("POST /api/projects/{id}/costing/time/{entryId}/void", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingTimeVoid))))
	mux.Handle("POST /api/projects/{id}/costing/other", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingOther))))
	mux.Handle("POST /api/projects/{id}/costing/other/{costId}/void", authMW(mfgOnly(http.HandlerFunc(server.HandleCostingOtherVoid))))

	// Structured site survey (OC-040/OC-041, #305): spaces, field measures,
	// verification and the fabrication-freeze gate — server-authoritative.
	mux.Handle("GET /api/projects/{id}/site-survey", authMW(http.HandlerFunc(server.HandleProjectSiteSurvey)))
	mux.Handle("POST /api/projects/{id}/site-survey", authMW(http.HandlerFunc(server.HandleProjectSiteSurvey)))
	mux.Handle("PUT /api/projects/{id}/site-survey/spaces", authMW(http.HandlerFunc(server.HandleSiteSurveySpaces)))
	mux.Handle("DELETE /api/projects/{id}/site-survey/spaces/{spaceId}", authMW(http.HandlerFunc(server.HandleSiteSurveySpaceDelete)))
	mux.Handle("POST /api/projects/{id}/site-survey/spaces/{spaceId}/capture", authMW(http.HandlerFunc(server.HandleSiteSurveyCapture)))
	mux.Handle("POST /api/projects/{id}/site-survey/spaces/{spaceId}/approve", authMW(http.HandlerFunc(server.HandleSiteSurveyApprove)))
	mux.Handle("POST /api/projects/{id}/site-survey/verify", authMW(http.HandlerFunc(server.HandleSiteSurveyVerify)))
	mux.Handle("POST /api/projects/{id}/site-survey/freeze", authMW(http.HandlerFunc(server.HandleSiteSurveyFreeze)))

	// Lifecycle events (OC-010): append-only audit trail.
	mux.Handle("GET /api/projects/{id}/events", authMW(http.HandlerFunc(server.HandleProjectEvents)))
	mux.Handle("POST /api/projects/{id}/events", authMW(http.HandlerFunc(server.HandleProjectEvents)))

	// Production activity tracking (gerente_produccion dashboard)
	mux.Handle("POST /api/production/activity/claim", authMW(http.HandlerFunc(server.HandleProductionClaim)))
	mux.Handle("POST /api/production/activity/finish/{activityId}", authMW(http.HandlerFunc(server.HandleProductionFinish)))
	mux.Handle("POST /api/production/activity/damage", authMW(http.HandlerFunc(server.HandleProductionDamage)))
	mux.Handle("GET /api/production/dashboard", authMW(http.HandlerFunc(server.HandleProductionDashboard)))
	mux.Handle("GET /api/production/active", authMW(http.HandlerFunc(server.HandleProductionActiveJobs)))
	mux.Handle("PATCH /api/production/damage/{id}/resolve", authMW(http.HandlerFunc(server.HandleProductionDamageResolve)))
	mux.Handle("GET /api/production/operators", authMW(http.HandlerFunc(server.HandleOperatorsBySector)))

	// User sector management: admin panel uses the admin routes below
	// (adminMW, defined with the other admin routes); staff managers use
	// the /api/staff/{department} sector routes. F094 — operators read
	// their OWN assignments for Mi Estación.
	mux.Handle("GET /api/me/sectors", authMW(http.HandlerFunc(server.HandleMySectors)))
}
