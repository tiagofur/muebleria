package api

import (
	"encoding/json"
	"os"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

func TestRefreshOpenAPIContractIsOpaqueAndTyped(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/openapi/granete-api.v1.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	paths := spec["paths"].(map[string]any)
	refresh := paths["/auth/refresh"].(map[string]any)["post"].(map[string]any)
	if security, ok := refresh["security"].([]any); !ok || len(security) != 0 {
		t.Fatal("refresh must authenticate with the opaque request credential, not BearerAuth")
	}
	body := refresh["requestBody"].(map[string]any)
	if required, _ := body["required"].(bool); !required {
		t.Fatal("refresh request body must be required")
	}
	if _, ok := paths["/auth/logout"]; !ok {
		t.Fatal("logout operation missing")
	}

	// Compile-time lock that generated Go types and typed error vocabulary
	// came from the canonical contract rather than hand-written DTOs.
	_ = openapi.RefreshRequest{RefreshToken: "opaque", Transport: openapi.AuthTransportWeb}
	for _, code := range []openapi.ApiErrorCode{
		openapi.ApiErrorCodeRefreshInvalid,
		openapi.ApiErrorCodeRefreshExpired,
		openapi.ApiErrorCodeRefreshRevoked,
		openapi.ApiErrorCodeRefreshReused,
	} {
		if code == "" {
			t.Fatal("generated refresh error code missing")
		}
	}
}
