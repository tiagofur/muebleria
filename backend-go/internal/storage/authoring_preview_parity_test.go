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
// published projection's, and nothing in the database moves.

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
	orgID := connectStoreInitialActor.OrganizationID
	ctx := storage.WithOrgCtx(context.Background(), orgID)

	componentID := "f4970000-0000-0000-0000-0000000000c1"
	seedPreviewComponent(t, store, ctx, componentID)

	definitions := []domain.FurnitureParameterDefinition{{
		Name: "shelfCount", Label: "Cantidad de estantes", SortOrder: 1,
		Type: domain.FurnitureParameterTypeNumber, DefaultValue: 2.0,
		Required: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration,
		Integer:  true,
		Binding: &domain.FurnitureParameterBinding{
			Version:     domain.FurnitureParameterBindingVersion,
			Kind:        domain.FurnitureParameterBindingComponentQuantity,
			ComponentID: componentID,
		},
	}}
	moduleID := "f4970000-0000-0000-0000-0000000000a1"
	mod := &domain.Module{
		ID: moduleID, Code: "MOD-PREVIEW-497", Name: "Mueble preview parity",
		WidthMm: 600, HeightMm: 720, DepthMm: 590,
		Components:           []domain.ComponentInstance{{ComponentID: componentID, Quantity: 2}},
		ParameterDefinitions: definitions,
	}
	if err := store.CreateModule(ctx, mod); err != nil {
		t.Fatalf("seed module: %v", err)
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, moduleID) })

	server := &api.Server{Store: store}
	doPreview := func(t *testing.T) map[string]any {
		t.Helper()
		body := `{"moduleId":"` + moduleID + `","parameterDefinitions":` + previewDefinitionsJSON(t, definitions) + `,"parameters":{}}`
		req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/preview", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(ctx, api.UserContextKey, &auth.Claims{UserID: "f4970000-0000-0000-0000-0000000000u1"}))
		rr := httptest.NewRecorder()
		server.HandleFurnitureAuthoringPreview(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("preview status = %d (body=%s)", rr.Code, rr.Body.String())
		}
		var parsed map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
			t.Fatalf("preview body: %v", err)
		}
		return parsed
	}

	before, err := store.GetModuleByID(ctx, moduleID)
	if err != nil {
		t.Fatalf("read module before previews: %v", err)
	}

	catalogBody := previewGetPublishedCatalog(t, server, ctx)
	var catalog struct {
		RevisionID  string `json:"revisionId"`
		Definitions map[string]struct {
			DefinitionHash string `json:"definitionHash"`
		} `json:"definitions"`
	}
	if err := json.Unmarshal(catalogBody, &catalog); err != nil {
		t.Fatalf("catalog body: %v", err)
	}

	preview1 := doPreview(t)
	preview2 := doPreview(t)

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

	// Nothing moved: the module row is untouched by previewing.
	after, err := store.GetModuleByID(ctx, moduleID)
	if err != nil {
		t.Fatalf("read module after previews: %v", err)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) || after.Version != before.Version {
		t.Fatalf("preview mutated the module row: updated_at %v -> %v, version %d -> %d",
			before.UpdatedAt, after.UpdatedAt, before.Version, after.Version)
	}
}

func previewGetPublishedCatalog(t *testing.T, server *api.Server, ctx context.Context) []byte {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req = req.WithContext(context.WithValue(ctx, api.UserContextKey, &auth.Claims{UserID: connectStoreFixtureUser}))
	rr := httptest.NewRecorder()
	server.HandleFurnitureDefinitions(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("furniture definitions status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	return rr.Body.Bytes()
}

func previewDefinitionsJSON(t *testing.T, definitions []domain.FurnitureParameterDefinition) string {
	t.Helper()
	out, err := json.Marshal(definitions)
	if err != nil {
		t.Fatalf("marshal definitions: %v", err)
	}
	return string(out)
}

func seedPreviewComponent(t *testing.T, store *previewParityStore, ctx context.Context, componentID string) {
	t.Helper()
	if err := store.CreateComponent(ctx, &domain.Component{
		ID: componentID, Code: "COMP-PREVIEW-" + componentID[:8], Name: "Estante",
		Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
		LengthMm: 590, WidthMm: 600, ThicknessMm: 18,
	}); err != nil {
		t.Fatalf("seed component: %v", err)
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM components WHERE id = $1`, componentID) })
}
