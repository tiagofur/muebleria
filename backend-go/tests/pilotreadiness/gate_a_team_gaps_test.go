package pilotreadiness

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
)

func TestPilotReadiness_ManagerCapabilitiesUseRealOrganizationPolicy(t *testing.T) {
	store := createGateATeamOrganization(t, "gate-a-store", "store")
	tests := []struct {
		name         string
		organization pilotOrg
		role         string
		capabilities []string
		allowedRole  string
		deniedRole   string
	}{
		{
			name: "factory sales manager", organization: fx.a, role: "gerente_ventas",
			capabilities: []string{"team:view", "team:invite:sales", "team:manage:sales"},
			allowedRole:  "vendedor", deniedRole: "produccion",
		},
		{
			name: "factory production manager", organization: fx.a, role: "gerente_produccion",
			capabilities: []string{"team:view", "team:invite:production", "team:manage:production", "team:manage:sectors"},
			allowedRole:  "produccion", deniedRole: "vendedor",
		},
		{
			name: "store sales manager", organization: store, role: "gerente_ventas",
			capabilities: []string{"team:view", "team:invite:sales", "team:manage:sales"},
			allowedRole:  "vendedor", deniedRole: "admin",
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			email := "gate-a-manager-" + test.organization.slug + "-" + test.role + "@pilot-readiness.test"
			manager := fx.inviteAndAccept(t, test.organization.admin.token, email, test.role)
			var summary struct {
				Capabilities []string `json:"capabilities"`
			}
			fx.decode(t, http.MethodGet, "/api/org/team/summary", manager.Token, nil, http.StatusOK, &summary)
			if !slices.Equal(summary.Capabilities, test.capabilities) {
				t.Fatalf("capabilities=%v want=%v", summary.Capabilities, test.capabilities)
			}

			allowed := createAcceptanceInvitation(t, manager.Token,
				"gate-a-allowed-"+test.organization.slug+"-"+test.role+"@pilot-readiness.test", test.allowedRole)
			if allowed.Invitation.ID == "" {
				t.Fatal("allowed manager invitation was not created")
			}
			status, body := fx.do(t, http.MethodPost, "/api/org/invitations", manager.Token, map[string]any{
				"email": "gate-a-denied-" + test.organization.slug + "-" + test.role + "@pilot-readiness.test",
				"roles": []string{test.deniedRole},
			})
			if status != http.StatusForbidden {
				t.Fatalf("denied manager command index=%d status=%d body=%s", index, status, body)
			}
		})
	}
}

func TestPilotReadiness_SeatLimitRollsBackAcceptanceAndReactivation(t *testing.T) {
	ctx := t.Context()
	var originalLimit *int64
	if err := fx.pool.QueryRow(ctx, `SELECT max_active_members FROM organization_entitlements WHERE organization_id=$1`, fx.a.id).Scan(&originalLimit); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := fx.pool.Exec(context.Background(), `UPDATE organization_entitlements SET max_active_members=$2,version=version+1 WHERE organization_id=$1`, fx.a.id, originalLimit); err != nil {
			t.Errorf("restore seat limit: %v", err)
		}
	})

	email := "gate-a-seat-new@pilot-readiness.test"
	invitation := createAcceptanceInvitation(t, fx.a.admin.token, email, "user")
	setSeatLimitToCurrentActiveCount(t, fx.a.id)
	blocked := sendAcceptanceRequest(fx.base, "gate-a-seat-new-accept-0001", map[string]string{
		"token": invitation.Token, "password": pilotPassword, "name": "Blocked Seat",
	})
	if blocked.err != nil {
		t.Fatal(blocked.err)
	}
	requireTeamHTTPError(t, teamHTTPResult{status: blocked.status, body: blocked.body, header: blocked.header}, http.StatusConflict, "SEAT_LIMIT_REACHED")
	var users, memberships int
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE normalized_email=normalize_identity_email($1)`, email).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM memberships membership JOIN users app_user ON app_user.id=membership.user_id WHERE app_user.normalized_email=normalize_identity_email($1)`, email).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if users != 0 || memberships != 0 {
		t.Fatalf("seat-limited acceptance leaked users=%d memberships=%d", users, memberships)
	}

	if _, err := fx.pool.Exec(ctx, `UPDATE organization_entitlements SET max_active_members=NULL,version=version+1 WHERE organization_id=$1`, fx.a.id); err != nil {
		t.Fatal(err)
	}
	reactivatedEmail := "gate-a-seat-reactivate@pilot-readiness.test"
	accepted := fx.inviteAndAccept(t, fx.a.admin.token, reactivatedEmail, "user")
	membership := accepted.Memberships[0]
	suspended := sendTeamHTTPRequest(t, "/api/org/memberships/"+membership.ID+":suspend", fx.a.admin.token,
		"gate-a-seat-suspend-0001", 1, map[string]string{"reason": "seat-limit reactivation proof"})
	requireTeamHTTPStatus(t, suspended, http.StatusOK)
	setSeatLimitToCurrentActiveCount(t, fx.a.id)
	// A different role set must create a new invitation instead of replaying the
	// already accepted original invitation for this identity.
	reactivation := createAcceptanceInvitation(t, fx.a.admin.token, reactivatedEmail, "vendedor")
	blocked = sendAcceptanceRequest(fx.base, "gate-a-seat-reactivate-0001", map[string]string{
		"token": reactivation.Token, "password": pilotPassword,
	})
	if blocked.err != nil {
		t.Fatal(blocked.err)
	}
	requireTeamHTTPError(t, teamHTTPResult{status: blocked.status, body: blocked.body, header: blocked.header}, http.StatusConflict, "SEAT_LIMIT_REACHED")
	var status string
	var version int64
	if err := fx.pool.QueryRow(ctx, `SELECT status,version FROM memberships WHERE id=$1`, membership.ID).Scan(&status, &version); err != nil {
		t.Fatal(err)
	}
	if status != "suspended" || version != 2 {
		t.Fatalf("seat-limited reactivation mutated membership status=%s version=%d", status, version)
	}
	var blockedAudits int
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type='seat_limit_blocked' AND details->>'invitation_id' IN ($2,$3)`, fx.a.id, invitation.Invitation.ID, reactivation.Invitation.ID).Scan(&blockedAudits); err != nil {
		t.Fatal(err)
	}
	if blockedAudits != 2 {
		t.Fatalf("seat_limit_blocked audits=%d want=2", blockedAudits)
	}
}

func setSeatLimitToCurrentActiveCount(t *testing.T, organizationID string) {
	t.Helper()
	var active int64
	if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM memberships WHERE organization_id=$1 AND status='active'`, organizationID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(t.Context(), `UPDATE organization_entitlements SET max_active_members=$2,version=version+1 WHERE organization_id=$1`, organizationID, active); err != nil {
		t.Fatal(err)
	}
}

func createGateATeamOrganization(t *testing.T, slug, organizationType string) pilotOrg {
	t.Helper()
	hash, err := auth.HashPassword(pilotPassword)
	if err != nil {
		t.Fatal(err)
	}
	email := slug + "-owner@pilot-readiness.test"
	owner := mustStorageUser(fx, email, "Gate A "+organizationType+" owner", hash)
	var result struct {
		Organization struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"organization"`
		Readiness struct {
			Ready bool `json:"ready"`
		} `json:"readiness"`
	}
	fx.decode(t, http.MethodPost, "/api/organizations", fx.platform.token, map[string]any{
		"name": "Gate A " + organizationType, "slug": slug, "type": organizationType,
		"license_plan": "trial", "bootstrap_admin_user_id": owner.ID,
		"entitlements": map[string]any{
			"max_active_members": 20, "max_sales_partners": 0,
			"manufacturing_enabled": organizationType == "factory", "sales_network_enabled": false,
			"sketchup_seats": 0, "advanced_audit_enabled": false,
		},
	}, http.StatusCreated, &result)
	if result.Organization.Status != "active" || !result.Readiness.Ready {
		t.Fatalf("organization was not ready: %+v", result)
	}
	login := fx.login(t, email, slug)
	return pilotOrg{
		id: result.Organization.ID, slug: slug, name: "Gate A " + organizationType,
		admin: pilotUser{id: owner.ID, email: email, token: login.Token},
	}
}
