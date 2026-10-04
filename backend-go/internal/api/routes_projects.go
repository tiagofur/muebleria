package api

import (
	"net/http"
)

// Contrato: proyectos/cotizaciones CRUD, bootstrap-design, identidad
// FurnitureInstance (#385) y relación QuoteLine (#386).
func registerProjectRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Proyectos y cotizaciones
	mux.Handle("POST /api/projects:bootstrap-design", noStoreMiddleware(authMW(server.RequireIdempotency("project.bootstrap-design", http.HandlerFunc(server.HandleProjectDesignBootstrap)))))
	mux.Handle("GET /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	mux.Handle("POST /api/projects", authMW(http.HandlerFunc(server.HandleProjects)))
	// #642 / 2A: batch read model for project commercial summaries in Cotizaciones list.
	mux.Handle("GET /api/projects/commercial-summaries", authMW(http.HandlerFunc(server.HandleProjectCommercialSummaries)))
	mux.Handle("GET /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))
	mux.Handle("PUT /api/projects/{id}", authMW(server.requireProjectInlineUpdateIdempotency(http.HandlerFunc(server.HandleProjectByID))))
	mux.Handle("DELETE /api/projects/{id}", authMW(http.HandlerFunc(server.HandleProjectByID)))

	// Project furniture identity (#385 / DT-1, ADR-0003): stable per-unit
	// identity owned by exactly one project. Create is retry-safe through the
	// durable idempotency receipt; removal is the terminal lifecycle command
	// under optimistic concurrency.
	mux.Handle("GET /api/projects/{projectId}/furniture-instances", authMW(http.HandlerFunc(server.HandleProjectFurnitureInstances)))
	mux.Handle("POST /api/projects/{projectId}/furniture-instances", authMW(server.RequireIdempotency("project.create-furniture-instance", http.HandlerFunc(server.HandleProjectFurnitureInstances))))
	mux.Handle("POST /api/projects/{projectId}/furniture-instances/{instanceCommand...}", authMW(server.RequireIdempotency("project.duplicate-furniture-instance", projectFurnitureInstanceCommandRouter(map[string]http.Handler{
		"duplicate": http.HandlerFunc(server.HandleFurnitureInstanceDuplicate),
	}))))
	mux.Handle("POST /api/furniture-instances/{instanceCommand...}", authMW(server.RequireIdempotency("project.remove-furniture-instance", furnitureInstanceCommandRouter(map[string]http.Handler{
		"remove": http.HandlerFunc(server.HandleFurnitureInstanceRemove),
	}))))

	// QuoteLine ↔ FurnitureInstance (#386 / DT-2, ADR-0003): the explicit
	// relation answering which physical units a quote line represents, plus
	// the idempotent :materialize command converging those units to the
	// commercial quantity. Accepted/produced quotes reject materialization
	// changes with a typed conflict — later changes need a new revision.
	mux.Handle("GET /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances", authMW(http.HandlerFunc(server.HandleQuoteLineFurnitureInstances)))
	mux.Handle("POST /api/projects/{projectId}/quote-lines/{quoteLineCommand...}", authMW(server.RequireIdempotency("project.materialize-quote-line-furniture", quoteLineCommandRouter(map[string]http.Handler{
		"materialize": http.HandlerFunc(server.HandleQuoteLineMaterialize),
	}))))
}
