package engine

import (
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1252 — CollectModuleConsumedHardwareRoles is the Inspector card's
// discovery projection: every por-grupo demand carrier (bulk lines,
// module/structure/agregado component placements) consumes its option group
// whether or not a member is already chosen; a concrete placement never
// does; missing structure/agregado references contribute nothing.

func TestCollectConsumedRolesFromModulePlacement(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)

	roles := CollectModuleConsumedHardwareRoles(module, catalog)
	if want := []string{"BISAGRA"}; !reflect.DeepEqual(roles, want) {
		t.Fatalf("expected %v, got %v", want, roles)
	}
}

func TestCollectConsumedRolesIgnoresConcretePlacement(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	for i := range module.Components {
		if module.Components[i].ComponentID == "comp-door" {
			module.Components[i].Overrides.HardwarePlacements[0] = domain.HardwarePlacement{
				HardwareID:       "hw-bisagra-cl",
				AnchorFace:       "front",
				RelativePosition: domain.HardwareRelPosition{XMm: 100, YMm: 100},
			}
		}
	}

	if roles := CollectModuleConsumedHardwareRoles(module, catalog); len(roles) != 0 {
		t.Fatalf("concrete placement consumes no group, got %v", roles)
	}
}

func TestCollectConsumedRolesFromBulkStructureAndAgregado(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)

	module.HardwareLines = append(module.HardwareLines, domain.HardwareLine{
		ID: "hl-patas", Quantity: 4, OptionRole: "PATAS",
	})

	catalog.Structures = append(catalog.Structures, domain.Structure{
		ID: "st-consumption-tirador",
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-tirador", Quantity: 1,
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{{
					OptionRole:       "TIRADOR",
					AnchorFace:       "front",
					RelativePosition: domain.HardwareRelPosition{XMm: 1, YMm: 1},
				}},
			},
		}},
	})
	module.StructureID = "st-consumption-tirador"

	catalog.Agregados = append(catalog.Agregados, domain.Agregado{
		ID: "agr-1", Code: "AGR-CAJ", Name: "Cajón",
		HardwareLines: []domain.HardwareLine{{ID: "hl-corredera", Quantity: 2, OptionRole: "CORREDERA"}},
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-tapa", Quantity: 1,
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{{
					OptionRole:       "BISAGRA",
					AnchorFace:       "top",
					RelativePosition: domain.HardwareRelPosition{XMm: 5, YMm: 5},
				}},
			},
		}},
	})
	module.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-1"}}

	want := []string{"BISAGRA", "CORREDERA", "PATAS", "TIRADOR"}
	if roles := CollectModuleConsumedHardwareRoles(module, catalog); !reflect.DeepEqual(roles, want) {
		t.Fatalf("expected %v (sorted, deduped), got %v", want, roles)
	}
}

func TestCollectConsumedRolesSkipsMissingReferencesAndEmptyRoles(t *testing.T) {
	module, catalog := oneDoorCabinetWithHingeGroup(true)
	module.StructureID = "st-missing"
	module.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-missing"}}
	module.HardwareLines = append(module.HardwareLines, domain.HardwareLine{
		ID: "hl-concrete", Quantity: 1, HardwareID: "hw-bisagra-cl",
	})

	if roles := CollectModuleConsumedHardwareRoles(module, catalog); !reflect.DeepEqual(roles, []string{"BISAGRA"}) {
		t.Fatalf("missing references and concrete bulk lines contribute nothing, got %v", roles)
	}
}
