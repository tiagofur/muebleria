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
	InvalidRequest json.RawMessage `json:"invalidRequest"`
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
