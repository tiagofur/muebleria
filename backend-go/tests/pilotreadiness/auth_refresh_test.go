package pilotreadiness

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestRefreshRotationReplayAndLogoutHTTP(t *testing.T) {
	login := fx.login(t, fx.a.admin.email, fx.a.slug)
	if login.RefreshToken == "" || login.RefreshExpiresAt == "" {
		t.Fatal("web login must emit initial opaque refresh credentials")
	}
	for _, wrongTransport := range []string{"mobile", "sketchup", "support"} {
		status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
			"refresh_token": login.RefreshToken,
			"transport":     wrongTransport,
		})
		if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_INVALID" {
			t.Fatalf("web refresh as %s status=%d code=%s", wrongTransport, status, apiErrorCode(raw))
		}
	}

	var rotated loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &rotated)
	if rotated.Token == "" || rotated.RefreshToken == "" || rotated.RefreshToken == login.RefreshToken {
		t.Fatalf("rotation did not return distinct A2/R2: %+v", rotated)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)

	status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REUSED" {
		t.Fatalf("R1 replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": rotated.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("R2 after replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, _ = fx.do(t, http.MethodGet, "/api/auth/me", rotated.Token, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("access credential must be cut after reuse, status=%d", status)
	}

	// A separate family proves the replacement itself is consumable once;
	// replay coverage above intentionally revokes R2 before it can rotate.
	happyLogin := fx.login(t, fx.a.admin.email, fx.a.slug)
	var happyR2, logoutLogin loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyLogin.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &happyR2)
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyR2.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &logoutLogin)
	fx.want(t, http.MethodGet, "/api/auth/me", logoutLogin.Token, nil, http.StatusOK)
	for i := 0; i < 2; i++ {
		fx.want(t, http.MethodPost, "/api/auth/logout", "", map[string]string{
			"refresh_token": logoutLogin.RefreshToken,
		}, http.StatusOK)
	}
	status, _ = fx.do(t, http.MethodGet, "/api/auth/me", logoutLogin.Token, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("access credential must fail after logout, status=%d", status)
	}
	status, raw = fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": logoutLogin.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("refresh credential after logout status=%d code=%s", status, apiErrorCode(raw))
	}
}

func apiErrorCode(raw []byte) string {
	var body struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(raw, &body)
	return body.Code
}
