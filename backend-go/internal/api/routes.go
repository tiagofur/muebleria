package api

import (
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func RegisterRoutes(server *Server) http.Handler {
	mux := http.NewServeMux()

	// Rate limiting on auth endpoints to blunt brute-force / credential
	// stuffing (#6). Applied per client-IP before the handler runs.
	authRL := RateLimitMiddleware(server.rateLimitRPS, server.rateLimitBurst)

	// Endpoints públicos (Auth) — with rate limiting
	mux.Handle("POST /api/auth/register", authRL(http.HandlerFunc(server.HandleRegister)))
	mux.Handle("POST /api/auth/login", authRL(http.HandlerFunc(server.HandleLogin)))

	// Endpoints protegidos por JWT (role/active re-checked against DB — #16)
	authMW := AuthMiddleware(server.JWTSecret, server.Store)

	// Refresh: requires a still-valid token; re-issues JWT with current DB role.
	mux.Handle("POST /api/auth/refresh", authMW(http.HandlerFunc(server.HandleRefresh)))

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
	mux.Handle("POST /api/projects/{id}/floor-scan", authMW(http.HandlerFunc(server.HandleProjectFloorScan)))
	mux.Handle("GET /api/projects/{id}/loading-status", authMW(http.HandlerFunc(server.HandleProjectLoadingStatus)))
	mux.Handle("PATCH /api/projects/{id}/items/{itemId}/floor-status", authMW(http.HandlerFunc(server.HandleProjectItemFloorStatus)))
	mux.Handle("GET /api/projects/{id}/floor-events", authMW(http.HandlerFunc(server.HandleProjectFloorEvents)))

	// Physical production execution (OC-030..OC-034, #301): piece operations
	// and module unit transitions with server-side gates, RBAC and audit.
	mux.Handle("GET /api/projects/{id}/part-executions", authMW(http.HandlerFunc(server.HandleProjectPartExecutions)))
	mux.Handle("PUT /api/projects/{id}/part-executions", authMW(http.HandlerFunc(server.HandleGeneratePartExecutions)))
	mux.Handle("POST /api/projects/{id}/parts/{partId}/advance", authMW(http.HandlerFunc(server.HandleAdvancePartOperation)))
	mux.Handle("POST /api/projects/{id}/parts/{partId}/rework", authMW(http.HandlerFunc(server.HandlePartRework)))
	mux.Handle("POST /api/projects/{id}/units/{unitId}/advance", authMW(http.HandlerFunc(server.HandleAdvanceModuleUnit)))
	mux.Handle("POST /api/projects/{id}/units/{unitId}/assembly-override", authMW(http.HandlerFunc(server.HandleAssemblyOverride)))

	// Material planning (OC-050..OC-054, #302): requirements from the released
	// BOM, reservations, shortage and the evidence-backed materials release.
	mux.Handle("GET /api/projects/{id}/materials", authMW(http.HandlerFunc(server.HandleProjectMaterials)))
	mux.Handle("POST /api/projects/{id}/materials/derive", authMW(http.HandlerFunc(server.HandleMaterialsDerive)))
	mux.Handle("POST /api/projects/{id}/materials/reserve", authMW(http.HandlerFunc(server.HandleMaterialsReserve)))
	mux.Handle("POST /api/projects/{id}/materials/consume", authMW(http.HandlerFunc(server.HandleMaterialsConsume)))
	mux.Handle("POST /api/projects/{id}/materials/release", authMW(http.HandlerFunc(server.HandleMaterialsRelease)))

	// Quality & rework (OC-060..OC-062, #302): issues, rework actions with
	// job costing and the per-unit QC gate — server-authoritative.
	mux.Handle("GET /api/projects/{id}/quality", authMW(http.HandlerFunc(server.HandleProjectQuality)))
	mux.Handle("POST /api/projects/{id}/quality/issue", authMW(http.HandlerFunc(server.HandleQualityIssue)))
	mux.Handle("POST /api/projects/{id}/quality/issue/{issueId}/transition", authMW(http.HandlerFunc(server.HandleQualityIssueTransition)))
	mux.Handle("POST /api/projects/{id}/quality/rework", authMW(http.HandlerFunc(server.HandleQualityRework)))
	mux.Handle("POST /api/projects/{id}/quality/qc/{unitId}", authMW(http.HandlerFunc(server.HandleQualityUnitQc)))
	mux.Handle("POST /api/projects/{id}/quality/qc/{unitId}/override", authMW(http.HandlerFunc(server.HandleQualityUnitQcOverride)))

	// Installation job (OC-070..OC-074, #303): visits, field issues, punch
	// items and gated closeout — server-authoritative with audit events.
	mux.Handle("GET /api/projects/{id}/installation", authMW(http.HandlerFunc(server.HandleProjectInstallation)))
	mux.Handle("PUT /api/projects/{id}/installation", authMW(http.HandlerFunc(server.HandleProjectInstallation)))
	mux.Handle("POST /api/projects/{id}/installation/closeout", authMW(http.HandlerFunc(server.HandleProjectInstallationCloseout)))

	// Job costing (OC-080..OC-084, #304): baseline frozen from quote snapshot
	// + release, time entries, other actuals and the estimate vs actual view.
	mux.Handle("GET /api/projects/{id}/costing", authMW(http.HandlerFunc(server.HandleProjectCosting)))
	mux.Handle("POST /api/projects/{id}/costing/baseline", authMW(http.HandlerFunc(server.HandleCostingBaseline)))
	mux.Handle("POST /api/projects/{id}/costing/labor-rate", authMW(http.HandlerFunc(server.HandleCostingLaborRate)))
	mux.Handle("POST /api/projects/{id}/costing/time", authMW(http.HandlerFunc(server.HandleCostingTime)))
	mux.Handle("POST /api/projects/{id}/costing/time/{entryId}/void", authMW(http.HandlerFunc(server.HandleCostingTimeVoid)))
	mux.Handle("POST /api/projects/{id}/costing/other", authMW(http.HandlerFunc(server.HandleCostingOther)))
	mux.Handle("POST /api/projects/{id}/costing/other/{costId}/void", authMW(http.HandlerFunc(server.HandleCostingOtherVoid)))

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
	mux.Handle("PUT /api/admin/users/{id}/approve", adminMW(http.HandlerFunc(server.HandleAdminUserApprove)))
	mux.Handle("PUT /api/admin/users/{id}/role", adminMW(http.HandlerFunc(server.HandleAdminUserRole)))
	mux.Handle("DELETE /api/admin/users/{id}", adminMW(http.HandlerFunc(server.HandleAdminUserReject)))
	// Sector assignments of any user — admin only (F094: was plain auth,
	// letting any authenticated user rewrite anyone's station access).
	mux.Handle("GET /api/admin/users/{id}/sectors", adminMW(http.HandlerFunc(server.HandleUserSectors)))
	mux.Handle("PUT /api/admin/users/{id}/sectors", adminMW(http.HandlerFunc(server.HandleUserSectors)))

	// Staff management — admin + gerente_produccion (production/warehouse) + gerente_ventas (sales)
	// Uses {department} wildcard for production/warehouse; sales has its own routes.
	prodStaffMW := RoleMiddleware(server.JWTSecret, server.Store, domain.RoleAdmin, domain.RoleGerenteProduccion)
	salesStaffMW := RoleMiddleware(server.JWTSecret, server.Store, domain.RoleAdmin, domain.RoleGerenteVentas)

	// Production + Warehouse (gerente_produccion)
	mux.Handle("GET /api/staff/production", prodStaffMW(http.HandlerFunc(server.HandleStaffByRole)))
	mux.Handle("POST /api/staff/production", prodStaffMW(http.HandlerFunc(server.HandleStaffCreate)))
	mux.Handle("PUT /api/staff/production/{id}", prodStaffMW(http.HandlerFunc(server.HandleStaffUpdate)))
	mux.Handle("DELETE /api/staff/production/{id}", prodStaffMW(http.HandlerFunc(server.HandleStaffDelete)))
	mux.Handle("GET /api/staff/production/{id}/sectors", prodStaffMW(http.HandlerFunc(server.HandleUserSectors)))
	mux.Handle("PUT /api/staff/production/{id}/sectors", prodStaffMW(http.HandlerFunc(server.HandleUserSectors)))

	mux.Handle("GET /api/staff/warehouse", prodStaffMW(http.HandlerFunc(server.HandleStaffByRole)))
	mux.Handle("POST /api/staff/warehouse", prodStaffMW(http.HandlerFunc(server.HandleStaffCreate)))
	mux.Handle("PUT /api/staff/warehouse/{id}", prodStaffMW(http.HandlerFunc(server.HandleStaffUpdate)))
	mux.Handle("DELETE /api/staff/warehouse/{id}", prodStaffMW(http.HandlerFunc(server.HandleStaffDelete)))
	mux.Handle("GET /api/staff/warehouse/{id}/sectors", prodStaffMW(http.HandlerFunc(server.HandleUserSectors)))
	mux.Handle("PUT /api/staff/warehouse/{id}/sectors", prodStaffMW(http.HandlerFunc(server.HandleUserSectors)))

	// Sales (gerente_ventas)
	mux.Handle("GET /api/staff/sales", salesStaffMW(http.HandlerFunc(server.HandleStaffByRole)))
	mux.Handle("POST /api/staff/sales", salesStaffMW(http.HandlerFunc(server.HandleStaffCreate)))
	mux.Handle("PUT /api/staff/sales/{id}", salesStaffMW(http.HandlerFunc(server.HandleStaffUpdate)))
	mux.Handle("DELETE /api/staff/sales/{id}", salesStaffMW(http.HandlerFunc(server.HandleStaffDelete)))

	// Aplicar CORS a toda la aplicación (allowlist, nunca wildcard)
	return CORSMiddleware(server.allowedOrigins)(mux)
}
