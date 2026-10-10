package domain

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
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

// ErrQuoteRevisionNotLegacy rejects a legacy-modernization command whose base
// revision already carries canonical commercial truth (#642 legacy recovery).
// That revision's continuation is the normal requote flow — modernization is
// exclusively the recovery path for snapshot-less legacy rows.
var ErrQuoteRevisionNotLegacy = errors.New("quote revision is not legacy: la última revisión ya tiene autoridad comercial moderna; usá re-cotización para cambiarla")

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

// QuoteCommercialPlinthSides freezes layout-derived exposed base returns.
type QuoteCommercialPlinthSides struct {
	Left  bool `json:"left"`
	Right bool `json:"right"`
	Back  bool `json:"back"`
}

// QuoteCommercialPricingContext freezes inputs not authored by a DesignRevision.
type QuoteCommercialPricingContext struct {
	MeasurePresetID      string                      `json:"measurePresetId,omitempty"`
	BaseMode             string                      `json:"baseMode"`
	StructureRevisionPin *int                        `json:"structureRevisionPin,omitempty"`
	StructureIndependent bool                        `json:"structureIndependent,omitempty"`
	BaseClearanceMm      *int                        `json:"baseClearanceMm,omitempty"`
	PlinthSides          *QuoteCommercialPlinthSides `json:"plinthSides,omitempty"`
}

// QuoteCommercialUnit is the frozen customer-facing descriptor of ONE physical
// furniture unit inside the revision, keyed by the exact FurnitureInstance
// identity (never by name or geometry).
type QuoteCommercialUnit struct {
	FurnitureInstanceID string                         `json:"furnitureInstanceId"`
	QuoteLineID         string                         `json:"quoteLineId"`
	ModuleCode          string                         `json:"moduleCode"`
	ModuleName          string                         `json:"moduleName"`
	LifecycleStatus     string                         `json:"lifecycleStatus"`
	Options             []QuoteCommercialOption        `json:"options"`
	PricingContext      *QuoteCommercialPricingContext `json:"pricingContext,omitempty"`
}

// QuoteCommercialLineAmounts freezes the amount contribution of one exact
// QuoteLine. Fixed labor stays at snapshot level; line SalePrice is
// DirectCost*MarginFactor + LaborModular, so the line sum plus fixed labor is
// exactly the authoritative snapshot SalePrice.
type QuoteCommercialLineAmounts struct {
	MaterialsCost float64 `json:"materialsCost"`
	EdgeTotal     float64 `json:"edgeTotal"`
	HardwareTotal float64 `json:"hardwareTotal"`
	DirectCost    float64 `json:"directCost"`
	LaborModular  float64 `json:"laborModular"`
	SalePrice     float64 `json:"salePrice"`
}

// QuoteCommercialLine is the stable commercial grouping captured alongside
// physical FurnitureInstance identities. Visually identical lines remain
// distinct because QuoteLineID, never presentation text, owns grouping.
type QuoteCommercialLine struct {
	QuoteLineID          string                     `json:"quoteLineId"`
	Quantity             int                        `json:"quantity"`
	FurnitureInstanceIDs []string                   `json:"furnitureInstanceIds"`
	Amounts              QuoteCommercialLineAmounts `json:"amounts"`
}

// QuoteCommercialDesignSource pins exact design-first working-copy provenance.
type QuoteCommercialDesignSource struct {
	DesignID           string `json:"designId"`
	WorkingVersion     string `json:"workingVersion"`
	WorkingFingerprint string `json:"workingFingerprint"`
}

// QuoteCommercialProfileDemand freezes the provenance of the profile-driven
// hardware demand one quote line contributed to its frozen breakdown (#917/
// #986): what the governed resolve consumed per hardware, with the profile,
// recipe, relationship and contact trail — commercial truth auditing reads
// this; nothing ever recomputes it for a frozen revision. Lines are per
// physical unit (the breakdown applies the line's own quantity multiplier).
type QuoteCommercialProfileDemand struct {
	QuoteLineID  string                      `json:"quoteLineId"`
	UnitQuantity int                         `json:"unitQuantity"`
	Lines        []QuoteCommercialDemandLine `json:"lines"`
}

// QuoteCommercialDemandLine mirrors the engine demand aggregation for one
// catalog hardware inside one quote line.
type QuoteCommercialDemandLine struct {
	HardwareID string                        `json:"hardwareId"`
	Quantity   float64                       `json:"quantity"`
	Sources    []QuoteCommercialDemandSource `json:"sources"`
}

// QuoteCommercialDemandSource mirrors one engine demand source: the resolved
// profile (id+revision), the recipe that produced the operations
// (id+revision), the relationship and how many contacts were verified.
type QuoteCommercialDemandSource struct {
	TechnicalProfileID       string `json:"technicalProfileId"`
	TechnicalProfileRevision string `json:"technicalProfileRevision"`
	RecipeID                 string `json:"recipeId,omitempty"`
	RecipeRevision           string `json:"recipeRevision,omitempty"`
	RelationshipID           string `json:"relationshipId"`
	ContactCount             int    `json:"contactCount"`
	// StationCount is what the demand actually multiplied (#1065): the
	// planned stations across the verified contacts, per relationship.
	StationCount int `json:"stationCount"`
}

// QuoteCommercialSnapshot is the complete frozen commercial payload of one
// exact QuoteRevision.
type QuoteCommercialSnapshot struct {
	Schema        string                         `json:"schema"`
	CapturedAt    time.Time                      `json:"capturedAt"`
	Currency      string                         `json:"currency"`
	Customer      QuoteCommercialIdentity        `json:"customer"`
	Project       QuoteCommercialIdentity        `json:"project"`
	Breakdown     QuoteBreakdown                 `json:"breakdown"`
	Lines         []QuoteCommercialLine          `json:"lines"`
	Units         []QuoteCommercialUnit          `json:"units"`
	DesignSource  *QuoteCommercialDesignSource   `json:"designSource,omitempty"`
	ProfileDemand []QuoteCommercialProfileDemand `json:"profileDemand,omitempty"`
	// OpeningBOM freezes the resolved opening BOM behind the breakdown
	// (#1263): the gola profile run, supports and end caps the design's
	// persisted selection resolved to — pinned datasheet slice, exact
	// lengths, full provenance. Additive optional section under schema v1:
	// existing frozen revisions never grow one.
	OpeningBOM []QuoteCommercialOpeningBOM `json:"openingBom,omitempty"`
}

// QuoteCommercialOpeningBOM freezes the opening BOM one quote line contributed
// to its frozen breakdown. Lines are per physical unit (the breakdown applies
// the line's own quantity multiplier).
type QuoteCommercialOpeningBOM struct {
	QuoteLineID  string                          `json:"quoteLineId"`
	UnitQuantity int                             `json:"unitQuantity"`
	Lines        []QuoteCommercialOpeningBOMLine `json:"lines"`
}

// QuoteCommercialOpeningBOMLine mirrors one engine-resolved opening BOM line
// (#1133 resolver output, frozen verbatim).
type QuoteCommercialOpeningBOMLine struct {
	LineID         string  `json:"lineId"`
	MemberKey      string  `json:"memberKey"`
	HardwareID     string  `json:"hardwareId"`
	ProfileID      string  `json:"profileId"`
	ProfileVersion int64   `json:"profileVersion"`
	Boundary       string  `json:"boundary"`
	Rule           string  `json:"rule"`
	Quantity       float64 `json:"quantity"`
	Unit           string  `json:"unit"`
	// CutLengthMm rides on profile-run lines: the exact millimetre cut.
	CutLengthMm int `json:"cutLengthMm,omitempty"`
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
	if strings.TrimSpace(snapshot.Currency) == "" {
		return fmt.Errorf("%w: commercial snapshot currency is empty", ErrInvalidRevisionSnapshot)
	}
	if strings.TrimSpace(snapshot.Customer.ID) == "" || strings.TrimSpace(snapshot.Customer.Name) == "" {
		return fmt.Errorf("%w: commercial snapshot customer identity is incomplete", ErrInvalidRevisionSnapshot)
	}
	if strings.TrimSpace(snapshot.Project.ID) == "" || strings.TrimSpace(snapshot.Project.Name) == "" {
		return fmt.Errorf("%w: commercial snapshot project identity is incomplete", ErrInvalidRevisionSnapshot)
	}
	if snapshot.CapturedAt.IsZero() {
		return fmt.Errorf("%w: commercial snapshot capturedAt is zero", ErrInvalidRevisionSnapshot)
	}
	if source := snapshot.DesignSource; source != nil {
		if _, err := uuid.Parse(source.DesignID); err != nil || strings.TrimSpace(source.WorkingVersion) == "" ||
			len(source.WorkingFingerprint) != 71 || !strings.HasPrefix(source.WorkingFingerprint, "sha256-") {
			return fmt.Errorf("%w: design working-copy provenance is invalid", ErrInvalidRevisionSnapshot)
		}
		for _, c := range source.WorkingFingerprint[7:] {
			if !strings.ContainsRune("0123456789abcdef", c) {
				return fmt.Errorf("%w: design working-copy fingerprint is invalid", ErrInvalidRevisionSnapshot)
			}
		}
	}
	for _, demand := range snapshot.ProfileDemand {
		if strings.TrimSpace(demand.QuoteLineID) == "" {
			return fmt.Errorf("%w: profile demand provenance has no quote line identity", ErrInvalidRevisionSnapshot)
		}
		if demand.UnitQuantity <= 0 {
			return fmt.Errorf("%w: profile demand provenance %s has no positive unit quantity", ErrInvalidRevisionSnapshot, demand.QuoteLineID)
		}
		if len(demand.Lines) == 0 {
			return fmt.Errorf("%w: profile demand provenance %s has no demand lines", ErrInvalidRevisionSnapshot, demand.QuoteLineID)
		}
		for _, line := range demand.Lines {
			if strings.TrimSpace(line.HardwareID) == "" || line.Quantity <= 0 ||
				math.IsNaN(line.Quantity) || math.IsInf(line.Quantity, 0) {
				return fmt.Errorf("%w: profile demand provenance %s has an invalid hardware line", ErrInvalidRevisionSnapshot, demand.QuoteLineID)
			}
			if len(line.Sources) == 0 {
				return fmt.Errorf("%w: profile demand provenance %s has a hardware line without provenance", ErrInvalidRevisionSnapshot, demand.QuoteLineID)
			}
			for _, source := range line.Sources {
				if strings.TrimSpace(source.TechnicalProfileID) == "" || strings.TrimSpace(source.TechnicalProfileRevision) == "" ||
					strings.TrimSpace(source.RelationshipID) == "" || source.ContactCount <= 0 {
					return fmt.Errorf("%w: profile demand provenance %s has an incomplete source", ErrInvalidRevisionSnapshot, demand.QuoteLineID)
				}
			}
		}
	}
	for _, opening := range snapshot.OpeningBOM {
		if strings.TrimSpace(opening.QuoteLineID) == "" {
			return fmt.Errorf("%w: opening BOM provenance has no quote line identity", ErrInvalidRevisionSnapshot)
		}
		if opening.UnitQuantity <= 0 {
			return fmt.Errorf("%w: opening BOM provenance %s has no positive unit quantity", ErrInvalidRevisionSnapshot, opening.QuoteLineID)
		}
		if len(opening.Lines) == 0 {
			return fmt.Errorf("%w: opening BOM provenance %s has no lines", ErrInvalidRevisionSnapshot, opening.QuoteLineID)
		}
		seenLineIDs := map[string]bool{}
		for _, line := range opening.Lines {
			if strings.TrimSpace(line.LineID) == "" || strings.TrimSpace(line.HardwareID) == "" ||
				strings.TrimSpace(line.ProfileID) == "" || line.ProfileVersion <= 0 ||
				strings.TrimSpace(line.Boundary) == "" || strings.TrimSpace(line.Rule) == "" ||
				line.Quantity <= 0 || math.IsNaN(line.Quantity) || math.IsInf(line.Quantity, 0) ||
				(line.Unit != "meter" && line.Unit != "piece") {
				return fmt.Errorf("%w: opening BOM provenance %s has an invalid line", ErrInvalidRevisionSnapshot, opening.QuoteLineID)
			}
			if seenLineIDs[line.LineID] {
				return fmt.Errorf("%w: opening BOM provenance %s repeats the line identity %s", ErrInvalidRevisionSnapshot, opening.QuoteLineID, line.LineID)
			}
			seenLineIDs[line.LineID] = true
		}
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
	if len(snapshot.Lines) == 0 {
		return fmt.Errorf("%w: commercial snapshot has no quote lines", ErrInvalidRevisionSnapshot)
	}
	lineByID := make(map[string]QuoteCommercialLine, len(snapshot.Lines))
	instanceLine := make(map[string]string, len(snapshot.Units))
	var summed QuoteCommercialLineAmounts
	for i, line := range snapshot.Lines {
		if _, err := uuid.Parse(line.QuoteLineID); err != nil || line.Quantity < 0 || len(line.FurnitureInstanceIDs) == 0 {
			return fmt.Errorf("%w: commercial snapshot line %d identity or quantity is invalid", ErrInvalidRevisionSnapshot, i)
		}
		if _, duplicate := lineByID[line.QuoteLineID]; duplicate {
			return fmt.Errorf("%w: duplicate commercial quote line %s", ErrInvalidRevisionSnapshot, line.QuoteLineID)
		}
		lineByID[line.QuoteLineID] = line
		for _, instanceID := range line.FurnitureInstanceIDs {
			if _, err := uuid.Parse(instanceID); err != nil {
				return fmt.Errorf("%w: commercial snapshot line %s has empty furniture identity", ErrInvalidRevisionSnapshot, line.QuoteLineID)
			}
			if prior, duplicate := instanceLine[instanceID]; duplicate {
				return fmt.Errorf("%w: furniture instance %s appears in quote lines %s and %s", ErrInvalidRevisionSnapshot, instanceID, prior, line.QuoteLineID)
			}
			instanceLine[instanceID] = line.QuoteLineID
		}
		for field, value := range map[string]float64{
			"materialsCost": line.Amounts.MaterialsCost,
			"edgeTotal":     line.Amounts.EdgeTotal,
			"hardwareTotal": line.Amounts.HardwareTotal,
			"directCost":    line.Amounts.DirectCost,
			"laborModular":  line.Amounts.LaborModular,
			"salePrice":     line.Amounts.SalePrice,
		} {
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
				return fmt.Errorf("%w: commercial snapshot line %s amount %s is invalid", ErrInvalidRevisionSnapshot, line.QuoteLineID, field)
			}
		}
		summed.MaterialsCost += line.Amounts.MaterialsCost
		summed.EdgeTotal += line.Amounts.EdgeTotal
		summed.HardwareTotal += line.Amounts.HardwareTotal
		summed.DirectCost += line.Amounts.DirectCost
		summed.LaborModular += line.Amounts.LaborModular
		summed.SalePrice += line.Amounts.SalePrice
	}
	activeByLine := make(map[string]int, len(snapshot.Lines))
	unitIDs := make(map[string]struct{}, len(snapshot.Units))
	for i, unit := range snapshot.Units {
		if _, err := uuid.Parse(unit.FurnitureInstanceID); err != nil {
			return fmt.Errorf("%w: commercial snapshot unit %d has invalid physical identity", ErrInvalidRevisionSnapshot, i)
		}
		if _, duplicate := unitIDs[unit.FurnitureInstanceID]; duplicate {
			return fmt.Errorf("%w: duplicate commercial unit %s", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
		}
		unitIDs[unit.FurnitureInstanceID] = struct{}{}
		if _, err := uuid.Parse(unit.QuoteLineID); err != nil {
			return fmt.Errorf("%w: commercial snapshot unit %d has incomplete physical/commercial identity", ErrInvalidRevisionSnapshot, i)
		}
		if strings.TrimSpace(unit.ModuleCode) == "" || strings.TrimSpace(unit.ModuleName) == "" || looksLikeUUID(unit.ModuleCode) || looksLikeUUID(unit.ModuleName) {
			return fmt.Errorf("%w: commercial snapshot unit %d has no customer-facing module descriptor", ErrInvalidRevisionSnapshot, i)
		}
		if unit.Options == nil {
			return fmt.Errorf("%w: commercial snapshot unit %s options must be an array", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
		}
		if context := unit.PricingContext; context != nil {
			if context.MeasurePresetID != "" {
				if _, err := uuid.Parse(context.MeasurePresetID); err != nil {
					return fmt.Errorf("%w: commercial snapshot unit %s has invalid measure preset", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
				}
			}
			switch context.BaseMode {
			case "none", "plinth_board", "plinth_strip", "legs":
			default:
				return fmt.Errorf("%w: commercial snapshot unit %s has invalid base mode %q", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID, context.BaseMode)
			}
			if context.StructureRevisionPin != nil && *context.StructureRevisionPin <= 0 {
				return fmt.Errorf("%w: commercial snapshot unit %s has invalid structure revision pin", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
			}
			if context.StructureRevisionPin != nil && context.StructureIndependent {
				return fmt.Errorf("%w: commercial snapshot unit %s has conflicting structure authority", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
			}
			if context.BaseClearanceMm == nil || *context.BaseClearanceMm < 0 {
				return fmt.Errorf("%w: commercial snapshot unit %s has invalid base clearance", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
			}
		}
		if instanceLine[unit.FurnitureInstanceID] != unit.QuoteLineID {
			return fmt.Errorf("%w: commercial snapshot unit %s is not bound to quote line %s", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID, unit.QuoteLineID)
		}
		for j, option := range unit.Options {
			if strings.TrimSpace(option.GroupCode) == "" || strings.TrimSpace(option.GroupLabel) == "" || strings.TrimSpace(option.ChoiceLabel) == "" ||
				looksLikeUUID(option.GroupCode) || looksLikeUUID(option.GroupLabel) || looksLikeUUID(option.ChoiceLabel) {
				return fmt.Errorf("%w: commercial snapshot unit %s option %d has no customer-facing descriptor", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID, j)
			}
			if _, err := uuid.Parse(option.ChoiceID); err != nil {
				return fmt.Errorf("%w: commercial snapshot unit %s option %d has invalid choice identity", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID, j)
			}
			if j > 0 {
				prior := unit.Options[j-1]
				if prior.GroupCode >= option.GroupCode {
					return fmt.Errorf("%w: commercial snapshot unit %s options are not deterministic", ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
				}
			}
		}
		switch unit.LifecycleStatus {
		case "active", "removed", "cancelled":
		default:
			return fmt.Errorf("%w: commercial snapshot unit %d has invalid lifecycle %q", ErrInvalidRevisionSnapshot, i, unit.LifecycleStatus)
		}
		if unit.LifecycleStatus == "active" {
			activeByLine[unit.QuoteLineID]++
		}
	}
	for instanceID, lineID := range instanceLine {
		if _, exists := unitIDs[instanceID]; !exists {
			return fmt.Errorf("%w: commercial snapshot line %s has no descriptor for furniture instance %s", ErrInvalidRevisionSnapshot, lineID, instanceID)
		}
	}
	for _, line := range snapshot.Lines {
		if activeByLine[line.QuoteLineID] != line.Quantity {
			return fmt.Errorf("%w: commercial snapshot line %s quantity %d differs from %d active physical units", ErrInvalidRevisionSnapshot, line.QuoteLineID, line.Quantity, activeByLine[line.QuoteLineID])
		}
	}
	for field, values := range map[string][2]float64{
		"materialsCost": {summed.MaterialsCost, breakdown.MaterialsCost},
		"edgeTotal":     {summed.EdgeTotal, breakdown.EdgeTotal},
		"hardwareTotal": {summed.HardwareTotal, breakdown.HardwareTotal},
		"directCost":    {summed.DirectCost, breakdown.DirectCost},
		"laborModular":  {summed.LaborModular, breakdown.LaborModular},
		"salePrice":     {summed.SalePrice + breakdown.LaborFixedCost, breakdown.SalePrice},
	} {
		if !commercialAmountsEqual(values[0], values[1]) {
			return fmt.Errorf("%w: commercial snapshot line %s sum %.12g differs from breakdown %.12g", ErrInvalidRevisionSnapshot, field, values[0], values[1])
		}
	}
	return nil
}

func looksLikeUUID(value string) bool {
	_, err := uuid.Parse(value)
	return err == nil
}

func commercialAmountsEqual(a, b float64) bool {
	scale := math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
	return math.Abs(a-b) <= scale*1e-9
}

// RedactQuoteCommercialSnapshot returns a copy with the workshop cost stack
// zeroed for cost-blind actors. The exact total sale price and line grouping
// remain useful, but every line amount (including salePrice) is hidden: keeping
// line sale prices would reveal fixed labor as total minus the line sum.
func RedactQuoteCommercialSnapshot(snapshot *QuoteCommercialSnapshot) *QuoteCommercialSnapshot {
	if snapshot == nil {
		return nil
	}
	redacted := *snapshot
	RedactQuoteBreakdown(&redacted.Breakdown)
	redacted.Lines = append([]QuoteCommercialLine(nil), snapshot.Lines...)
	for i := range redacted.Lines {
		redacted.Lines[i].Amounts.MaterialsCost = 0
		redacted.Lines[i].Amounts.EdgeTotal = 0
		redacted.Lines[i].Amounts.HardwareTotal = 0
		redacted.Lines[i].Amounts.DirectCost = 0
		redacted.Lines[i].Amounts.LaborModular = 0
		redacted.Lines[i].Amounts.SalePrice = 0
	}
	return &redacted
}

// BuildQuoteCommercialSnapshot assembles and validates the frozen payload from
// already-authoritative inputs. Pure: it never mutates its arguments.
// profileDemand (#986) carries the frozen provenance of the profile-driven
// hardware demand behind the breakdown; nil keeps the snapshot shape
// byte-identical to the pre-demand payload (additive optional section under
// schema v1 — existing frozen revisions never grow one).
func BuildQuoteCommercialSnapshot(capturedAt time.Time, currency string, customer, project QuoteCommercialIdentity, breakdown QuoteBreakdown, lines []QuoteCommercialLine, units []QuoteCommercialUnit, profileDemand []QuoteCommercialProfileDemand, openingBOM []QuoteCommercialOpeningBOM) (*QuoteCommercialSnapshot, error) {
	lines = append([]QuoteCommercialLine(nil), lines...)
	units = append([]QuoteCommercialUnit(nil), units...)
	for i := range lines {
		lines[i].FurnitureInstanceIDs = append([]string(nil), lines[i].FurnitureInstanceIDs...)
		sort.Strings(lines[i].FurnitureInstanceIDs)
	}
	for i := range units {
		options := make([]QuoteCommercialOption, len(units[i].Options))
		copy(options, units[i].Options)
		units[i].Options = options
		units[i].PricingContext = CloneQuoteCommercialPricingContext(units[i].PricingContext)
		sort.Slice(units[i].Options, func(a, b int) bool {
			if units[i].Options[a].GroupCode == units[i].Options[b].GroupCode {
				return units[i].Options[a].ChoiceID < units[i].Options[b].ChoiceID
			}
			return units[i].Options[a].GroupCode < units[i].Options[b].GroupCode
		})
	}
	sort.Slice(lines, func(i, j int) bool { return lines[i].QuoteLineID < lines[j].QuoteLineID })
	sort.Slice(units, func(i, j int) bool {
		if units[i].QuoteLineID == units[j].QuoteLineID {
			return units[i].FurnitureInstanceID < units[j].FurnitureInstanceID
		}
		return units[i].QuoteLineID < units[j].QuoteLineID
	})
	provenance := append([]QuoteCommercialProfileDemand(nil), profileDemand...)
	for i := range provenance {
		provenance[i].Lines = append([]QuoteCommercialDemandLine(nil), provenance[i].Lines...)
		for j := range provenance[i].Lines {
			provenance[i].Lines[j].Sources = append([]QuoteCommercialDemandSource(nil), provenance[i].Lines[j].Sources...)
		}
		sort.Slice(provenance[i].Lines, func(a, b int) bool {
			return provenance[i].Lines[a].HardwareID < provenance[i].Lines[b].HardwareID
		})
	}
	sort.SliceStable(provenance, func(i, j int) bool { return provenance[i].QuoteLineID < provenance[j].QuoteLineID })
	openingProvenance := append([]QuoteCommercialOpeningBOM(nil), openingBOM...)
	for i := range openingProvenance {
		openingProvenance[i].Lines = append([]QuoteCommercialOpeningBOMLine(nil), openingProvenance[i].Lines...)
		sort.SliceStable(openingProvenance[i].Lines, func(a, b int) bool {
			return openingProvenance[i].Lines[a].LineID < openingProvenance[i].Lines[b].LineID
		})
	}
	sort.SliceStable(openingProvenance, func(i, j int) bool { return openingProvenance[i].QuoteLineID < openingProvenance[j].QuoteLineID })
	snapshot := &QuoteCommercialSnapshot{
		Schema:        QuoteCommercialSnapshotSchema,
		CapturedAt:    capturedAt,
		Currency:      currency,
		Customer:      customer,
		Project:       project,
		Breakdown:     breakdown,
		Lines:         lines,
		Units:         units,
		ProfileDemand: provenance,
		OpeningBOM:    openingProvenance,
	}
	if err := ValidateQuoteCommercialSnapshot(snapshot); err != nil {
		return nil, err
	}
	return snapshot, nil
}

// CloneQuoteCommercialPricingContext returns an independent copy suitable for
// carrying immutable quote context into a new revision.
func CloneQuoteCommercialPricingContext(source *QuoteCommercialPricingContext) *QuoteCommercialPricingContext {
	if source == nil {
		return nil
	}
	cloned := *source
	if source.StructureRevisionPin != nil {
		pin := *source.StructureRevisionPin
		cloned.StructureRevisionPin = &pin
	}
	if source.BaseClearanceMm != nil {
		clearance := *source.BaseClearanceMm
		cloned.BaseClearanceMm = &clearance
	}
	if source.PlinthSides != nil {
		sides := *source.PlinthSides
		cloned.PlinthSides = &sides
	}
	return &cloned
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

// ProjectCommercialQuoteStatus is the authoritative quote status of a project
// derived solely from its authoritative QuoteRevision (#642 / 2A).
type ProjectCommercialQuoteStatus string

const (
	ProjectCommercialQuoteStatusNone       ProjectCommercialQuoteStatus = "none"
	ProjectCommercialQuoteStatusDraft      ProjectCommercialQuoteStatus = "draft"
	ProjectCommercialQuoteStatusPublished  ProjectCommercialQuoteStatus = "published"
	ProjectCommercialQuoteStatusAccepted   ProjectCommercialQuoteStatus = "accepted"
	ProjectCommercialQuoteStatusSuperseded ProjectCommercialQuoteStatus = "superseded"
)

// ProjectCommercialSummary is the server-owned commercial summary of a project
// derived from its authoritative QuoteRevision (#642 / 2A).
//
// CommercialActivityAt is a REAL commercial event (accepted_at → published_at →
// revision creation, by lifecycle) or nil when the project has no revision at
// all — Project.updated_at never stands in for commercial activity. SaleTotal
// is nil when the caller must not see the retail amount (legacy fail-closed, or
// an organization that reaches the project only as manufacturing organization).
type ProjectCommercialSummary struct {
	ProjectID                 string                       `json:"projectId"`
	ProjectName               string                       `json:"projectName"`
	CustomerID                *string                      `json:"customerId,omitempty"`
	CustomerName              *string                      `json:"customerName,omitempty"`
	Currency                  string                       `json:"currency"`
	QuoteStatus               ProjectCommercialQuoteStatus `json:"quoteStatus"`
	QuoteRevisionID           *string                      `json:"quoteRevisionId,omitempty"`
	QuoteRevisionNumber       *int64                       `json:"quoteRevisionNumber,omitempty"`
	ActiveDraftRevisionNumber *int64                       `json:"activeDraftRevisionNumber,omitempty"`
	IsLegacy                  bool                         `json:"isLegacy"`
	SaleTotal                 *float64                     `json:"saleTotal,omitempty"`
	FurnitureQuantity         int64                        `json:"furnitureQuantity"`
	CommercialActivityAt      *string                      `json:"commercialActivityAt"`
	OwnerUserID               string                       `json:"-"`
}
