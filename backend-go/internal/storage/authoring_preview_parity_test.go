package storage_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #497 T4: the authoring preview must agree with the published catalog it
// previews against. When the draft equals the persisted definitions, the
// would-be definitionHash and the echoed catalogRevision are EXACTLY the
// published projection's, and nothing in the database moves. Every call runs
// inside a tenant transaction — the same way the auth middleware wraps real
// requests for the NOBYPASSRLS runtime role.

type previewParityStore struct {
	*storage.PostgresStore
}

func (s *previewParityStore) GetUserByID(_ context.Context, userID string) (*domain.User, error) {
	return &domain.User{ID: userID, Email: "preview-parity@test"}, nil
}

func (s *previewParityStore) GetOrganizationByID(_ context.Context, orgID string) (*domain.Organization, error) {
	expires := time.Now().Add(365 * 24 * time.Hour)
	return &domain.Organization{
		ID: orgID, Name: "Taller Preview", Slug: "taller-preview",
		Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanPro,
		LicenseExpiresAt: &expires, Status: domain.OrganizationStatusActive, CredentialVersion: 1,
	}, nil
}

func TestAuthoringPreviewParityWithPublishedCatalog(t *testing.T) {
	realStore, _ := migratedConnectStore(t)
	store := &previewParityStore{PostgresStore: realStore}
	actor := connectStoreInitialActor
	previewUserID := "f4970000-0000-0000-0000-0000000000u1"

	previewComponentID := "f4970000-0000-0000-0000-0000000000c1"
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		if err := store.CreateComponent(txCtx, &domain.Component{
			ID: previewComponentID, Code: "COMP-PREVIEW-497", Name: "Estante",
			Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
			LengthMm: 590, WidthMm: 600, ThicknessMm: 18,
		}); err != nil {
			return err
		}
		t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM components WHERE id = $1`, previewComponentID) })
		return nil
	})

	definitions := []domain.FurnitureParameterDefinition{{
		Name: "shelfCount", Label: "Cantidad de estantes", SortOrder: 1,
		Type: domain.FurnitureParameterTypeNumber, DefaultValue: 2.0,
		Required: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration,
		Integer:  true,
		Binding: &domain.FurnitureParameterBinding{
			Version:     domain.FurnitureParameterBindingVersion,
			Kind:        domain.FurnitureParameterBindingComponentQuantity,
			ComponentID: previewComponentID,
		},
	}}
	moduleID := "f4970000-0000-0000-0000-0000000000a1"
	mod := &domain.Module{
		ID: moduleID, Code: "MOD-PREVIEW-497", Name: "Mueble preview parity",
		WidthMm: 600, HeightMm: 720, DepthMm: 590,
		Components:           []domain.ComponentInstance{{ComponentID: previewComponentID, Quantity: 2}},
		ParameterDefinitions: definitions,
	}
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		if err := store.CreateModule(txCtx, mod); err != nil {
			return err
		}
		t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, moduleID) })
		return nil
	})

	server := &api.Server{Store: store}

	before := withinConnectStoreTenantValue(t, store.PostgresStore, actor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, moduleID)
	})

	// Published projection (GET /api/furniture/definitions) inside the tenant
	// transaction, exactly as the auth middleware wraps real requests.
	catalogBody := withinConnectStoreTenantValue(t, store.PostgresStore, actor, func(txCtx context.Context) ([]byte, error) {
		req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
		req = req.WithContext(context.WithValue(txCtx, api.UserContextKey, &auth.Claims{UserID: previewUserID}))
		rr := httptest.NewRecorder()
		server.HandleFurnitureDefinitions(rr, req)
		if rr.Code != http.StatusOK {
			return nil, nil
		}
		return rr.Body.Bytes(), nil
	})
	var catalog struct {
		RevisionID  string `json:"revisionId"`
		Definitions map[string]struct {
			DefinitionHash string `json:"definitionHash"`
		} `json:"definitions"`
	}
	if err := json.Unmarshal(catalogBody, &catalog); err != nil {
		t.Fatalf("catalog body: %v", err)
	}

	previewBody := `{"moduleId":"` + moduleID + `","parameterDefinitions":` + previewDefinitionsJSON(t, definitions) + `,"parameters":{}}`
	doPreview := func(t *testing.T) (int, []byte) {
		t.Helper()
		var status int
		var payload []byte
		withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
			req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/preview", strings.NewReader(previewBody))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(context.WithValue(txCtx, api.UserContextKey, &auth.Claims{UserID: previewUserID}))
			rr := httptest.NewRecorder()
			server.HandleFurnitureAuthoringPreview(rr, req)
			status = rr.Code
			payload = rr.Body.Bytes()
			return nil
		})
		return status, payload
	}

	status1, body1 := doPreview(t)
	status2, body2 := doPreview(t)
	if status1 != http.StatusOK || status2 != http.StatusOK {
		t.Fatalf("preview statuses = %d/%d (body=%s)", status1, status2, body1)
	}
	var preview1, preview2 map[string]any
	if err := json.Unmarshal(body1, &preview1); err != nil {
		t.Fatalf("preview body: %v", err)
	}
	if err := json.Unmarshal(body2, &preview2); err != nil {
		t.Fatalf("preview body 2: %v", err)
	}

	if preview1["status"] != "accepted" || preview2["status"] != "accepted" {
		t.Fatalf("preview statuses: %v / %v", preview1["status"], preview2["status"])
	}
	if preview1["catalogRevision"] != catalog.RevisionID {
		t.Fatalf("preview revision %v != published %v", preview1["catalogRevision"], catalog.RevisionID)
	}
	if preview1["definitionHash"] != catalog.Definitions[moduleID].DefinitionHash {
		t.Fatalf("draft==persisted hash %v != published %v", preview1["definitionHash"], catalog.Definitions[moduleID].DefinitionHash)
	}
	if _, hasResolved := preview1["resolved"]; !hasResolved {
		t.Fatal("accepted preview must carry resolved data")
	}
	if preview1["definitionHash"] != preview2["definitionHash"] || preview1["catalogRevision"] != preview2["catalogRevision"] {
		t.Fatal("identical previews diverged (stateless violation)")
	}

	// Golden parity: the committed contracts fixture is EXACTLY what the
	// server answered for this preview (regenerate with
	// UPDATE_AUTHORING_PREVIEW_GOLDEN=1); the TS contract test parses the
	// same file so Go and the browser share one authority.
	goldenPath := filepath.Join("..", "..", "..", "contracts", "furnitureAuthoringPreview.fixture.json")
	golden, _ := json.MarshalIndent(preview1, "", "  ")
	golden = append(golden, '\n')
	if os.Getenv("UPDATE_AUTHORING_PREVIEW_GOLDEN") == "1" {
		if err := os.WriteFile(goldenPath, golden, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
	} else {
		committed, err := os.ReadFile(goldenPath)
		if err != nil {
			t.Fatalf("read golden (run with UPDATE_AUTHORING_PREVIEW_GOLDEN=1 once): %v", err)
		}
		if !bytes.Equal(committed, golden) {
			t.Fatal("authoring preview golden drifted — regenerate deliberately")
		}
	}

	// Nothing moved: the module row is untouched by previewing.
	after := withinConnectStoreTenantValue(t, store.PostgresStore, actor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, moduleID)
	})
	if !after.UpdatedAt.Equal(before.UpdatedAt) || after.Version != before.Version {
		t.Fatalf("preview mutated the module row: updated_at %v -> %v, version %d -> %d",
			before.UpdatedAt, after.UpdatedAt, before.Version, after.Version)
	}
}

func previewDefinitionsJSON(t *testing.T, definitions []domain.FurnitureParameterDefinition) string {
	t.Helper()
	out, err := json.Marshal(definitions)
	if err != nil {
		t.Fatalf("marshal definitions: %v", err)
	}
	return string(out)
}
