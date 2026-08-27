// Platform admin & support sessions (F179 / ADR-0005 §5): platform staff
// administer organizations from the console but never read business data
// without an audited, time-boxed support session — and a session on org A
// grants nothing on org B. Logout and expiry cut the context immediately.

package pilotreadiness

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

// Platform staff manage orgs, but the org-less console token has no business
// scope (fail-closed).
func TestPilotReadiness_PlatformAdminNoBusinessAccess(t *testing.T) {
	var orgs []struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	}
	fx.decode(t, http.MethodGet, "/api/platform/organizations", fx.platform.token, nil, http.StatusOK, &orgs)
	var hasA, hasB bool
	for _, o := range orgs {
		hasA = hasA || o.Slug == fx.a.slug
		hasB = hasB || o.Slug == fx.b.slug
	}
	if !hasA || !hasB {
		t.Fatalf("platform console: expected %s and %s in the org list, got %d orgs", fx.a.slug, fx.b.slug, len(orgs))
	}

	// Org-less platform token must not reach business data.
	for _, path := range []string{"/api/customers", "/api/projects", "/api/settings", "/api/catalog/materials"} {
		fx.want(t, http.MethodGet, path, fx.platform.token, nil, http.StatusForbidden)
	}
}

// A support session on A acts as admin of A only: no B data, no switching to
// B, audited start/end, and dead after logout or expiry.
func TestPilotReadiness_SupportSessionScopedAndAudited(t *testing.T) {
	token, sessionID := fx.startSupportSession(t, fx.a.id, "pilot readiness support check")
	if token == "" || sessionID == "" {
		t.Fatal("support session: no token/session id returned")
	}

	// Effective admin of A.
	fx.want(t, http.MethodGet, "/api/org/team", token, nil, http.StatusOK)

	// A's data is reachable, B's is not — 404, never a leak.
	var customers []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	fx.decode(t, http.MethodGet, "/api/customers", token, nil, http.StatusOK, &customers)
	for _, c := range customers {
		if c.ID == fx.b.customer.id || c.Name == fx.b.customer.name {
			t.Fatal("support session on A exposed a customer of B")
		}
	}
	fx.want(t, http.MethodGet, "/api/customers/"+fx.b.customer.id, token, nil, http.StatusNotFound)
	fx.want(t, http.MethodGet, "/api/projects/"+fx.b.project.id, token, nil, http.StatusNotFound)

	// A support token cannot re-scope itself into B.
	fx.want(t, http.MethodPost, "/api/auth/select-org", token, map[string]string{
		"organization_id": fx.b.id,
	}, http.StatusForbidden)

	// The start is audited on A's trail (and only on A's).
	assertAuditEvent(t, fx.a.id, "support_session_started", sessionID)
	assertNoAuditEvent(t, fx.b.id, sessionID)

	// Explicit logout ends the context immediately.
	fx.endSupportSession(t, sessionID)
	fx.want(t, http.MethodGet, "/api/customers", token, nil, http.StatusUnauthorized)
	assertAuditEvent(t, fx.a.id, "support_session_ended", sessionID)
}

// Expiry ends the context the same way logout does. Simulated by moving the
// session row's expires_at to the past — direct SQL is the only honest way
// to time-travel here.
func TestPilotReadiness_SupportSessionExpiry(t *testing.T) {
	token, sessionID := fx.startSupportSession(t, fx.b.id, "pilot readiness expiry check")
	fx.exec(t, `UPDATE support_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, sessionID)
	fx.want(t, http.MethodGet, "/api/customers", token, nil, http.StatusUnauthorized)
}

// auditEvent is one row of GET /api/platform/organizations/{id}/audit.
type auditEvent struct {
	EventType string `json:"event_type"`
	// Details arrives base64-encoded (the storage layer scans jsonb as bytes).
	Details string `json:"details"`
}

func (e auditEvent) detailMap(t *testing.T) map[string]any {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(e.Details)
	if err != nil {
		// Tolerate a plain JSON object if the transport ever changes.
		raw = []byte(e.Details)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("audit details not decodable: %v (raw=%q)", err, e.Details)
	}
	return m
}

func listAuditEvents(t *testing.T, orgID string) []auditEvent {
	t.Helper()
	var events []auditEvent
	fx.decode(t, http.MethodGet, "/api/platform/organizations/"+orgID+"/audit", fx.platform.token, nil, http.StatusOK, &events)
	return events
}

func assertAuditEvent(t *testing.T, orgID, eventType, sessionID string) {
	t.Helper()
	for _, ev := range listAuditEvents(t, orgID) {
		if ev.EventType != eventType {
			continue
		}
		if sid, _ := ev.detailMap(t)["session_id"].(string); sid == sessionID {
			return
		}
	}
	t.Fatalf("audit of %s: no %s event for session %s", orgID, eventType, sessionID)
}

func assertNoAuditEvent(t *testing.T, orgID, sessionID string) {
	t.Helper()
	for _, ev := range listAuditEvents(t, orgID) {
		if sid, _ := ev.detailMap(t)["session_id"].(string); sid == sessionID {
			t.Fatalf("audit of %s: session %s of another org must not appear here", orgID, sessionID)
		}
	}
}
