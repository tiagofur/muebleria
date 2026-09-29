package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const workingCopyFixturePath = "../../../contracts/sketchupWorkingCopyUpdate.contract.json"

type workingCopyContractFixture struct {
	Scenarios []struct {
		ID      string          `json:"id"`
		Request json.RawMessage `json:"request"`
	} `json:"scenarios"`
	InvalidRequest             json.RawMessage `json:"invalidRequest"`
	InvalidModesRequest        json.RawMessage `json:"invalidModesRequest"`
	MissingPreconditionRequest json.RawMessage `json:"missingPreconditionRequest"`
}

func loadWorkingCopyContractFixture(t *testing.T) workingCopyContractFixture {
	t.Helper()
	raw, err := os.ReadFile(workingCopyFixturePath)
	if err != nil {
		t.Fatalf("read working-copy contract fixture: %v", err)
	}
	var fixture workingCopyContractFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode working-copy contract fixture: %v", err)
	}
	return fixture
}

func TestWorkingCopyContractFixture_AcceptedByGeneratedGoHandler(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	for _, scenario := range fixture.Scenarios {
		t.Run(scenario.ID, func(t *testing.T) {
			store := &stubStore{}
			srv := &Server{Store: store}
			req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy",
				string(scenario.Request), string(domain.RoleAdmin))
			rr := httptest.NewRecorder()

			srv.HandleDesignWorkingCopy(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
			}
			if store.updateDesignWorkingCopyCmd == nil || len(store.updateDesignWorkingCopyCmd.Items) != 1 {
				t.Fatal("generated request must reach the working-copy command with one item")
			}
			version := store.updateDesignWorkingCopyCmd.Items[0].DefinitionVersion
			if scenario.ID == "catalog-semver-omitted" && version != nil {
				t.Fatalf("catalog semver scenario produced definition version %v, want omitted", *version)
			}
			if scenario.ID == "authoritative-integer-preserved" && (version == nil || *version != 7) {
				t.Fatalf("authoritative integer version = %v, want 7", version)
			}
			assertDesignDefaultsScenario(t, scenario.ID, store.updateDesignWorkingCopyCmd)
		})
	}
}

// assertDesignDefaultsScenario pins the #784 wire contract per scenario:
// design-level authoring_defaults reach the command, explicit lineage rides
// with full parity, and the apply scenario carries NO item modes (the
// backend legacy merge preserves the persisted lineage of unchanged items).
func assertDesignDefaultsScenario(t *testing.T, scenarioID string, cmd *storage.UpdateDesignWorkingCopyCommand) {
	t.Helper()
	switch scenarioID {
	case "design-backed-inherits-default", "override-equal-to-default-survives-exact",
		"apply-design-defaults-preserving-items":
		if cmd.AuthoringDefaults == nil {
			t.Fatal("authoring_defaults must reach the command")
		}
		wantDefaults := map[string]string{"INTERIOR": "mat-roble"}
		if scenarioID == "design-backed-inherits-default" {
			wantDefaults["FRENTES"] = "mat-blanco"
		}
		for role, material := range wantDefaults {
			if cmd.AuthoringDefaults.MaterialChoices[role] != material {
				t.Fatalf("authoring default %s = %q, want %q", role, cmd.AuthoringDefaults.MaterialChoices[role], material)
			}
		}
		item := cmd.Items[0]
		if scenarioID == "apply-design-defaults-preserving-items" {
			if item.MaterialChoiceModes != nil {
				t.Fatal("the apply scenario must not carry item modes")
			}
			return
		}
		if len(item.MaterialChoiceModes) == 0 {
			t.Fatal("material_choice_modes must reach the command")
		}
		if scenarioID == "override-equal-to-default-survives-exact" &&
			item.MaterialChoiceModes["INTERIOR"] != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("INTERIOR mode = %q, want override (equality with the default must never flip lineage)", item.MaterialChoiceModes["INTERIOR"])
		}
		if scenarioID == "design-backed-inherits-default" &&
			item.MaterialChoiceModes["INTERIOR"] != domain.DesignMaterialChoiceModeDesign {
			t.Fatalf("INTERIOR mode = %q, want design", item.MaterialChoiceModes["INTERIOR"])
		}
	}
}

func TestWorkingCopyContractFixture_SemverIsRejectedByGeneratedGoHandler(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy",
		string(fixture.InvalidRequest), string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopy(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateDesignWorkingCopyCmd != nil {
		t.Fatal("invalid semver must never reach the working-copy command")
	}
}

// #784 R3 fixture parity: a PARTIAL lineage statement (some roles carry
// modes while others do not) is ambiguous and never reaches the store —
// 400 is part of the shared Ruby-to-Go boundary.
func TestWorkingCopyContractFixture_PartialModesRejected(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	if len(fixture.InvalidModesRequest) == 0 {
		t.Fatal("fixture must carry invalidModesRequest")
	}
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy",
		string(fixture.InvalidModesRequest), string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopy(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateDesignWorkingCopyCmd != nil {
		t.Fatal("partial lineage statement must never reach the working-copy command")
	}
}

// #810 fixture parity: a PUT without the canonical workingVersion token never
// reaches the store — 428 PRECONDITION_REQUIRED is part of the shared
// Ruby-to-Go boundary.
func TestWorkingCopyContractFixture_MissingPreconditionRejected(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	if len(fixture.MissingPreconditionRequest) == 0 {
		t.Fatal("fixture must carry missingPreconditionRequest")
	}
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy",
		string(fixture.MissingPreconditionRequest), string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopy(rr, req)

	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, want 428 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateDesignWorkingCopyCmd != nil {
		t.Fatal("missing precondition must never reach the working-copy command")
	}
}
