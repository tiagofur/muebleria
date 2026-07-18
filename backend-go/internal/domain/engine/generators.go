package engine

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// IsProjectClosed reports whether status freezes catalog prices (PRD §7.4 / F036).
func IsProjectClosed(status domain.ProjectStatus) bool {
	return status == domain.StatusQuoted || status == domain.StatusAccepted || status == domain.StatusProduced
}

type sortableCutRow struct {
	moduleCode  string
	partCode    string
	partID      string
	description string
	row         domain.ProductionCutRow
}

// FormatOptimizerPartDescription builds Optimizer column D with stable codes (F048).
// "{partCode} · {partName} · {moduleCode}" or "{partName} · {moduleCode}".
func FormatOptimizerPartDescription(moduleCode, partName, partCode string) string {
	name := strings.TrimSpace(partName)
	mod := strings.TrimSpace(moduleCode)
	code := strings.TrimSpace(partCode)
	if code != "" {
		return fmt.Sprintf("%s · %s · %s", code, name, mod)
	}
	return fmt.Sprintf("%s · %s", name, mod)
}

// GenerateCutRows expands project board parts into Optimizer cut-list rows
// (PRD §14 / EXP-02, EXP-04, EXP-05, VAL-05). Never includes hardware.
// Description includes part/module codes (F048) without adding Optimizer columns.
func GenerateCutRows(project domain.Project, catalog domain.Catalog) ([]domain.ProductionCutRow, error) {
	var sortable []sortableCutRow

	for _, item := range project.Items {
		if item.Quantity <= 0 {
			return nil, fmt.Errorf("project item quantity must be > 0 (got %d)", item.Quantity)
		}
		module, ok := findModule(catalog, item.ModuleID)
		if !ok {
			return nil, fmt.Errorf("module not found for project item: %s", item.ModuleID)
		}

		bom, err := ResolveBomWithPin(module, choicesForItem(project, item), catalog, item.MeasurePresetID, item.StructureRevisionPin)
		if err != nil {
			return nil, err
		}

		for _, part := range bom.BoardParts {
			material, ok := findMaterial(catalog, part.MaterialID)
			if !ok {
				return nil, fmt.Errorf("material not found: %s", part.MaterialID)
			}
			flags := edgeFlags(part.Edges)
			labelRef := strings.TrimSpace(part.Code)
			if labelRef == "" {
				labelRef = module.Code + "/" + part.ID
			}
			desc := FormatOptimizerPartDescription(module.Code, part.Description, part.Code)
			sortable = append(sortable, sortableCutRow{
				moduleCode:  module.Code,
				partCode:    part.Code,
				partID:      part.ID,
				description: part.Description,
				row: domain.ProductionCutRow{
					Quantity:     part.Quantity * item.Quantity,
					LengthMm:     part.LengthMm,
					WidthMm:      part.WidthMm,
					Description:  desc,
					MaterialName: material.Name,
					Grain:        part.Grain,
					L1:           flags["L1"],
					L2:           flags["L2"],
					W1:           flags["W1"],
					W2:           flags["W2"],
					PartName:     part.Description,
					PartCode:     part.Code,
					ModuleCode:   module.Code,
					LabelRef:     labelRef,
				},
			})
		}
	}

	if len(sortable) == 0 {
		return nil, fmt.Errorf("no hay piezas de tablero para exportar")
	}

	sort.Slice(sortable, func(i, j int) bool {
		a, b := sortable[i], sortable[j]
		if a.moduleCode != b.moduleCode {
			return a.moduleCode < b.moduleCode
		}
		if a.partCode != b.partCode {
			return a.partCode < b.partCode
		}
		if a.description != b.description {
			return a.description < b.description
		}
		return a.partID < b.partID
	})

	rows := make([]domain.ProductionCutRow, len(sortable))
	for i, s := range sortable {
		rows[i] = s.row
	}
	return rows, nil
}

// GenerateHardwareList aggregates project hardware into a purchase list (EXP-08).
// Quantity = line.quantity × item.quantity, summed by hardwareId. Sorted by code.
func GenerateHardwareList(project domain.Project, catalog domain.Catalog) ([]domain.HardwarePurchaseRow, error) {
	type agg struct {
		quantity int
		hardware domain.Hardware
	}
	totals := make(map[string]*agg)

	for _, item := range project.Items {
		if item.Quantity <= 0 {
			return nil, fmt.Errorf("project item quantity must be > 0 (got %d)", item.Quantity)
		}
		module, ok := findModule(catalog, item.ModuleID)
		if !ok {
			return nil, fmt.Errorf("module not found for project item: %s", item.ModuleID)
		}

		bom, err := ResolveBomWithPin(module, choicesForItem(project, item), catalog, item.MeasurePresetID, item.StructureRevisionPin)
		if err != nil {
			return nil, err
		}

		for _, line := range bom.HardwareLines {
			hw, ok := findHardware(catalog, line.HardwareID)
			if !ok {
				return nil, fmt.Errorf("hardware not found: %s", line.HardwareID)
			}
			if !hw.Active {
				return nil, fmt.Errorf("inactive hardware cannot be used: %s", hw.Code)
			}
			qty := line.Quantity * item.Quantity
			if existing, ok := totals[hw.ID]; ok {
				existing.quantity += qty
			} else {
				totals[hw.ID] = &agg{quantity: qty, hardware: hw}
			}
		}
	}

	if len(totals) == 0 {
		return nil, fmt.Errorf("no hay herrajes para exportar")
	}

	rows := make([]domain.HardwarePurchaseRow, 0, len(totals))
	for _, a := range totals {
		rows = append(rows, domain.HardwarePurchaseRow{
			HardwareID:  a.hardware.ID,
			Code:        a.hardware.Code,
			Description: a.hardware.Name,
			Unit:        a.hardware.Unit,
			Quantity:    a.quantity,
			CostPerUnit: a.hardware.CostPerUnit,
			LineCost:    float64(a.quantity) * a.hardware.CostPerUnit,
		})
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Code != rows[j].Code {
			return rows[i].Code < rows[j].Code
		}
		return rows[i].Description < rows[j].Description
	})
	return rows, nil
}

// collectUsedUnitPrices gathers unit prices for materials/edges/hardware in the BOM.
func collectUsedUnitPrices(project domain.Project, catalog domain.Catalog) (
	materialCostPerM2 map[string]float64,
	edgeCostPerMl map[string]float64,
	hardwareCostPerUnit map[string]float64,
	err error,
) {
	materialCostPerM2 = make(map[string]float64)
	edgeCostPerMl = make(map[string]float64)
	hardwareCostPerUnit = make(map[string]float64)

	for _, item := range project.Items {
		module, ok := findModule(catalog, item.ModuleID)
		if !ok {
			continue
		}
		bom, resolveErr := ResolveBomWithPin(module, choicesForItem(project, item), catalog, item.MeasurePresetID, item.StructureRevisionPin)
		if resolveErr != nil {
			return nil, nil, nil, resolveErr
		}
		for _, part := range bom.BoardParts {
			if material, ok := findMaterial(catalog, part.MaterialID); ok {
				materialCostPerM2[material.ID] = material.CostPerM2
			}
			if part.EdgeBandID != "" {
				if edge, ok := findEdgeBand(catalog, part.EdgeBandID); ok {
					edgeCostPerMl[edge.ID] = edge.CostPerMl
				}
			}
		}
		for _, line := range bom.HardwareLines {
			if hw, ok := findHardware(catalog, line.HardwareID); ok {
				hardwareCostPerUnit[hw.ID] = hw.CostPerUnit
			}
		}
	}
	return materialCostPerM2, edgeCostPerMl, hardwareCostPerUnit, nil
}

// CaptureQuoteSnapshot freezes live breakdown + unit prices used (PRD §7.4).
// Always uses live catalog prices — never reads an existing snapshot.
func CaptureQuoteSnapshot(
	project domain.Project,
	catalog domain.Catalog,
	capturedAt time.Time,
) (domain.QuotePriceSnapshot, error) {
	// Force live calc: ignore any existing snapshot by using a draft-like path.
	live := project
	live.PriceSnapshot = nil
	live.Status = domain.StatusDraft

	breakdown, err := CalcProjectBreakdown(live, catalog)
	if err != nil {
		return domain.QuotePriceSnapshot{}, err
	}
	mat, edge, hw, err := collectUsedUnitPrices(project, catalog)
	if err != nil {
		return domain.QuotePriceSnapshot{}, err
	}
	if capturedAt.IsZero() {
		capturedAt = time.Now().UTC()
	}
	return domain.QuotePriceSnapshot{
		CapturedAt:          capturedAt,
		Breakdown:           breakdown,
		MaterialCostPerM2:   mat,
		EdgeCostPerMl:       edge,
		HardwareCostPerUnit: hw,
	}, nil
}

// TransitionProjectStatus applies PRD §7.4 close/reopen snapshot rules.
// - draft → quoted/accepted: attach fresh priceSnapshot + peg structureRevisionPin
// - quoted/accepted → draft: remove priceSnapshot (pins are CONSERVED, see #108)
// - quoted ↔ accepted: keep existing snapshot (re-freeze only if missing)
//
// #108 (Slice 2): pins are captured on close (so the BOM stays frozen against
// later structure edits) and conserved on reopen (they are audit history of
// which revision the quote used). On close→close the pins are left untouched
// when a snapshot already exists, matching the TS closed→closed branch.
func TransitionProjectStatus(
	project domain.Project,
	newStatus domain.ProjectStatus,
	catalog domain.Catalog,
	capturedAt time.Time,
) (domain.Project, error) {
	wasClosed := IsProjectClosed(project.Status)
	willClose := IsProjectClosed(newStatus)

	out := project

	if !wasClosed && willClose {
		snap, err := CaptureQuoteSnapshot(project, catalog, capturedAt)
		if err != nil {
			return domain.Project{}, err
		}
		out.Status = newStatus
		out.PriceSnapshot = &snap
		out.Items = CaptureProjectItemStructurePins(out.Items, catalog)
		return out, nil
	}

	if wasClosed && !willClose {
		out.Status = newStatus
		out.PriceSnapshot = nil
		// Pins are intentionally conserved (#108): they are the audit trail of
		// which structure revision was used when the quote was closed, and let
		// a reopened quote be re-resolved against the exact revision until the
		// next close overwrites them. Mirrors TS reopen semantics.
		return out, nil
	}

	if wasClosed && willClose {
		out.Status = newStatus
		if project.PriceSnapshot == nil {
			snap, err := CaptureQuoteSnapshot(project, catalog, capturedAt)
			if err != nil {
				return domain.Project{}, err
			}
			out.PriceSnapshot = &snap
		}
		// Keep closed→closed pins as-is (do not re-freeze). Matches TS.
		return out, nil
	}

	// draft → draft: drop any stale snapshot
	out.Status = newStatus
	if project.PriceSnapshot != nil {
		out.PriceSnapshot = nil
	}
	return out, nil
}
