package engine

import (
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Recipe change simulation (#1369, slice 1 — backend contract).
//
// A catalog Agregado IS its recipe. Changing familia/SKU/variante means
// proposing a candidate definition; before committing it, the user needs the
// classified impact of resolving the candidate against the same dimensions the
// current recipe resolves with. This file is the pure, deterministic diff:
// identities are the DECLARED ids (memberId, componentId, variantSetId,
// hardwareId+role), never array positions, so unchanged members keep their
// identity across the change exactly as the apply will keep it.
//
// Server authority: the web consumes this diff verbatim and never re-resolves.
// The apply is the existing guarded PUT (If-Match) — nothing here mutates.

// RecipeChangeState summarizes whether the candidate can be applied as-is.
type RecipeChangeState string

const (
	// RecipeChangeValid: both recipes resolve and at least one thing changes.
	RecipeChangeValid RecipeChangeState = "valid"
	// RecipeChangeNoChanges: both resolve and nothing differs.
	RecipeChangeNoChanges RecipeChangeState = "no_changes"
	// RecipeChangePartiallyInvalid: the candidate rejected at least one variant
	// set for these dimensions (no fitting nominal). The rejection carries the
	// alternatives; members/boards/consumption cannot be computed until the
	// user picks one (or changes dimensions). Never a clamp.
	RecipeChangePartiallyInvalid RecipeChangeState = "partially_invalid"
)

// Change kinds shared by the four sections. Each row carries exactly one.
const (
	ChangeAdded           = "added"
	ChangeRemoved         = "removed"
	ChangeUnchanged       = "unchanged"
	ChangeMoved           = "moved"            // members/boards: transform differs
	ChangeHardwareChanged = "hardware_changed" // members: hardware or bom role differs
	ChangeResized         = "resized"          // boards: width/length/quantity differ
	ChangeVariantChanged  = "changed"          // variants: nominal or hardware differs
	ChangeVariantRejected = "rejected"         // variants: candidate has no fitting nominal
	ChangeQuantityChanged = "quantity_changed" // consumption
)

type RecipeMemberChange struct {
	MemberID           string                    `json:"memberId"`
	Change             string                    `json:"change"`
	Role               string                    `json:"role,omitempty"`
	HardwareIDBefore   string                    `json:"hardwareIdBefore,omitempty"`
	HardwareIDAfter    string                    `json:"hardwareIdAfter,omitempty"`
	BOMRoleBefore      domain.RigidMemberBOMRole `json:"bomRoleBefore,omitempty"`
	BOMRoleAfter       domain.RigidMemberBOMRole `json:"bomRoleAfter,omitempty"`
	TranslationBefore  *[3]float64               `json:"translationBeforeMm,omitempty"`
	TranslationAfter   *[3]float64               `json:"translationAfterMm,omitempty"`
	TranslationDeltaMm *[3]float64               `json:"translationDeltaMm,omitempty"`
}

type RecipeBoardDims struct {
	WidthMm  float64 `json:"widthMm"`
	LengthMm float64 `json:"lengthMm"`
	Quantity int     `json:"quantity"`
}

type RecipeBoardChange struct {
	ComponentID        string           `json:"componentId"`
	Change             string           `json:"change"`
	Before             *RecipeBoardDims `json:"before,omitempty"`
	After              *RecipeBoardDims `json:"after,omitempty"`
	TranslationDeltaMm *[3]float64      `json:"translationDeltaMm,omitempty"`
}

// RecipeVariantRejection explains a candidate variant set with no fitting
// nominal for the simulated dimensions. Fitting lists the nominals that WOULD
// fit the requested space under the rule's clearance (empty = none fits: the
// user must change dimensions or recipe, not pick an alternative).
type RecipeVariantRejection struct {
	RequestedSpaceMm    float64   `json:"requestedSpaceMm"`
	RequiredClearanceMm float64   `json:"requiredClearanceMm"`
	AvailableNominals   []float64 `json:"availableNominals"`
	FittingNominals     []float64 `json:"fittingNominals"`
}

type RecipeVariantChange struct {
	VariantSetID string                          `json:"variantSetId"`
	Change       string                          `json:"change"`
	Before       *domain.SelectedAssemblyVariant `json:"before,omitempty"`
	After        *domain.SelectedAssemblyVariant `json:"after,omitempty"`
	Rejection    *RecipeVariantRejection         `json:"rejection,omitempty"`
}

type RecipeConsumptionChange struct {
	HardwareID     string  `json:"hardwareId"`
	Role           string  `json:"role"`
	Change         string  `json:"change"`
	QuantityBefore float64 `json:"quantityBefore"`
	QuantityAfter  float64 `json:"quantityAfter"`
}

type RecipeChangeSummary struct {
	Added        int `json:"added"`
	Removed      int `json:"removed"`
	Moved        int `json:"moved"`
	Resized      int `json:"resized"`
	Rejected     int `json:"rejected"`
	TotalChanges int `json:"totalChanges"`
}

// RecipeChangeDiff is the wire contract of one simulation. Every slice is
// sorted by its declared id so two simulations of the same input are
// byte-identical (idempotence is observable, not assumed).
type RecipeChangeDiff struct {
	State             RecipeChangeState         `json:"state"`
	Params            AssemblyResolutionParams  `json:"params"`
	CandidateResolved bool                      `json:"candidateResolved"`
	Members           []RecipeMemberChange      `json:"members"`
	Boards            []RecipeBoardChange       `json:"boards"`
	Variants          []RecipeVariantChange     `json:"variants"`
	Consumption       []RecipeConsumptionChange `json:"consumption"`
	Summary           RecipeChangeSummary       `json:"summary"`
}

// ErrCurrentRecipeUnresolvable wraps a failure to resolve the CURRENT recipe:
// the simulation cannot describe a change from a state that does not resolve.
type ErrCurrentRecipeUnresolvable struct{ Cause error }

func (e *ErrCurrentRecipeUnresolvable) Error() string {
	return fmt.Sprintf("la receta actual no resuelve con estas dimensiones: %v", e.Cause)
}
func (e *ErrCurrentRecipeUnresolvable) Unwrap() error { return e.Cause }

// ErrCandidateRecipeInvalid wraps a candidate that fails definition validation
// (not a variant rejection — those are reported inside the diff).
type ErrCandidateRecipeInvalid struct{ Cause error }

func (e *ErrCandidateRecipeInvalid) Error() string {
	return fmt.Sprintf("la receta candidata no es válida: %v", e.Cause)
}
func (e *ErrCandidateRecipeInvalid) Unwrap() error { return e.Cause }

// RestrictVariantSelections returns a copy of the recipe whose variant sets
// named in selections keep ONLY the chosen nominal. An explicit user choice is
// honoured by narrowing the set — the resolver's policy still decides whether
// that nominal fits (rejection with that single alternative if it does not),
// so a choice can never clamp or silently exceed the space. Unknown set ids or
// nominals absent from the set are an error, never ignored.
func RestrictVariantSelections(recipe domain.Agregado, selections map[string]float64) (domain.Agregado, error) {
	if len(selections) == 0 {
		return recipe, nil
	}
	out := recipe
	out.VariantSets = make([]domain.AgregadoVariantSet, len(recipe.VariantSets))
	seen := map[string]bool{}
	for i, vs := range recipe.VariantSets {
		out.VariantSets[i] = vs
		nominal, ok := selections[vs.ID]
		if !ok {
			continue
		}
		seen[vs.ID] = true
		var kept []domain.ProductVariant
		for _, v := range vs.Variants {
			if math.Abs(v.NominalDimensionMm-nominal) < 1e-3 {
				kept = append(kept, v)
			}
		}
		if len(kept) == 0 {
			return domain.Agregado{}, fmt.Errorf("el set de variantes %q no ofrece el nominal %.1f mm", vs.ID, nominal)
		}
		narrowed := vs
		narrowed.Variants = kept
		out.VariantSets[i] = narrowed
	}
	for id := range selections {
		if !seen[id] {
			return domain.Agregado{}, fmt.Errorf("la receta candidata no declara el set de variantes %q", id)
		}
	}
	return out, nil
}

// SimulateRecipeChange resolves current and candidate against the same params
// and classifies the differences by declared identity. It never mutates.
func SimulateRecipeChange(current, candidate domain.Agregado, params AssemblyResolutionParams) (RecipeChangeDiff, error) {
	diff := RecipeChangeDiff{
		Params:      params,
		Members:     []RecipeMemberChange{},
		Boards:      []RecipeBoardChange{},
		Variants:    []RecipeVariantChange{},
		Consumption: []RecipeConsumptionChange{},
	}

	cur, err := ResolveAgregadoAssembly(current, params)
	if err != nil {
		return RecipeChangeDiff{}, &ErrCurrentRecipeUnresolvable{Cause: err}
	}

	cand, err := ResolveAgregadoAssembly(candidate, params)
	if err != nil {
		var rejected *domain.ErrAssemblyVariantNotFound
		if errors.As(err, &rejected) {
			diff.State = RecipeChangePartiallyInvalid
			diff.CandidateResolved = false
			diff.Variants = append(diff.Variants, RecipeVariantChange{
				VariantSetID: rejected.VariantSetID,
				Change:       ChangeVariantRejected,
				Before:       selectedVariantFor(cur, rejected.VariantSetID),
				Rejection: &RecipeVariantRejection{
					RequestedSpaceMm:    rejected.RequestedSpaceMm,
					RequiredClearanceMm: rejected.RequiredClearance,
					AvailableNominals:   sortedFloats(rejected.AvailableNominals),
					FittingNominals:     fittingNominals(rejected),
				},
			})
			diff.Summary.Rejected = 1
			diff.Summary.TotalChanges = 1
			return diff, nil
		}
		return RecipeChangeDiff{}, &ErrCandidateRecipeInvalid{Cause: err}
	}
	diff.CandidateResolved = true

	diff.Members = diffMembers(cur.RigidMembers, cand.RigidMembers)
	diff.Boards = diffBoards(cur.FabricatedComponents, cand.FabricatedComponents)
	diff.Variants = diffVariants(cur.SelectedVariants, cand.SelectedVariants)
	diff.Consumption = diffConsumption(cur.BOMItems, cand.BOMItems)

	for _, m := range diff.Members {
		countChange(&diff.Summary, m.Change)
	}
	for _, b := range diff.Boards {
		countChange(&diff.Summary, b.Change)
	}
	for _, v := range diff.Variants {
		countChange(&diff.Summary, v.Change)
	}
	for _, c := range diff.Consumption {
		countChange(&diff.Summary, c.Change)
	}
	if diff.Summary.TotalChanges == 0 {
		diff.State = RecipeChangeNoChanges
	} else {
		diff.State = RecipeChangeValid
	}
	return diff, nil
}

func countChange(s *RecipeChangeSummary, change string) {
	switch change {
	case ChangeUnchanged:
		return
	case ChangeAdded:
		s.Added++
	case ChangeRemoved:
		s.Removed++
	case ChangeMoved:
		s.Moved++
	case ChangeResized:
		s.Resized++
	case ChangeVariantRejected:
		s.Rejected++
	}
	s.TotalChanges++
}

const translationEpsilonMm = 1e-6

func translationDelta(before, after domain.AssemblyMemberTransform) (*[3]float64, bool) {
	var delta [3]float64
	moved := false
	for i := 0; i < 3; i++ {
		delta[i] = roundMm(after.TranslationMm[i] - before.TranslationMm[i])
		if math.Abs(delta[i]) > translationEpsilonMm {
			moved = true
		}
	}
	if !moved && !sameBasis(before.Basis, after.Basis) {
		moved = true
	}
	if !moved {
		return nil, false
	}
	return &delta, true
}

func sameBasis(a, b domain.HardwareBasis) bool {
	for i := 0; i < 3; i++ {
		if math.Abs(a.X[i]-b.X[i]) > translationEpsilonMm ||
			math.Abs(a.Y[i]-b.Y[i]) > translationEpsilonMm ||
			math.Abs(a.Z[i]-b.Z[i]) > translationEpsilonMm {
			return false
		}
	}
	return true
}

// roundMm keeps the wire contract free of float noise (1e-6 mm resolution).
func roundMm(v float64) float64 {
	r := math.Round(v*1e6) / 1e6
	if r == 0 {
		return 0 // normalize -0
	}
	return r
}

func translationCopy(t domain.AssemblyMemberTransform) *[3]float64 {
	out := [3]float64{roundMm(t.TranslationMm[0]), roundMm(t.TranslationMm[1]), roundMm(t.TranslationMm[2])}
	return &out
}

func diffMembers(before, after []domain.ResolvedRigidMember) []RecipeMemberChange {
	beforeByID := map[string]domain.ResolvedRigidMember{}
	for _, m := range before {
		beforeByID[m.MemberID] = m
	}
	afterByID := map[string]domain.ResolvedRigidMember{}
	for _, m := range after {
		afterByID[m.MemberID] = m
	}
	ids := unionKeys(keysOfMembers(beforeByID), keysOfMembers(afterByID))

	out := make([]RecipeMemberChange, 0, len(ids))
	for _, id := range ids {
		b, hasBefore := beforeByID[id]
		a, hasAfter := afterByID[id]
		switch {
		case hasBefore && !hasAfter:
			out = append(out, RecipeMemberChange{
				MemberID: id, Change: ChangeRemoved, Role: b.Role,
				HardwareIDBefore: b.HardwareID, BOMRoleBefore: b.BOMRole,
				TranslationBefore: translationCopy(b.LocalTransform),
			})
		case !hasBefore && hasAfter:
			out = append(out, RecipeMemberChange{
				MemberID: id, Change: ChangeAdded, Role: a.Role,
				HardwareIDAfter: a.HardwareID, BOMRoleAfter: a.BOMRole,
				TranslationAfter: translationCopy(a.LocalTransform),
			})
		default:
			row := RecipeMemberChange{
				MemberID: id, Change: ChangeUnchanged, Role: a.Role,
				HardwareIDBefore: b.HardwareID, HardwareIDAfter: a.HardwareID,
				BOMRoleBefore: b.BOMRole, BOMRoleAfter: a.BOMRole,
			}
			delta, moved := translationDelta(b.LocalTransform, a.LocalTransform)
			if b.HardwareID != a.HardwareID || b.BOMRole != a.BOMRole {
				row.Change = ChangeHardwareChanged
			} else if moved {
				row.Change = ChangeMoved
			}
			if moved {
				row.TranslationBefore = translationCopy(b.LocalTransform)
				row.TranslationAfter = translationCopy(a.LocalTransform)
				row.TranslationDeltaMm = delta
			}
			out = append(out, row)
		}
	}
	return out
}

func diffBoards(before, after []domain.ResolvedFabricatedComponent) []RecipeBoardChange {
	beforeByID := map[string]domain.ResolvedFabricatedComponent{}
	for _, c := range before {
		beforeByID[c.ComponentID] = c
	}
	afterByID := map[string]domain.ResolvedFabricatedComponent{}
	for _, c := range after {
		afterByID[c.ComponentID] = c
	}
	ids := unionKeys(keysOfBoards(beforeByID), keysOfBoards(afterByID))

	dims := func(c domain.ResolvedFabricatedComponent) *RecipeBoardDims {
		return &RecipeBoardDims{WidthMm: roundMm(c.WidthMm), LengthMm: roundMm(c.LengthMm), Quantity: c.Quantity}
	}
	out := make([]RecipeBoardChange, 0, len(ids))
	for _, id := range ids {
		b, hasBefore := beforeByID[id]
		a, hasAfter := afterByID[id]
		switch {
		case hasBefore && !hasAfter:
			out = append(out, RecipeBoardChange{ComponentID: id, Change: ChangeRemoved, Before: dims(b)})
		case !hasBefore && hasAfter:
			out = append(out, RecipeBoardChange{ComponentID: id, Change: ChangeAdded, After: dims(a)})
		default:
			row := RecipeBoardChange{ComponentID: id, Change: ChangeUnchanged, Before: dims(b), After: dims(a)}
			resized := math.Abs(b.WidthMm-a.WidthMm) > translationEpsilonMm ||
				math.Abs(b.LengthMm-a.LengthMm) > translationEpsilonMm ||
				b.Quantity != a.Quantity
			delta, moved := translationDelta(b.Transform, a.Transform)
			if resized {
				row.Change = ChangeResized
			} else if moved {
				row.Change = ChangeMoved
			}
			if moved {
				row.TranslationDeltaMm = delta
			}
			out = append(out, row)
		}
	}
	return out
}

func diffVariants(before, after []domain.SelectedAssemblyVariant) []RecipeVariantChange {
	beforeByID := map[string]domain.SelectedAssemblyVariant{}
	for _, v := range before {
		beforeByID[v.VariantSetID] = v
	}
	afterByID := map[string]domain.SelectedAssemblyVariant{}
	for _, v := range after {
		afterByID[v.VariantSetID] = v
	}
	ids := unionKeys(keysOfVariants(beforeByID), keysOfVariants(afterByID))

	out := make([]RecipeVariantChange, 0, len(ids))
	for _, id := range ids {
		b, hasBefore := beforeByID[id]
		a, hasAfter := afterByID[id]
		switch {
		case hasBefore && !hasAfter:
			bb := b
			out = append(out, RecipeVariantChange{VariantSetID: id, Change: ChangeRemoved, Before: &bb})
		case !hasBefore && hasAfter:
			aa := a
			out = append(out, RecipeVariantChange{VariantSetID: id, Change: ChangeAdded, After: &aa})
		default:
			bb, aa := b, a
			change := ChangeUnchanged
			if b.HardwareID != a.HardwareID || math.Abs(b.NominalDimensionMm-a.NominalDimensionMm) > 1e-3 {
				change = ChangeVariantChanged
			}
			out = append(out, RecipeVariantChange{VariantSetID: id, Change: change, Before: &bb, After: &aa})
		}
	}
	return out
}

func consumptionKey(item domain.AssemblyBOMItem) string { return item.HardwareID + "\x00" + item.Role }

func diffConsumption(before, after []domain.AssemblyBOMItem) []RecipeConsumptionChange {
	// Aggregate by hardwareId+role: the same line may appear more than once.
	agg := func(items []domain.AssemblyBOMItem) map[string]domain.AssemblyBOMItem {
		out := map[string]domain.AssemblyBOMItem{}
		for _, it := range items {
			k := consumptionKey(it)
			cur, ok := out[k]
			if !ok {
				out[k] = domain.AssemblyBOMItem{HardwareID: it.HardwareID, Role: it.Role, Quantity: it.Quantity}
				continue
			}
			cur.Quantity += it.Quantity
			out[k] = cur
		}
		return out
	}
	beforeByKey := agg(before)
	afterByKey := agg(after)
	keys := unionKeys(keysOfBOM(beforeByKey), keysOfBOM(afterByKey))

	out := make([]RecipeConsumptionChange, 0, len(keys))
	for _, k := range keys {
		b, hasBefore := beforeByKey[k]
		a, hasAfter := afterByKey[k]
		switch {
		case hasBefore && !hasAfter:
			out = append(out, RecipeConsumptionChange{HardwareID: b.HardwareID, Role: b.Role, Change: ChangeRemoved, QuantityBefore: b.Quantity})
		case !hasBefore && hasAfter:
			out = append(out, RecipeConsumptionChange{HardwareID: a.HardwareID, Role: a.Role, Change: ChangeAdded, QuantityAfter: a.Quantity})
		default:
			change := ChangeUnchanged
			if math.Abs(b.Quantity-a.Quantity) > 1e-9 {
				change = ChangeQuantityChanged
			}
			out = append(out, RecipeConsumptionChange{HardwareID: a.HardwareID, Role: a.Role, Change: change, QuantityBefore: b.Quantity, QuantityAfter: a.Quantity})
		}
	}
	return out
}

func selectedVariantFor(res domain.ResolvedAssembly, variantSetID string) *domain.SelectedAssemblyVariant {
	for _, v := range res.SelectedVariants {
		if v.VariantSetID == variantSetID {
			vv := v
			return &vv
		}
	}
	return nil
}

func fittingNominals(rej *domain.ErrAssemblyVariantNotFound) []float64 {
	maxAllowed := rej.RequestedSpaceMm - rej.RequiredClearance
	out := []float64{}
	for _, n := range sortedFloats(rej.AvailableNominals) {
		if n <= maxAllowed+1e-9 {
			out = append(out, n)
		}
	}
	return out
}

func sortedFloats(in []float64) []float64 {
	out := append([]float64(nil), in...)
	sort.Float64s(out)
	return out
}

func unionKeys(a, b []string) []string {
	set := map[string]bool{}
	for _, k := range a {
		set[k] = true
	}
	for _, k := range b {
		set[k] = true
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func keysOfMembers(m map[string]domain.ResolvedRigidMember) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func keysOfBoards(m map[string]domain.ResolvedFabricatedComponent) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func keysOfVariants(m map[string]domain.SelectedAssemblyVariant) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func keysOfBOM(m map[string]domain.AssemblyBOMItem) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
