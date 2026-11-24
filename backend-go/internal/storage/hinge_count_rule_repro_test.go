package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579 PR2 regression: creating a PROJECT whose catalog carries a
// hinge count rule pattern (countRule placement + hinge table) must not
// fail — the pattern rides the catalog JSONB and the project row is plain
// data at this stage. Mirrors the browser spec's PR2 seeding (browser gate
// once surfaced a transient 500 here; this pins the storage path green).
func TestHingeCountRuleProjectCreateWithPatternCatalog(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	now := time.Now()

	patternAgr := domain.Agregado{
		ID:   "67777777-3333-4733-8777-333333333333",
		Code: "HWG-AGR-PUE-PATRON",
		Name: "Puerta patrón (countRule)",
		Components: []domain.ComponentInstance{{
			ComponentID:       "67777777-3636-4736-8777-363636363636",
			Quantity:          1,
			PlacementOverride: func() *domain.ComponentPlacement { p := domain.PlacementPuerta; return &p }(),
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{{
					OptionRole: domain.HingeDemandRole,
					AnchorFace: "back",
					CountRule: &domain.HingeCountRule{
						Kind: "hingeDemand", EndOffsetBottomMm: 90, EndOffsetTopMm: 90,
					},
					RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90},
				}},
			},
		}},
	}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{{ID: "77777777-0000-4777-8777-000000000001", Code: "MEL-BL-18", Name: "Melamina blanca 18", WidthMm: 2750, LengthMm: 1850, ThicknessMm: 18, BoardPrice: 480, WastePercent: 10, CostPerM2: 132, Active: true}},
		Hardware: []domain.Hardware{
			{ID: "67777777-3a3a-473a-8777-3a3a3a3a3a3a", Code: "HWG-ECO-REPRO", Name: "Bisagra económica repro", Unit: "piece", CostPerUnit: 12, Active: true,
				HingeDemand: &domain.HingeDemandPolicy{
					Bands:            []domain.HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}, {UpToHeightMm: 2000, Hinges: 4}},
					WidthSurgeOverMm: func() *float64 { z := 0.0; return &z }(),
				}},
		},
		Components: []domain.Component{{
			ID: "67777777-3636-4736-8777-363636363636", Code: "HWG-PUE-PATRON", Name: "Puerta patrón",
			Placement: domain.PlacementPuerta, GeometryKind: "rectangular_board",
			LengthMm: 700, WidthMm: 600, ThicknessMm: 18,
			LengthFormula: "PH - 3", WidthFormula: "PW - 3",
			OptionRoles: []string{"FRENTES"}, Active: true,
		}},
		Structures: []domain.Structure{{
			ID: "67777777-3434-4734-8777-343434343434", Code: "HWG-EST-PATRON", Name: "Cuerpo patrón",
			WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true,
			Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-patron", AgregadoID: patternAgr.ID, Quantity: 1}},
		}},
		Agregados: []domain.Agregado{patternAgr},
		Modules: []domain.Module{{
			ID: "67777777-3535-4735-8777-353535353535", Code: "HWG-PATRON-REPRO", Name: "Módulo puerta patrón",
			StructureID: "67777777-3434-4734-8777-343434343434",
			WidthMm:     600, HeightMm: 720, DepthMm: 560,
			HardwareLines: []domain.HardwareLine{},
		}},
		OptionGroups: []domain.OptionGroup{
			{ID: "67777777-3b3b-473b-8777-3b3b3b3b3b3b", Code: "FRENTES", Name: "Frentes", Kind: "board", Required: true, OptionIDs: []string{"77777777-0000-4777-8777-000000000001"}},
			{ID: "67777777-3c3c-473c-8777-3c3c3c3c3c3c", Code: "BISAGRA", Name: "Bisagra", Kind: "hardware", Required: true, OptionIDs: []string{"67777777-3a3a-473a-8777-3a3a3a3a3a3a"}},
		},
	}

	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		for i := range catalog.Materials {
			if err := store.CreateMaterialBoard(txCtx, &catalog.Materials[i]); err != nil {
				return fmt.Errorf("material: %w", err)
			}
		}
		for i := range catalog.Hardware {
			if err := store.CreateHardware(txCtx, &catalog.Hardware[i]); err != nil {
				return fmt.Errorf("hardware: %w", err)
			}
		}
		for i := range catalog.Components {
			if err := store.CreateComponent(txCtx, &catalog.Components[i]); err != nil {
				return fmt.Errorf("component: %w", err)
			}
		}
		for i := range catalog.Structures {
			if err := store.CreateStructure(txCtx, &catalog.Structures[i]); err != nil {
				return fmt.Errorf("structure: %w", err)
			}
		}
		for i := range catalog.Agregados {
			if err := store.CreateAgregado(txCtx, &catalog.Agregados[i]); err != nil {
				return fmt.Errorf("agregado: %w", err)
			}
		}
		for i := range catalog.Modules {
			if err := store.CreateModule(txCtx, &catalog.Modules[i]); err != nil {
				return fmt.Errorf("module: %w", err)
			}
		}
		for i := range catalog.OptionGroups {
			if err := store.CreateOptionGroup(txCtx, &catalog.OptionGroups[i]); err != nil {
				return fmt.Errorf("option groups: %w", err)
			}
		}
		return nil
	})

	customer := &domain.Customer{Name: "Cliente repro 1579 PR2", Active: true}
	project := &domain.Project{
		ID:             fmt.Sprintf("67777777-3737-4737-8777-%012d", now.UnixNano()%1e12),
		Name:           "Patrón 1579 repro",
		CustomerID:     customer.ID,
		Currency:       "MXN",
		MarginFactor:   1,
		LaborFixedCost: 0,
		Status:         domain.StatusDraft,
		CreatedAt:      now,
		UpdatedAt:      now,
		Items: []domain.ProjectItem{{
			ID:            fmt.Sprintf("67777777-3939-4739-8777-%012d", now.UnixNano()%1e12),
			ModuleID:      "67777777-3535-4735-8777-353535353535",
			Quantity:      1,
			CustomDims:    &domain.ItemCustomDims{WidthMm: 600, HeightMm: 2100, DepthMm: 560},
			OptionChoices: map[string]string{"FRENTES": "77777777-0000-4777-8777-000000000001", "BISAGRA": "67777777-3a3a-473a-8777-3a3a3a3a3a3a"},
		}},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		if err := store.CreateCustomer(txCtx, customer); err != nil {
			return fmt.Errorf("customer: %w", err)
		}
		project.CustomerID = customer.ID
		if err := store.CreateProject(txCtx, project); err != nil {
			return fmt.Errorf("create project: %w", err)
		}
		return nil
	})
}
