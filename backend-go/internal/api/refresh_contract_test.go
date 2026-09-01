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
		t.Fatal("refresh must authenticate with the presented credential, not BearerAuth")
	}
	// SEC-4A: the JSON body is the mobile transport contract only. The body is
	// optional because the Web cookie flow POSTs with no body at all.
	if required, _ := refresh["requestBody"].(map[string]any)["required"].(bool); required {
		t.Fatal("refresh request body must be optional (web cookie flow is bodyless)")
	}
	schemas := spec["components"].(map[string]any)["schemas"].(map[string]any)
	refreshTransport := schemas["RefreshTransport"].(map[string]any)
	if enum, _ := refreshTransport["enum"].([]any); len(enum) != 1 || enum[0] != "mobile" {
		t.Fatalf("RefreshTransport must be mobile-only, got %v", enum)
	}
	logout := paths["/auth/logout"].(map[string]any)["post"].(map[string]any)
	if required, _ := logout["requestBody"].(map[string]any)["required"].(bool); required {
		t.Fatal("logout request body must be optional (web cookie flow is bodyless)")
	}

	// Compile-time lock that generated Go types and typed error vocabulary
	// came from the canonical contract rather than hand-written DTOs.
	_ = openapi.RefreshRequest{RefreshToken: "opaque", Transport: openapi.RefreshTransportMobile}
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
