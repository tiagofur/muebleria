package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: identidad FurnitureInstance (#385 ADR-0003) y su relación con
// QuoteLine (#386).
type FurnitureStore interface {
	// Project furniture identity (#385 / DT-1, ADR-0003): stable per-unit
	// identity owned by exactly one project; lifecycle + durable audit are
	// transactionally coupled in the storage layer.
	CreateFurnitureInstance(ctx context.Context, cmd storage.CreateFurnitureInstanceCommand) (*domain.FurnitureInstance, error)
	GetFurnitureInstanceByID(ctx context.Context, id string) (*domain.FurnitureInstance, error)
	ListFurnitureInstancesByProject(ctx context.Context, projectID string, includeTerminal bool) ([]domain.FurnitureInstance, error)
	// List with the server-computed presentation block (#389 / DT-5): catalog
	// label + quoted-or-default dimensions for authoring-client panels.
	ListFurnitureInstanceSummariesByProject(ctx context.Context, projectID string, includeTerminal bool) ([]storage.FurnitureInstanceSummary, error)
	RemoveFurnitureInstance(ctx context.Context, cmd storage.RemoveFurnitureInstanceCommand) (*domain.FurnitureInstance, error)
	// #391 / DT-7: duplicate an existing project furniture instance within the same project.
	DuplicateFurnitureInstance(ctx context.Context, cmd storage.DuplicateFurnitureInstanceCommand) (*domain.FurnitureInstance, error)

	// QuoteLine ↔ FurnitureInstance relation (#386 / DT-2, ADR-0003): the
	// explicit link answering which physical units a quote line represents;
	// materialization converges those units to the line's commercial quantity
	// (idempotent, draft-only, accepted quotes are immutable).
	MaterializeQuoteLine(ctx context.Context, cmd storage.MaterializeQuoteLineCommand) (*domain.QuoteLineMaterialization, error)
	ListQuoteLineFurnitureInstances(ctx context.Context, projectID, quoteLineID string) ([]domain.QuoteLineFurnitureInstance, error)
}
