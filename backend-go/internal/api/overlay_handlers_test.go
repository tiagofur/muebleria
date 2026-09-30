package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Helper to inject org claims into the request context for testing
func withOverlayOrgClaims(req *http.Request, orgID, userID string) *http.Request {
	claims := &auth.Claims{
		OrgID:  orgID,
		UserID: userID,
		Role:   string(domain.RoleAdmin),
	}
	claims.Subject = userID
	ctx := context.WithValue(req.Context(), UserContextKey, claims)
	ctx = storage.WithOrgCtx(ctx, orgID)
	return req.WithContext(ctx)
}

func setupTestReleases(standardID uuid.UUID) (uuid.UUID, uuid.UUID, *domain.LibraryRelease, *domain.LibraryRelease, *domain.LibraryManifest, *domain.LibraryManifest, []byte, []byte) {
	rel1ID := uuid.New()
	rel2ID := uuid.New()
	now := time.Now().UTC()
	hash1 := "sha256:rel1"
	hash2 := "sha256:rel2"

	rel1 := &domain.LibraryRelease{
		ID:           rel1ID,
		LibraryID:    standardID,
		Version:      "1.0.0",
		Status:       domain.ReleaseStatusPublished,
		ManifestHash: &hash1,
		PublishedAt:  &now,
	}

	rel2 := &domain.LibraryRelease{
		ID:           rel2ID,
		LibraryID:    standardID,
		Version:      "1.1.0",
		Status:       domain.ReleaseStatusPublished,
		ManifestHash: &hash2,
		PublishedAt:  &now,
	}

	res1UUID := uuid.New()
	manifest1 := &domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.0",
		EffectiveReleaseID: rel1ID,
		ManifestHash:       hash1,
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             res1UUID,
				Revision:       "1.0.0",
				DefinitionHash: "blob1",
				PackageKind:    domain.PackageKindStandard,
			},
		},
	}

	manifest2 := &domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.1.0",
		EffectiveReleaseID: rel2ID,
		ManifestHash:       hash2,
		Resources: []domain.ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             res1UUID,
				Revision:       "1.1.0",
				DefinitionHash: "blob2",
				PackageKind:    domain.PackageKindStandard,
			},
		},
	}

	raw1, _ := json.Marshal(manifest1)
	raw2, _ := json.Marshal(manifest2)

	return rel1ID, rel2ID, rel1, rel2, manifest1, manifest2, raw1, raw2
}

func TestHandleCreateLibraryOverlay(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	orgID := uuid.New()
	userID := uuid.New()
	rel1ID, _, rel1, _, m1, _, raw1, _ := setupTestReleases(standardID)

	customResUUID := uuid.New()

	t.Run("Success 201", func(t *testing.T) {
		store := &stubStore{
			releaseByID:            map[uuid.UUID]*domain.LibraryRelease{rel1ID: rel1},
			releaseManifestsByID:   map[uuid.UUID]*domain.LibraryManifest{rel1ID: m1},
			releaseManifestRawByID: map[uuid.UUID][]byte{rel1ID: raw1},
		}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId:     rel1ID.String(),
			CustomResourceIds: []string{customResUUID.String()},
			Overrides: map[string]any{
				"parameters.panelThickness": 18.0,
			},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", rr.Code, rr.Body.String())
		}

		var resp openapi.LibraryOverlayDetail
		if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}

		if resp.OrganizationId != orgID.String() {
			t.Errorf("expected org %s, got %s", orgID, resp.OrganizationId)
		}
		if resp.BaseReleaseId != rel1ID.String() {
			t.Errorf("expected base release %s, got %s", rel1ID, resp.BaseReleaseId)
		}
		if resp.Status != "active" {
			t.Errorf("expected active status, got %s", resp.Status)
		}
		if len(resp.CustomResourceIds) != 1 || resp.CustomResourceIds[0] != customResUUID.String() {
			t.Errorf("expected custom resource id %s, got %v", customResUUID, resp.CustomResourceIds)
		}
	})

	t.Run("Unauthorized missing org context 401", func(t *testing.T) {
		store := &stubStore{}
		srv := &Server{Store: store}

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader([]byte("{}")))
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rr.Code)
		}
	})

	t.Run("Invalid baseReleaseId 400", func(t *testing.T) {
		store := &stubStore{}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId: "not-a-uuid",
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("Invalid customResourceId 400", func(t *testing.T) {
		store := &stubStore{}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId:     rel1ID.String(),
			CustomResourceIds: []string{"invalid-uuid"},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("Invalid override path 400", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{rel1ID: rel1},
		}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId: rel1ID.String(),
			Overrides: map[string]any{
				"unauthorized_root.foo": "bad",
			},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid override path, got %d", rr.Code)
		}
	})

	t.Run("Base release not found 404", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{},
		}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId: rel1ID.String(),
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for missing base release, got %d", rr.Code)
		}
	})

	t.Run("Base release not published 400", func(t *testing.T) {
		draftRel := &domain.LibraryRelease{
			ID:        rel1ID,
			LibraryID: standardID,
			Version:   "1.0.0-draft",
			Status:    domain.ReleaseStatusDraft,
		}
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{rel1ID: draftRel},
		}
		srv := &Server{Store: store}

		reqBody := openapi.CreateLibraryOverlayRequest{
			BaseReleaseId: rel1ID.String(),
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays", bytes.NewReader(bodyBytes))
		req = withOverlayOrgClaims(req, orgID.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleCreateLibraryOverlay(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for draft base release, got %d", rr.Code)
		}
	})
}

func TestHandleGetLibraryOverlayByID(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	overlayID := uuid.New()

	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      standardID,
		BaseReleaseID:  uuid.New(),
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 15.0}`),
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}

	store := &stubStore{
		overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
			overlayID: overlay,
		},
	}
	srv := &Server{Store: store}

	t.Run("Success 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+overlayID.String(), nil)
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleGetLibraryOverlayByID(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var detail openapi.LibraryOverlayDetail
		if err := json.NewDecoder(rr.Body).Decode(&detail); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if detail.ID != overlayID.String() {
			t.Errorf("expected ID %s, got %s", overlayID, detail.ID)
		}
	})

	t.Run("Cross-tenant isolation 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+overlayID.String(), nil)
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // Org B trying to access Org A's overlay
		rr := httptest.NewRecorder()

		srv.HandleGetLibraryOverlayByID(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-tenant access, got %d", rr.Code)
		}
	})

	t.Run("Overlay not found 404", func(t *testing.T) {
		missingID := uuid.New()
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+missingID.String(), nil)
		req.SetPathValue("id", missingID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleGetLibraryOverlayByID(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for non-existent overlay, got %d", rr.Code)
		}
	})
}

func TestHandleUpdateLibraryOverlay(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	overlayID := uuid.New()

	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      standardID,
		BaseReleaseID:  uuid.New(),
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 15.0}`),
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}

	t.Run("Success 200", func(t *testing.T) {
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.UpdateLibraryOverlayRequest{
			Overrides: map[string]any{
				"parameters.panelThickness": 18.0,
			},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPatch, "/api/manufacturing-libraries/overlays/"+overlayID.String(), bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleUpdateLibraryOverlay(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("Cross-tenant isolation 404", func(t *testing.T) {
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.UpdateLibraryOverlayRequest{
			Overrides: map[string]any{
				"parameters.panelThickness": 19.0,
			},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPatch, "/api/manufacturing-libraries/overlays/"+overlayID.String(), bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // Org B
		rr := httptest.NewRecorder()

		srv.HandleUpdateLibraryOverlay(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-tenant mutation, got %d", rr.Code)
		}
	})

	t.Run("Invalid override path 400", func(t *testing.T) {
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.UpdateLibraryOverlayRequest{
			Overrides: map[string]any{
				"unauthorized.path": 19.0,
			},
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPatch, "/api/manufacturing-libraries/overlays/"+overlayID.String(), bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleUpdateLibraryOverlay(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for bad path, got %d", rr.Code)
		}
	})
}

func TestHandleRebaseLibraryOverlay(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	overlayID := uuid.New()

	rel1ID, rel2ID, rel1, rel2, m1, m2, raw1, raw2 := setupTestReleases(standardID)

	// Blob for old base: parameters.panelThickness = 15.0, rules.maxSpan = 800
	oldBlob := &domain.ResourceBlob{
		SHA256: "blob1",
		Content: json.RawMessage(`{
			"id": "res1",
			"code": "DEF_BASE",
			"parameters": {"panelThickness": 15.0},
			"rules": {"maxSpan": 800}
		}`),
	}

	// New base changes rules.maxSpan to 900, leaves panelThickness at 15.0
	newBlobClean := &domain.ResourceBlob{
		SHA256: "blob2",
		Content: json.RawMessage(`{
			"id": "res1",
			"code": "DEF_BASE",
			"parameters": {"panelThickness": 15.0},
			"rules": {"maxSpan": 900}
		}`),
	}

	// New base changes panelThickness to 16.0 (collision with tenant who changed panelThickness to 18.0)
	newBlobConflict := &domain.ResourceBlob{
		SHA256: "blob2_conflict",
		Content: json.RawMessage(`{
			"id": "res1",
			"code": "DEF_BASE",
			"parameters": {"panelThickness": 16.0},
			"rules": {"maxSpan": 800}
		}`),
	}

	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      standardID,
		BaseReleaseID:  rel1ID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 18.0}`),
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}

	t.Run("Clean merge 200 no conflicts", func(t *testing.T) {
		cleanOverlay := *overlay
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: &cleanOverlay,
			},
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				rel1ID: rel1,
				rel2ID: rel2,
			},
			releaseManifestsByID: map[uuid.UUID]*domain.LibraryManifest{
				rel1ID: m1,
				rel2ID: m2,
			},
			releaseManifestRawByID: map[uuid.UUID][]byte{
				rel1ID: raw1,
				rel2ID: raw2,
			},
			resourceBlobsByHash: map[string]*domain.ResourceBlob{
				"blob1": oldBlob,
				"blob2": newBlobClean,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.RebaseLibraryOverlayRequest{
			TargetReleaseId: rel2ID.String(),
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/rebase", bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleRebaseLibraryOverlay(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var res openapi.LibraryOverlayRebaseResult
		if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
			t.Fatalf("decode: %v", err)
		}

		if res.HasConflicts {
			t.Errorf("expected no conflicts, got %d conflicts", len(res.Conflicts))
		}
		if res.Status != "active" {
			t.Errorf("expected active status, got %s", res.Status)
		}
		if res.NewBaseReleaseId != rel2ID.String() {
			t.Errorf("expected new base release %s, got %s", rel2ID, res.NewBaseReleaseId)
		}
	})

	t.Run("Rebase with collisions 200 has conflicts", func(t *testing.T) {
		m2Conflict := &domain.LibraryManifest{
			SchemaVersion:      1,
			LibraryID:          standardID,
			LibraryCode:        "0001",
			LibraryVersion:     "1.1.0",
			EffectiveReleaseID: rel2ID,
			ManifestHash:       "sha256:rel2_conflict",
			Resources: []domain.ManifestResourceRef{
				{
					Kind:           "furniture_definition",
					ID:             m1.Resources[0].ID,
					Revision:       "1.1.0",
					DefinitionHash: "blob2_conflict",
					PackageKind:    domain.PackageKindStandard,
				},
			},
		}
		raw2Conflict, _ := json.Marshal(m2Conflict)

		conflictOverlay := *overlay
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: &conflictOverlay,
			},
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				rel1ID: rel1,
				rel2ID: rel2,
			},
			releaseManifestsByID: map[uuid.UUID]*domain.LibraryManifest{
				rel1ID: m1,
				rel2ID: m2Conflict,
			},
			releaseManifestRawByID: map[uuid.UUID][]byte{
				rel1ID: raw1,
				rel2ID: raw2Conflict,
			},
			resourceBlobsByHash: map[string]*domain.ResourceBlob{
				"blob1":          oldBlob,
				"blob2_conflict": newBlobConflict,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.RebaseLibraryOverlayRequest{
			TargetReleaseId: rel2ID.String(),
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/rebase", bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleRebaseLibraryOverlay(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var res openapi.LibraryOverlayRebaseResult
		if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
			t.Fatalf("decode: %v", err)
		}

		if !res.HasConflicts {
			t.Fatal("expected conflicts, got none")
		}
		if res.Status != "rebase_conflict" {
			t.Errorf("expected rebase_conflict status, got %s", res.Status)
		}
		if len(res.Conflicts) == 0 {
			t.Fatal("expected at least 1 conflict detail")
		}
		if res.Conflicts[0].Path != "parameters.panelThickness" {
			t.Errorf("expected conflict on parameters.panelThickness, got %s", res.Conflicts[0].Path)
		}
	})

	t.Run("Cross-tenant rebase 404", func(t *testing.T) {
		crossOverlay := *overlay
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: &crossOverlay,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.RebaseLibraryOverlayRequest{
			TargetReleaseId: rel2ID.String(),
		}
		bodyBytes, _ := json.Marshal(reqBody)

		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/rebase", bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // Org B
		rr := httptest.NewRecorder()

		srv.HandleRebaseLibraryOverlay(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-tenant rebase, got %d", rr.Code)
		}
	})
}

func TestHandleListLibraryOverlayConflicts(t *testing.T) {
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	overlayID := uuid.New()

	c1ID := uuid.New()
	c2ID := uuid.New()
	oldRelID := uuid.New()
	newRelID := uuid.New()

	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      uuid.New(),
		BaseReleaseID:  oldRelID,
		Status:         "pending_review",
	}

	conflicts := map[uuid.UUID]*domain.LibraryOverlayConflict{
		c1ID: {
			ID:               c1ID,
			OverlayID:        overlayID,
			OrganizationID:   orgA,
			OldBaseReleaseID: oldRelID,
			NewBaseReleaseID: newRelID,
			ConflictType:     domain.ConflictSameField,
			Path:             "parameters.panelThickness",
			Status:           "pending",
			CreatedAt:        time.Now().UTC(),
		},
		c2ID: {
			ID:               c2ID,
			OverlayID:        overlayID,
			OrganizationID:   orgA,
			OldBaseReleaseID: oldRelID,
			NewBaseReleaseID: newRelID,
			ConflictType:     domain.ConflictCrossFieldDependency,
			Path:             "rules.jointDepth",
			Status:           "resolved",
			CreatedAt:        time.Now().UTC(),
		},
	}

	store := &stubStore{
		overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
			overlayID: overlay,
		},
		overlayConflictsByID: conflicts,
	}
	srv := &Server{Store: store}

	t.Run("List all conflicts 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/conflicts", nil)
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleListLibraryOverlayConflicts(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var list []openapi.LibraryOverlayConflictDetail
		if err := json.NewDecoder(rr.Body).Decode(&list); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(list) != 2 {
			t.Errorf("expected 2 conflicts, got %d", len(list))
		}
	})

	t.Run("Filter by status=pending 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/conflicts?status=pending", nil)
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleListLibraryOverlayConflicts(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var list []openapi.LibraryOverlayConflictDetail
		if err := json.NewDecoder(rr.Body).Decode(&list); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("expected 1 pending conflict, got %d", len(list))
		}
		if list[0].ID != c1ID.String() {
			t.Errorf("expected conflict %s, got %s", c1ID, list[0].ID)
		}
	})

	t.Run("Cross-tenant listing 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/"+overlayID.String()+"/conflicts", nil)
		req.SetPathValue("id", overlayID.String())
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // Org B
		rr := httptest.NewRecorder()

		srv.HandleListLibraryOverlayConflicts(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-tenant conflicts list, got %d", rr.Code)
		}
	})
}

func TestHandleResolveLibraryOverlayConflict(t *testing.T) {
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	overlayID := uuid.New()
	conflictID := uuid.New()
	oldRelID := uuid.New()
	newRelID := uuid.New()

	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      uuid.New(),
		BaseReleaseID:  oldRelID,
		Status:         "pending_review",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 18.0}`),
	}

	conflict := &domain.LibraryOverlayConflict{
		ID:               conflictID,
		OverlayID:        overlayID,
		OrganizationID:   orgA,
		OldBaseReleaseID: oldRelID,
		NewBaseReleaseID: newRelID,
		ConflictType:     domain.ConflictSameField,
		Path:             "parameters.panelThickness",
		OldBaseValue:     15.0,
		NewBaseValue:     16.0,
		CustomValue:      18.0,
		Status:           "pending",
		CreatedAt:        time.Now().UTC(),
	}

	t.Run("Success keep_custom 200", func(t *testing.T) {
		cCopy := *conflict
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
			overlayConflictsByID: map[uuid.UUID]*domain.LibraryOverlayConflict{
				conflictID: &cCopy,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.ResolveLibraryOverlayConflictRequest{
			Action: "keep_custom",
		}
		bodyBytes, _ := json.Marshal(reqBody)

		url := "/api/manufacturing-libraries/overlays/" + overlayID.String() + "/conflicts/" + conflictID.String() + "/resolve"
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req.SetPathValue("conflictId", conflictID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleResolveLibraryOverlayConflict(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var res openapi.LibraryOverlayConflictDetail
		if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if res.Status != "resolved" {
			t.Errorf("expected status resolved, got %s", res.Status)
		}
		if res.ResolutionAction == nil || *res.ResolutionAction != "keep_custom" {
			t.Errorf("expected resolution action keep_custom, got %v", res.ResolutionAction)
		}
	})

	t.Run("Already resolved conflict 400", func(t *testing.T) {
		resolvedConflict := *conflict
		resolvedConflict.Status = "resolved"

		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
			overlayConflictsByID: map[uuid.UUID]*domain.LibraryOverlayConflict{
				conflictID: &resolvedConflict,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.ResolveLibraryOverlayConflictRequest{
			Action: "adopt_upstream",
		}
		bodyBytes, _ := json.Marshal(reqBody)

		url := "/api/manufacturing-libraries/overlays/" + overlayID.String() + "/conflicts/" + conflictID.String() + "/resolve"
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req.SetPathValue("conflictId", conflictID.String())
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleResolveLibraryOverlayConflict(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for already resolved conflict, got %d: %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("Cross-tenant resolve 404", func(t *testing.T) {
		cCopy := *conflict
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
			overlayConflictsByID: map[uuid.UUID]*domain.LibraryOverlayConflict{
				conflictID: &cCopy,
			},
		}
		srv := &Server{Store: store}

		reqBody := openapi.ResolveLibraryOverlayConflictRequest{
			Action: "keep_custom",
		}
		bodyBytes, _ := json.Marshal(reqBody)

		url := "/api/manufacturing-libraries/overlays/" + overlayID.String() + "/conflicts/" + conflictID.String() + "/resolve"
		req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
		req.SetPathValue("id", overlayID.String())
		req.SetPathValue("conflictId", conflictID.String())
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // Org B
		rr := httptest.NewRecorder()

		srv.HandleResolveLibraryOverlayConflict(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-tenant conflict resolution, got %d", rr.Code)
		}
	})
}

func TestHandleGetActiveLibraryOverlay(t *testing.T) {
	orgA := uuid.New()
	orgB := uuid.New()
	userID := uuid.New()
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	baseRelID := uuid.New()

	overlayID := uuid.New()
	overlay := &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		LibraryID:      standardID,
		BaseReleaseID:  baseRelID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"joint.floorToSide.stationsCount": 4}`),
	}

	t.Run("Success 200 returns active overlay", func(t *testing.T) {
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay,
			},
		}
		srv := &Server{Store: store}

		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/active", nil)
		req = withOverlayOrgClaims(req, orgA.String(), userID.String())
		rr := httptest.NewRecorder()

		srv.HandleGetActiveLibraryOverlay(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
		}

		var res openapi.LibraryOverlayDetail
		if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if res.ID != overlayID.String() {
			t.Errorf("expected overlay ID %s, got %s", overlayID, res.ID)
		}
		if res.Status != "active" {
			t.Errorf("expected status active, got %s", res.Status)
		}
	})

	t.Run("Not found 404 when no overlay exists for org", func(t *testing.T) {
		store := &stubStore{
			overlaysByID: map[uuid.UUID]*domain.LibraryOverlay{
				overlayID: overlay, // belongs to orgA
			},
		}
		srv := &Server{Store: store}

		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/active", nil)
		req = withOverlayOrgClaims(req, orgB.String(), userID.String()) // orgB has no overlay
		rr := httptest.NewRecorder()

		srv.HandleGetActiveLibraryOverlay(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for org without overlay, got %d: %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("Unauthorized 401 when claims missing", func(t *testing.T) {
		srv := &Server{Store: &stubStore{}}
		req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/overlays/active", nil)
		rr := httptest.NewRecorder()

		srv.HandleGetActiveLibraryOverlay(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 without claims, got %d", rr.Code)
		}
	})
}

