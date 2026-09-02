package pilotreadiness

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
)

// #460 / SEC-7 — MFA and step-up over real HTTP + PostgreSQL. These proofs
// cover the browser-facing contract: enrollment, the step-up challenge (403,
// typed — never a 401, so no client can mistake it for access expiry),
// Idempotency-Key preservation across the challenge, SketchUp device approval
// gating, scope isolation, TTL expiry, session replacement and the per-user
// brute-force bound.

// enrollDeviceOnSketchUpFlow runs the anonymous enrollment half.
func enrollDeviceOnSketchUpFlow(t *testing.T, displayName string) (enrollmentID, code string) {
	t.Helper()
	var enrolled struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/devices/enroll", "", map[string]string{
		"client_type": "sketchup", "display_name": displayName,
	}, http.StatusCreated, &enrolled)
	return enrolled.ID, enrolled.Code
}

// enrollMFADirectly walks begin+verify with fresh counters for users that do
// not go through the fixture's cached provider (dedicated test users).
func enrollMFADirectly(t *testing.T, token string) []string {
	t.Helper()
	var begun struct {
		FactorID        string `json:"factor_id"`
		ProvisioningUri string `json:"provisioning_uri"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/mfa/totp:begin", token, map[string]string{}, http.StatusCreated, &begun)
	rawSecret := decodeProvisioningSecret(t, begun.ProvisioningUri)
	var verified struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/mfa/totp/"+begun.FactorID+":verify", token,
		map[string]string{"code": auth.TOTPCode(rawSecret, auth.TOTPCounter(time.Now()))}, http.StatusOK, &verified)
	return verified.RecoveryCodes
}

// decodeProvisioningSecret extracts the raw TOTP secret from the one-time
// otpauth:// URI.
func decodeProvisioningSecret(t *testing.T, uri string) []byte {
	t.Helper()
	parsed, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("provisioning uri: %v", err)
	}
	encoded := parsed.Query().Get("secret")
	if encoded == "" {
		t.Fatalf("provisioning uri without secret: %s", uri)
	}
	raw, err := base32NoPad.DecodeString(encoded)
	if err != nil {
		t.Fatalf("provisioning secret: %v", err)
	}
	return raw
}

func TestPilotReadiness_MFAEnrollmentFlow(t *testing.T) {
	user := fx.a.admin
	var begun struct {
		FactorID        string `json:"factor_id"`
		ProvisioningUri string `json:"provisioning_uri"`
		ExpiresAt       string `json:"expires_at"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/mfa/totp:begin", user.token, map[string]string{"label": "Teléfono"}, http.StatusCreated, &begun)
	if !strings.HasPrefix(begun.ProvisioningUri, "otpauth://totp/Granete:") || !strings.Contains(begun.ProvisioningUri, "algorithm=SHA1") {
		t.Fatalf("provisioning uri: %s", begun.ProvisioningUri)
	}
	if begun.ExpiresAt == "" {
		t.Fatal("begin response must carry the pending-enrollment deadline")
	}

	// Factors list shows the pending enrollment.
	var directory struct {
		Factors []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"factors"`
	}
	fx.decode(t, http.MethodGet, "/api/auth/mfa/factors", user.token, nil, http.StatusOK, &directory)
	found := false
	for _, f := range directory.Factors {
		if f.ID == begun.FactorID && f.Status == "pending" {
			found = true
		}
	}
	if !found {
		t.Fatalf("pending factor missing from directory: %+v", directory.Factors)
	}

	// A wrong code keeps it pending (typed MFA_INVALID).
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/mfa/totp/"+begun.FactorID+":verify", user.token, map[string]string{"code": "000000"})
	if status != http.StatusForbidden || !strings.Contains(string(body), "MFA_INVALID") {
		t.Fatalf("invalid enroll code: status=%d body=%s", status, body)
	}

	// The fixture provider enrolls and enables a fresh factor for step-ups.
	fx.mfaFor(t, user)
}

func TestPilotReadiness_DeviceApprovalRequiresStepUp(t *testing.T) {
	user := fx.a.admin
	_, code := enrollDeviceOnSketchUpFlow(t, "Mac del taller SEC-7")

	// Without step-up: the typed challenge naming its scope.
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", user.token, map[string]string{"code": code})
	if status != http.StatusForbidden || !strings.Contains(string(body), "STEP_UP_REQUIRED") {
		t.Fatalf("approve without step-up: status=%d body=%s", status, body)
	}
	if !strings.Contains(string(body), `"scope":"device_enrollment"`) {
		t.Fatalf("challenge must name its scope: %s", body)
	}

	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "device_enrollment")

	status, body = fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", user.token, map[string]string{"code": code})
	if status != http.StatusOK {
		t.Fatalf("approve after step-up: status=%d body=%s", status, body)
	}

	// The grant covers repeated approvals within its TTL.
	_, code2 := enrollDeviceOnSketchUpFlow(t, "Segunda Mac")
	status, body = fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", user.token, map[string]string{"code": code2})
	if status != http.StatusOK {
		t.Fatalf("second approve (grant still fresh): status=%d body=%s", status, body)
	}
}

func TestPilotReadiness_DeviceApprovalIdempotencyKeySurvivesChallenge(t *testing.T) {
	user := fx.b.admin
	_, code := enrollDeviceOnSketchUpFlow(t, "Idempotencia SEC-7")
	const key = "sec7-challenge-key"

	doApprove := func() *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, fx.base+"/api/auth/devices/approve",
			strings.NewReader(fmt.Sprintf(`{"code":%q}`, code)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+user.token)
		req.Header.Set("Idempotency-Key", key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	// Challenge first.
	resp := doApprove()
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("challenge status=%d", resp.StatusCode)
	}

	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "device_enrollment")

	// Same key, same payload: the FIRST successful execution is stored —
	// not the earlier 403, which never reached the idempotency wrapper.
	resp2 := doApprove()
	firstBody, _ := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("retry with the same key: status=%d body=%s", resp2.StatusCode, firstBody)
	}

	// The replay proves the receipt holds the 200, not the challenge.
	resp3 := doApprove()
	replayBody, _ := io.ReadAll(resp3.Body)
	resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK || resp3.Header.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay: status=%d replayed=%q body=%s", resp3.StatusCode, resp3.Header.Get("Idempotency-Replayed"), replayBody)
	}
	if string(firstBody) != string(replayBody) {
		t.Fatalf("replay body drifted: %s vs %s", firstBody, replayBody)
	}
}

func TestPilotReadiness_ExpiredEnrollmentDeniedEvenWithStepUp(t *testing.T) {
	user := fx.a.admin
	enrollmentID, code := enrollDeviceOnSketchUpFlow(t, "Vencida SEC-7")
	// Age the enrollment past its 10-minute window (the CHECK pins
	// expires_at > created_at, so both move together).
	fx.exec(t, `UPDATE auth_device_enrollments
		SET created_at = NOW() - INTERVAL '11 minutes', expires_at = NOW() - INTERVAL '1 minute'
		WHERE id = $1`, enrollmentID)

	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "device_enrollment")
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", user.token, map[string]string{"code": code})
	if status != http.StatusConflict {
		t.Fatalf("expired enrollment must stay denied after MFA: status=%d body=%s", status, body)
	}
}

func TestPilotReadiness_StepUpScopesAreIsolated(t *testing.T) {
	user := fx.a.admin
	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "device_enrollment")

	// The device_enrollment grant must NOT authorize security_admin commands.
	var factors struct {
		Factors []struct {
			ID string `json:"id"`
		} `json:"factors"`
	}
	fx.decode(t, http.MethodGet, "/api/auth/mfa/factors", user.token, nil, http.StatusOK, &factors)
	if len(factors.Factors) == 0 {
		t.Fatal("expected an enrolled factor")
	}
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/mfa/factors/"+factors.Factors[0].ID+":remove", user.token, nil)
	if status != http.StatusForbidden || !strings.Contains(string(body), "STEP_UP_REQUIRED") {
		t.Fatalf("scope isolation: security_admin command under a device_enrollment grant: status=%d body=%s", status, body)
	}
}

func TestPilotReadiness_StepUpExpiresAndSessionReplacement(t *testing.T) {
	user := fx.a.admin
	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "device_enrollment")

	// TTL expiry: time-travel the grants (direct SQL is the only honest way).
	fx.exec(t, `
		UPDATE auth_step_up_grants
		SET created_at = NOW() - INTERVAL '11 minutes', expires_at = NOW() - INTERVAL '1 second'
		WHERE scope = 'device_enrollment' AND user_id = (SELECT id FROM users WHERE email = $1)`, user.email)
	_, code := enrollDeviceOnSketchUpFlow(t, "Expirada SEC-7")
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", user.token, map[string]string{"code": code})
	if status != http.StatusForbidden || !strings.Contains(string(body), "STEP_UP_EXPIRED") {
		t.Fatalf("expired step-up: status=%d body=%s", status, body)
	}

	// Session replacement: a fresh login mints a NEW sid that carries no
	// grants, even unexpired ones.
	fx.pilotStepUp(t, user, provider, "device_enrollment")
	rel := fx.login(t, user.email, fx.a.slug)
	_, code2 := enrollDeviceOnSketchUpFlow(t, "Nueva sesión SEC-7")
	status, body = fx.rawRequest(http.MethodPost, "/api/auth/devices/approve", rel.Token, map[string]string{"code": code2})
	if status != http.StatusForbidden || !strings.Contains(string(body), "STEP_UP_REQUIRED") {
		t.Fatalf("replaced session must not inherit step-up: status=%d body=%s", status, body)
	}
}

func TestPilotReadiness_RecoveryCodeStepUpAndManagement(t *testing.T) {
	// Dedicated user: enable MFA through the real flow, keep the codes.
	fx.inviteAndAccept(t, fx.a.admin.token, "recovery-sec7@pilot-readiness.test", "user")
	token := fx.scopedToken(t, "recovery-sec7@pilot-readiness.test", fx.a.slug)
	codes := enrollMFADirectly(t, token)
	if len(codes) != 10 {
		t.Fatalf("recovery codes: %d", len(codes))
	}

	// A recovery code performs exactly one step-up; reuse is typed-rejected.
	var step struct {
		Scope string `json:"scope"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/mfa/step-up", token,
		map[string]string{"scope": "security_admin", "method": "recovery", "code": codes[0]}, http.StatusOK, &step)
	status, body := fx.rawRequest(http.MethodPost, "/api/auth/mfa/step-up", token,
		map[string]string{"scope": "organization_admin", "method": "recovery", "code": codes[0]})
	if status != http.StatusForbidden || !strings.Contains(string(body), "MFA_RECOVERY_INVALID") {
		t.Fatalf("reused recovery code: status=%d body=%s", status, body)
	}

	// The security_admin step-up (granted above) authorizes regeneration; the
	// fresh batch invalidates the old codes.
	var regenerated struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}
	fx.decode(t, http.MethodPost, "/api/auth/mfa/recovery-codes:regenerate", token, nil, http.StatusOK, &regenerated)
	if len(regenerated.RecoveryCodes) != 10 {
		t.Fatalf("regenerated codes: %d", len(regenerated.RecoveryCodes))
	}
	status, body = fx.rawRequest(http.MethodPost, "/api/auth/mfa/step-up", token,
		map[string]string{"scope": "platform_admin", "method": "recovery", "code": codes[2]})
	if status != http.StatusForbidden || !strings.Contains(string(body), "MFA_RECOVERY_INVALID") {
		t.Fatalf("old recovery codes must die at regeneration: status=%d body=%s", status, body)
	}
}

func TestPilotReadiness_StepUpRateLimitPerUser(t *testing.T) {
	// Dedicated user so the brute-force bound cannot pollute other proofs.
	fx.inviteAndAccept(t, fx.a.admin.token, "ratelimit-sec7@pilot-readiness.test", "user")
	token := fx.scopedToken(t, "ratelimit-sec7@pilot-readiness.test", fx.a.slug)
	enrollMFADirectly(t, token)

	throttled := false
	for i := 0; i < 8; i++ {
		status, _ := fx.rawRequest(http.MethodPost, "/api/auth/mfa/step-up", token,
			map[string]string{"scope": "security_admin", "method": "totp", "code": "000000"})
		if status == http.StatusTooManyRequests {
			throttled = true
			break
		}
		if status != http.StatusForbidden {
			t.Fatalf("attempt %d: unexpected status %d", i, status)
		}
	}
	if !throttled {
		t.Fatal("brute force was not throttled after repeated invalid codes")
	}
}

func TestPilotReadiness_MFASecretsNeverPersistedInAudit(t *testing.T) {
	user := fx.a.admin
	provider := fx.mfaFor(t, user)
	fx.pilotStepUp(t, user, provider, "security_admin")

	rows, err := fx.pool.Query(context.Background(), `
		SELECT event_type, COALESCE(details::text, '') FROM security_audit_events
		WHERE event_type LIKE 'mfa%' OR event_type LIKE 'step_up%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	events := 0
	for rows.Next() {
		var eventType, details string
		if err := rows.Scan(&eventType, &details); err != nil {
			t.Fatal(err)
		}
		events++
		for _, forbidden := range []string{"otpauth://", `"code"`, "recovery_codes"} {
			if strings.Contains(details, forbidden) {
				t.Fatalf("audit event %s leaks %q: %s", eventType, forbidden, details)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if events == 0 {
		t.Fatal("expected MFA/step-up audit events")
	}
}
