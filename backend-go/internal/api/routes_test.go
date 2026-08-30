package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMembershipCommandRouterDispatchesExactCommandAndSetsMembershipID(t *testing.T) {
	commands := map[string]http.Handler{
		"change-roles": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.PathValue("membershipId"); got != "membership-123" {
				t.Fatalf("membershipId = %q, want membership-123", got)
			}
			w.WriteHeader(http.StatusNoContent)
		}),
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/org/memberships/{membershipCommand...}", membershipCommandRouter(commands))

	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/org/memberships/membership-123:change-roles", nil))

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

func TestRegisterRoutesAcceptsTeamCommandPaths(t *testing.T) {
	router := RegisterRoutes(&Server{})
	commands := []string{
		"change-roles",
		"suspend",
		"reactivate",
		"revoke-sessions",
		"offboarding-preview",
	}
	for _, command := range commands {
		t.Run(command, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			path := "/api/org/memberships/membership-123:" + command
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, nil))
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want authenticated command dispatch (%d)", recorder.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestRegisterRoutesRejectsUnknownTeamCommand(t *testing.T) {
	router := RegisterRoutes(&Server{})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/org/memberships/membership-123:unknown", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
}
