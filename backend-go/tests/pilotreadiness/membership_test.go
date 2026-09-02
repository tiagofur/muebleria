// Membership semantics (F179 / ADR-0005 §3): a user sees only the
// organizations of their memberships, multi-org users must explicitly select
// a context, effective roles come from the ACTIVE membership (union
// semantics), and deactivation/role changes apply to live tokens immediately.

package pilotreadiness

import (
	"net/http"
	"sort"
	"testing"
)

// A single-membership user of A cannot reach B by any token flow.
func TestPilotReadiness_MembershipSingleOrg(t *testing.T) {
	// select-org into a foreign organization → 403.
	fx.want(t, http.MethodPost, "/api/auth/select-org", fx.a.admin.token, map[string]string{
		"organization_id": fx.b.id,
	}, http.StatusForbidden)

	// Login with a foreign org hint → uniform 401 (no enumeration).
	status, _ := fx.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": fx.a.admin.email, "password": pilotPassword, "org": fx.b.slug, "transport": "web",
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("login of %s with org hint %s: got %d want 401", fx.a.admin.email, fx.b.slug, status)
	}
}

// A user with memberships in A and B must switch context explicitly; roles
// differ per membership and drive real authorization decisions.
func TestPilotReadiness_MembershipExplicitContext(t *testing.T) {
	// Onboard the dual user into A (admin) and then B (vendedor — a role
	// that can access customers, so cross-org 404s are observable).
	acceptA := fx.inviteAndAccept(t, fx.a.admin.token, "dual@pilot-readiness.test", "admin")
	if acceptA.Organization == nil || acceptA.Organization.Slug != fx.a.slug {
		t.Fatalf("dual user: first acceptance should scope to %s, got %+v", fx.a.slug, acceptA)
	}
	acceptB := fx.inviteAndAccept(t, fx.b.admin.token, "dual@pilot-readiness.test", "vendedor")
	if acceptB.SelectionRequired || acceptB.Organization == nil || acceptB.Organization.Slug != fx.b.slug {
		t.Fatalf("dual user: invitation acceptance must enter the inviting org directly, got %+v", acceptB)
	}

	// Plain login (no hint): org-less token + selection_required + both orgs.
	login := fx.login(t, "dual@pilot-readiness.test", "")
	if !login.SelectionRequired {
		t.Fatalf("dual user: login must demand org selection, got %+v", login)
	}
	if len(login.Memberships) != 2 {
		t.Fatalf("dual user: expected 2 memberships, got %d", len(login.Memberships))
	}
	if login.Token == "" {
		t.Fatal("dual user: no org-less token issued for the selection step")
	}

	// The org-less token carries no business scope (fail-closed, ADR-0005).
	fx.want(t, http.MethodGet, "/api/customers", login.Token, nil, http.StatusForbidden)
	fx.want(t, http.MethodGet, "/api/settings", login.Token, nil, http.StatusForbidden)

	// Context A: effective roles are the A membership's.
	tokA := fx.scopedToken(t, "dual@pilot-readiness.test", fx.a.slug)
	var meA struct {
		Roles []string `json:"roles"`
	}
	fx.decode(t, http.MethodGet, "/api/auth/me", tokA, nil, http.StatusOK, &meA)
	if len(meA.Roles) != 1 || meA.Roles[0] != "admin" {
		t.Fatalf("dual user in A: roles %v want [admin]", meA.Roles)
	}
	fx.want(t, http.MethodGet, "/api/org/memberships", tokA, nil, http.StatusOK)

	// Context B: same person, different effective roles.
	tokB := fx.scopedToken(t, "dual@pilot-readiness.test", fx.b.slug)
	var meB struct {
		Roles []string `json:"roles"`
	}
	fx.decode(t, http.MethodGet, "/api/auth/me", tokB, nil, http.StatusOK, &meB)
	if len(meB.Roles) != 1 || meB.Roles[0] != "vendedor" {
		t.Fatalf("dual user in B: roles %v want [vendedor]", meB.Roles)
	}
	fx.want(t, http.MethodGet, "/api/org/memberships", tokB, nil, http.StatusForbidden)

	// The B-scoped token still cannot read A's data.
	fx.want(t, http.MethodGet, "/api/customers/"+fx.a.customer.id, tokB, nil, http.StatusNotFound)
}

// roles[] of a membership is a union of capabilities (multi-role chips).
func TestPilotReadiness_MembershipRoleUnion(t *testing.T) {
	fx.inviteAndAccept(t, fx.a.admin.token, "union@pilot-readiness.test", "vendedor", "almacen")
	login := fx.login(t, "union@pilot-readiness.test", fx.a.slug)
	got := append([]string(nil), login.Roles...)
	sort.Strings(got)
	want := []string{"almacen", "vendedor"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("union membership: login roles %v want %v", got, want)
	}

	var me struct {
		Roles []string `json:"roles"`
	}
	fx.decode(t, http.MethodGet, "/api/auth/me", login.Token, nil, http.StatusOK, &me)
	sort.Strings(me.Roles)
	if len(me.Roles) != 2 || me.Roles[0] != want[0] || me.Roles[1] != want[1] {
		t.Fatalf("union membership: /me roles %v want %v", me.Roles, want)
	}
}

// Deactivating a membership cuts access on the next request (live re-read),
// without touching the same user's other context or other users.
func TestPilotReadiness_MembershipDeactivationCutsAccess(t *testing.T) {
	accept := fx.inviteAndAccept(t, fx.b.admin.token, "member-b@pilot-readiness.test", "user")
	tok := fx.scopedToken(t, "member-b@pilot-readiness.test", fx.b.slug)
	fx.want(t, http.MethodGet, "/api/settings", tok, nil, http.StatusOK)

	fx.want(t, http.MethodPut, "/api/org/memberships/"+accept.Memberships[0].ID+"/status", fx.b.admin.token,
		map[string]string{"status": "suspended", "reason": "pilot proof"}, http.StatusOK)

	// Live token dies immediately (middleware re-reads the membership).
	fx.want(t, http.MethodGet, "/api/settings", tok, nil, http.StatusUnauthorized)

	// The deactivation is per-membership: B's admin keeps working.
	fx.want(t, http.MethodGet, "/api/settings", fx.b.admin.token, nil, http.StatusOK)

	// The user no longer has any selectable organization.
	status, body := fx.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": "member-b@pilot-readiness.test", "password": pilotPassword, "transport": "web",
	})
	if status != http.StatusForbidden {
		t.Fatalf("deactivated member login: got %d want 403 body=%s", status, truncate(body))
	}
}

// A role change applies to already-issued tokens on their next request
// (roles are resolved live from the membership, never trusted from the JWT).
func TestPilotReadiness_RoleChangeRevalidatesTokens(t *testing.T) {
	accept := fx.inviteAndAccept(t, fx.a.admin.token, "promote@pilot-readiness.test", "user")
	tok := fx.scopedToken(t, "promote@pilot-readiness.test", fx.a.slug)
	fx.want(t, http.MethodGet, "/api/org/memberships", tok, nil, http.StatusForbidden)

	// Role changes are organization_admin step-up gated (#460 SEC-7).
	fx.pilotStepUp(t, fx.a.admin, fx.mfaFor(t, fx.a.admin), "organization_admin")
	fx.want(t, http.MethodPut, "/api/org/memberships/"+accept.Memberships[0].ID+"/roles", fx.a.admin.token,
		map[string][]string{"roles": {"admin"}}, http.StatusOK)

	// Same bearer, next request: admin capabilities now apply.
	fx.want(t, http.MethodGet, "/api/org/memberships", tok, nil, http.StatusOK)
	login := fx.login(t, "promote@pilot-readiness.test", fx.a.slug)
	if len(login.Roles) != 1 || login.Roles[0] != "admin" {
		t.Fatalf("role change: fresh login roles %v want [admin]", login.Roles)
	}
}
