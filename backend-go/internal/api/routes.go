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

	// Proyectos y cotizaciones
	mux.Handle("GET /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	mux.Handle("POST /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	mux.Handle("GET /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))
	mux.Handle("PUT /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))
	mux.Handle("DELETE /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))

	// Cálculo financiero
	mux.Handle("POST /api/projects/{id}/calculate", authMW(http.HandlerFunc(server.HandleProjectCalculate)))

	// Assignable portfolio owners (admin + gerente_ventas) — F035
	mux.Handle("GET /api/assignable-owners", authMW(http.HandlerFunc(server.HandleAssignableOwners)))

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

	// Aplicar CORS a toda la aplicación (allowlist, nunca wildcard)
	return CORSMiddleware(server.allowedOrigins)(mux)
}
