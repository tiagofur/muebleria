package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #388 / DT-4: shared model-binding contract fixture (Go is the golden
// author). The fixture pins the exact wire shape of binding:validate that
// the Ruby plugin parses fail-closed (model_binding_contract_test.rb).

const modelBindingFixturePath = "../../../contracts/sketchupModelBinding.contract.json"

type modelBindingFixtureFile struct {
	SchemaVersion       int                           `json:"schemaVersion"`
	Comment             string                        `json:"comment"`
	Endpoint            string                        `json:"endpoint"`
	ModelDictionary     string                        `json:"modelDictionary"`
	BindingKey          string                        `json:"bindingKey"`
	ServerSchemaVersion int                           `json:"serverSchemaVersion"`
	Scenarios           []modelBindingFixtureScenario `json:"scenarios"`
}

type modelBindingFixtureScenario struct {
	ID             string          `json:"id"`
	Request        json.RawMessage `json:"request"`
	ResponseStatus int             `json:"responseStatus"`
	Response       json.RawMessage `json:"response"`
}

// modelBindingScenarioResponse runs the real handler over a stubStore whose
// context is shaped by mutate, capturing the exact wire response. The shared
// stub is reset first so scenarios stay independent.
func modelBindingScenarioResponse(t *testing.T, srv *Server, body string, mutate func(*stubStore, *storage.ModelBindingContext)) (int, []byte) {
	t.Helper()
	store := srv.Store.(*stubStore)
	store.modelBindingContext = nil
	store.modelBindingContextErr = nil
	ctx := validBindingContext()
	if mutate != nil {
		mutate(store, ctx)
	} else {
		store.modelBindingContext = ctx
	}
	req := bindingValidationRequest(http.MethodPost,
		"/api/projects/"+designTestProjectID+"/designs/"+designTestDesignID+"/binding:validate",
		body, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleProjectDesignBindingValidate(rr, req)
	return rr.Code, rr.Body.Bytes()
}

func TestModelBindingContractFixtureGolden(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	run := func(body string, mutate func(*stubStore, *storage.ModelBindingContext)) modelBindingFixtureScenarioResult {
		status, raw := modelBindingScenarioResponse(t, srv, body, mutate)
		return modelBindingFixtureScenarioResult{Status: status, Body: mustJSON(t, raw)}
	}

	type scenarioSpec struct {
		id      string
		request string
		result  modelBindingFixtureScenarioResult
	}
	specs := []scenarioSpec{
		{
			id:      "01-first-bind-valid",
			request: `{"client_schema_version":1}`,
			result:  run(`{"client_schema_version":1}`, nil),
		},
		{
			id:      "02-bound-base-validated",
			request: `{"client_schema_version":1,"base_revision_id":"` + designTestRevisionID + `"}`,
			result:  run(`{"client_schema_version":1,"base_revision_id":"`+designTestRevisionID+`"}`, nil),
		},
		{
			id:      "03-design-archived",
			request: `{"client_schema_version":1}`,
			result: run(`{"client_schema_version":1}`, func(store *stubStore, ctx *storage.ModelBindingContext) {
				ctx.Design.Status = domain.DesignStatusArchived
				store.modelBindingContext = ctx
			}),
		},
		{
			id:      "04-foreign-design-uniform-404",
			request: `{"client_schema_version":1}`,
			result: run(`{"client_schema_version":1}`, func(store *stubStore, _ *storage.ModelBindingContext) {
				store.modelBindingContext = nil
				store.modelBindingContextErr = domain.ErrDesignNotFound
			}),
		},
		{
			id:      "05-no-published-revision",
			request: `{"client_schema_version":1}`,
			result: run(`{"client_schema_version":1}`, func(store *stubStore, ctx *storage.ModelBindingContext) {
				ctx.WorkingCopyBaseRevisionID = nil
				ctx.BaseRevisionNumber = nil
				store.modelBindingContext = ctx
			}),
		},
	}

	scenarios := make([]modelBindingFixtureScenario, 0, len(specs))
	for _, spec := range specs {
		scenarios = append(scenarios, modelBindingFixtureScenario{
			ID:             spec.id,
			Request:        json.RawMessage(spec.request),
			ResponseStatus: spec.result.Status,
			Response:       spec.result.Body,
		})
	}

	fixture := modelBindingFixtureFile{
		SchemaVersion: 1,
		Comment: "Shared #388 model binding contract fixture. Generated from the Go handler's " +
			"own HTTP responses (golden author); consumed by Go (this test) and Ruby " +
			"(model_binding_contract_test.rb parses every 200 response fail-closed and pins the " +
			"error rule: a non-200 response must never write binding metadata). " +
			"Regenerate: UPDATE_MODEL_BINDING_GOLDEN=1 go test ./internal/api -run TestModelBindingContractFixtureGolden",
		Endpoint:            "POST /api/projects/{projectId}/designs/{designId}/binding:validate",
		ModelDictionary:     "com.granete.project",
		BindingKey:          "granete.project-binding.v1",
		ServerSchemaVersion: ModelBindingSchemaVersion,
		Scenarios:           scenarios,
	}

	body, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	body = append(body, '\n')

	if os.Getenv("UPDATE_MODEL_BINDING_GOLDEN") == "1" {
		if err := os.WriteFile(modelBindingFixturePath, body, 0o644); err != nil {
			t.Fatalf("update golden: %v", err)
		}
	}

	raw, err := os.ReadFile(modelBindingFixturePath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if strings.TrimSpace(string(raw)) != strings.TrimSpace(string(body)) {
		t.Fatal("model binding contract fixture drifted from the handler output; regenerate with UPDATE_MODEL_BINDING_GOLDEN=1 and review the diff")
	}

	// Wire-shape pins the Ruby parser relies on.
	var probe struct {
		ServerSchemaVersion int `json:"serverSchemaVersion"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("decode golden: %v", err)
	}
	if probe.ServerSchemaVersion != ModelBindingSchemaVersion {
		t.Fatalf("fixture serverSchemaVersion = %d, want %d", probe.ServerSchemaVersion, ModelBindingSchemaVersion)
	}
}

type modelBindingFixtureScenarioResult struct {
	Status int
	Body   json.RawMessage
}

func mustJSON(t *testing.T, raw []byte) json.RawMessage {
	t.Helper()
	if !json.Valid(raw) {
		t.Fatalf("handler did not return valid JSON: %s", raw)
	}
	// Normalize formatting so the fixture stays deterministic.
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("decode handler response: %v", err)
	}
	out, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("normalize handler response: %v", err)
	}
	return json.RawMessage(out)
}
