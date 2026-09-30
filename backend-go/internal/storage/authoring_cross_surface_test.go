package storage_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #497 T8 — the cross-surface chain, proven on a real PostgreSQL under the
// runtime role with ONE golden artifact
// (contracts/furnitureAuthoringCrossSurface.fixture.json):
//
//	React-authored module write (the exact CatalogModuleWrite wire the web
//	emits) → POST /catalog/modules (created, versioned) → the published
//	catalog serves the definition (parameters + definitionHash) → the
//	versioned authoring resolve ACCEPTS the sample values against the
//	advanced revision → the served module wire round-trips → the persisted
//	definitions are byte-identical to what React authored.
//
// The same fixture is consumed by the TS domain/storage contracts, the Ruby
// extension catalog contract and the SketchUp dialog JS harness — every
// surface, one authority. Regenerate the generated block with
// UPDATE_CROSS_SURFACE_GOLDEN=1.
func TestFurnitureAuthoringCrossSurfaceChain(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "contracts", "furnitureAuthoringCrossSurface.fixture.json")
	rawFixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		ComponentShelf map[string]any `json:"componentShelf"`
		ComponentDoor  map[string]any `json:"componentDoor"`
		ModuleWrite    map[string]any `json:"moduleWrite"`
		Samples        map[string]any `json:"samples"`
		Expected       struct {
			DefinitionHash      string          `json:"definitionHash"`
			PublishedParameters json.RawMessage `json:"publishedParameters"`
			ModuleServed        map[string]any  `json:"moduleServed"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(rawFixture, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	moduleID, _ := fixture.ModuleWrite["id"].(string)
	if moduleID == "" {
		t.Fatal("fixture moduleWrite.id missing")
	}

	realStore, _ := migratedConnectStore(t)
	store := &previewParityStore{PostgresStore: realStore}
	actor := connectStoreInitialActor
	userID := "f4970000-0000-0000-0000-0000000000u1"
	server := &api.Server{Store: store}

	seedComponentFromFixture(t, store, fixture.ComponentShelf)
	seedComponentFromFixture(t, store, fixture.ComponentDoor)
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, moduleID)
		cleanupConnectStoreFixture(t, `DELETE FROM components WHERE id IN ($1::uuid, $2::uuid)`,
			fixture.ComponentShelf["id"], fixture.ComponentDoor["id"])
	})

	// Segment 0 — the catalog revision BEFORE the authored save.
	revisionBefore := withinConnectStoreTenantValue(t, store.PostgresStore, actor, func(txCtx context.Context) (string, error) {
		var catalog struct {
			RevisionID string `json:"revisionId"`
		}
		if err := json.Unmarshal(crossSurfaceGetDefinitions(t, txCtx, server, userID), &catalog); err != nil {
			t.Fatalf("parse definitions for revision: %v", err)
		}
		return catalog.RevisionID, nil
	})

	// Segment 1 — the React write: the exact wire the web client emits,
	// accepted by the generated-contract transport semantics (POST create,
	// strong ETag back).
	moduleWriteJSON, err := json.Marshal(fixture.ModuleWrite)
	if err != nil {
		t.Fatalf("marshal moduleWrite: %v", err)
	}
	var createETag string
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		req := httptest.NewRequest(http.MethodPost, "/api/catalog/modules", bytes.NewReader(moduleWriteJSON))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(txCtx, api.UserContextKey, &auth.Claims{UserID: userID, Role: string(domain.RoleIngeniero), Roles: []string{string(domain.RoleIngeniero)}}))
		rr := httptest.NewRecorder()
		server.HandleModules(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("module create status = %d (body=%s)", rr.Code, rr.Body.String())
		}
		createETag = rr.Header().Get("ETag")
		return nil
	})
	if createETag != `"v1"` {
		t.Fatalf("created module ETag = %q, want \"v1\"", createETag)
	}

	// Segment 2 — the published catalog serves the definition and the
	// revision advanced.
	var revisionAfter string
	var servedDefinition map[string]any
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		var catalog struct {
			RevisionID  string                     `json:"revisionId"`
			Definitions map[string]json.RawMessage `json:"definitions"`
		}
		if err := json.Unmarshal(crossSurfaceGetDefinitions(t, txCtx, server, userID), &catalog); err != nil {
			t.Fatalf("parse definitions: %v", err)
		}
		revisionAfter = catalog.RevisionID
		return json.Unmarshal(catalog.Definitions[moduleID], &servedDefinition)
	})
	if revisionAfter == "" || revisionAfter == revisionBefore {
		t.Fatalf("catalog revision did not advance: before=%q after=%q", revisionBefore, revisionAfter)
	}
	servedHash, _ := servedDefinition["definitionHash"].(string)
	servedParameters, err := json.Marshal(servedDefinition["parameters"])
	if err != nil {
		t.Fatalf("marshal served parameters: %v", err)
	}

	// Segment 3 — the versioned authoring resolve ACCEPTS the sample values
	// against the advanced revision (the SketchUp submit path).
	resolveJSON, err := json.Marshal(map[string]any{
		"schemaId":         "granete.sketchup-authoring-resolve.v1",
		"schemaName":       "granete.sketchup-authoring-resolve",
		"schemaVersion":    "1.0",
		"messageId":        "cross-surface-497",
		"idempotencyKey":   "cross-surface-497-key",
		"sentAt":           "2026-09-30T00:00:00Z",
		"source":           map[string]any{"client": "granete-cross-surface-test", "clientVersion": "1", "host": "test", "hostVersion": "1"},
		"units":            map[string]any{"length": "mm", "angle": "deg", "precisionMm": 0.01},
		"coordinateSystem": map[string]any{"handedness": "right", "upAxis": "z", "projectFrameId": "cross-surface-frame"},
		"furniture": map[string]any{
			"furnitureDefinitionId": moduleID,
			"catalogRevision":       revisionAfter,
			"parameters":            fixture.Samples,
		},
	})
	if err != nil {
		t.Fatalf("marshal resolve request: %v", err)
	}
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/resolve", bytes.NewReader(resolveJSON))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(txCtx, api.UserContextKey, &auth.Claims{UserID: userID, Role: string(domain.RoleIngeniero), Roles: []string{string(domain.RoleIngeniero)}}))
		rr := httptest.NewRecorder()
		server.HandleFurnitureAuthoringResolve(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("resolve status = %d (body=%s)", rr.Code, rr.Body.String())
		}
		var response struct {
			Status   string         `json:"status"`
			Resolved map[string]any `json:"resolved"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
			t.Fatalf("parse resolve response: %v", err)
		}
		if response.Status != "accepted" || response.Resolved == nil {
			t.Fatalf("resolve did not accept the sample values: status=%q", response.Status)
		}
		return nil
	})

	// Segment 4 — the served module wire (what React reads back later),
	// timestamps stripped for determinism.
	var moduleServed map[string]any
	withinConnectStoreTenant(t, store.PostgresStore, actor, func(txCtx context.Context) error {
		var listed []map[string]any
		if err := json.Unmarshal(crossSurfaceGetModules(t, txCtx, server, userID), &listed); err != nil {
			t.Fatalf("parse modules list: %v", err)
		}
		for _, module := range listed {
			if module["id"] == moduleID {
				moduleServed = module
				break
			}
		}
		return nil
	})
	if moduleServed == nil {
		t.Fatal("authored module not served by GET /catalog/modules")
	}
	// #497 audit follow-up: the LIST must serve the real version token (a 0
	// here means GetFullCatalog dropped it and clients cannot seed their
	// cache from one read).
	if servedVersion, _ := moduleServed["version"].(float64); servedVersion != 1 {
		t.Fatalf("served module version = %v, want 1 (GetFullCatalog must carry version)", moduleServed["version"])
	}
	delete(moduleServed, "created_at")
	delete(moduleServed, "updated_at")

	// Golden: the generated block is EXACTLY what the server produced.
	if os.Getenv("UPDATE_CROSS_SURFACE_GOLDEN") == "1" {
		var whole map[string]any
		if err := json.Unmarshal(rawFixture, &whole); err != nil {
			t.Fatalf("parse whole fixture for update: %v", err)
		}
		var parametersBlock any
		if err := json.Unmarshal(servedParameters, &parametersBlock); err != nil {
			t.Fatalf("parameters to interface: %v", err)
		}
		whole["expected"] = map[string]any{
			"definitionHash":      servedHash,
			"publishedParameters": parametersBlock,
			"moduleServed":        moduleServed,
		}
		out, err := json.MarshalIndent(whole, "", "  ")
		if err != nil {
			t.Fatalf("marshal fixture: %v", err)
		}
		if err := os.WriteFile(fixturePath, append(out, '\n'), 0o644); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
		return
	}
	if fixture.Expected.DefinitionHash == "" || len(fixture.Expected.PublishedParameters) == 0 {
		t.Fatal("fixture expected block missing — run once with UPDATE_CROSS_SURFACE_GOLDEN=1")
	}
	var goldenParameters []map[string]any
	if err := json.Unmarshal(fixture.Expected.PublishedParameters, &goldenParameters); err != nil {
		t.Fatalf("parse golden published parameters: %v", err)
	}
	goldenCompact, _ := json.Marshal(goldenParameters)
	servedCompact, _ := json.Marshal(servedDefinition["parameters"])
	if !bytes.Equal(goldenCompact, servedCompact) {
		t.Fatalf("published parameters drifted — regenerate deliberately (UPDATE_CROSS_SURFACE_GOLDEN=1) after reviewing the change")
	}
	if fixture.Expected.DefinitionHash != servedHash {
		t.Fatalf("definitionHash drifted: golden=%q served=%q", fixture.Expected.DefinitionHash, servedHash)
	}
	goldenModule, err := json.Marshal(fixture.Expected.ModuleServed)
	if err != nil {
		t.Fatalf("marshal golden module: %v", err)
	}
	servedRemarshal, err := json.Marshal(moduleServed)
	if err != nil {
		t.Fatalf("marshal served module: %v", err)
	}
	if !bytes.Equal(bytes.TrimSpace(goldenModule), bytes.TrimSpace(servedRemarshal)) {
		t.Fatalf("served module wire drifted — regenerate deliberately\nG:%s\nS:%s", goldenModule, servedRemarshal)
	}

	// Cross-surface identity: the persisted definitions are byte-identical
	// to the wire the React editor authored (no transformation in between).
	persisted := withinConnectStoreTenantValue(t, store.PostgresStore, actor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, moduleID)
	})
	var persistedCanonical, authoredCanonical []map[string]any
	persistedJSON, _ := json.Marshal(persisted.ParameterDefinitions)
	authoredJSON, _ := json.Marshal(fixture.ModuleWrite["parameter_definitions"])
	if err := json.Unmarshal(persistedJSON, &persistedCanonical); err != nil {
		t.Fatalf("canonicalize persisted: %v", err)
	}
	if err := json.Unmarshal(authoredJSON, &authoredCanonical); err != nil {
		t.Fatalf("canonicalize authored: %v", err)
	}
	persistedRemarshal, _ := json.Marshal(persistedCanonical)
	authoredRemarshal, _ := json.Marshal(authoredCanonical)
	if !bytes.Equal(persistedRemarshal, authoredRemarshal) {
		t.Fatalf("persisted definitions drifted from the authored wire:\n%s\n%s", persistedRemarshal, authoredRemarshal)
	}
}

func seedComponentFromFixture(t *testing.T, store *previewParityStore, spec map[string]any) {
	t.Helper()
	number := func(key string) int {
		value, _ := spec[key].(float64)
		return int(value)
	}
	text := func(key string) string {
		value, _ := spec[key].(string)
		return value
	}
	withinConnectStoreTenant(t, store.PostgresStore, connectStoreInitialActor, func(txCtx context.Context) error {
		return store.CreateComponent(txCtx, &domain.Component{
			ID: text("id"), Code: text("code"), Name: text("name"),
			Placement: domain.ComponentPlacement(text("placement")), GeometryKind: text("geometry_kind"),
			LengthMm: number("length_mm"), WidthMm: number("width_mm"), ThicknessMm: number("thickness_mm"),
		})
	})
}

func crossSurfaceGetDefinitions(t *testing.T, ctx context.Context, server *api.Server, userID string) []byte {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req = req.WithContext(context.WithValue(ctx, api.UserContextKey, &auth.Claims{UserID: userID, Role: string(domain.RoleIngeniero), Roles: []string{string(domain.RoleIngeniero)}}))
	rr := httptest.NewRecorder()
	server.HandleFurnitureDefinitions(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("definitions status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	return rr.Body.Bytes()
}

func crossSurfaceGetModules(t *testing.T, ctx context.Context, server *api.Server, userID string) []byte {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog/modules", nil)
	req = req.WithContext(context.WithValue(ctx, api.UserContextKey, &auth.Claims{UserID: userID, Role: string(domain.RoleIngeniero), Roles: []string{string(domain.RoleIngeniero)}}))
	rr := httptest.NewRecorder()
	server.HandleModules(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("modules status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	return rr.Body.Bytes()
}
