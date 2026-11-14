package api

// #1627 s2 (review B1'): saving a web project carries the explicit «Sin
// inserto» ("none") in item and project-level choices; any other non-UUID
// value and a finish on «Sin inserto» stay rejected.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestValidateProjectPayloadAcceptsExplicitNoInsert_1627(t *testing.T) {
	const moduleID = "52000000-0000-0000-0000-0000000000c1"
	const customerID = "30000000-0000-0000-0000-00000000000a"
	project := func(itemChoices, levelChoices map[string]string, finishes map[string]string) *domain.Project {
		return &domain.Project{
			CustomerID:          customerID,
			Items:               []domain.ProjectItem{{ModuleID: moduleID, OptionChoices: itemChoices, OptionFinishes: finishes}},
			ProjectLevelChoices: levelChoices,
		}
	}
	accept := project(map[string]string{"INSERTO_E": domain.AccessoryChoiceNone}, map[string]string{"INSERTO_E": domain.AccessoryChoiceNone}, nil)
	rec := httptest.NewRecorder()
	if !validateProjectPayloadRequiredIDs(rec, accept, false) {
		t.Fatalf("«Sin inserto» in item and project choices must be accepted, got %d %s", rec.Code, rec.Body.String())
	}
	for name, p := range map[string]*domain.Project{
		"otro valor no UUID en la línea":    project(map[string]string{"INSERTO_E": "ninguno"}, nil, nil),
		"otro valor no UUID en el proyecto": project(nil, map[string]string{"INSERTO_E": "x"}, nil),
		"acabado sobre «Sin inserto»":       project(map[string]string{"INSERTO_E": domain.AccessoryChoiceNone}, nil, map[string]string{"INSERTO_E": "chrome"}),
	} {
		rec := httptest.NewRecorder()
		if validateProjectPayloadRequiredIDs(rec, p, false) || rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: must be rejected with 400, got %d", name, rec.Code)
		}
		if name == "acabado sobre «Sin inserto»" && !strings.Contains(rec.Body.String(), "acabado sin elección de herraje") {
			t.Fatalf("the finish case must fail for the missing hardware, got %s", rec.Body.String())
		}
	}
}
