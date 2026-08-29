package api

import (
	"net/http"
)

func RegisterRoutes(server *Server) http.Handler {
	mux := http.NewServeMux()

	// Rate limiting on auth endpoints to blunt brute-force / credential
	// stuffing (#6). Applied per client-IP before the handler runs.
	authRL := RateLimitMiddleware(server.rateLimitRPS, server.rateLimitBurst)

	// Endpoints públicos (Auth) — with rate limiting
	mux.Handle("POST /api/auth/register", authRL(http.HandlerFunc(server.HandleRegister)))
	mux.Handle("POST /api/auth/login", authRL(http.HandlerFunc(server.HandleLogin)))

	// Health check endpoint (unauthenticated) — used by Docker healthchecks and Caddy depends_on.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// Endpoints protegidos por JWT (role/active re-checked against DB — #16)
	authMW := AuthMiddleware(server.JWTSecret, server.Store)
	// #327: manufacturing subresources (physical execution, MRP, quality,
	// installation, job costing) are factory-only — the sales org gets 404.
	mfgOnly := server.manufacturingOnly

	// Refresh: requires a still-valid token; re-issues JWT with current DB role.
	mux.Handle("POST /api/auth/refresh", authMW(http.HandlerFunc(server.HandleRefresh)))
	// Select-org: swaps an authenticated token for one scoped to a chosen
	// organization (multi-membership users, ADR-0004).
	mux.Handle("POST /api/auth/select-org", authMW(http.HandlerFunc(server.HandleSelectOrg)))
	mux.Handle("GET /api/auth/me", authMW(http.HandlerFunc(server.HandleMe)))

	// Platform console (ADR-0005 §5 / #326): org lifecycle, licenses, users,
	// audit and audited support sessions. Platform staff only.
	platformMW := PlatformAdminMiddleware(server.JWTSecret, server.Store)
	mux.Handle("GET /api/platform/organizations", platformMW(http.HandlerFunc(server.HandlePlatformListOrganizations)))
	mux.Handle("POST /api/platform/organizations", platformMW(server.RequireIdempotency("platform.create-organization", http.HandlerFunc(server.HandlePlatformCreateOrganization))))
	mux.Handle("PATCH /api/platform/organizations/{id}", platformMW(http.HandlerFunc(server.HandlePlatformUpdateOrganization)))
	mux.Handle("GET /api/platform/organizations/{id}/audit", platformMW(http.HandlerFunc(server.HandlePlatformOrgAudit)))
	mux.Handle("GET /api/platform/users", platformMW(http.HandlerFunc(server.HandlePlatformUsers)))
	mux.Handle("POST /api/platform/organizations/{id}/support-session", platformMW(server.RequireIdempotency("platform.start-support-session", http.HandlerFunc(server.HandlePlatformStartSupportSession))))
	mux.Handle("DELETE /api/platform/support-sessions/{sessionId}", platformMW(http.HandlerFunc(server.HandlePlatformEndSupportSession)))

	// Factory sales network (#326): a factory admin lists/creates its
	// connected store/dealer organizations (cloned from the factory catalog).
	mux.Handle("GET /api/factory/organizations", authMW(http.HandlerFunc(server.HandleFactoryOrganizations)))
	mux.Handle("POST /api/factory/organizations", authMW(server.RequireIdempotency("factory.create-organization", http.HandlerFunc(server.HandleFactoryOrganizations))))

	// Org team management (#326): active-org admin (or support session).
	mux.Handle("GET /api/org/team", authMW(http.HandlerFunc(server.HandleOrgTeam)))
	mux.Handle("PUT /api/org/members/{userId}/roles", authMW(http.HandlerFunc(server.HandleOrgMemberRoles)))
	mux.Handle("PUT /api/org/members/{userId}/active", authMW(http.HandlerFunc(server.HandleOrgMemberActive)))
	mux.Handle("GET /api/org/invitations", authMW(http.HandlerFunc(server.HandleOrgListInvitations)))
	mux.Handle("POST /api/org/invitations", authMW(server.RequireIdempotency("org.create-invitation", http.HandlerFunc(server.HandleOrgCreateInvitation))))
	mux.Handle("DELETE /api/org/invitations/{id}", authMW(server.RequireIdempotency("org.revoke-invitation", http.HandlerFunc(server.HandleOrgRevokeInvitation))))

	// Public invitation acceptance (rate limited like login/register).
	mux.Handle("POST /api/auth/accept-invitation", authRL(server.RequireIdempotency("auth.accept-invitation", http.HandlerFunc(server.HandleAcceptInvitation))))

	// Biblioteca paramétrica de muebles (catálogo piloto compartido con el dominio TS;
	// consumida hoy por la extensión de SketchUp; requiere licencia activa por usuario).
	mux.Handle("GET /api/furniture/definitions", authMW(http.HandlerFunc(server.HandleFurnitureDefinitions)))
	// Layout completo resuelto (componentes + herrajes) de una definición a
	// medidas concretas — la extensión de SketchUp inserta desde aquí.
	mux.Handle("GET /api/furniture/definitions/{definitionId}/layout", authMW(http.HandlerFunc(server.HandleFurnitureDefinitionLayout)))

	// Clientes
	mux.Handle("GET /api/customers", authMW(http.HandlerFunc(server.HandleCustomers)))
	mux.Handle("POST /api/customers", authMW(http.HandlerFunc(server.HandleCustomers)))
	mux.Handle("GET /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))
	mux.Handle("PUT /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))
	mux.Handle("DELETE /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))

	// Catálogo: Tableros
	mux.Handle("GET /api/catalog/materials", authMW(http.HandlerFunc(server.HandleMaterials)))
	mux.Handle("POST /api/catalog/materials", authMW(http.HandlerFunc(server.HandleMaterials)))
	mux.Handle("GET /api/catalog/materials/{id}", authMW(http.HandlerFunc(server.HandleMaterialByID)))
	mux.Handle("PUT /api/catalog/materials/{id}", authMW(http.HandlerFunc(server.HandleMaterialByID)))
	mux.Handle("DELETE /api/catalog/materials/{id}", authMW(http.HandlerFunc(server.HandleMaterialByID)))

	// Catálogo: Materiales ambientales y acabados (solo presentación — #4150 / F086)
	mux.Handle("GET /api/catalog/ambient-materials", authMW(http.HandlerFunc(server.HandleAmbientMaterials)))
	mux.Handle("POST /api/catalog/ambient-materials", authMW(http.HandlerFunc(server.HandleAmbientMaterials)))
	mux.Handle("GET /api/catalog/ambient-materials/{id}", authMW(http.HandlerFunc(server.HandleAmbientMaterialByID)))
	mux.Handle("PUT /api/catalog/ambient-materials/{id}", authMW(http.HandlerFunc(server.HandleAmbientMaterialByID)))
	mux.Handle("DELETE /api/catalog/ambient-materials/{id}", authMW(http.HandlerFunc(server.HandleAmbientMaterialByID)))

	// Catálogo: Categorías de acabados / materiales ambientales (F086)
	mux.Handle("GET /api/catalog/ambient-categories", authMW(http.HandlerFunc(server.HandleAmbientCategories)))
	mux.Handle("POST /api/catalog/ambient-categories", authMW(http.HandlerFunc(server.HandleAmbientCategories)))
	mux.Handle("GET /api/catalog/ambient-categories/{id}", authMW(http.HandlerFunc(server.HandleAmbientCategoryByID)))
	mux.Handle("PUT /api/catalog/ambient-categories/{id}", authMW(http.HandlerFunc(server.HandleAmbientCategoryByID)))
	mux.Handle("DELETE /api/catalog/ambient-categories/{id}", authMW(http.HandlerFunc(server.HandleAmbientCategoryByID)))

	// Catálogo: Categorías de tableros / subgrupos (F142)
	mux.Handle("GET /api/catalog/material-categories", authMW(http.HandlerFunc(server.HandleMaterialCategories)))
	mux.Handle("POST /api/catalog/material-categories", authMW(http.HandlerFunc(server.HandleMaterialCategories)))
	mux.Handle("GET /api/catalog/material-categories/{id}", authMW(http.HandlerFunc(server.HandleMaterialCategoryByID)))
	mux.Handle("PUT /api/catalog/material-categories/{id}", authMW(http.HandlerFunc(server.HandleMaterialCategoryByID)))
	mux.Handle("DELETE /api/catalog/material-categories/{id}", authMW(http.HandlerFunc(server.HandleMaterialCategoryByID)))

	// Catálogo: Cantos (Cintillas)
	mux.Handle("GET /api/catalog/edges", authMW(http.HandlerFunc(server.HandleEdgeBands)))
	mux.Handle("POST /api/catalog/edges", authMW(http.HandlerFunc(server.HandleEdgeBands)))
	mux.Handle("GET /api/catalog/edges/{id}", authMW(http.HandlerFunc(server.HandleEdgeBandByID)))
	mux.Handle("PUT /api/catalog/edges/{id}", authMW(http.HandlerFunc(server.HandleEdgeBandByID)))
	mux.Handle("DELETE /api/catalog/edges/{id}", authMW(http.HandlerFunc(server.HandleEdgeBandByID)))

	// Catálogo: Herrajes
	mux.Handle("GET /api/catalog/hardware", authMW(http.HandlerFunc(server.HandleHardwares)))
	mux.Handle("POST /api/catalog/hardware", authMW(http.HandlerFunc(server.HandleHardwares)))
	mux.Handle("GET /api/catalog/hardware/{id}", authMW(http.HandlerFunc(server.HandleHardwareByID)))
	mux.Handle("PUT /api/catalog/hardware/{id}", authMW(http.HandlerFunc(server.HandleHardwareByID)))
	mux.Handle("DELETE /api/catalog/hardware/{id}", authMW(http.HandlerFunc(server.HandleHardwareByID)))

	// Catálogo: Grupos de Opciones
	mux.Handle("GET /api/catalog/option-groups", authMW(http.HandlerFunc(server.HandleOptionGroups)))
	mux.Handle("POST /api/catalog/option-groups", authMW(http.HandlerFunc(server.HandleOptionGroups)))
	mux.Handle("GET /api/catalog/option-groups/{id}", authMW(http.HandlerFunc(server.HandleOptionGroupByID)))
	mux.Handle("PUT /api/catalog/option-groups/{id}", authMW(http.HandlerFunc(server.HandleOptionGroupByID)))
	mux.Handle("DELETE /api/catalog/option-groups/{id}", authMW(http.HandlerFunc(server.HandleOptionGroupByID)))

	// Catálogo: Agregados (sub-ensambles reutilizables)
	mux.Handle("GET /api/catalog/agregados", authMW(http.HandlerFunc(server.HandleAgregados)))
	mux.Handle("POST /api/catalog/agregados", authMW(http.HandlerFunc(server.HandleAgregados)))
	mux.Handle("GET /api/catalog/agregados/{id}", authMW(http.HandlerFunc(server.HandleAgregadoByID)))
	mux.Handle("PUT /api/catalog/agregados/{id}", authMW(http.HandlerFunc(server.HandleAgregadoByID)))
	mux.Handle("DELETE /api/catalog/agregados/{id}", authMW(http.HandlerFunc(server.HandleAgregadoByID)))

	// Catálogo: Categorías jerárquicas de módulos (F025)
	mux.Handle("GET /api/catalog/categories", authMW(http.HandlerFunc(server.HandleCategories)))
	mux.Handle("POST /api/catalog/categories", authMW(http.HandlerFunc(server.HandleCategories)))
	mux.Handle("GET /api/catalog/categories/{id}", authMW(http.HandlerFunc(server.HandleCategoryByID)))
	mux.Handle("PUT /api/catalog/categories/{id}", authMW(http.HandlerFunc(server.HandleCategoryByID)))
	mux.Handle("DELETE /api/catalog/categories/{id}", authMW(http.HandlerFunc(server.HandleCategoryByID)))

	// Catálogo: Módulos Plantilla
	mux.Handle("GET /api/catalog/modules", authMW(http.HandlerFunc(server.HandleModules)))
	mux.Handle("POST /api/catalog/modules", authMW(http.HandlerFunc(server.HandleModules)))
	mux.Handle("GET /api/catalog/modules/{id}", authMW(http.HandlerFunc(server.HandleModuleByID)))
	mux.Handle("PUT /api/catalog/modules/{id}", authMW(http.HandlerFunc(server.HandleModuleByID)))
	mux.Handle("DELETE /api/catalog/modules/{id}", authMW(http.HandlerFunc(server.HandleModuleByID)))

	// Catálogo: Estructuras / cuerpos (F049 / #99)
	mux.Handle("GET /api/catalog/structures", authMW(http.HandlerFunc(server.HandleStructures)))
	mux.Handle("POST /api/catalog/structures", authMW(http.HandlerFunc(server.HandleStructures)))
	mux.Handle("GET /api/catalog/structures/{id}", authMW(http.HandlerFunc(server.HandleStructureByID)))
	mux.Handle("PUT /api/catalog/structures/{id}", authMW(http.HandlerFunc(server.HandleStructureByID)))
	mux.Handle("DELETE /api/catalog/structures/{id}", authMW(http.HandlerFunc(server.HandleStructureByID)))

	// Catálogo: Componentes reutilizables (F050 / #101)
	mux.Handle("GET /api/catalog/components", authMW(http.HandlerFunc(server.HandleComponents)))
	mux.Handle("POST /api/catalog/components", authMW(http.HandlerFunc(server.HandleComponents)))
	mux.Handle("GET /api/catalog/components/{id}", authMW(http.HandlerFunc(server.HandleComponentByID)))
	mux.Handle("PUT /api/catalog/components/{id}", authMW(http.HandlerFunc(server.HandleComponentByID)))
	mux.Handle("DELETE /api/catalog/components/{id}", authMW(http.HandlerFunc(server.HandleComponentByID)))

	// Proyectos y cotizaciones
	mux.Handle("GET /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	mux.Handle("POST /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	mux.Handle("GET /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))
	mux.Handle("PUT /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))
	mux.Handle("DELETE /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))

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

	// Compras/Almacén picking (Fase 3): project × material despacho state.
	// Read: admin/gerente_produccion/almacen; write: admin/almacen.
	mux.Handle("GET /api/picking", authMW(http.HandlerFunc(server.HandlePickingList)))
	mux.Handle("PUT /api/picking", authMW(http.HandlerFunc(server.HandlePickingUpsert)))

	// Compras/Almacén stock (Fase 3b): balances + mínimos + movement ledger.
	// Read: admin/gerente_produccion/almacen; write (movements/mínimos): admin/almacen.
	mux.Handle("GET /api/stock", authMW(http.HandlerFunc(server.HandleStockList)))
	mux.Handle("PUT /api/stock", authMW(http.HandlerFunc(server.HandleStockUpsertMin)))
	mux.Handle("POST /api/stock/movements", authMW(http.HandlerFunc(server.HandleStockMovementCreate)))
	mux.Handle("GET /api/stock/movements", authMW(http.HandlerFunc(server.HandleStockMovementsList)))

	// Compras/Almacén proveedores + órdenes de compra (Fase 3c). Reads: workspace
	// roles; writes (create/edit/emit/cancel/receive): admin/almacen.
	mux.Handle("GET /api/suppliers", authMW(http.HandlerFunc(server.HandleSuppliers)))
	mux.Handle("POST /api/suppliers", authMW(http.HandlerFunc(server.HandleSuppliers)))
	mux.Handle("PUT /api/suppliers/{id}", authMW(http.HandlerFunc(server.HandleSupplierByID)))
	mux.Handle("DELETE /api/suppliers/{id}", authMW(http.HandlerFunc(server.HandleSupplierByID)))
	mux.Handle("GET /api/purchase-orders", authMW(http.HandlerFunc(server.HandlePurchaseOrders)))
	mux.Handle("POST /api/purchase-orders", authMW(http.HandlerFunc(server.HandlePurchaseOrders)))
	mux.Handle("GET /api/purchase-orders/{id}", authMW(http.HandlerFunc(server.HandlePurchaseOrderByID)))
	mux.Handle("PUT /api/purchase-orders/{id}", authMW(http.HandlerFunc(server.HandlePurchaseOrderByID)))
	mux.Handle("POST /api/purchase-orders/{id}/emit", authMW(http.HandlerFunc(server.HandlePurchaseOrderEmit)))
	mux.Handle("POST /api/purchase-orders/{id}/cancel", authMW(http.HandlerFunc(server.HandlePurchaseOrderCancel)))
	mux.Handle("POST /api/purchase-orders/{id}/receive", authMW(http.HandlerFunc(server.HandlePurchaseOrderReceive)))

	// Project gallery photos (CRM Phase 1) & Commercial Showcase (CRM Phase 4)
	mux.Handle("GET /api/projects/{id}/photos", authMW(http.HandlerFunc(server.HandleProjectPhotos)))
	mux.Handle("POST /api/projects/{id}/photos", authMW(http.HandlerFunc(server.HandleProjectPhotos)))
	mux.Handle("PATCH /api/projects/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleProjectPhotoByID)))
	mux.Handle("DELETE /api/projects/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleProjectPhotoByID)))
	mux.Handle("GET /api/showcase/photos", authMW(http.HandlerFunc(server.HandleShowcasePhotos)))

	// Project internal messages & technical workflow (CRM Phase 2)
	mux.Handle("GET /api/projects/{id}/messages", authMW(http.HandlerFunc(server.HandleProjectInternalMessages)))
	mux.Handle("POST /api/projects/{id}/messages", authMW(http.HandlerFunc(server.HandleProjectInternalMessages)))
	mux.Handle("PATCH /api/projects/{id}/technical-workflow", authMW(http.HandlerFunc(server.HandleProjectTechnicalWorkflow)))

	// Warranty tickets (CRM Phase 3)
	mux.Handle("GET /api/warranties", authMW(http.HandlerFunc(server.HandleWarrantyTickets)))
	mux.Handle("POST /api/warranties", authMW(http.HandlerFunc(server.HandleWarrantyTickets)))
	mux.Handle("GET /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("PATCH /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("DELETE /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("GET /api/warranties/{id}/photos", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotos)))
	mux.Handle("POST /api/warranties/{id}/photos", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotos)))
	mux.Handle("DELETE /api/warranties/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotoDelete)))

	// Plantillas de proyecto (#110 / H15)

	mux.Handle("GET /api/project-templates", authMW(http.HandlerFunc(server.HandleProjectTemplates)))
	mux.Handle("POST /api/project-templates", authMW(http.HandlerFunc(server.HandleProjectTemplates)))
	mux.Handle("GET /api/project-templates/{id}", authMW(http.HandlerFunc(server.HandleProjectTemplateByID)))
	mux.Handle("PUT /api/project-templates/{id}", authMW(http.HandlerFunc(server.HandleProjectTemplateByID)))
	mux.Handle("DELETE /api/project-templates/{id}", authMW(http.HandlerFunc(server.HandleProjectTemplateByID)))

	// Cálculo financiero
	mux.Handle("POST /api/projects/{id}/calculate", authMW(http.HandlerFunc(server.HandleProjectCalculate)))

	// Assignable portfolio owners (admin + gerente_ventas) — F035
	mux.Handle("GET /api/assignable-owners", authMW(http.HandlerFunc(server.HandleAssignableOwners)))

	// Seed: populate database from plantilla fixtures (idempotent)
	mux.Handle("POST /api/seed", authMW(http.HandlerFunc(server.HandleSeed)))

	// Catalog media (F040) — upload mutate-catalog roles; GET any auth
	mux.Handle("POST /api/media", authMW(http.HandlerFunc(server.HandleMediaUpload)))
	mux.Handle("GET /api/media/{name}", authMW(http.HandlerFunc(server.HandleMediaGet)))

	// Workshop settings (F031 defaults + F044 COST-02 flag)
	mux.Handle("GET /api/settings", authMW(http.HandlerFunc(server.HandleWorkshopSettings)))
	mux.Handle("PUT /api/settings", authMW(http.HandlerFunc(server.HandleWorkshopSettings)))

	// Admin — Gestión de usuarios (solo admin; live role from DB)
	adminMW := AdminMiddleware(server.JWTSecret, server.Store)
	mux.Handle("GET /api/admin/users", adminMW(http.HandlerFunc(server.HandleAdminUsers)))
	mux.Handle("PUT /api/admin/users/{id}/role", adminMW(http.HandlerFunc(server.HandleAdminUserRole)))
	mux.Handle("DELETE /api/admin/users/{id}", adminMW(http.HandlerFunc(server.HandleAdminUserReject)))
	// Sector assignments of any user — admin only (F094: was plain auth,
	// letting any authenticated user rewrite anyone's station access).
	mux.Handle("GET /api/admin/users/{id}/sectors", adminMW(http.HandlerFunc(server.HandleUserSectors)))
	mux.Handle("PUT /api/admin/users/{id}/sectors", adminMW(http.HandlerFunc(server.HandleUserSectors)))

	// NOTE: legacy /api/staff/* routes were removed (users.role bridge): they
	// created/listed GLOBAL users with no organization scope and no caller in
	// the clients. Team management lives in /api/org/* (memberships, #326) and
	// /api/admin/users (org-scoped directory).

	// Aplicar CORS a toda la aplicación (allowlist, nunca wildcard)
	return CORSMiddleware(server.allowedOrigins)(RequestIDMiddleware(mux))
}
