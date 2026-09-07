package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func machineOutputPutBody(operation string, sel domain.MachineOutputSelection, expectedVersion int64) *strings.Reader {
	payload := map[string]any{
		"selection": map[string]any{
			// The body carries the SELECTION's own operation; the path
			// parameter stays independent so path/body mismatch is testable.
			"operation":                   sel.Operation,
			"machineProfileId":            sel.MachineProfileID,
			"machineProfileRevisionId":    sel.MachineProfileRevisionID,
			"outputProfileId":             sel.OutputProfileID,
			"outputProfileRevisionId":     sel.OutputProfileRevisionID,
			"adapterId":                   sel.AdapterID,
			"adapterVersion":              sel.AdapterVersion,
			"adapterImplementationDigest": sel.AdapterImplementationDigest,
		},
		"expectedVersion": expectedVersion,
	}
	raw, _ := json.Marshal(payload)
	return strings.NewReader(string(raw))
}

func validCuttingSelectionAPI() domain.MachineOutputSelection {
	return domain.MachineOutputSelection{
		Operation:                   domain.OperationCutting,
		MachineProfileID:            "client-a-machine-b-hpp250",
		MachineProfileRevisionID:    "r1",
		OutputProfileID:             "ptx-generic",
		OutputProfileRevisionID:     "r1",
		AdapterID:                   "granete-ptx",
		AdapterVersion:              "1.0.0",
		AdapterImplementationDigest: "39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28",
	}
}

func putMachineOutputSelection(t *testing.T, srv *Server, operation string, sel domain.MachineOutputSelection, expectedVersion int64, role string) *httptest.ResponseRecorder {
	t.Helper()
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/machine-output-selections/"+operation, machineOutputPutBody(operation, sel, expectedVersion)), "admin", role)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("operation", operation)
	rr := httptest.NewRecorder()
	srv.HandleUpsertMachineOutputSelection(rr, req)
	return rr
}

func TestMachineOutputSelectionRoundTrip(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	saved := putMachineOutputSelection(t, srv, "cutting", validCuttingSelectionAPI(), 0, string(domain.RoleAdmin))
	if saved.Code != http.StatusOK {
		t.Fatalf("save status = %d (body=%s)", saved.Code, saved.Body.String())
	}
	var record domain.MachineOutputSelectionRecord
	if err := json.Unmarshal(saved.Body.Bytes(), &record); err != nil {
		t.Fatalf("decode saved record: %v", err)
	}
	if record.Version != 1 || record.OutputProfileID != "ptx-generic" {
		t.Fatalf("unexpected record: %+v", record)
	}

	// GET read model resolves labels and no blockers for an implemented serializer.
	get := withClaims(httptest.NewRequest(http.MethodGet, "/api/machine-output-selections", nil), "admin", string(domain.RoleAdmin))
	getRR := httptest.NewRecorder()
	srv.HandleListMachineOutputSelections(getRR, get)
	if getRR.Code != http.StatusOK {
		t.Fatalf("get status = %d", getRR.Code)
	}
	var readModel struct {
		Selections []struct {
			MachineLabel  string                  `json:"machineLabel"`
			AdapterLabel  string                  `json:"adapterLabel"`
			SupportStatus string                  `json:"supportStatus"`
			Blockers      []struct{ Code string } `json:"blockers"`
		} `json:"selections"`
	}
	if err := json.Unmarshal(getRR.Body.Bytes(), &readModel); err != nil {
		t.Fatalf("decode read model: %v", err)
	}
	if len(readModel.Selections) != 1 {
		t.Fatalf("selections = %d, want 1", len(readModel.Selections))
	}
	entry := readModel.Selections[0]
	if entry.MachineLabel != "HOLZMA (HOMAG) HPP 250" || entry.SupportStatus != "NOT_TESTED" {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	if len(entry.Blockers) != 0 {
		t.Fatalf("implemented serializer must not block: %+v", entry.Blockers)
	}
}

func TestMachineOutputSelectionRejectsInvalidTuple(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	sel := validCuttingSelectionAPI()
	sel.OutputProfileID = "saw-homag" // family mismatch with granete-ptx

	rr := putMachineOutputSelection(t, srv, "cutting", sel, 0, string(domain.RoleAdmin))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(errorBody(t, rr), "no es compatible") {
		t.Errorf("error should explain family mismatch, got %q", errorBody(t, rr))
	}
}

func TestMachineOutputSelectionStaleVersionConflict(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	if rr := putMachineOutputSelection(t, srv, "cutting", validCuttingSelectionAPI(), 0, string(domain.RoleAdmin)); rr.Code != http.StatusOK {
		t.Fatalf("initial save failed: %d %s", rr.Code, rr.Body.String())
	}
	// Editor A moves v1 -> v2.
	if rr := putMachineOutputSelection(t, srv, "cutting", validCuttingSelectionAPI(), 1, string(domain.RoleAdmin)); rr.Code != http.StatusOK {
		t.Fatalf("update to v2 failed: %d %s", rr.Code, rr.Body.String())
	}
	// Editor B still holds v1: typed conflict, never a silent overwrite.
	stale := putMachineOutputSelection(t, srv, "cutting", validCuttingSelectionAPI(), 1, string(domain.RoleAdmin))
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale status = %d, want 409 (body=%s)", stale.Code, stale.Body.String())
	}
	if !strings.Contains(stale.Body.String(), "VERSION_CONFLICT") {
		t.Errorf("conflict body must carry VERSION_CONFLICT code, got %s", stale.Body.String())
	}
}

func TestMachineOutputSelectionPermissionAndOperationMismatch(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	// Vendedor (sales) cannot mutate machine configuration.
	forbidden := putMachineOutputSelection(t, srv, "cutting", validCuttingSelectionAPI(), 0, string(domain.RoleVendedor))
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("vendedor status = %d, want 403", forbidden.Code)
	}

	// Path operation must match the body selection operation — the body keeps
	// its ORIGINAL value (the handler must not overwrite it before comparing).
	sel := validCuttingSelectionAPI() // body says cutting...
	mismatch := putMachineOutputSelection(t, srv, "machining", sel, 0, string(domain.RoleAdmin))
	if mismatch.Code != http.StatusBadRequest {
		t.Fatalf("mismatched operation status = %d, want 400", mismatch.Code)
	}
	if !strings.Contains(mismatch.Body.String(), "no coincide") {
		t.Errorf("mismatch body should explain the path/body divergence, got %s", mismatch.Body.String())
	}

	// Store (vendedor) cannot read the internal machine catalog either.
	get := withClaims(httptest.NewRequest(http.MethodGet, "/api/machine-output-selections", nil), "v1", string(domain.RoleVendedor))
	getRR := httptest.NewRecorder()
	srv.HandleListMachineOutputSelections(getRR, get)
	if getRR.Code != http.StatusForbidden {
		t.Fatalf("vendedor GET status = %d, want 403 (factory-only scope)", getRR.Code)
	}
}

func TestMachineOutputSelectionSerializerNotImplementedSurfaced(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	sel := domain.MachineOutputSelection{
		Operation:                   domain.OperationMachining,
		MachineProfileID:            "client-a-machine-a-bhx050",
		MachineProfileRevisionID:    "r1",
		OutputProfileID:             "mpr-woodwop",
		OutputProfileRevisionID:     "r1",
		AdapterID:                   "woodwop-mpr",
		AdapterVersion:              "0.1.0",
		AdapterImplementationDigest: "4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782",
	}
	rr := putMachineOutputSelection(t, srv, "machining", sel, 0, string(domain.RoleAdmin))
	if rr.Code != http.StatusOK {
		t.Fatalf("selection of a pending serializer must still save (selection ≠ generation): %d %s", rr.Code, rr.Body.String())
	}

	get := withClaims(httptest.NewRequest(http.MethodGet, "/api/machine-output-selections", nil), "admin", string(domain.RoleAdmin))
	getRR := httptest.NewRecorder()
	srv.HandleListMachineOutputSelections(getRR, get)
	if !strings.Contains(getRR.Body.String(), "SERIALIZER_NOT_IMPLEMENTED") {
		t.Fatalf("read model must surface SERIALIZER_NOT_IMPLEMENTED, got %s", getRR.Body.String())
	}
}
