package api

import (
	"net/http"
)

// Contrato: biblioteca paramétrica compartida (definitions/layout/authoring)
// y librerías de manufactura standard + overlays (LIB-1..4).
func registerLibraryRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Biblioteca paramétrica de muebles (catálogo piloto compartido con el dominio TS;
	// consumida hoy por la extensión de SketchUp; requiere licencia activa por usuario).
	mux.Handle("GET /api/furniture/definitions", authMW(http.HandlerFunc(server.HandleFurnitureDefinitions)))
	// Layout completo resuelto (componentes + herrajes) de una definición a
	// medidas concretas — la extensión de SketchUp inserta desde aquí.
	mux.Handle("GET /api/furniture/definitions/{definitionId}/layout", authMW(http.HandlerFunc(server.HandleFurnitureDefinitionLayout)))
	// #477 — resolve de autoría semántica rica (stateless, versionado): la
	// extensión envía su snapshot de autoría como body estructurado y recibe
	// el resultado resuelto autoritativo. POST explícito; sin query params.
	authoringResolve := authMW(http.HandlerFunc(server.HandleFurnitureAuthoringResolve))
	mux.Handle("POST /api/furniture/authoring/resolve", authoringResolve)
	// Keep the exact unmethoded path so unsupported methods reach the contract
	// handler and receive its typed METHOD_NOT_ALLOWED envelope. Without this
	// fallback, ServeMux emits a bare 405 before the versioned boundary runs.
	mux.Handle("/api/furniture/authoring/resolve", authoringResolve)
	// #497 — preview de autoría del editor web: resuelve un DRAFT de
	// definiciones tipadas con valores de muestra por el mismo motor del
	// resolve, sin persistir nada ni avanzar la revisión del catálogo.
	// Web-only: los tokens de extensión no pueden POSTearlo (no está en el
	// allowlist de extensión — fail-closed por defecto).
	mux.Handle("POST /api/furniture/authoring/preview", authMW(http.HandlerFunc(server.HandleFurnitureAuthoringPreview)))

	// #772 (LIB-1): Manufacturing library identity and immutable releases
	mux.Handle("GET /api/manufacturing-libraries/standard/releases", authMW(http.HandlerFunc(server.HandleStandardLibraryReleases)))
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/current", authMW(http.HandlerFunc(server.HandleStandardLibraryCurrentRelease)))
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/{releaseId}", authMW(http.HandlerFunc(server.HandleStandardLibraryReleaseByID)))
	// #918 (HW-PROFILE): pinned hardware-profile read for an exact release.
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/{releaseId}/hardware-profiles", authMW(http.HandlerFunc(server.HandleHardwareProfilesForRelease)))
	// #955 (LIB-1): Granete platform staff publish surface — the only
	// writers of Standard library releases.
	mux.Handle("POST /api/manufacturing-libraries/standard/releases", authMW(http.HandlerFunc(server.HandleCreateStandardLibraryRelease)))
	mux.Handle("POST /api/manufacturing-libraries/standard/releases/{releaseId}/publish", authMW(http.HandlerFunc(server.HandlePublishStandardLibraryRelease)))
	// #1102 (LIB-AUTH Slice C): publish-confirmation diff — what would change
	// between the published release and the draft; read-only.
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/{releaseId}/diff", authMW(http.HandlerFunc(server.HandleStandardLibraryDraftDiff)))
	// #1102 (LIB-AUTH Slice B): read-only pre-publish validation — the
	// "probar borrador" dry run; same platform-staff gate as publish.
	mux.Handle("POST /api/manufacturing-libraries/standard/releases/{releaseId}/validate", authMW(http.HandlerFunc(server.HandleValidateStandardLibraryDraft)))
	// #1102 (LIB-AUTH Slice A): authoring workspace draft read — platform
	// staff only; the literal path wins over {releaseId} so a draft list is
	// never parsed as a release id.
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/drafts", authMW(http.HandlerFunc(server.HandleStandardLibraryDraftReleases)))
	// #773 (LIB-2): Manifest and content-addressed resource distribution
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/{releaseId}/manifest", authMW(http.HandlerFunc(server.HandleStandardLibraryReleaseManifest)))
	mux.Handle("GET /api/manufacturing-libraries/standard/releases/{releaseId}/resources/{resourceId}/blobs/{hash}", authMW(http.HandlerFunc(server.HandleStandardLibraryResourceBlob)))
	// #775 (LIB-4): Organization manufacturing library overlays and 3-way rebase
	mux.Handle("POST /api/manufacturing-libraries/overlays", authMW(http.HandlerFunc(server.HandleCreateLibraryOverlay)))
	mux.Handle("GET /api/manufacturing-libraries/overlays/active", authMW(http.HandlerFunc(server.HandleGetActiveLibraryOverlay)))
	mux.Handle("GET /api/manufacturing-libraries/overlays/{id}", authMW(http.HandlerFunc(server.HandleGetLibraryOverlayByID)))
	mux.Handle("PATCH /api/manufacturing-libraries/overlays/{id}", authMW(http.HandlerFunc(server.HandleUpdateLibraryOverlay)))
	mux.Handle("PUT /api/manufacturing-libraries/overlays/{id}/policy-draft", authMW(http.HandlerFunc(server.HandleSaveLibraryOverlayPolicyDraft)))
	mux.Handle("POST /api/manufacturing-libraries/overlays/{id}/policy:activate", authMW(http.HandlerFunc(server.HandleActivateLibraryOverlayPolicy)))
	mux.Handle("POST /api/manufacturing-libraries/overlays/{id}/rebase", authMW(http.HandlerFunc(server.HandleRebaseLibraryOverlay)))
	mux.Handle("GET /api/manufacturing-libraries/overlays/{id}/conflicts", authMW(http.HandlerFunc(server.HandleListLibraryOverlayConflicts)))
	mux.Handle("POST /api/manufacturing-libraries/overlays/{id}/conflicts/{conflictId}/resolve", authMW(http.HandlerFunc(server.HandleResolveLibraryOverlayConflict)))
}
