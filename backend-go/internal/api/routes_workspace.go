package api

import (
	"net/http"
)

// Contrato: utilidades de operación — plantillas de proyecto (#110),
// cálculo financiero, owners asignables (F035) y seed demo.
func registerWorkspaceRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
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
}

// Contrato: workshop settings (F031/F044) y selecciones de salida de
// máquina (#591).
func registerWorkspaceSettingsRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Workshop settings (F031 defaults + F044 COST-02 flag)
	mux.Handle("GET /api/settings", authMW(http.HandlerFunc(server.HandleWorkshopSettings)))
	mux.Handle("PUT /api/settings", authMW(http.HandlerFunc(server.HandleWorkshopSettings)))

	// Machine output selections (#591 / WEB-MFG-2) — generated contract paths
	mux.Handle("GET /api/machine-output-selections", authMW(http.HandlerFunc(server.HandleListMachineOutputSelections)))
	mux.Handle("PUT /api/machine-output-selections/{operation}", authMW(http.HandlerFunc(server.HandleUpsertMachineOutputSelection)))
}
