package api

import (
	"net/http"
)

// Contrato: designs, working copy, revisiones, validación de binding (#388)
// y pairing grants Web↔SketchUp (#499). Publish staged va en
// registerDesignPublishRoutes (mismo archivo).
func registerDesignRoutes(server *Server, mux *http.ServeMux, authRL, authMW func(http.Handler) http.Handler) {
	// Design aggregate and immutable DesignRevision snapshots (#387 / DT-3, ADR-0003):
	// logical designs owned by the project, plus versioned immutable revision snapshots.
	// Revision publication is retry-safe through the durable idempotency receipt.
	mux.Handle("GET /api/projects/{projectId}/designs", authMW(http.HandlerFunc(server.HandleProjectDesigns)))
	mux.Handle("POST /api/projects/{projectId}/designs", authMW(server.RequireIdempotency("project.create-design", http.HandlerFunc(server.HandleProjectDesigns))))
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/draft-units:prepare", authMW(server.RequireIdempotency("project.prepare-design-draft-units", http.HandlerFunc(server.HandlePrepareDesignDraftUnits))))
	mux.Handle("GET /api/designs/{designId}", authMW(http.HandlerFunc(server.HandleDesign)))
	mux.Handle("GET /api/designs/{designId}/working-copy", authMW(http.HandlerFunc(server.HandleDesignWorkingCopy)))
	mux.Handle("PUT /api/designs/{designId}/working-copy", authMW(http.HandlerFunc(server.HandleDesignWorkingCopy)))
	mux.Handle("POST /api/designs/{designId}/working-copy:reset", authMW(http.HandlerFunc(server.HandleDesignWorkingCopyReset)))
	// #637 / DT-MAT: quoted-material provenance detection (read-only) and the
	// explicit reconciliation command. The repair is an observable business
	// mutation: durable idempotency receipt like every other design command.
	mux.Handle("GET /api/designs/{designId}/working-copy/material-provenance", authMW(http.HandlerFunc(server.HandleDesignWorkingCopyMaterialProvenance)))
	mux.Handle("POST /api/designs/{designId}/effective-materials", authMW(http.HandlerFunc(server.HandleDesignEffectiveMaterials)))
	mux.Handle("POST /api/designs/{designId}/working-copy/material-choices:reconcile", noStoreMiddleware(authMW(server.RequireIdempotency("design.reconcile-working-materials", http.HandlerFunc(server.HandleDesignWorkingCopyMaterialsReconcile)))))
	mux.Handle("GET /api/designs/{designId}/revisions", authMW(http.HandlerFunc(server.HandleDesignRevisions)))
	mux.Handle("POST /api/designs/{designId}/revisions", authMW(server.RequireIdempotency("design.publish-revision", http.HandlerFunc(server.HandleDesignRevisions))))
	mux.Handle("GET /api/designs/{designId}/revisions/{revisionId}", authMW(http.HandlerFunc(server.HandleDesignRevision)))
	// #388 / DT-4: stateless authoritative validation of a SketchUp model
	// binding candidate. no-store: the answer is session- and revision-scoped.
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/binding:validate", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleProjectDesignBindingValidate))))

	// #499 / DT-SU-1: one-time Web-to-SketchUp pairing grants. Create and
	// cancel are authenticated commands that mint/revoke opaque codes, so
	// they get their own rate-limit bucket (separate from login's: a burst
	// of pairing must not lock out authentication, and vice versa). GET
	// status stays deliberately unlimited — the Web surface polls it while
	// waiting for the plugin to confirm the handoff. The exchange is the
	// extension-credential boundary: rate-limited like the auth surface
	// because it consumes an opaque code, and DENIED to web sessions inside
	// the handler.
	pairingCommandRL := RateLimitMiddleware(server.rateLimitRPS, server.rateLimitBurst)
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/pairing-grants", noStoreMiddleware(authMW(pairingCommandRL(http.HandlerFunc(server.HandleDesignPairingGrantCreate)))))
	mux.Handle("GET /api/projects/{projectId}/designs/{designId}/pairing-grants/{grantId}", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleDesignPairingGrantStatus))))
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/pairing-grants/{grantCommand...}", noStoreMiddleware(authMW(pairingCommandRL(designPairingGrantCommandRouter(map[string]http.Handler{
		"cancel": http.HandlerFunc(server.HandleDesignPairingGrantCancel),
	})))))
	mux.Handle("POST /api/design-pairing-grants:exchange", noStoreMiddleware(authRL(authMW(http.HandlerFunc(server.HandleDesignPairingGrantExchange)))))
	// #499 Slice 3: device-only confirmation of the persisted binding. The
	// same authRL bucket as exchange — both consume one-time grant state. The
	// wildcard must occupy an entire segment (same mux rule as the
	// designRevisionCommandRouter), so the grantId:confirm segment is captured
	// and split by the same router shape.
	mux.Handle("POST /api/design-pairing-grants/{grantCommand...}", noStoreMiddleware(authRL(authMW(designPairingGrantCommandRouter(map[string]http.Handler{
		"confirm": http.HandlerFunc(server.HandleDesignPairingGrantConfirm),
	})))))
}

// Contrato: publicación staged de DesignRevision con manifest + artefactos
// y lecturas firmadas (#392).
func registerDesignPublishRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// #392 / DT-8: staged publication of an immutable DesignRevision with
	// manifest + artifacts. prepare and finalize are durable commands behind
	// the idempotency receipt (retry of a lost finalize response replays the
	// SAME revision, never a new one); artifact upload is a multipart upsert
	// of staging metadata (replace semantics, inherently retry-safe). The
	// multipart upload endpoint is intentionally outside the generated
	// OpenAPI surface, same as catalog media upload.
	mux.Handle("POST /api/designs/{designId}/publish:prepare", noStoreMiddleware(authMW(server.RequireIdempotency("design.publish-prepare", http.HandlerFunc(server.HandleDesignPublishPrepare)))))
	mux.Handle("POST /api/designs/{designId}/publish/{sessionId}/artifacts/{kind}", authMW(http.HandlerFunc(server.HandleDesignPublishArtifactUpload)))
	mux.Handle("POST /api/designs/{designId}/publish/{publishCommand...}", noStoreMiddleware(authMW(server.RequireIdempotency("design.publish-finalize", publishCommandRouter(map[string]http.Handler{
		"finalize": http.HandlerFunc(server.HandleDesignPublishFinalize),
	})))))
	// Published artifact readback + signed reads (#392 §§31-32): metadata is
	// readable by the project surface; bytes are served through the same
	// short-lived grant mechanism as catalog media — never public URLs.
	mux.Handle("GET /api/designs/{designId}/revisions/{revisionId}/artifacts", authMW(http.HandlerFunc(server.HandleDesignRevisionArtifacts)))
	mux.Handle("POST /api/designs/{designId}/revisions/{revisionId}/artifacts/{artifactCommand...}", noStoreMiddleware(authMW(designRevisionArtifactCommandRouter(map[string]http.Handler{
		"authorize": http.HandlerFunc(server.HandleDesignRevisionArtifactAuthorize),
	}))))
	mux.Handle("GET /api/design-artifacts/{key...}", server.designArtifactGetAuth(http.HandlerFunc(server.HandleDesignArtifactGet)))
}
