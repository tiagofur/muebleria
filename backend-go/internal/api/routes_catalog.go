package api

import (
	"net/http"
)

// Contrato: clientes y catálogo CRUD — tableros, ambientes, canton, herrajes,
// perfiles HW, side assignments, hardware assets 3D, option groups, agregados,
// categorías, módulos, estructuras y componentes.
func registerCatalogRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Clientes
	mux.Handle("GET /api/customers/summaries", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleCustomerSummaries))))
	mux.Handle("GET /api/customers", authMW(http.HandlerFunc(server.HandleCustomers)))
	mux.Handle("POST /api/customers", authMW(http.HandlerFunc(server.HandleCustomers)))
	mux.Handle("GET /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))
	mux.Handle("PUT /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))
	mux.Handle("DELETE /api/customers/{id}", authMW(http.HandlerFunc(server.HandleCustomerByID)))

	// Catálogo: Política de construcción de fábrica (#1078/#1218) — lectura
	// del overlay parseado; nil = escalera de librería.
	mux.Handle("GET /api/catalog/construction-policy", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleConstructionPolicy))))

	// Catálogo: Capacidades de apertura de fábrica (#1134) — lectura del
	// blob 'opening.capabilities' parseado; nil = escalera de librería.
	// Available ≠ valid: gobierna la oferta para nueva autoría, jamás los
	// diseños existentes.
	mux.Handle("GET /api/catalog/opening-capabilities", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleOpeningCapabilities))))

	// Catálogo: Perfiles de apertura (#1130) — gola L/C, REACH… con ficha
	// técnica respaldada; escrituras If-Match.
	mux.Handle("GET /api/catalog/opening-profiles", authMW(http.HandlerFunc(server.HandleOpeningProfiles)))
	mux.Handle("POST /api/catalog/opening-profiles", authMW(http.HandlerFunc(server.HandleOpeningProfiles)))
	mux.Handle("GET /api/catalog/opening-profiles/{id}", authMW(http.HandlerFunc(server.HandleOpeningProfileByID)))
	mux.Handle("PUT /api/catalog/opening-profiles/{id}", authMW(http.HandlerFunc(server.HandleOpeningProfileByID)))
	mux.Handle("DELETE /api/catalog/opening-profiles/{id}", authMW(http.HandlerFunc(server.HandleOpeningProfileByID)))

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

	// #913 / HW-PROFILE: versioned hardware-profile catalog writes.
	mux.Handle("GET /api/catalog/hardware-profiles", authMW(http.HandlerFunc(server.HandleHardwareProfiles)))
	mux.Handle("POST /api/catalog/hardware-profiles", authMW(http.HandlerFunc(server.HandleHardwareProfiles)))
	mux.Handle("GET /api/catalog/hardware-profiles/{id}", authMW(http.HandlerFunc(server.HandleHardwareProfileByID)))
	mux.Handle("PUT /api/catalog/hardware-profiles/{id}", authMW(http.HandlerFunc(server.HandleHardwareProfileByID)))
	mux.Handle("DELETE /api/catalog/hardware-profiles/{id}", authMW(http.HandlerFunc(server.HandleHardwareProfileByID)))

	// #915 / HW-PROFILE: component definition side assignments.
	mux.Handle("GET /api/catalog/components/{id}/side-assignments", authMW(http.HandlerFunc(server.HandleComponentSideAssignments)))
	mux.Handle("PUT /api/catalog/components/{id}/side-assignments", authMW(http.HandlerFunc(server.HandleComponentSideAssignments)))
	mux.Handle("DELETE /api/catalog/components/{id}/side-assignments/{side}", authMW(http.HandlerFunc(server.HandleComponentSideAssignments)))

	// #667 / M1: versioned 3D assets for the hardware catalog. start/finalize
	// are durable commands behind the idempotency receipt (a lost finalize
	// response replays the SAME asset, never a second one); the multipart
	// byte upload is a replace-semantics upsert of staging state and stays
	// outside the generated OpenAPI surface, same as design publish
	// artifacts and catalog media. Bytes are read through short-lived
	// integrity-pinned grants only (#460) — the consumer surface for #668.
	mux.Handle("POST /api/hardware-assets/uploads", noStoreMiddleware(authMW(server.RequireIdempotency("hardware-assets.start-upload", http.HandlerFunc(server.HandleHardwareAssetUploadStart)))))
	mux.Handle("PUT /api/hardware-assets/uploads/{sessionId}/bytes/{representation}", authMW(http.HandlerFunc(server.HandleHardwareAssetUploadBytes)))
	mux.Handle("POST /api/hardware-assets/uploads/{sessionCommand...}", noStoreMiddleware(authMW(hardwareAssetSessionCommandRouter(map[string]http.Handler{
		// The generated client sends an Idempotency-Key for finalize; the
		// receipt now actually guards the command (retry replays the same
		// asset). cancel declares no key and stays direct.
		"finalize": server.RequireIdempotency("hardware-assets.finalize-upload", http.HandlerFunc(server.HandleHardwareAssetUploadFinalize)),
		"cancel":   http.HandlerFunc(server.HandleHardwareAssetUploadCancel),
	}))))
	mux.Handle("GET /api/hardware-assets/uploads/{sessionId}", authMW(http.HandlerFunc(server.HandleHardwareAssetUploadGet)))
	mux.Handle("GET /api/hardware-assets", authMW(http.HandlerFunc(server.HandleHardwareAssets)))
	mux.Handle("GET /api/hardware-assets/{assetId}", authMW(http.HandlerFunc(server.HandleHardwareAssetByID)))
	// Canonical command surface (#667 M1 R1): exactly the OpenAPI/generated
	// client forms — "{assetId}:retire" and
	// "{assetId}/revisions/{revisionId}:authorize". One catch-all dispatches
	// both shapes; the "uploads/{sessionCommand...}" pattern above is a strict
	// subset of this one (literal segment beats the wildcard), so ServeMux
	// accepts the pair without conflicts.
	mux.Handle("POST /api/hardware-assets/{assetCommand...}", noStoreMiddleware(authMW(hardwareAssetCommandRouter(map[string]http.Handler{
		"retire":    server.RequireIdempotency("hardware-assets.retire", http.HandlerFunc(server.HandleHardwareAssetRetire)),
		"authorize": http.HandlerFunc(server.HandleHardwareAssetRevisionAuthorize),
		"validate":  http.HandlerFunc(server.HandleHardwareAssetRevisionValidate),
		"derive":    server.RequireIdempotency("hardware-assets.derive-revision", http.HandlerFunc(server.HandleHardwareAssetRevisionDerive)),
	}))))
	mux.Handle("GET /api/hardware-assets/files/{key...}", server.hardwareAssetFileGetAuth(http.HandlerFunc(server.HandleHardwareAssetFileGet)))

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
}
