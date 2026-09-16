package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestHandleHardwareAssetRevisionDerive_RoleGuards(t *testing.T) {
	dummyRev := &domain.HardwareAssetRevision{
		ID:                  "74000000-0000-0000-0000-000000000002",
		AssetID:             "74000000-0000-0000-0000-000000000001",
		RevisionNumber:      2,
		Representation:      domain.HardwareAssetRepresentationSKP,
		ContentType:         "application/octet-stream",
		SizeBytes:           1024,
		SHA256:              "sha256-" + strings.Repeat("aa", 32),
		IntegrityVerifiedAt: time.Now().UTC(),
		ValidationState:     domain.HardwareAssetValidationPending,
		CreatedAt:           time.Now().UTC(),
	}

	validBody := `{
		"source_revision_id": "74000000-0000-0000-0000-000000000001",
		"origin": {
			"source_units": "mm",
			"up_axis": "z",
			"mount_frame": {
				"origin_mm": [0, 15, 30],
				"basis": {
					"x": [1, 0, 0],
					"y": [0, 1, 0],
					"z": [0, 0, 1]
				}
			}
		}
	}`

	// 1. Unauthorized when token is missing
	{
		store := &stubStore{assetRevisionResult: dummyRev}
		srv := &Server{Store: store}
		req := httptest.NewRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", strings.NewReader(validBody))
		req.Header.Set("Content-Type", "application/json")
		req.SetPathValue("assetId", "74000000-0000-0000-0000-000000000001")
		rr := httptest.NewRecorder()
		srv.HandleHardwareAssetRevisionDerive(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized without token, got %d", rr.Code)
		}
	}

	// 2. Forbidden for non-catalog mutation roles
	for _, forbiddenRole := range []domain.UserRole{domain.RoleVendedor, domain.RoleAlmacen, domain.RoleProduccion} {
		store := &stubStore{assetRevisionResult: dummyRev}
		srv := &Server{Store: store}
		req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", validBody, string(forbiddenRole))
		req.SetPathValue("assetId", "74000000-0000-0000-0000-000000000001")
		rr := httptest.NewRecorder()
		srv.HandleHardwareAssetRevisionDerive(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %s: expected 403 Forbidden, got %d", forbiddenRole, rr.Code)
		}
	}

	// 3. Allowed for RoleAdmin and RoleIngeniero
	for _, allowedRole := range []domain.UserRole{domain.RoleAdmin, domain.RoleIngeniero} {
		store := &stubStore{assetRevisionResult: dummyRev}
		srv := &Server{Store: store}
		req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", validBody, string(allowedRole))
		req.SetPathValue("assetId", "74000000-0000-0000-0000-000000000001")
		rr := httptest.NewRecorder()
		srv.HandleHardwareAssetRevisionDerive(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("role %s: expected 201 Created, got %d (body=%s)", allowedRole, rr.Code, rr.Body.String())
		}
	}
}

func TestHandleHardwareAssetRevisionDerive_ExtensionClientBoundary(t *testing.T) {
	// Rule 1: ExtensionClient must NOT be permitted to PUT /api/catalog/hardware/{id}
	putCatalogPath := "/api/catalog/hardware/55000000-0000-0000-0000-000000000001"
	if extensionClientMayAccess(http.MethodPut, putCatalogPath) {
		t.Errorf("VIOLATION of Rule 1: extensionClientMayAccess allowed PUT %s", putCatalogPath)
	}

	// Rule 2: ExtensionClient allowed for POST /api/hardware-assets/{assetId}/revisions:derive
	derivePath := "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive"
	if !extensionClientMayAccess(http.MethodPost, derivePath) {
		t.Errorf("expected extensionClientMayAccess to allow POST %s", derivePath)
	}

	// ExtensionClient allowed for GET /api/hardware-assets/{assetId}
	getPath := "/api/hardware-assets/74000000-0000-0000-0000-000000000001"
	if !extensionClientMayAccess(http.MethodGet, getPath) {
		t.Errorf("expected extensionClientMayAccess to allow GET %s", getPath)
	}

	// Deny-by-default on arbitrary other paths
	for _, unauthorized := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/hardware-assets"},
		{http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001:retire"},
		{http.MethodPut, "/api/hardware-assets/74000000-0000-0000-0000-000000000001"},
		{http.MethodDelete, "/api/hardware-assets/74000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/api/hardware-assets"},
	} {
		if extensionClientMayAccess(unauthorized.method, unauthorized.path) {
			t.Errorf("expected deny for %s %s", unauthorized.method, unauthorized.path)
		}
	}
}

func TestHandleHardwareAssetRevisionDerive_IdempotencyReplay(t *testing.T) {
	backend := newDurableBackend(func() time.Time { return time.Now().UTC() })
	store := &durableTestStore{
		backend: backend,
		stubStore: stubStore{
			assetRevisionResult: &domain.HardwareAssetRevision{
				ID:                  "74000000-0000-0000-0000-000000000002",
				AssetID:             "74000000-0000-0000-0000-000000000001",
				RevisionNumber:      2,
				Representation:      domain.HardwareAssetRepresentationSKP,
				ContentType:         "application/octet-stream",
				SizeBytes:           1024,
				SHA256:              "sha256-" + strings.Repeat("aa", 32),
				IntegrityVerifiedAt: time.Now().UTC(),
				ValidationState:     domain.HardwareAssetValidationPending,
				CreatedAt:           time.Now().UTC(),
			},
		},
	}

	srv := &Server{Store: store}
	router := hardwareAssetCommandRouter(map[string]http.Handler{
		"derive": srv.RequireIdempotency("hardware-assets.derive-revision", http.HandlerFunc(srv.HandleHardwareAssetRevisionDerive)),
	})

	body1 := `{
		"source_revision_id": "74000000-0000-0000-0000-000000000001",
		"origin": {
			"source_units": "mm",
			"up_axis": "z",
			"mount_frame": {
				"origin_mm": [0, 15, 30],
				"basis": {
					"x": [1, 0, 0],
					"y": [0, 1, 0],
					"z": [0, 0, 1]
				}
			}
		}
	}`

	// First attempt: creates R2
	req1 := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", body1, string(domain.RoleAdmin))
	req1.Header.Set("Idempotency-Key", "derive-idemp-key-999")
	req1.SetPathValue("assetCommand", "74000000-0000-0000-0000-000000000001/revisions:derive")
	rr1 := httptest.NewRecorder()
	router.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("first attempt status = %d, want 201 (body=%s)", rr1.Code, rr1.Body.String())
	}
	if store.deriveRevisionCalls != 1 {
		t.Fatalf("expected 1 call to store, got %d", store.deriveRevisionCalls)
	}

	// Second attempt with exact same key + same payload: replayed response, no new revision / store call
	req2 := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", body1, string(domain.RoleAdmin))
	req2.Header.Set("Idempotency-Key", "derive-idemp-key-999")
	req2.SetPathValue("assetCommand", "74000000-0000-0000-0000-000000000001/revisions:derive")
	rr2 := httptest.NewRecorder()
	router.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusCreated {
		t.Fatalf("second attempt status = %d, want 201 (body=%s)", rr2.Code, rr2.Body.String())
	}
	if rr2.Header().Get("Idempotency-Replayed") != "true" {
		t.Errorf("second attempt must be marked as Idempotency-Replayed")
	}
	if store.deriveRevisionCalls != 1 {
		t.Fatalf("idempotent replay must NOT call store again, got %d calls (no R3 created)", store.deriveRevisionCalls)
	}
	if rr1.Body.String() != rr2.Body.String() {
		t.Fatalf("replayed body mismatch:\nfirst=%s\nsecond=%s", rr1.Body.String(), rr2.Body.String())
	}

	// Third attempt with SAME key but DIFFERENT payload -> 409 Conflict
	bodyDifferent := `{
		"source_revision_id": "74000000-0000-0000-0000-000000000001",
		"origin": {
			"source_units": "mm",
			"up_axis": "z",
			"mount_frame": {
				"origin_mm": [99, 99, 99],
				"basis": {
					"x": [1, 0, 0],
					"y": [0, 1, 0],
					"z": [0, 0, 1]
				}
			}
		}
	}`
	req3 := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions:derive", bodyDifferent, string(domain.RoleAdmin))
	req3.Header.Set("Idempotency-Key", "derive-idemp-key-999")
	req3.SetPathValue("assetCommand", "74000000-0000-0000-0000-000000000001/revisions:derive")
	rr3 := httptest.NewRecorder()
	router.ServeHTTP(rr3, req3)

	if rr3.Code != http.StatusConflict {
		t.Fatalf("different payload with same key: expected 409 Conflict, got %d (body=%s)", rr3.Code, rr3.Body.String())
	}
	if store.deriveRevisionCalls != 1 {
		t.Fatalf("conflicted key must NOT call store, got %d calls", store.deriveRevisionCalls)
	}
}
