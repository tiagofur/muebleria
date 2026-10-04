package api

import (
	"net/http"
)

// Contrato: ciclo comercial — reconciliación (#393), requote (#394),
// QuoteRevisions (#571), proyección comercial (#677) y furniture workspace (#500).
func registerCommercialRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance.
	// Pure deterministic comparison returning structured differences and summary counts.
	mux.Handle("POST /api/projects/{projectId}/reconciliation", authMW(http.HandlerFunc(server.HandleProjectReconciliation)))

	// #394 / DT-10: explicit re-quote workflow. The response of a lost
	// request is replayed by the durable idempotency receipt — a retry never
	// mints a second revision. Classification is computed server-side; the
	// accepted source revision is never rewritten.
	mux.Handle("POST /api/projects/{projectId}/quote-revisions:requote", authMW(server.RequireIdempotency("quote.requote", http.HandlerFunc(server.HandleProjectQuoteRequote))))
	// #500 / WEB-DT-1: immutable QuoteRevision read model (with per-unit
	// commercial items) that powers the exact commercial context selector of
	// the Project Furniture matrix. Read-only.
	mux.Handle("GET /api/projects/{projectId}/quote-revisions", authMW(http.HandlerFunc(server.HandleProjectQuoteRevisions)))
	// #642 -> #677: non-binding commercial projection for the exact mutable
	// Design working copy. no-store prevents a previous model/version total
	// from being presented as current after authoring mutations.
	mux.Handle("GET /api/projects/{projectId}/designs/{designId}/commercial-projection", noStoreMiddleware(consistentReleaseCatalogMiddleware(authMW(http.HandlerFunc(server.HandleDesignCommercialProjection)))))
	// #571 / WEB-DT-4: commercial QuoteRevision lifecycle. The canonical Q1
	// entry converts the project's editable commercial state into the first
	// immutable draft revision — the server builds the whole snapshot
	// (materialization convergence included), the client sends no commercial
	// payload. Q1-only by contract: subsequent revisions come from requote.
	mux.Handle("POST /api/projects/{projectId}/quote-revisions", noStoreMiddleware(authMW(server.RequireIdempotency("quote.create-revision", http.HandlerFunc(server.HandleCreateInitialQuoteRevision)))))
	mux.Handle("POST /api/projects/{projectId}/designs/{designId}/quote-revisions", noStoreMiddleware(authMW(server.RequireIdempotency("quote.create-design-revision", http.HandlerFunc(server.HandleCreateInitialDesignQuoteRevision)))))
	// #571 / WEB-DT-4: explicit lifecycle commands on an EXACT revision —
	// publish (draft→published) and accept (published→accepted, atomically
	// superseding the previously accepted revision of the project in the same
	// transaction). Exact IDs only; never "latest". Each command carries its
	// own idempotency scope so a retry replays the same transition.
	mux.Handle("POST /api/projects/{projectId}/quote-revisions/{quoteRevisionCommand...}", noStoreMiddleware(authMW(quoteRevisionCommandRouter(map[string]http.Handler{
		"publish": server.RequireIdempotency("quote.publish-revision", http.HandlerFunc(server.HandleQuoteRevisionPublish)),
		"accept":  server.RequireIdempotency("quote.accept-revision", http.HandlerFunc(server.HandleQuoteRevisionAccept)),
	}))))
	// #500 / WEB-DT-1: authoritative contextual projection of the Project
	// Furniture matrix (placed/pending, commercial grouping provenance,
	// server actions and exact contextual release). Read-only.
	mux.Handle("POST /api/projects/{projectId}/furniture-workspace", authMW(http.HandlerFunc(server.HandleProjectFurnitureWorkspace)))
}
