package pilotreadiness

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestPilotReadiness_ConcurrentInvitationAcceptCreatesOneIdentityAndMembership(t *testing.T) {
	var invitation struct {
		InvitationToken string `json:"invitation_token"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.a.admin.token, map[string]any{"email": "concurrent-accept@pilot-readiness.test", "roles": []string{"user"}}, http.StatusCreated, &invitation)
	sum := sha256.Sum256([]byte(invitation.InvitationToken))
	passwordHash, err := auth.HashPassword(pilotPassword)
	if err != nil {
		t.Fatal(err)
	}
	cmd := storage.AcceptInvitationCommand{TokenHash: hex.EncodeToString(sum[:]), Password: pilotPassword, NewPasswordHash: passwordHash, Name: "Concurrent Member"}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := fx.store.AcceptInvitation(context.Background(), cmd, auth.CheckPasswordHash, auth.ValidatePassword)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success, used := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, storage.ErrInvitationAlreadyUsed) {
			used++
		} else {
			t.Fatalf("unexpected concurrent error: %v", err)
		}
	}
	if success != 1 || used != 1 {
		t.Fatalf("success=%d already_used=%d", success, used)
	}
	var users, memberships int
	if err := fx.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE normalized_email='concurrent-accept@pilot-readiness.test'`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(context.Background(), `SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.normalized_email='concurrent-accept@pilot-readiness.test' AND m.organization_id=$1`, fx.a.id).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if users != 1 || memberships != 1 {
		t.Fatalf("users=%d memberships=%d", users, memberships)
	}
}

func TestPilotReadiness_ResendRotatesTokenAndOnlyNewTokenCanBeAccepted(t *testing.T) {
	var invitation struct {
		Invitation struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"invitation"`
		InvitationToken string `json:"invitation_token"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.a.admin.token, map[string]any{
		"email": "rotated-token@pilot-readiness.test", "roles": []string{"user"},
	}, http.StatusCreated, &invitation)

	newToken := "replacement-invitation-token-for-pilot-proof"
	newTokenSum := sha256.Sum256([]byte(newToken))
	err := fx.store.WithinTenantTx(context.Background(), storage.TenantActor{
		OrganizationID: fx.a.id,
		UserID:         fx.a.admin.id,
	}, func(ctx context.Context) error {
		_, err := fx.store.ResendInvitation(ctx, fx.a.id, invitation.Invitation.ID, hex.EncodeToString(newTokenSum[:]), time.Now().Add(24*time.Hour), invitation.Invitation.Version)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	oldTokenSum := sha256.Sum256([]byte(invitation.InvitationToken))
	passwordHash, err := auth.HashPassword(pilotPassword)
	if err != nil {
		t.Fatal(err)
	}
	oldCommand := storage.AcceptInvitationCommand{
		TokenHash: hex.EncodeToString(oldTokenSum[:]), Password: pilotPassword,
		NewPasswordHash: passwordHash, Name: "Rotated Token Member",
	}
	if _, err = fx.store.AcceptInvitation(context.Background(), oldCommand, auth.CheckPasswordHash, auth.ValidatePassword); !errors.Is(err, storage.ErrInvitationTokenRotated) {
		t.Fatalf("old token error=%v, want %v", err, storage.ErrInvitationTokenRotated)
	}

	newCommand := oldCommand
	newCommand.TokenHash = hex.EncodeToString(newTokenSum[:])
	if _, err = fx.store.AcceptInvitation(context.Background(), newCommand, auth.CheckPasswordHash, auth.ValidatePassword); err != nil {
		t.Fatalf("new token acceptance failed: %v", err)
	}
}

func TestPilotReadiness_FailedInvitationAcceptanceIsAuditedWithoutSecrets(t *testing.T) {
	email := "failed-accept-audit@pilot-readiness.test"
	fx.inviteAndAccept(t, fx.a.admin.token, email, "user")
	var invitation struct {
		InvitationToken string `json:"invitation_token"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.b.admin.token, map[string]any{"email": email, "roles": []string{"user"}}, http.StatusCreated, &invitation)
	status, body := fx.do(t, http.MethodPost, "/api/auth/invitations:accept", "", map[string]string{"token": invitation.InvitationToken, "password": "wrongpass9"})
	if status != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var details string
	if err := fx.pool.QueryRow(context.Background(), `SELECT details::text FROM security_audit_events WHERE organization_id=$1 AND event_type='invitation_acceptance_failed' ORDER BY created_at DESC LIMIT 1`, fx.b.id).Scan(&details); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{invitation.InvitationToken, email, "wrongpass9"} {
		if strings.Contains(details, secret) {
			t.Fatalf("audit leaked secret %q: %s", secret, details)
		}
	}
}

func TestPilotReadiness_ExpiredAcceptancePersistsLifecycleAndAuditAfterCommandRollback(t *testing.T) {
	var invitation struct {
		Invitation struct {
			ID string `json:"id"`
		} `json:"invitation"`
		InvitationToken string `json:"invitation_token"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.a.admin.token, map[string]any{
		"email": "expired-accept@pilot-readiness.test", "roles": []string{"user"},
	}, http.StatusCreated, &invitation)
	if _, err := fx.pool.Exec(t.Context(), `UPDATE invitations SET expires_at=NOW()-interval '1 minute' WHERE id=$1`, invitation.Invitation.ID); err != nil {
		t.Fatal(err)
	}
	status, body := fx.do(t, http.MethodPost, "/api/auth/invitations:accept", "", map[string]string{
		"token": invitation.InvitationToken, "password": pilotPassword, "name": "Expired Member",
	})
	if status != http.StatusGone {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var lifecycleStatus string
	if err := fx.pool.QueryRow(t.Context(), `SELECT status FROM invitations WHERE id=$1`, invitation.Invitation.ID).Scan(&lifecycleStatus); err != nil {
		t.Fatal(err)
	}
	if lifecycleStatus != "expired" {
		t.Fatalf("invitation status=%q, want expired", lifecycleStatus)
	}
	for _, eventType := range []string{"invitation_expired", "invitation_acceptance_failed"} {
		var count int
		if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type=$2 AND details->>'invitation_id'=$3`, fx.a.id, eventType, invitation.Invitation.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("%s audit count=%d, want 1", eventType, count)
		}
	}
}

func TestPilotReadiness_LifecycleCommandsFailClosedAcrossOrganizations(t *testing.T) {
	var invitation struct {
		Invitation struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"invitation"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.b.admin.token, map[string]any{
		"email": "cross-org-invite@pilot-readiness.test", "roles": []string{"user"},
	}, http.StatusCreated, &invitation)

	var visible []struct {
		ID string `json:"id"`
	}
	fx.decode(t, http.MethodGet, "/api/org/invitations", fx.a.admin.token, nil, http.StatusOK, &visible)
	for _, candidate := range visible {
		if candidate.ID == invitation.Invitation.ID {
			t.Fatal("organization A listed organization B invitation")
		}
	}
	for _, command := range []struct {
		suffix, body, key string
	}{
		{suffix: ":resend", key: "cross-org-resend-proof"},
		{suffix: ":revoke", body: `{"reason":"cross-org proof"}`, key: "cross-org-revoke-proof"},
	} {
		status, body := lifecycleCommand(t, "/api/org/invitations/"+invitation.Invitation.ID+command.suffix, fx.a.admin.token, invitation.Invitation.Version, command.key, command.body)
		if status != http.StatusNotFound {
			t.Fatalf("foreign invitation %s status=%d body=%s", command.suffix, status, body)
		}
	}

	accepted := fx.inviteAndAccept(t, fx.b.admin.token, "cross-org-member@pilot-readiness.test", "user")
	fx.want(t, http.MethodPut, "/api/org/memberships/"+accepted.Memberships[0].ID+"/status", fx.a.admin.token,
		map[string]string{"status": "suspended", "reason": "cross-org proof"}, http.StatusNotFound)
	var membershipStatus string
	if err := fx.pool.QueryRow(t.Context(), `SELECT status FROM memberships WHERE id=$1`, accepted.Memberships[0].ID).Scan(&membershipStatus); err != nil {
		t.Fatal(err)
	}
	if membershipStatus != "active" {
		t.Fatalf("foreign membership mutation changed status to %q", membershipStatus)
	}
}

func lifecycleCommand(t *testing.T, path, token string, version int64, key, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, fx.base+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("If-Match", `"v`+strconv.FormatInt(version, 10)+`"`)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(raw)
}

func TestPilotReadiness_ExistingLegacyPasswordCanAcceptWithoutNewPasswordPolicy(t *testing.T) {
	legacyPassword := "weak"
	hash, err := auth.HashPassword(legacyPassword)
	if err != nil {
		t.Fatal(err)
	}
	user := &domain.User{
		Email:         "legacy-password@pilot-readiness.test",
		Name:          "Legacy Password",
		PasswordHash:  hash,
		AccountStatus: domain.AccountStatusActive,
	}
	if err := fx.store.CreateUser(context.Background(), user); err != nil {
		t.Fatal(err)
	}
	var invitation struct {
		InvitationToken string `json:"invitation_token"`
	}
	fx.decode(t, http.MethodPost, "/api/org/invitations", fx.a.admin.token, map[string]any{"email": user.Email, "roles": []string{"user"}}, http.StatusCreated, &invitation)
	var accepted struct {
		Token             string `json:"token"`
		SelectionRequired bool   `json:"selection_required"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/invitations:accept", "", map[string]string{"token": invitation.InvitationToken, "password": legacyPassword}, http.StatusOK, &accepted)
	if accepted.Token == "" || accepted.SelectionRequired {
		t.Fatalf("acceptance did not return direct org session: %+v", accepted)
	}
}

func TestPilotReadiness_LastLoginChangesOnlyAfterSuccessfulAuthentication(t *testing.T) {
	accepted := fx.inviteAndAccept(t, fx.a.admin.token, "last-login@pilot-readiness.test", "user")
	if _, err := fx.pool.Exec(t.Context(), `UPDATE users SET last_login_at=NULL WHERE id=$1`, accepted.User.ID); err != nil {
		t.Fatal(err)
	}
	status, _ := fx.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": " LAST-LOGIN@pilot-readiness.test ", "password": "wrong-password", "transport": "web",
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("wrong-password login status=%d, want 401", status)
	}
	var lastLogin *time.Time
	if err := fx.pool.QueryRow(t.Context(), `SELECT last_login_at FROM users WHERE id=$1`, accepted.User.ID).Scan(&lastLogin); err != nil {
		t.Fatal(err)
	}
	if lastLogin != nil {
		t.Fatalf("failed login changed last_login_at to %v", lastLogin)
	}

	if login := fx.login(t, " LAST-LOGIN@pilot-readiness.test ", fx.a.slug); login.Token == "" {
		t.Fatal("successful normalized-email login returned no token")
	}
	if err := fx.pool.QueryRow(t.Context(), `SELECT last_login_at FROM users WHERE id=$1`, accepted.User.ID).Scan(&lastLogin); err != nil {
		t.Fatal(err)
	}
	if lastLogin == nil {
		t.Fatal("successful login did not set last_login_at")
	}
}
