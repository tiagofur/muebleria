package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #497 T4: the web editor's authoring preview resolves a DRAFT definition set
// through the resolve engine without persisting anything. Rejected drafts
// answer 422 with structured issues and NEVER carry resolved data.

func previewServer(store *stubStore) *Server {
	return &Server{Store: store}
}

func previewRequest(store *stubStore, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/preview", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	previewServer(store).HandleFurnitureAuthoringPreview(rr, req)
	return rr
}

const previewModuleID = "f4970000-0000-0000-0000-0000000000aa"

func validPreviewModule() *domain.Module {
	return &domain.Module{
		ID:       previewModuleID,
		Code:     "PREVIEW-01",
		Name:     "Mueble preview",
		WidthMm:  600,
		HeightMm: 720,
		DepthMm:  590,
		Components: []domain.ComponentInstance{{
			ComponentID: "f4970000-0000-0000-0000-0000000000cc",
			Quantity:    2,
		}},
		ParameterDefinitions: []domain.FurnitureParameterDefinition{{
			Name: "shelfCount", Label: "Cantidad de estantes", SortOrder: 1,
			Type: domain.FurnitureParameterTypeNumber, DefaultValue: 2.0,
			Required: true, Unit: domain.FurnitureParameterUnitCount,
			Category: domain.FurnitureParameterCategoryConfiguration,
			Min:      float64Ptr(0), Max: float64Ptr(10), Integer: true,
			Binding: &domain.FurnitureParameterBinding{
				Version:     domain.FurnitureParameterBindingVersion,
				Kind:        domain.FurnitureParameterBindingComponentQuantity,
				ComponentID: "f4970000-0000-0000-0000-0000000000cc",
			},
		}},
	}
}

func previewCatalog() domain.Catalog {
	module := *validPreviewModule()
	return domain.Catalog{
		Modules: []domain.Module{module},
		Components: []domain.Component{{
			ID: "f4970000-0000-0000-0000-0000000000cc", Code: "COMP-PREVIEW", Name: "Estante",
			Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
		}},
	}
}

func previewCatalogPtr() *domain.Catalog {
	c := previewCatalog()
	return &c
}

func previewStore() *stubStore {
	return &stubStore{
		getUserByEmail:        &domain.User{ID: "u-1", Email: "preview@test"},
		catalogOverride: previewCatalogPtr(),
		listMaterialCategories: []domain.MaterialCategory{},
	}
}

const validPreviewBody = `{
	"moduleId": "f4970000-0000-0000-0000-0000000000aa",
	"parameterDefinitions": [
		{
			"name": "shelfCount", "label": "Cantidad de estantes", "sortOrder": 1,
			"type": "number", "defaultValue": 2, "required": true, "unit": "count",
			"category": "configuration", "min": 0, "max": 10, "integer": true,
			"binding": {"version": 1, "kind": "componentQuantity", "componentId": "f4970000-0000-0000-0000-0000000000cc"}
		}
	],
	"parameters": {}
}`

func TestHandleAuthoringPreviewAcceptsValidDraft(t *testing.T) {
	rr := previewRequest(previewStore(), validPreviewBody)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{
		`"status":"accepted"`,
		`"definitionHash":"sha256-`,
		`"resolved"`,
		`"layout"`,
		`"preflight"`,
		// synthesized dimension projections ride the published set
		`"name":"widthMm"`, `"name":"heightMm"`, `"name":"depthMm"`,
		// catalog revision echoed so the client can show which truth it used
		`"catalogRevision":"workshop-`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("accepted body missing %s: %s", want, body)
		}
	}
}

func TestHandleAuthoringPreviewRejectsMetadataWithBinding(t *testing.T) {
	body := strings.Replace(validPreviewBody, `"category": "configuration"`, `"category": "metadata"`, 1)
	rr := previewRequest(previewStore(), body)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	b := rr.Body.String()
	if !strings.Contains(b, `"status":"rejected"`) || !strings.Contains(b, "PARAMETER_DEFINITION_INVALID") {
		t.Fatalf("rejected body missing status/issues: %s", b)
	}
	if strings.Contains(b, `"resolved"`) {
		t.Fatalf("rejected draft must never carry resolved data: %s", b)
	}
}

func TestHandleAuthoringPreviewRejectsReservedDimensionName(t *testing.T) {
	body := strings.Replace(validPreviewBody, `"name": "shelfCount"`, `"name": "widthMm"`, 1)
	rr := previewRequest(previewStore(), body)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "PARAMETER_DEFINITION_INVALID") {
		t.Fatalf("reserved dimension must fail the persisted boundary: %s", rr.Body.String())
	}
}

func TestHandleAuthoringPreviewRejectsOutOfRangeSample(t *testing.T) {
	body := strings.Replace(validPreviewBody, `"parameters": {}`, `"parameters": {"widthMm": 99999}`, 1)
	rr := previewRequest(previewStore(), body)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "PARAMETER_OUT_OF_RANGE") {
		t.Fatalf("out-of-range sample must answer the typed code: %s", rr.Body.String())
	}
}

func TestHandleAuthoringPreviewMissingModuleIs404(t *testing.T) {
	body := strings.Replace(validPreviewBody, previewModuleID, "f4970000-0000-0000-0000-0000000000ff", 1)
	rr := previewRequest(previewStore(), body)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleAuthoringPreviewRejectsUnknownFields(t *testing.T) {
	body := strings.Replace(validPreviewBody, `"moduleId": "f4970000`, `"sneaky": true, "moduleId": "f4970000`, 1)
	rr := previewRequest(previewStore(), body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleAuthoringPreviewRejectsQueryAndMethod(t *testing.T) {
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/preview?shelf=3", strings.NewReader(validPreviewBody)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	previewServer(previewStore()).HandleFurnitureAuthoringPreview(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("query status = %d, want 400", rr.Code)
	}

	get := withClaims(httptest.NewRequest(http.MethodGet, "/api/furniture/authoring/preview", nil), "eng", string(domain.RoleIngeniero))
	rr2 := httptest.NewRecorder()
	previewServer(previewStore()).HandleFurnitureAuthoringPreview(rr2, get)
	if rr2.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d, want 405", rr2.Code)
	}
}

func TestHandleAuthoringPreviewRequiresLicense(t *testing.T) {
	store := previewStore()
	past := time.Now().Add(-24 * time.Hour)
	expired := &domain.Organization{
		ID: "org-1", LicensePlan: domain.LicensePlanTrial, LicenseExpiresAt: &past, Status: domain.OrganizationStatusActive,
	}
	store.getOrgByID = expired
	rr := previewRequest(store, validPreviewBody)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
}

// The preview is stateless: identical previews echo the same catalog revision
// and the same would-be hash for the same draft.
func TestHandleAuthoringPreviewIsDeterministic(t *testing.T) {
	first := previewRequest(previewStore(), validPreviewBody)
	second := previewRequest(previewStore(), validPreviewBody)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("statuses = %d/%d, want 200/200", first.Code, second.Code)
	}
	hash := func(body string) string {
		i := strings.Index(body, `"definitionHash":"`)
		if i < 0 {
			t.Fatal("missing definitionHash")
		}
		return body[i : i+80]
	}
	if hash(first.Body.String()) != hash(second.Body.String()) {
		t.Fatal("same draft produced different would-be hashes")
	}
	if !strings.Contains(first.Body.String(), `"catalogRevision":"workshop-`) {
		t.Fatal("missing catalog revision echo")
	}
}
