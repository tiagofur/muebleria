package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const workingCopyFixturePath = "../../../contracts/sketchupWorkingCopyUpdate.contract.json"

type workingCopyContractFixture struct {
	Scenarios []struct {
		ID      string          `json:"id"`
		Request json.RawMessage `json:"request"`
	} `json:"scenarios"`
	Scenarios784 []struct {
		ID      string          `json:"id"`
		Request json.RawMessage `json:"request"`
	} `json:"scenarios784"`
	InvalidRequest             json.RawMessage `json:"invalidRequest"`
	InvalidModesRequest784     json.RawMessage `json:"invalidModesRequest784"`
	MissingPreconditionRequest json.RawMessage `json:"missingPreconditionRequest"`
}

// TestWorkingCopyContractFixture_DesignDefaultsAcceptedByGeneratedGoHandler
// freezes the #784 half of the shared boundary: design-level
// authoring_defaults and per-item material_choice_modes decode through the
// generated request and reach the working-copy command verbatim. These
// scenarios live beside (not inside) the Ruby-built list until the SketchUp
// builder emits the fields; the Go side already accepts them.
func TestWorkingCopyContractFixture_DesignDefaultsAcceptedByGeneratedGoHandler(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	if len(fixture.Scenarios784) == 0 {
		t.Fatal("fixture must carry scenarios784")
	}
	for _, scenario := range fixture.Scenarios784 {
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
			cmd := store.updateDesignWorkingCopyCmd
			if cmd == nil || len(cmd.Items) != 1 {
				t.Fatal("request must reach the working-copy command with one item")
			}
			if cmd.AuthoringDefaults == nil {
				t.Fatal("authoring_defaults must reach the command")
			}
			wantDefaults := map[string]string{"INTERIOR": "mat-roble"}
			switch scenario.ID {
			case "design-backed-inherits-default", "apply-design-defaults-preserving-items":
				wantDefaults["FRENTES"] = "mat-blanco"
			}
			if got := cmd.AuthoringDefaults.MaterialChoices; len(got) != len(wantDefaults) {
				t.Fatalf("authoring defaults = %v, want %v", got, wantDefaults)
			}
			for role, material := range wantDefaults {
				if cmd.AuthoringDefaults.MaterialChoices[role] != material {
					t.Fatalf("authoring default %s = %q, want %q", role, cmd.AuthoringDefaults.MaterialChoices[role], material)
				}
			}
			item := cmd.Items[0]
			if scenario.ID == "apply-design-defaults-preserving-items" {
				// The R2 apply carries items VERBATIM without modes: the
				// backend legacy merge preserves the persisted lineage.
				if item.MaterialChoiceModes != nil {
					t.Fatal("the apply scenario must not carry item modes")
				}
			} else if len(item.MaterialChoiceModes) == 0 {
				t.Fatal("material_choice_modes must reach the command")
			}
			if scenario.ID == "override-equal-to-default-survives-exact" &&
				item.MaterialChoiceModes["INTERIOR"] != domain.DesignMaterialChoiceModeOverride {
				t.Fatalf("INTERIOR mode = %q, want override (equality with the default must never flip lineage)", item.MaterialChoiceModes["INTERIOR"])
			}
			if scenario.ID == "design-backed-inherits-default" &&
				item.MaterialChoiceModes["INTERIOR"] != domain.DesignMaterialChoiceModeDesign {
				t.Fatalf("INTERIOR mode = %q, want design", item.MaterialChoiceModes["INTERIOR"])
			}
		})
	}
}

// TestWorkingCopyContractFixture_PartialModesRejected: a PARTIAL lineage
// statement (some roles carry modes while others do not) is ambiguous and
// never reaches the store — 400 is part of the #784 boundary.
func TestWorkingCopyContractFixture_PartialModesRejected(t *testing.T) {
	fixture := loadWorkingCopyContractFixture(t)
	if len(fixture.InvalidModesRequest784) == 0 {
		t.Fatal("fixture must carry invalidModesRequest784")
	}
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy",
		string(fixture.InvalidModesRequest784), string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopy(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateDesignWorkingCopyCmd != nil {
		t.Fatal("partial lineage statement must never reach the working-copy command")
	}
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
		})
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
