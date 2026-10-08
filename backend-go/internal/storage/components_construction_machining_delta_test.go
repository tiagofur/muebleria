package storage

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1052 slice 2 / #1219 — PG real: the PERSISTED construction block governs
// the machining. Two identical cabinets, the only difference the shelf's
// persisted joinerySystemId: the inherit variant drills minifix cams, the
// screw-only variant does not. Persistence (slice 1) → resolve → machining
// delta, one wiring.
func TestComponentConstructionGovernsMachiningDelta(t *testing.T) {
	store := newMigratedRuntimeStore(t)

	// Los códigos viven en varchar(50): sufijo corto y único por corrida.
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%1_000_000)
	plainCode := "CMP-PLAIN-" + suffix
	screwCode := "CMP-SCREW-" + suffix

	buildCatalog := func(t *testing.T, store *PostgresStore, shelfCode string, withConstruction bool) domain.Catalog {
		t.Helper()
		var shelf domain.Component
		withinInitialOrganization(t, store, func(txCtx context.Context) error {
			shelf = domain.Component{
				Code: shelfCode, Name: "Entrepaño", Placement: domain.PlacementInterno,
				GeometryKind: "rectangular_board", LengthMm: 568, WidthMm: 524, ThicknessMm: 18,
				OptionRoles: []string{"INTERIOR"}, Active: true,
			}
			if withConstruction {
				shelf.Construction = &domain.ComponentConstruction{JoinerySystemID: "screw-only"}
			}
			if err := store.CreateComponent(txCtx, &shelf); err != nil {
				return err
			}
			side := domain.Component{
				Code: shelfCode + "-LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
				GeometryKind: "rectangular_board", LengthMm: 684, WidthMm: 560, ThicknessMm: 18,
				OptionRoles: []string{"LATERAL"}, Active: true,
			}
			return store.CreateComponent(txCtx, &side)
		})
		var shelfLoaded, sideLoaded domain.Component
		withinInitialOrganization(t, store, func(txCtx context.Context) error {
			loaded, err := store.ListComponents(txCtx)
			if err != nil {
				return err
			}
			for _, comp := range loaded {
				if comp.Code == shelfCode {
					shelfLoaded = comp
				}
				if comp.Code == shelfCode+"-LAT" {
					sideLoaded = comp
				}
			}
			return nil
		})
		if shelfLoaded.ID == "" || sideLoaded.ID == "" {
			t.Fatalf("persisted components not loaded (shelf=%q side=%q)", shelfLoaded.ID, sideLoaded.ID)
		}
		if withConstruction && (shelfLoaded.Construction == nil || shelfLoaded.Construction.JoinerySystemID != "screw-only") {
			t.Fatalf("persisted construction block did not round-trip: %+v", shelfLoaded.Construction)
		}
		return domain.Catalog{
			Components: []domain.Component{shelfLoaded, sideLoaded},
			Hardware: []domain.Hardware{
				{ID: "hw-minifix", Code: "HER-MIN-15", Name: "Minifix 15", Unit: domain.UnitPiece, Active: true},
				{ID: "hw-dowel", Code: "HER-TAQ-8X30", Name: "Tarugo 8x30", Unit: domain.UnitPiece, Active: true},
			},
		}
	}

	type resolvedPack struct {
		camHoles   int
		dowelHoles int
	}
	resolve := func(catalog domain.Catalog) resolvedPack {
		t.Helper()
		module := domain.Module{
			ID: "mod-delta", Code: "AUTH-DELTA", Name: "Gabinete delta",
			WidthMm: 600, HeightMm: 720, DepthMm: 560,
			Components: []domain.ComponentInstance{
				{ComponentID: catalog.Components[0].ID, Quantity: 1},
				{ComponentID: catalog.Components[1].ID, Quantity: 1},
			},
			ParameterDefinitions: []domain.FurnitureParameterDefinition{{
				Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
				DefaultValue: float64(1), Required: true, Integer: true,
				Category: domain.FurnitureParameterCategoryConfiguration,
				Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: catalog.Components[0].ID,
					Relationship: &domain.FurnitureParameterRelationshipBinding{Kind: "shelf-support", SourceRole: "shelf-edge", Targets: []domain.FurnitureParameterRelationshipTarget{
						{ComponentID: catalog.Components[1].ID, Role: "inside-face"},
					}}},
			}},
		}
		result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
			Module: module, Catalog: catalog, PrecisionMm: 0.01,
			EvaluatedParameters: map[string]any{"shelfCount": float64(1)},
			Occurrences: []engine.AuthoringOccurrence{
				{
					ComponentInstanceID:   "mod-delta-1",
					ComponentDefinitionID: "mod-delta",
					Transform:             &engine.AuthoringOccurrenceTransform{Frame: "assembly", TranslationMm: [3]float64{0, 0, 0}},
				},
			},
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if len(result.StructuralIssues) != 0 {
			t.Fatalf("resolve rejected: %+v", result.StructuralIssues)
		}
		pack := resolvedPack{}
		for _, op := range result.Machining.Operations {
			for _, hole := range op.Holes {
				if hole.DiameterMm == 15 {
					pack.camHoles++
				}
				if hole.Type == "dowel" || hole.DiameterMm == 8 {
					pack.dowelHoles++
				}
			}
		}
		return pack
	}

	plain := resolve(buildCatalog(t, store, plainCode, false))
	screw := resolve(buildCatalog(t, store, screwCode, true))

	if plain.camHoles == 0 {
		t.Fatalf("the inherited shelf must drill minifix cams: %+v", plain)
	}
	if screw.camHoles != 0 {
		t.Fatalf("the screw-only shelf must not drill minifix cams: %+v", screw)
	}
	if screw.dowelHoles == 0 {
		t.Fatalf("the screw-only shelf must still drill dowels: %+v", screw)
	}
}
