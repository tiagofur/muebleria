package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #395 authority integration (PR #551 review): the canonical ProductionRelease
// is the ONE release authority for every production consumer. These proofs pin
// the two API boundaries: the legacy project PUT can no longer rewrite release
// truth once a canonical release exists, and the part-executions revision
// guard resolves the canonical release (never the coexisting legacy blob).

func TestProjectUpdate_CannotRewriteReleaseOnceCanonicalExists(t *testing.T) {
	storedRelease := &domain.LegacyProductionRelease{ID: "rel-legacy-1", ProjectID: "p1"}
	existing := &domain.Project{
		ID: "p1", Name: "Obra", CustomerID: "c1", Status: domain.StatusAccepted,
		OwnerUserID: "u1", ProductionRelease: storedRelease,
	}
	store := &stubStore{
		projectReturnedByID:        existing,
		latestProductionRelease:    &domain.ProductionRelease{ID: "3f0c9c11-0000-4000-8000-000000000005", ProjectID: "p1"},
	}
	srv := &Server{Store: store}

	body := `{"id":"p1","name":"Obra","customer_id":"30000000-0000-0000-0000-00000000000a","status":"accepted","owner_user_id":"u1",` +
		`"production_release":{"id":"rel-client-forged","project_id":"p1","bom_fingerprint":"client-says-abc"}}`
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", strings.NewReader(body)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	if store.lastUpdatedProject == nil || store.lastUpdatedProject.ProductionRelease == nil {
		t.Fatalf("the stored release must be preserved, not nulled")
	}
	if store.lastUpdatedProject.ProductionRelease.ID != "rel-legacy-1" {
		t.Fatalf("client-sent release truth must be ignored once a canonical release exists, got %q",
			store.lastUpdatedProject.ProductionRelease.ID)
	}
}

// The part-executions revision guard resolves the canonical release authority:
// parts derived against the legacy blob revision are rejected, parts derived
// against the canonical release pass — the consumer resolves the SAME release
// the gate created.
func TestPartExec_RevisionGuardUsesCanonicalReleaseAuthority(t *testing.T) {
	store, srv := partExecFixtures("rel-legacy-1")
	store.partInstances = nil
	store.moduleUnits = nil
	store.itemQuantities = map[string]int{"i1": 2}
	store.latestProductionRelease = &domain.ProductionRelease{
		ID:                      "3f0c9c11-0000-4000-8000-000000000005",
		ProjectID:               "p1",
		ManufacturingFingerprint: "sha256-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
	}

	// Parts stamped with the LEGACY blob revision no longer match the
	// released authority.
	if rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rel-legacy-1", 2)); rr.Code != http.StatusConflict {
		t.Fatalf("legacy blob revision must not satisfy the guard once the canonical release exists, got %d body=%s", rr.Code, rr.Body.String())
	}

	// Parts stamped with the CANONICAL release id resolve the same authority
	// the release gate created.
	if rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("3f0c9c11-0000-4000-8000-000000000005", 2)); rr.Code != http.StatusOK {
		t.Fatalf("canonical release revision must satisfy the guard, got %d body=%s", rr.Code, rr.Body.String())
	}
}

// Without a canonical release the legacy blob remains the (compatibility)
// authority: pre-DT projects keep working exactly as before.
func TestPartExec_RevisionGuardFallsBackToLegacyBlob(t *testing.T) {
	store, srv := partExecFixtures("rel-legacy-1")
	store.partInstances = nil
	store.moduleUnits = nil
	store.itemQuantities = map[string]int{"i1": 2}

	if rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rel-legacy-1", 2)); rr.Code != http.StatusOK {
		t.Fatalf("legacy blob must keep grounding pre-DT projects, got %d body=%s", rr.Code, rr.Body.String())
	}
	if rr := doGenerate(srv, string(domain.RoleAdmin), generateBody("rel-old", 2)); rr.Code != http.StatusConflict {
		t.Fatalf("stale legacy revision must still 409, got %d", rr.Code)
	}
}

// The readback returned by the release API and the authority the consumers
// resolve must be the SAME release: the readback ID/fingerprint equal what
// GetLatestProjectProductionRelease (the consumer authority) returns.
func TestProductionRelease_ReadbackCarriesAuthorityPins(t *testing.T) {
	created := &storage.ProductionReleaseReadback{
		Release: domain.ProductionRelease{
			ID:                      "3f0c9c11-0000-4000-8000-000000000005",
			ProjectID:               releaseTestProjectID,
			DesignRevisionID:        releaseTestRevisionID,
			QuoteRevisionID:         releaseTestQuoteRevID,
			ReleaseNumber:           1,
			DesignRevisionNumber:    3,
			ManufacturingFingerprint: "sha256-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
			Status:                  domain.ProductionReleaseStatusActive,
			ReleasedBy:              "user-release",
		},
	}
	store := &stubStore{
		createProductionReleaseResult: created,
		latestProductionRelease:       &created.Release,
	}
	srv := &Server{Store: store}
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+releaseTestProjectID+"/production-releases",
		strings.NewReader(`{"design_revision_id":"`+releaseTestRevisionID+`","quote_revision_id":"`+releaseTestQuoteRevID+`"}`))
	req.SetPathValue("projectId", releaseTestProjectID)
	req = withTestClaims(req, "user-release", []domain.UserRole{domain.RoleAdmin})
	rr := httptest.NewRecorder()
	srv.HandleProjectProductionReleases(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var release struct {
		ID                       string `json:"id"`
		DesignRevisionID         string `json:"design_revision_id"`
		QuoteRevisionID          string `json:"quote_revision_id"`
		ManufacturingFingerprint string `json:"manufacturing_fingerprint"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&release); err != nil {
		t.Fatalf("decode: %v", err)
	}
	authority, err := store.GetLatestProjectProductionRelease(nil, releaseTestProjectID)
	if err != nil || authority == nil {
		t.Fatalf("consumer authority must resolve the release: %v", err)
	}
	if release.ID != authority.ID || release.ManufacturingFingerprint != authority.ManufacturingFingerprint {
		t.Fatalf("readback and consumer authority must be the SAME release: %s/%s vs %s/%s",
			release.ID, release.ManufacturingFingerprint, authority.ID, authority.ManufacturingFingerprint)
	}
	if release.DesignRevisionID != releaseTestRevisionID || release.QuoteRevisionID != releaseTestQuoteRevID {
		t.Fatalf("readback must carry the exact pins")
	}
}
