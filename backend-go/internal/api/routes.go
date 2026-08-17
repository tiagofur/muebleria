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

	// Production activity tracking (gerente_produccion dashboard)
	mux.Handle("POST /api/production/activity/claim", authMW(http.HandlerFunc(server.HandleProductionClaim)))
	mux.Handle("POST /api/production/activity/finish/{activityId}", authMW(http.HandlerFunc(server.HandleProductionFinish)))
	mux.Handle("POST /api/production/activity/damage", authMW(http.HandlerFunc(server.HandleProductionDamage)))
	mux.Handle("GET /api/production/dashboard", authMW(http.HandlerFunc(server.HandleProductionDashboard)))
	mux.Handle("GET /api/production/active", authMW(http.HandlerFunc(server.HandleProductionActiveJobs)))
	mux.Handle("PATCH /api/production/damage/{id}/resolve", authMW(http.HandlerFunc(server.HandleProductionDamageResolve)))
	mux.Handle("GET /api/production/operators", authMW(http.HandlerFunc(server.HandleOperatorsBySector)))

	// User sector management (admin assigns sectors to operators)
	mux.Handle("GET /api/admin/users/{id}/sectors", authMW(http.HandlerFunc(server.HandleUserSectors)))
	mux.Handle("PUT /api/admin/users/{id}/sectors", authMW(http.HandlerFunc(server.HandleUserSectors)))

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
