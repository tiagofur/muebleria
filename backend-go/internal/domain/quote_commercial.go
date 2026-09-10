package domain

import (
	"errors"
	"fmt"
	"math"
	"time"
)

// #642 / QUOTE-AUTH: the exact QuoteRevision is the sole canonical commercial
// authority (digital-thread §16A). QuoteCommercialSnapshot is the immutable
// server-owned payload captured ONCE in the same atomic command that creates
// the revision. It freezes everything a customer-facing document or commercial
// UI must reproduce later WITHOUT consulting mutable Project state, current
// catalog names/prices, settings, the legacy priceSnapshot or any live pricing
// calculation.
//
// Monetary strategy: authoritative calculated amounts (the existing pricing
// engine runs exactly once, server-side, at creation). Historical commercial
// meaning never depends on today's engine implementation.

// QuoteCommercialSnapshotSchema is the payload marker of the frozen commercial
// snapshot (new schemas are born granete.*, conventions §Identificadores).
const QuoteCommercialSnapshotSchema = "granete.quote-commercial-snapshot.v1"

// ErrQuoteCommercialSnapshotMissing is the actionable fail-closed verdict for
// a revision whose commercial truth is required but was never frozen (legacy
// pre-#642 rows). The honest continuation is creating a NEW revision from the
// current editable state — never recalculating history from mutable inputs.
var ErrQuoteCommercialSnapshotMissing = errors.New("quote revision commercial snapshot missing: la revisión no congeló su verdad comercial; creá una nueva revisión de cotización en lugar de recalcular la histórica")

// QuoteCommercialIdentity is a frozen commercial identity reference: the exact
// id plus the customer-facing label captured at revision creation.
type QuoteCommercialIdentity struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// QuoteCommercialOption is one frozen customer-facing option descriptor: the
// option group and the chosen entity, each with identity and captured label.
type QuoteCommercialOption struct {
	GroupCode   string `json:"groupCode"`
	GroupLabel  string `json:"groupLabel"`
	ChoiceID    string `json:"choiceId"`
	ChoiceLabel string `json:"choiceLabel"`
}

// QuoteCommercialUnit is the frozen customer-facing descriptor of ONE physical
// furniture unit inside the revision, keyed by the exact FurnitureInstance
// identity (never by name or geometry).
type QuoteCommercialUnit struct {
	FurnitureInstanceID string                  `json:"furnitureInstanceId"`
	ModuleCode          string                  `json:"moduleCode"`
	ModuleName          string                  `json:"moduleName"`
	LifecycleStatus     string                  `json:"lifecycleStatus"`
	Options             []QuoteCommercialOption `json:"options"`
}

// QuoteCommercialSnapshot is the complete frozen commercial payload of one
// exact QuoteRevision.
type QuoteCommercialSnapshot struct {
	Schema     string                  `json:"schema"`
	CapturedAt time.Time               `json:"capturedAt"`
	Currency   string                  `json:"currency"`
	Customer   QuoteCommercialIdentity `json:"customer"`
	Project    QuoteCommercialIdentity `json:"project"`
	Breakdown  QuoteBreakdown          `json:"breakdown"`
	Units      []QuoteCommercialUnit   `json:"units"`
}

// ValidateQuoteCommercialSnapshot enforces the structural contract fail-closed:
// a frozen snapshot that cannot identify itself, its parties, its currency or
// carries non-finite amounts was never legitimate commercial truth.
func ValidateQuoteCommercialSnapshot(snapshot *QuoteCommercialSnapshot) error {
	if snapshot == nil {
		return fmt.Errorf("%w: commercial snapshot is nil", ErrInvalidRevisionSnapshot)
	}
	if snapshot.Schema != QuoteCommercialSnapshotSchema {
		return fmt.Errorf("%w: unknown commercial snapshot schema %q", ErrInvalidRevisionSnapshot, snapshot.Schema)
	}
	if snapshot.Currency == "" {
		return fmt.Errorf("%w: commercial snapshot currency is empty", ErrInvalidRevisionSnapshot)
	}
	if snapshot.Customer.ID == "" || snapshot.Customer.Name == "" {
		return fmt.Errorf("%w: commercial snapshot customer identity is incomplete", ErrInvalidRevisionSnapshot)
	}
	if snapshot.Project.ID == "" || snapshot.Project.Name == "" {
		return fmt.Errorf("%w: commercial snapshot project identity is incomplete", ErrInvalidRevisionSnapshot)
	}
	if snapshot.CapturedAt.IsZero() {
		return fmt.Errorf("%w: commercial snapshot capturedAt is zero", ErrInvalidRevisionSnapshot)
	}
	breakdown := snapshot.Breakdown
	for field, value := range map[string]float64{
		"materials_cost":   breakdown.MaterialsCost,
		"edge_total":       breakdown.EdgeTotal,
		"hardware_total":   breakdown.HardwareTotal,
		"direct_cost":      breakdown.DirectCost,
		"labor_modular":    breakdown.LaborModular,
		"labor_fixed_cost": breakdown.LaborFixedCost,
		"margin_factor":    breakdown.MarginFactor,
		"sale_price":       breakdown.SalePrice,
	} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("%w: commercial snapshot breakdown %s is not finite", ErrInvalidRevisionSnapshot, field)
		}
	}
	if breakdown.MarginFactor <= 0 {
		return fmt.Errorf("%w: commercial snapshot margin_factor must be > 0", ErrInvalidRevisionSnapshot)
	}
	if len(snapshot.Units) == 0 {
		return fmt.Errorf("%w: commercial snapshot has no units", ErrInvalidRevisionSnapshot)
	}
	for i, unit := range snapshot.Units {
		if unit.FurnitureInstanceID == "" {
			return fmt.Errorf("%w: commercial snapshot unit %d has no furniture instance identity", ErrInvalidRevisionSnapshot, i)
		}
		switch unit.LifecycleStatus {
		case "active", "removed", "cancelled":
		default:
			return fmt.Errorf("%w: commercial snapshot unit %d has invalid lifecycle %q", ErrInvalidRevisionSnapshot, i, unit.LifecycleStatus)
		}
	}
	return nil
}

// RedactQuoteCommercialSnapshot returns a copy with the workshop cost stack
// zeroed for cost-blind actors (same policy as RedactQuoteBreakdown: sale
// price is commercial and stays visible). The original stays authoritative.
func RedactQuoteCommercialSnapshot(snapshot *QuoteCommercialSnapshot) *QuoteCommercialSnapshot {
	if snapshot == nil {
		return nil
	}
	redacted := *snapshot
	RedactQuoteBreakdown(&redacted.Breakdown)
	return &redacted
}

// BuildQuoteCommercialSnapshot assembles and validates the frozen payload from
// already-authoritative inputs. Pure: it never mutates its arguments.
func BuildQuoteCommercialSnapshot(capturedAt time.Time, currency string, customer, project QuoteCommercialIdentity, breakdown QuoteBreakdown, units []QuoteCommercialUnit) (*QuoteCommercialSnapshot, error) {
	snapshot := &QuoteCommercialSnapshot{
		Schema:     QuoteCommercialSnapshotSchema,
		CapturedAt: capturedAt,
		Currency:   currency,
		Customer:   customer,
		Project:    project,
		Breakdown:  breakdown,
		Units:      units,
	}
	if err := ValidateQuoteCommercialSnapshot(snapshot); err != nil {
		return nil, err
	}
	return snapshot, nil
}

// CommercialDimsFromParameters extracts a full width/height/depth override
// from a revision item's parameter map. Returns nil unless all three axes are
// present as positive numbers — partial or absent dimensions fall back to the
// catalog definition (the same precedence the item snapshot recorded).
func CommercialDimsFromParameters(parameters map[string]any) *ItemCustomDims {
	if parameters == nil {
		return nil
	}
	width, widthOK := positiveNumber(parameters["widthMm"])
	height, heightOK := positiveNumber(parameters["heightMm"])
	depth, depthOK := positiveNumber(parameters["depthMm"])
	if !widthOK || !heightOK || !depthOK {
		return nil
	}
	return &ItemCustomDims{WidthMm: int(width), HeightMm: int(height), DepthMm: int(depth)}
}

func positiveNumber(value any) (float64, bool) {
	number, ok := value.(float64)
	if !ok || number <= 0 || number != math.Trunc(number) || number > 1_000_000 {
		return 0, false
	}
	return number, true
}
