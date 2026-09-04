package domain

import (
	"errors"
	"fmt"
	mrand "math/rand"
	"time"
)

var jobCostingRand = mrand.New(mrand.NewSource(time.Now().UnixNano()))

/**
 * Job costing domain (OC-080..OC-084, issue #304) — parity with
 * packages/domain/src/jobCosting.ts and contracts/jobCosting.json.
 *
 * CostBaseline frozen from the quote snapshot + production release, time
 * entries per OC-081 category with a frozen hourly rate, other actual costs
 * (OC-083), material actuals from stock consumption assigned to the job
 * (OC-082) and the estimate vs actual summary (OC-084). No fiscal accounting.
 */

type TimeEntryCategory string

const (
	TimeCategorySalesDesign  TimeEntryCategory = "sales_design"
	TimeCategoryEngineering  TimeEntryCategory = "engineering"
	TimeCategoryCut          TimeEntryCategory = "cut"
	TimeCategoryCnc          TimeEntryCategory = "cnc"
	TimeCategoryEdgeBanding  TimeEntryCategory = "edge_banding"
	TimeCategoryAssembly     TimeEntryCategory = "assembly"
	TimeCategoryQcRework     TimeEntryCategory = "qc_rework"
	TimeCategoryShipping     TimeEntryCategory = "shipping"
	TimeCategoryInstallation TimeEntryCategory = "installation"
	TimeCategoryWarranty     TimeEntryCategory = "warranty"
)

var timeEntryCategories = map[string]struct{}{
	"sales_design": {},
	"engineering":  {},
	"cut":          {},
	"cnc":          {},
	"edge_banding": {},
	"assembly":     {},
	"qc_rework":    {},
	"shipping":     {},
	"installation": {},
	"warranty":     {},
}

func IsValidTimeEntryCategory(s string) bool {
	_, ok := timeEntryCategories[s]
	return ok
}

type OtherCostKind string

const (
	OtherCostFreight              OtherCostKind = "freight"
	OtherCostOutsource            OtherCostKind = "outsource"
	OtherCostExternalInstallation OtherCostKind = "external_installation"
	OtherCostConsumable           OtherCostKind = "consumable"
)

var otherCostKinds = map[string]struct{}{
	"freight":               {},
	"outsource":             {},
	"external_installation": {},
	"consumable":            {},
}

func IsValidOtherCostKind(s string) bool {
	_, ok := otherCostKinds[s]
	return ok
}

/* ── Entities ──────────────────────────────────────────────────────────────── */

// CostBaseline is the official estimated cost of a job (OC-080), frozen from
// the quote snapshot and the production release on the floor.
type CostBaseline struct {
	ID               string             `json:"id"`
	ProjectID        string             `json:"project_id"`
	CapturedAt       time.Time          `json:"captured_at"`
	CapturedByUserID string             `json:"captured_by_user_id,omitempty"`
	Source           CostBaselineSource `json:"source"`
	Revenue          float64            `json:"revenue"`
	MaterialsCost    float64            `json:"materials_cost"`
	EdgeTotal        float64            `json:"edge_total"`
	HardwareTotal    float64            `json:"hardware_total"`
	LaborModular     float64            `json:"labor_modular"`
	LaborFixedCost   float64            `json:"labor_fixed_cost"`
	// materials + edges + hardware + estimated labor (PRD-v2 §12.1).
	EstimatedDirectCost   float64 `json:"estimated_direct_cost"`
	ExpectedGrossMargin   float64 `json:"expected_gross_margin"`
	ExpectedMarginPercent float64 `json:"expected_margin_percent"`
}

// CostBaselineSource freezes what the baseline was captured against: which
// quote snapshot and which release. The persisted fingerprint field keeps its
// historical OC-080 name (bom_fingerprint); since #395 its value is the
// resolved authority's ManufacturingFingerprint — the canonical sha256
// baseline, or the legacy token for pre-DT captures.
type CostBaselineSource struct {
	QuoteSnapshotCapturedAt time.Time `json:"quote_snapshot_captured_at"`
	ProjectVersion          int       `json:"project_version"`
	ReleaseID               string    `json:"release_id"`
	BOMFingerprint          string    `json:"bom_fingerprint"`
}

// TimeEntry is labor time actually spent on the job (OC-081); the hourly rate
// is frozen at record time so history is never rewritten.
type TimeEntry struct {
	ID              string            `json:"id"`
	Category        TimeEntryCategory `json:"category"`
	Minutes         float64           `json:"minutes"`
	At              time.Time         `json:"at"`
	ByUserID        string            `json:"by_user_id,omitempty"`
	ByName          string            `json:"by_name,omitempty"`
	Note            string            `json:"note,omitempty"`
	RatePerHour     float64           `json:"rate_per_hour"`
	RemovedAt       *time.Time        `json:"removed_at,omitempty"`
	RemovedByUserID string            `json:"removed_by_user_id,omitempty"`
	RemovedByName   string            `json:"removed_by_name,omitempty"`
}

// OtherActualCost is an out-of-production actual cost (OC-083).
type OtherActualCost struct {
	ID              string        `json:"id"`
	Kind            OtherCostKind `json:"kind"`
	Amount          float64       `json:"amount"`
	At              time.Time     `json:"at"`
	ByUserID        string        `json:"by_user_id,omitempty"`
	ByName          string        `json:"by_name,omitempty"`
	Vendor          string        `json:"vendor,omitempty"`
	Note            string        `json:"note,omitempty"`
	RemovedAt       *time.Time    `json:"removed_at,omitempty"`
	RemovedByUserID string        `json:"removed_by_user_id,omitempty"`
	RemovedByName   string        `json:"removed_by_name,omitempty"`
}

// JobCosting is the costing subprocess of one project.
type JobCosting struct {
	ID               string            `json:"id"`
	ProjectID        string            `json:"project_id"`
	Baseline         *CostBaseline     `json:"baseline,omitempty"`
	LaborRatePerHour float64           `json:"labor_rate_per_hour"`
	TimeEntries      []TimeEntry       `json:"time_entries"`
	OtherCosts       []OtherActualCost `json:"other_costs"`
	CreatedAt        time.Time         `json:"created_at"`
}

/* ── Material actual (OC-082) ──────────────────────────────────────────────── */

// MaterialConsumptionInput is one material consumption assigned to the job;
// quantity and unit costs must share the material's stock unit (sheets/m2/ml
// or pieces) — the caller aligns units.
type MaterialConsumptionInput struct {
	MaterialID      string   `json:"material_id"`
	Quantity        float64  `json:"quantity"`
	POUnitCost      *float64 `json:"po_unit_cost,omitempty"`
	CatalogUnitCost *float64 `json:"catalog_unit_cost,omitempty"`
}

type MaterialValuationBasis string

const (
	ValuationBasisPOUnitCost MaterialValuationBasis = "po_unit_cost"
	ValuationBasisCatalog    MaterialValuationBasis = "catalog"
)

type CostTruth string

const (
	CostTruthActual  CostTruth = "actual"
	CostTruthProxy   CostTruth = "proxy"
	CostTruthMissing CostTruth = "missing"
)

type ValuedMaterialLine struct {
	MaterialID string                 `json:"material_id"`
	Quantity   float64                `json:"quantity"`
	UnitCost   float64                `json:"unit_cost"`
	Amount     float64                `json:"amount"`
	Basis      MaterialValuationBasis `json:"basis"`
	Truth      CostTruth              `json:"truth"`
}

type MaterialCostValuation struct {
	Lines                       []ValuedMaterialLine `json:"lines"`
	Total                       float64              `json:"total"`
	Truth                       CostTruth            `json:"truth"`
	MissingValuationMaterialIDs []string             `json:"missing_valuation_material_ids"`
}

// ValueMaterialConsumptions mirrors valueMaterialConsumptions: prefer the
// real price paid (received PO unit cost), fall back to catalog price labelled
// as proxy, and surface materials that could not be valued at all.
func ValueMaterialConsumptions(inputs []MaterialConsumptionInput) MaterialCostValuation {
	lines := make([]ValuedMaterialLine, 0, len(inputs))
	missing := make([]string, 0)
	for _, input := range inputs {
		if input.Quantity <= 0 {
			continue
		}
		if input.POUnitCost != nil && *input.POUnitCost > 0 {
			lines = append(lines, ValuedMaterialLine{
				MaterialID: input.MaterialID,
				Quantity:   input.Quantity,
				UnitCost:   *input.POUnitCost,
				Amount:     roundCost(input.Quantity * *input.POUnitCost),
				Basis:      ValuationBasisPOUnitCost,
				Truth:      CostTruthActual,
			})
		} else if input.CatalogUnitCost != nil && *input.CatalogUnitCost > 0 {
			lines = append(lines, ValuedMaterialLine{
				MaterialID: input.MaterialID,
				Quantity:   input.Quantity,
				UnitCost:   *input.CatalogUnitCost,
				Amount:     roundCost(input.Quantity * *input.CatalogUnitCost),
				Basis:      ValuationBasisCatalog,
				Truth:      CostTruthProxy,
			})
		} else {
			missing = append(missing, input.MaterialID)
		}
	}
	total := 0.0
	for _, l := range lines {
		total += l.Amount
	}
	truth := CostTruthMissing
	if len(lines) > 0 {
		truth = CostTruthProxy
		allActual := true
		for _, l := range lines {
			if l.Truth != CostTruthActual {
				allActual = false
				break
			}
		}
		if allActual {
			truth = CostTruthActual
		}
	}
	return MaterialCostValuation{
		Lines:                       lines,
		Total:                       roundCost(total),
		Truth:                       truth,
		MissingValuationMaterialIDs: missing,
	}
}

/* ── Summary (OC-084) ──────────────────────────────────────────────────────── */

// ReworkCostInput is the rework cost input — use ReworkCostSummary(quality).
type ReworkCostInput struct {
	MaterialCost float64 `json:"material_cost"`
	LaborMinutes float64 `json:"labor_minutes"`
}

// ReworkCostSummary aggregates rework material cost and labor minutes of a
// quality job (mirror of reworkCostSummary in quality.ts).
func ReworkCostSummary(job *QualityJob) ReworkCostInput {
	material, minutes := 0.0, 0.0
	if job != nil {
		for _, a := range job.ReworkActions {
			material += a.MaterialCost
			minutes += a.LaborMinutes
		}
	}
	return ReworkCostInput{MaterialCost: roundCost(material), LaborMinutes: roundMinutes(minutes)}
}

type JobCostSummaryInput struct {
	Baseline         *CostBaseline
	TimeEntries      []TimeEntry
	LaborRatePerHour float64
	Rework           *ReworkCostInput
	Material         *MaterialCostValuation
	OtherCosts       []OtherActualCost
}

type JobCostSummary struct {
	Revenue               *float64           `json:"revenue"`
	EstimatedDirectCost   *float64           `json:"estimated_direct_cost"`
	ActualMaterialCost    float64            `json:"actual_material_cost"`
	ActualMaterialTruth   CostTruth          `json:"actual_material_truth"`
	ActualLaborMinutes    float64            `json:"actual_labor_minutes"`
	ActualLaborCost       *float64           `json:"actual_labor_cost"`
	ActualOtherCost       float64            `json:"actual_other_cost"`
	ActualDirectCost      *float64           `json:"actual_direct_cost"`
	Variance              *float64           `json:"variance"`
	ExpectedGrossMargin   *float64           `json:"expected_gross_margin"`
	ExpectedMarginPercent *float64           `json:"expected_margin_percent"`
	ActualGrossMargin     *float64           `json:"actual_gross_margin"`
	ActualMarginPercent   *float64           `json:"actual_margin_percent"`
	MinutesByCategory     map[string]float64 `json:"minutes_by_category"`
	OtherCostByKind       map[string]float64 `json:"other_cost_by_kind"`
}

// ComputeJobCostSummary mirrors computeJobCostSummary: estimate vs actual for
// one job. Missing inputs stay explicit (null) instead of being reported as
// zero (Data Truth Contract).
func ComputeJobCostSummary(input JobCostSummaryInput) JobCostSummary {
	minutesByCategory := map[string]float64{}
	for category := range timeEntryCategories {
		minutesByCategory[category] = 0
	}
	otherCostByKind := map[string]float64{}
	for kind := range otherCostKinds {
		otherCostByKind[kind] = 0
	}

	laborMinutes := 0.0
	laborCost := 0.0
	for _, entry := range input.TimeEntries {
		if entry.RemovedAt != nil {
			continue
		}
		laborMinutes += entry.Minutes
		laborCost += TimeEntryCost(entry)
		minutesByCategory[string(entry.Category)] += entry.Minutes
	}
	if input.Rework != nil && input.Rework.LaborMinutes > 0 {
		laborMinutes += input.Rework.LaborMinutes
		laborCost += roundCost((input.Rework.LaborMinutes / 60) * input.LaborRatePerHour)
	}

	otherCost := 0.0
	for _, cost := range input.OtherCosts {
		if cost.RemovedAt != nil {
			continue
		}
		otherCostByKind[string(cost.Kind)] = roundCost(otherCostByKind[string(cost.Kind)] + cost.Amount)
		otherCost += cost.Amount
	}

	reworkMaterial := 0.0
	if input.Rework != nil && input.Rework.MaterialCost > 0 {
		reworkMaterial = input.Rework.MaterialCost
	}

	materialTotal := 0.0
	materialTruth := CostTruthMissing
	if input.Material != nil {
		materialTotal = input.Material.Total
		if len(input.Material.Lines) == 0 && len(input.Material.MissingValuationMaterialIDs) > 0 {
			materialTruth = CostTruthMissing
		} else {
			materialTruth = input.Material.Truth
		}
	}
	actualMaterialCost := roundCost(materialTotal + reworkMaterial)

	laborConfigured := input.LaborRatePerHour > 0 || laborMinutes == 0
	var actualLaborCost, actualDirectCost *float64
	if laborConfigured {
		v := roundCost(laborCost)
		actualLaborCost = &v
		direct := roundCost(actualMaterialCost + v + roundCost(otherCost))
		actualDirectCost = &direct
	}

	summary := JobCostSummary{
		ActualMaterialCost:  actualMaterialCost,
		ActualMaterialTruth: materialTruth,
		ActualLaborMinutes:  roundMinutes(laborMinutes),
		ActualOtherCost:     roundCost(otherCost),
		ActualLaborCost:     actualLaborCost,
		ActualDirectCost:    actualDirectCost,
		MinutesByCategory:   minutesByCategory,
		OtherCostByKind:     otherCostByKind,
	}

	if input.Baseline != nil {
		revenue := input.Baseline.Revenue
		estimated := input.Baseline.EstimatedDirectCost
		expectedMargin := input.Baseline.ExpectedGrossMargin
		expectedPercent := input.Baseline.ExpectedMarginPercent
		summary.Revenue = &revenue
		summary.EstimatedDirectCost = &estimated
		summary.ExpectedGrossMargin = &expectedMargin
		summary.ExpectedMarginPercent = &expectedPercent
		if actualDirectCost != nil {
			variance := roundCost(*actualDirectCost - estimated)
			actualMargin := roundCost(revenue - *actualDirectCost)
			summary.Variance = &variance
			summary.ActualGrossMargin = &actualMargin
			if revenue > 0 {
				percent := roundCost((actualMargin / revenue) * 100)
				summary.ActualMarginPercent = &percent
			}
		}
	}
	return summary
}

// TimeEntryCost mirrors timeEntryCost: frozen rate × elapsed hours.
func TimeEntryCost(entry TimeEntry) float64 {
	return roundCost((entry.Minutes / 60) * entry.RatePerHour)
}

func roundCost(v float64) float64 {
	return float64(int64(v*100+0.5*sign(v))) / 100
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func roundMinutes(v float64) float64 {
	return float64(int64(v*10+0.5*sign(v))) / 10
}

/* ── Actions ───────────────────────────────────────────────────────────────── */

// NewJobCostingEntityID generates an entity id (mirror of the TS
// generateCostingId shape).
func NewJobCostingEntityID(prefix string) string {
	if prefix == "" {
		prefix = "jc"
	}
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixNano(), jobCostingRandomSuffix())
}

func jobCostingRandomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 5)
	for i := range out {
		out[i] = alphabet[jobCostingRand.Intn(len(alphabet))]
	}
	return string(out)
}

// BuildCostBaseline mirrors captureCostBaseline: freezes the baseline from the
// quote snapshot + production release. Both sources must exist and a baseline
// for the same release is not overwritten.
func BuildCostBaseline(
	costing *JobCosting,
	snapshot *QuotePriceSnapshot,
	release *ResolvedProductionRelease,
	projectID string,
	byUserID string,
	at time.Time,
) (*CostBaseline, error) {
	if snapshot == nil {
		return nil, errors.New("BAD_REQUEST:falta capturar el snapshot de cotización (cerrar la cotización)")
	}
	if release == nil {
		return nil, errors.New("BAD_REQUEST:falta liberar la revisión de ingeniería a producción")
	}
	if costing != nil && costing.Baseline != nil && costing.Baseline.Source.ReleaseID == release.ReleaseID {
		return nil, errors.New("CONFLICT:el baseline ya fue capturado para esta liberación; capture de nuevo sólo tras una nueva liberación")
	}

	bd := snapshot.Breakdown
	estimated := roundCost(bd.MaterialsCost + bd.EdgeTotal + bd.HardwareTotal + bd.LaborModular + bd.LaborFixedCost)
	revenue := bd.SalePrice
	expectedMargin := roundCost(revenue - estimated)
	expectedPercent := 0.0
	if revenue > 0 {
		expectedPercent = roundCost((expectedMargin / revenue) * 100)
	}

	return &CostBaseline{
		ID:               NewJobCostingEntityID("cb"),
		ProjectID:        projectID,
		CapturedAt:       at,
		CapturedByUserID: byUserID,
		Source: CostBaselineSource{
			QuoteSnapshotCapturedAt: snapshot.CapturedAt,
			ProjectVersion:          release.ProjectVersion,
			ReleaseID:               release.ReleaseID,
			BOMFingerprint:          release.ManufacturingFingerprint,
		},
		Revenue:               revenue,
		MaterialsCost:         bd.MaterialsCost,
		EdgeTotal:             bd.EdgeTotal,
		HardwareTotal:         bd.HardwareTotal,
		LaborModular:          bd.LaborModular,
		LaborFixedCost:        bd.LaborFixedCost,
		EstimatedDirectCost:   estimated,
		ExpectedGrossMargin:   expectedMargin,
		ExpectedMarginPercent: expectedPercent,
	}, nil
}

/* ── Snapshot + mutation (transactional contract) ──────────────────────────── */

// JobCostingSnapshot is the locked state handed to a costing mutation: the
// stored costing, the baseline sources (quote snapshot + release), the quality
// job (rework costs) and the job-assigned material consumption already valued
// per material by the storage layer.
type JobCostingSnapshot struct {
	Costing           *JobCosting
	PriceSnapshot     *QuotePriceSnapshot
	// ProductionRelease is the resolved release authority (#395): canonical
	// when one exists, legacy-adapted otherwise. Never the raw blob.
	ProductionRelease *ResolvedProductionRelease
	Quality           *QualityJob
	Consumption       []MaterialConsumptionInput
}

// JobCostingMutation is what a costing mutation produced: the new costing
// payload and the audit events.
type JobCostingMutation struct {
	Costing *JobCosting
	Events  []ProjectEvent
}

/* ── Shape validation ──────────────────────────────────────────────────────── */

// ValidateJobCostingShape mirrors validateJobCostingShape: structural
// invariants of a candidate costing payload, independent of what was stored.
func ValidateJobCostingShape(costing *JobCosting) error {
	if costing == nil {
		return nil
	}
	if costing.ID == "" {
		return errors.New("costing.id requerido")
	}
	if costing.ProjectID == "" {
		return errors.New("costing.project_id requerido")
	}
	if costing.LaborRatePerHour < 0 {
		return errors.New("costing.labor_rate_per_hour debe ser >= 0")
	}
	entryIDs := map[string]struct{}{}
	for _, e := range costing.TimeEntries {
		if _, dup := entryIDs[e.ID]; dup {
			return fmt.Errorf("registro de tiempo duplicado: %s", e.ID)
		}
		entryIDs[e.ID] = struct{}{}
		if !IsValidTimeEntryCategory(string(e.Category)) {
			return fmt.Errorf("timeEntry %s: categoría inválida %s", e.ID, e.Category)
		}
		if e.Minutes <= 0 {
			return fmt.Errorf("timeEntry %s: minutos deben ser > 0", e.ID)
		}
		if e.RatePerHour < 0 {
			return fmt.Errorf("timeEntry %s: tarifa debe ser >= 0", e.ID)
		}
		if e.RemovedAt != nil && e.RemovedByUserID == "" {
			return fmt.Errorf("timeEntry %s: anulación sin autor", e.ID)
		}
	}
	costIDs := map[string]struct{}{}
	for _, c := range costing.OtherCosts {
		if _, dup := costIDs[c.ID]; dup {
			return fmt.Errorf("costo duplicado: %s", c.ID)
		}
		costIDs[c.ID] = struct{}{}
		if !IsValidOtherCostKind(string(c.Kind)) {
			return fmt.Errorf("otherCost %s: tipo inválido %s", c.ID, c.Kind)
		}
		if c.Amount <= 0 {
			return fmt.Errorf("otherCost %s: monto debe ser > 0", c.ID)
		}
		if c.RemovedAt != nil && c.RemovedByUserID == "" {
			return fmt.Errorf("otherCost %s: anulación sin autor", c.ID)
		}
	}
	if b := costing.Baseline; b != nil {
		if b.ID == "" {
			return errors.New("baseline.id requerido")
		}
		if b.Source.ReleaseID == "" {
			return errors.New("baseline.source.release_id requerido")
		}
		if b.Source.BOMFingerprint == "" {
			return errors.New("baseline.source.bom_fingerprint requerido")
		}
		if b.Revenue < 0 || b.EstimatedDirectCost < 0 {
			return errors.New("baseline no puede tener montos negativos")
		}
	}
	return nil
}

// ValidateJobCostingTransition validates a candidate costing against the
// previously stored one: entries/costs are append-only and only voidable
// (once), the baseline may only be replaced by a different release, and the
// labor rate never goes negative.
func ValidateJobCostingTransition(prev, next *JobCosting) error {
	if err := ValidateJobCostingShape(next); err != nil {
		return err
	}
	if prev == nil {
		return nil
	}
	if next == nil {
		return errors.New("costing no removible")
	}
	if next.ID != prev.ID {
		return fmt.Errorf("costing id inmutable (%s ≠ %s)", prev.ID, next.ID)
	}
	if next.LaborRatePerHour < 0 {
		return errors.New("tarifa horaria no puede ser negativa")
	}

	prevEntries := map[string]TimeEntry{}
	for _, e := range prev.TimeEntries {
		prevEntries[e.ID] = e
	}
	for _, e := range next.TimeEntries {
		before, existed := prevEntries[e.ID]
		if !existed {
			continue
		}
		if before.Category != e.Category || before.Minutes != e.Minutes || before.RatePerHour != e.RatePerHour || before.At != e.At {
			return fmt.Errorf("registro de tiempo inmutable: %s", e.ID)
		}
		if before.RemovedAt == nil && e.RemovedAt != nil && e.RemovedByUserID == "" {
			return fmt.Errorf("anulación de tiempo %s sin autor", e.ID)
		}
		if before.RemovedAt != nil && e.RemovedAt == nil {
			return fmt.Errorf("anulación de tiempo no revocable: %s", e.ID)
		}
	}
	for id := range prevEntries {
		found := false
		for _, e := range next.TimeEntries {
			if e.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("registro de tiempo no removible: %s", id)
		}
	}

	prevCosts := map[string]OtherActualCost{}
	for _, c := range prev.OtherCosts {
		prevCosts[c.ID] = c
	}
	for _, c := range next.OtherCosts {
		before, existed := prevCosts[c.ID]
		if !existed {
			continue
		}
		if before.Kind != c.Kind || before.Amount != c.Amount || before.At != c.At {
			return fmt.Errorf("costo inmutable: %s", c.ID)
		}
		if before.RemovedAt != nil && c.RemovedAt == nil {
			return fmt.Errorf("anulación de costo no revocable: %s", c.ID)
		}
	}
	for id := range prevCosts {
		found := false
		for _, c := range next.OtherCosts {
			if c.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("costo no removible: %s", id)
		}
	}

	if prev.Baseline != nil && next.Baseline != nil && prev.Baseline.ID != next.Baseline.ID {
		if prev.Baseline.Source.ReleaseID == next.Baseline.Source.ReleaseID {
			return errors.New("baseline re-capturado para la misma liberación")
		}
	}
	return nil
}
