package domain

import (
	"errors"
	"time"
)

// #386 / DT-2: QuoteLine ↔ FurnitureInstance relation (ADR-0003 /
// digital-thread §6). QuoteLine.quantity is commercial grouping; each physical
// unit keeps its own FurnitureInstance identity. The relation answers "which
// physical units does this quote line represent" — it never owns furniture
// identity.

var (
	// ErrQuoteRevisionAccepted rejects any materialization change (add or
	// retire linked units) once the project's commercial truth is pinned
	// (status accepted/produced). Later commercial changes require a new quote
	// revision (I3 / §6); today's acceptance state is projects.status.
	ErrQuoteRevisionAccepted = errors.New("quote revision accepted; materialization is immutable")
	// ErrQuoteLineStillMaterialized rejects deleting or dropping a quote line
	// that still represents materialized furniture instances. The link must be
	// retired explicitly (quantity decrease / unmaterialize) first — a generic
	// project edit may never silently destroy commercial ↔ physical linkage.
	ErrQuoteLineStillMaterialized = errors.New("quote line still represents materialized furniture instances")
	// ErrFurnitureInstanceDurableHistory rejects retiring (draft quantity
	// decrease) a linked instance that already has durable history: the
	// identity survives, it is never recycled for another unit (digital-thread
	// §6 / anti-pattern 12).
	ErrFurnitureInstanceDurableHistory = errors.New("furniture instance has durable history and is never recycled")
)

// QuoteLineFurnitureInstance is one explicit link between a quote line and the
// physical unit it represents. QuoteLine maps to today's persisted commercial
// line (project_items); when a revisioned SalesQuote family lands it adds its
// own reference without changing this contract.
type QuoteLineFurnitureInstance struct {
	ID                  string             `json:"id"`
	ProjectID           string             `json:"project_id"`
	QuoteLineID         string             `json:"quote_line_id"`
	FurnitureInstanceID string             `json:"furniture_instance_id"`
	FurnitureInstance   FurnitureInstance  `json:"furniture_instance"`
	CreatedAt           time.Time          `json:"created_at"`
	OrganizationID      string             `json:"-"`
}

// QuoteLineMaterialization is the authoritative result of converging one quote
// line's physical units to its commercial quantity. Instances is the full
// post-command link state; Created/Cancelled/Unlinked record exactly what the
// command changed (empty for an idempotent no-op run).
type QuoteLineMaterialization struct {
	ProjectID              string                      `json:"project_id"`
	QuoteLineID            string                      `json:"quote_line_id"`
	Quantity               int                         `json:"quantity"`
	Instances              []QuoteLineFurnitureInstance `json:"instances"`
	CreatedInstanceIDs     []string                    `json:"created_furniture_instance_ids"`
	CancelledInstanceIDs   []string                    `json:"cancelled_furniture_instance_ids"`
	UnlinkedInstanceIDs    []string                    `json:"unlinked_furniture_instance_ids"`
}
