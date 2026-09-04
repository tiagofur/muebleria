package domain

import (
	"errors"
	"fmt"
	"math"
	mrand "math/rand"
	"sort"
	"time"
)

/**
 * Material planning / MRP ligero domain (OC-050..OC-054).
 * Parity with packages/domain/src/materialPlanning.ts and
 * contracts/materialPlanning.json.
 */

type MaterialReservationStatus string

const (
	MaterialReservationActive   MaterialReservationStatus = "active"
	MaterialReservationReleased MaterialReservationStatus = "released"
	MaterialReservationConsumed MaterialReservationStatus = "consumed"
)

var materialReservationStatuses = map[string]struct{}{
	"active":   {},
	"released": {},
	"consumed": {},
}

func IsValidMaterialReservationStatus(s string) bool {
	_, ok := materialReservationStatuses[s]
	return ok
}

// MaterialRequirementLine is one material line of the released-BOM requirement.
type MaterialRequirementLine struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	Quantity   float64 `json:"quantity"`
}

// MaterialRequirementsSnapshot is materialized from the released BOM (OC-050):
// bound to the legacy OC-022 ProductionRelease it was derived from.
type MaterialRequirementsSnapshot struct {
	ReleaseID     string                   `json:"release_id,omitempty"`
	BomFingerprint string                  `json:"bom_fingerprint,omitempty"`
	DerivedAt     time.Time                `json:"derived_at"`
	DerivedBy     string                   `json:"derived_by,omitempty"`
	Lines         []MaterialRequirementLine `json:"lines"`
}

// MaterialReservation is a warehouse reservation of material for one project.
type MaterialReservation struct {
	ID          string                    `json:"id"`
	Kind        string                    `json:"kind"`
	MaterialID  string                    `json:"material_id"`
	Quantity    float64                   `json:"quantity"`
	Status      MaterialReservationStatus `json:"status"`
	ReservedBy  string                    `json:"reserved_by,omitempty"`
	ReservedAt  time.Time                 `json:"reserved_at"`
	ReleasedAt  *time.Time                `json:"released_at,omitempty"`
	ConsumedAt  *time.Time                `json:"consumed_at,omitempty"`
}

// MaterialsReleaseOverride is the audited reason a release happened with
// failing evidence gates (OC-054).
type MaterialsReleaseOverride struct {
	Reason        string    `json:"reason"`
	ByUserID      string    `json:"by_user_id,omitempty"`
	At            time.Time `json:"at"`
	FailingChecks []string  `json:"failing_checks"`
}

// MaterialsReleaseEvidence backs the materials release (OC-054).
type MaterialsReleaseEvidence struct {
	ReleasedBy string                    `json:"released_by,omitempty"`
	ReleasedAt time.Time                 `json:"released_at"`
	Override   *MaterialsReleaseOverride `json:"override,omitempty"`
}

// MaterialPlanning is the material planning subprocess of one project.
type MaterialPlanning struct {
	ID            string                      `json:"id"`
	ProjectID     string                      `json:"project_id"`
	Requirements  *MaterialRequirementsSnapshot `json:"requirements,omitempty"`
	Reservations  []MaterialReservation       `json:"reservations"`
	Release       *MaterialsReleaseEvidence   `json:"release,omitempty"`
	CreatedAt     time.Time                   `json:"createdAt"`
}

/* ── Shape + transition validation ────────────────────────────────────────── */

// ValidateMaterialPlanningShape checks the structural invariants of a
// candidate planning, independent of what was stored before.
func ValidateMaterialPlanningShape(planning *MaterialPlanning) error {
	if planning == nil {
		return nil
	}
	if planning.ProjectID == "" {
		return errors.New("material planning requiere project_id")
	}
	if planning.Requirements != nil {
		seen := map[string]struct{}{}
		for _, line := range planning.Requirements.Lines {
			key := line.Kind + ":" + line.MaterialID
			if _, dup := seen[key]; dup {
				return fmt.Errorf("línea de requerimiento duplicada: %s", key)
			}
			seen[key] = struct{}{}
			if line.Quantity <= 0 {
				return fmt.Errorf("la cantidad de %s %s debe ser mayor a cero", line.Kind, line.MaterialID)
			}
			if !ValidStockMaterialKind(line.Kind) {
				return fmt.Errorf("tipo de material inválido: %s", line.Kind)
			}
		}
		if len(planning.Requirements.Lines) == 0 {
			return errors.New("el snapshot de requerimientos no puede estar vacío")
		}
	}
	reservationIDs := map[string]struct{}{}
	for _, r := range planning.Reservations {
		if _, dup := reservationIDs[r.ID]; dup {
			return fmt.Errorf("reserva duplicada: %s", r.ID)
		}
		reservationIDs[r.ID] = struct{}{}
		if !IsValidMaterialReservationStatus(string(r.Status)) {
			return fmt.Errorf("estado de reserva inválido: %s", r.Status)
		}
		if r.Quantity <= 0 {
			return fmt.Errorf("la reserva %s debe ser mayor a cero", r.ID)
		}
	}
	if planning.Release != nil && planning.Release.Override != nil && planning.Release.Override.Reason == "" {
		return errors.New("el override de liberación requiere motivo")
	}
	return nil
}

// ValidateMaterialPlanningTransition validates a candidate planning against
// the previously stored one: reservations are append-only (identity immutable,
// quantity may only shrink while consuming, status only moves forward), the
// requirements snapshot may be re-derived only before the release, and the
// release itself is set once and never revoked.
func ValidateMaterialPlanningTransition(prev, next *MaterialPlanning) error {
	if err := ValidateMaterialPlanningShape(next); err != nil {
		return err
	}
	if prev == nil {
		return nil
	}
	if next != nil && next.ID != prev.ID {
		return fmt.Errorf("material planning id inmutable (%s ≠ %s)", prev.ID, next.ID)
	}
	if next == nil {
		return errors.New("material planning no removible")
	}

	prevReservations := map[string]MaterialReservation{}
	for _, r := range prev.Reservations {
		prevReservations[r.ID] = r
	}
	for _, r := range next.Reservations {
		before, existed := prevReservations[r.ID]
		if !existed {
			if r.Status != MaterialReservationActive {
				return fmt.Errorf("reserva nueva %s debe crearse como active", r.ID)
			}
			continue
		}
		if before.Kind != r.Kind || before.MaterialID != r.MaterialID {
			return fmt.Errorf("reserva %s no puede cambiar de material", r.ID)
		}
		if r.Quantity > before.Quantity+1e-6 {
			return fmt.Errorf("reserva %s no puede crecer (%v → %v)", r.ID, before.Quantity, r.Quantity)
		}
		if before.Status != r.Status {
			legal := before.Status == MaterialReservationActive &&
				(r.Status == MaterialReservationReleased || r.Status == MaterialReservationConsumed)
			if !legal {
				return fmt.Errorf("transición de reserva inválida %s: %s → %s", r.ID, before.Status, r.Status)
			}
		}
	}
	for id := range prevReservations {
		found := false
		for _, r := range next.Reservations {
			if r.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("reserva no removible: %s", id)
		}
	}

	if prev.Release != nil {
		if next.Release == nil {
			return errors.New("liberación de material no revocable")
		}
		if next.Release.ReleasedAt.Before(prev.Release.ReleasedAt) {
			return errors.New("liberación de material no retrocedible")
		}
	}
	return nil
}

/* ── Availability (OC-051) ─────────────────────────────────────────────────── */

// MaterialAvailability is the six honest quantities for one material.
type MaterialAvailability struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	OnHand     float64 `json:"onHand"`
	Reserved   float64 `json:"reserved"`
	Available  float64 `json:"available"`
	Incoming   float64 `json:"incoming"`
	Required   float64 `json:"required"`
	Shortage   float64 `json:"shortage"`
}

func roundQty(n float64) float64 {
	return math.Round(n*100) / 100
}

// ComputeWarehouseAvailability derives availability per material: available =
// onHand − reserved; incoming = pending reception of emitted POs; shortage =
// what neither stock nor incoming covers. Parity with
// computeWarehouseAvailability in materialPlanning.ts.
func ComputeWarehouseAvailability(stock []MaterialStock, plannings []*MaterialPlanning, pos []PurchaseOrder) []MaterialAvailability {
	type acc struct {
		row MaterialAvailability
	}
	byKey := map[string]*acc{}
	touch := func(kind, materialID string) *acc {
		key := kind + ":" + materialID
		row, ok := byKey[key]
		if !ok {
			row = &acc{row: MaterialAvailability{Kind: kind, MaterialID: materialID}}
			byKey[key] = row
		}
		return row
	}
	for _, s := range stock {
		touch(string(s.Kind), s.MaterialID).row.OnHand += s.Quantity
	}
	for _, plan := range plannings {
		if plan == nil {
			continue
		}
		for _, r := range plan.Reservations {
			if r.Status == MaterialReservationActive {
				touch(r.Kind, r.MaterialID).row.Reserved += r.Quantity
			}
		}
		if plan.Release == nil && plan.Requirements != nil {
			for _, line := range plan.Requirements.Lines {
				touch(line.Kind, line.MaterialID).row.Required += line.Quantity
			}
		}
	}
	for _, po := range pos {
		if po.Status != POEmitida {
			continue
		}
		for _, item := range po.Items {
			touch(string(item.Kind), item.MaterialID).row.Incoming += math.Max(0, item.Quantity-item.ReceivedQuantity)
		}
	}

	out := make([]MaterialAvailability, 0, len(byKey))
	for _, a := range byKey {
		a.row.OnHand = roundQty(a.row.OnHand)
		a.row.Reserved = roundQty(a.row.Reserved)
		a.row.Available = roundQty(a.row.OnHand - a.row.Reserved)
		a.row.Incoming = roundQty(a.row.Incoming)
		a.row.Required = roundQty(a.row.Required)
		a.row.Shortage = roundQty(math.Max(0, a.row.Required-a.row.OnHand-a.row.Incoming))
		out = append(out, a.row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].MaterialID < out[j].MaterialID
	})
	return out
}

/* ── Release gates (OC-054) ───────────────────────────────────────────────── */

type MaterialsReleaseCheckCode string

const (
	ReleaseCheckRequirementsDerived MaterialsReleaseCheckCode = "requirements_derived"
	ReleaseCheckLinesReserved       MaterialsReleaseCheckCode = "lines_reserved"
	ReleaseCheckReservationsBacked  MaterialsReleaseCheckCode = "reservations_backed"
)

type MaterialsReleaseCheck struct {
	Code     MaterialsReleaseCheckCode `json:"code"`
	Label    string                    `json:"label"`
	Passed   bool                      `json:"passed"`
	Required bool                      `json:"required"`
	Details  string                    `json:"details"`
}

var materialsReleaseCheckLabels = map[MaterialsReleaseCheckCode]string{
	ReleaseCheckRequirementsDerived: "Requerimientos derivados del BOM liberado",
	ReleaseCheckLinesReserved:       "Todas las líneas cubiertas con reservas",
	ReleaseCheckReservationsBacked:  "Reservas respaldadas por stock físico",
}

// EvaluateMaterialsReleaseReadiness evaluates the evidence gates (OC-054).
// Parity with evaluateMaterialsReleaseReadiness in materialPlanning.ts.
func EvaluateMaterialsReleaseReadiness(planning *MaterialPlanning, stock []MaterialStock, plannings []*MaterialPlanning) ([]MaterialsReleaseCheck, bool) {
	var lines []MaterialRequirementLine
	if planning != nil && planning.Requirements != nil {
		lines = planning.Requirements.Lines
	}
	requirementsPassed := len(lines) > 0

	// lines_reserved: every requirement line covered by this project's
	// active/released reservations.
	// Coverage counts every reservation status: active (earmarked) and
	// released/consumed (already handed to the project) all satisfy the line.
	reservedByLine := map[string]float64{}
	if planning != nil {
		for _, r := range planning.Reservations {
			reservedByLine[r.Kind+":"+r.MaterialID] += r.Quantity
		}
	}
	uncovered := 0
	for _, line := range lines {
		if reservedByLine[line.Kind+":"+line.MaterialID]+1e-6 < line.Quantity {
			uncovered++
		}
	}

	// reservations_backed: total active reservations per material vs stock.
	onHandBy := map[string]float64{}
	for _, s := range stock {
		onHandBy[string(s.Kind)+":"+s.MaterialID] = s.Quantity
	}
	materialKeys := map[string]struct{}{}
	for _, line := range lines {
		materialKeys[line.Kind+":"+line.MaterialID] = struct{}{}
	}
	reservedTotal := map[string]float64{}
	for _, plan := range plannings {
		if plan == nil {
			continue
		}
		for _, r := range plan.Reservations {
			if r.Status != MaterialReservationActive {
				continue
			}
			key := r.Kind + ":" + r.MaterialID
			if _, relevant := materialKeys[key]; !relevant {
				continue
			}
			reservedTotal[key] += r.Quantity
		}
	}
	overcommitted := 0
	for key, total := range reservedTotal {
		if total > onHandBy[key]+1e-6 {
			overcommitted++
		}
	}

	requirementsDetails := fmt.Sprintf("Requerimientos derivados del BOM liberado (%d líneas)", len(lines))
	if !requirementsPassed {
		requirementsDetails = "Derivar los requerimientos del BOM liberado antes de liberar material"
	}
	linesDetails := "Todas las líneas cubiertas con reservas"
	if uncovered > 0 {
		linesDetails = fmt.Sprintf("%d línea(s) sin reservar completo: reservar o generar compra del faltante", uncovered)
	} else if !requirementsPassed {
		linesDetails = "Sin requerimientos derivados"
	}
	backedDetails := "Las reservas están respaldadas por stock físico"
	if overcommitted > 0 {
		backedDetails = fmt.Sprintf("%d material(es) con reservas mayores al stock físico: registrar recepciones (entradas) antes de liberar", overcommitted)
	}

	checks := []MaterialsReleaseCheck{
		{Code: ReleaseCheckRequirementsDerived, Label: materialsReleaseCheckLabels[ReleaseCheckRequirementsDerived], Passed: requirementsPassed, Required: true, Details: requirementsDetails},
		{Code: ReleaseCheckLinesReserved, Label: materialsReleaseCheckLabels[ReleaseCheckLinesReserved], Passed: uncovered == 0 && requirementsPassed, Required: true, Details: linesDetails},
		{Code: ReleaseCheckReservationsBacked, Label: materialsReleaseCheckLabels[ReleaseCheckReservationsBacked], Passed: overcommitted == 0, Required: true, Details: backedDetails},
	}
	ready := true
	for _, c := range checks {
		if c.Required && !c.Passed {
			ready = false
			break
		}
	}
	return checks, ready
}

// MaterialPlanningSnapshot is the locked state handed to a materials mutation:
// the stored planning plus the warehouse context the gates depend on.
type MaterialPlanningSnapshot struct {
	Planning                  *MaterialPlanning
	AllPlannings              []*MaterialPlanning
	Stock                     []MaterialStock
	PurchaseOrders            []PurchaseOrder
	ProductionRelease         *LegacyProductionRelease
	MaterialsReleased         bool
	HasMaterialsReservedEvent bool
}

// MaterialPlanningMutation is what a materials mutation produced: the new
// planning payload, an optional materials_release stamp (process stage) and
// the audit lifecycle events.
type MaterialPlanningMutation struct {
	Planning         *MaterialPlanning
	MaterialsRelease *MaterialsReleaseStamp
	Events           []ProjectEvent
}

// MaterialsReleaseStamp is the processStage "materials complete" stamp written
// alongside the planning release (parity with processStage.MaterialsRelease).
type MaterialsReleaseStamp struct {
	ReleasedBy string    `json:"released_by"`
	ReleasedAt time.Time `json:"released_at"`
}

/* ── Per-project coverage (OC-051/052) ────────────────────────────────────── */

// ProjectLineCoverage is the evidence of one requirement line: reserved vs
// required vs what must be purchased. Parity with
// ProjectMaterialLineCoverage in materialPlanning.ts.
type ProjectLineCoverage struct {
	Kind              string  `json:"kind"`
	MaterialID        string  `json:"material_id"`
	Required          float64 `json:"required"`
	Reserved          float64 `json:"reserved"`
	PendingReserve    float64 `json:"pending_reserve"`
	Available         float64 `json:"available"`
	IncomingAllocated float64 `json:"incoming_allocated"`
	Shortage          float64 `json:"shortage"`
	Covered           bool    `json:"covered"`
}

// ComputeProjectCoverage mirrors computeProjectMaterialCoverage: coverage of
// one project's requirement lines against warehouse availability and the
// incoming PO lines allocated to the obra.
func ComputeProjectCoverage(projectID string, stock []MaterialStock, plannings []*MaterialPlanning, pos []PurchaseOrder) []ProjectLineCoverage {
	var planning *MaterialPlanning
	for _, p := range plannings {
		if p != nil && p.ProjectID == projectID {
			planning = p
			break
		}
	}
	if planning == nil || planning.Requirements == nil || len(planning.Requirements.Lines) == 0 {
		return []ProjectLineCoverage{}
	}

	availability := map[string]MaterialAvailability{}
	for _, row := range ComputeWarehouseAvailability(stock, plannings, pos) {
		availability[row.Kind+":"+row.MaterialID] = row
	}

	coveredQty := map[string]float64{}
	for _, r := range planning.Reservations {
		coveredQty[r.Kind+":"+r.MaterialID] += r.Quantity
	}
	incomingAllocated := map[string]float64{}
	for _, po := range pos {
		if po.Status != POEmitida {
			continue
		}
		for _, item := range po.Items {
			if item.AllocatedProjectID == nil || *item.AllocatedProjectID != projectID {
				continue
			}
			key := string(item.Kind) + ":" + item.MaterialID
			incomingAllocated[key] += math.Max(0, item.Quantity-item.ReceivedQuantity)
		}
	}

	out := make([]ProjectLineCoverage, 0, len(planning.Requirements.Lines))
	for _, line := range planning.Requirements.Lines {
		key := line.Kind + ":" + line.MaterialID
		reserved := roundQty(coveredQty[key])
		available := availability[key].Available
		allocated := roundQty(incomingAllocated[key])
		pending := roundQty(math.Max(0, line.Quantity-reserved))
		out = append(out, ProjectLineCoverage{
			Kind:              line.Kind,
			MaterialID:        line.MaterialID,
			Required:          line.Quantity,
			Reserved:          reserved,
			PendingReserve:    pending,
			Available:         available,
			IncomingAllocated: allocated,
			Shortage:          roundQty(math.Max(0, pending-available-allocated)),
			Covered:           reserved+1e-6 >= line.Quantity,
		})
	}
	return out
}

/* ── Reserve computation (OC-051) ─────────────────────────────────────────── */

// ReserveLine is a reservation request/capacity line (parity with the
// reserveProjectMaterials result lines).
type ReserveLine struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	Quantity   float64 `json:"quantity"`
}

// PlanReservations mirrors reserveProjectMaterials: reserves every pending
// requirement line (or the explicit wanted lines) capped by warehouse
// availability, returning the new planning plus the reserved and short lines.
// Callers persist the result and audit materials_reserved /
// materials_shortage_detected.
func PlanReservations(
	planning *MaterialPlanning,
	stock []MaterialStock,
	plannings []*MaterialPlanning,
	wanted []ReserveLine,
	byUserID string,
	at time.Time,
) (next *MaterialPlanning, reserved, short []ReserveLine) {
	if planning == nil || planning.Release != nil {
		return planning, nil, nil
	}

	// Availability for this project's caps: onHand − every project's active
	// reservations.
	onHand := map[string]float64{}
	for _, s := range stock {
		onHand[string(s.Kind)+":"+s.MaterialID] = s.Quantity
	}
	reservedAll := map[string]float64{}
	for _, p := range plannings {
		if p == nil {
			continue
		}
		for _, r := range p.Reservations {
			if r.Status == MaterialReservationActive {
				reservedAll[r.Kind+":"+r.MaterialID] += r.Quantity
			}
		}
	}
	available := func(kind, materialID string) float64 {
		key := kind + ":" + materialID
		return math.Max(0, onHand[key]-reservedAll[key])
	}

	// Coverage of this project's own reservations (pending per line).
	ownReserved := map[string]float64{}
	for _, r := range planning.Reservations {
		if r.Status == MaterialReservationActive {
			ownReserved[r.Kind+":"+r.MaterialID] += r.Quantity
		}
	}

	if wanted == nil {
		if planning.Requirements == nil {
			return planning, nil, nil
		}
		for _, line := range planning.Requirements.Lines {
			pending := math.Max(0, line.Quantity-ownReserved[line.Kind+":"+line.MaterialID])
			if pending > 1e-6 {
				wanted = append(wanted, ReserveLine{Kind: line.Kind, MaterialID: line.MaterialID, Quantity: roundQty(pending)})
			}
		}
	}

	reservations := make([]MaterialReservation, len(planning.Reservations))
	copy(reservations, planning.Reservations)
	reserved = []ReserveLine{}
	short = []ReserveLine{}
	for _, line := range wanted {
		if line.Quantity <= 0 {
			continue
		}
		cap := math.Min(line.Quantity, available(line.Kind, line.MaterialID))
		if cap > 1e-6 {
			reservations = append(reservations, MaterialReservation{
				ID:         NewMaterialPlanningID("mres"),
				Kind:       line.Kind,
				MaterialID: line.MaterialID,
				Quantity:   roundQty(cap),
				Status:     MaterialReservationActive,
				ReservedBy: byUserID,
				ReservedAt: at,
			})
			reserved = append(reserved, ReserveLine{Kind: line.Kind, MaterialID: line.MaterialID, Quantity: roundQty(cap)})
		}
		if remaining := roundQty(line.Quantity - cap); remaining > 1e-6 {
			short = append(short, ReserveLine{Kind: line.Kind, MaterialID: line.MaterialID, Quantity: remaining})
		}
	}

	next = &MaterialPlanning{
		ID:           planning.ID,
		ProjectID:    planning.ProjectID,
		Requirements: planning.Requirements,
		Reservations: reservations,
		Release:      planning.Release,
		CreatedAt:    planning.CreatedAt,
	}
	return next, reserved, short
}

var materialPlanningIDCounter time.Time

// NewMaterialPlanningID generates an entity id (mirror of the TS
// generatePlanningId shape).
func NewMaterialPlanningID(prefix string) string {
	if prefix == "" {
		prefix = "mplan"
	}
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixNano(), randomSuffix())
}

func randomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 5)
	for i := range out {
		out[i] = alphabet[mrand.Intn(len(alphabet))]
	}
	return string(out)
}

// ConsumePlannedMaterials mirrors consumePlannedMaterials: a picking despacho
// consumes the project's active reservations oldest-first, splitting partial
// consumption. Reservation records are history — consumption is not reverted
// by an unmark (the stock revert restores availability, not the record).
func ConsumePlannedMaterials(planning *MaterialPlanning, lines []ReserveLine, at time.Time) *MaterialPlanning {
	if planning == nil {
		return planning
	}
	remaining := map[string]float64{}
	for _, l := range lines {
		if l.Quantity > 0 {
			remaining[l.Kind+":"+l.MaterialID] += l.Quantity
		}
	}
	if len(remaining) == 0 {
		return planning
	}

	next := *planning
	next.Reservations = append([]MaterialReservation(nil), planning.Reservations...)
	for i := range next.Reservations {
		r := &next.Reservations[i]
		key := r.Kind + ":" + r.MaterialID
		pending, ok := remaining[key]
		if !ok || r.Status != MaterialReservationActive {
			continue
		}
		consume := math.Min(r.Quantity, pending)
		remaining[key] = roundQty(pending - consume)
		if consume >= r.Quantity {
			r.Status = MaterialReservationConsumed
			r.ConsumedAt = &at
		} else {
			r.Quantity = roundQty(r.Quantity - consume)
		}
	}
	return &next
}
