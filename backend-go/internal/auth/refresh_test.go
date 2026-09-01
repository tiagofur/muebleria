package auth

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestRefreshCredentialsGenerateAndVerify(t *testing.T) {
	authority, err := NewRefreshCredentials(strings.Repeat("p", 32))
	if err != nil {
		t.Fatal(err)
	}
	rawA, verifierA, err := authority.Generate()
	if err != nil {
		t.Fatal(err)
	}
	rawB, verifierB, err := authority.Generate()
	if err != nil {
		t.Fatal(err)
	}
	if rawA == rawB || bytes.Equal(verifierA, verifierB) {
		t.Fatal("generated refresh credentials must be unique")
	}
	if !authority.Matches(rawA, verifierA) || authority.Matches(rawB, verifierA) {
		t.Fatal("verifier must match only its originating opaque credential")
	}
	if strings.Contains(string(verifierA), rawA) {
		t.Fatal("verifier must not contain the raw credential")
	}
}

func TestIssueTransportTokenUntilCapsAccessAtSessionAbsoluteExpiry(t *testing.T) {
	keyring, err := SingleKeyKeyring(strings.Repeat("j", 32))
	if err != nil {
		t.Fatal(err)
	}
	authority, err := NewAuthority(keyring, "")
	if err != nil {
		t.Fatal(err)
	}
	origin := time.Now().Add(-17*time.Hour - 59*time.Minute)
	absolute := time.Now().Add(30 * time.Second).Truncate(time.Second)
	token, err := authority.IssueTransportTokenUntil("user-1", "user@example.test", TokenContext{
		PlatformAdmin: true, AuthStartedAt: origin, SessionID: "session-1",
	}, "web", absolute)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := authority.Validate(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.ExpiresAt == nil || claims.ExpiresAt.Time.After(absolute) {
		t.Fatalf("access exp=%v exceeds session absolute=%v", claims.ExpiresAt, absolute)
	}
}

func TestRefreshCredentialsRejectMalformedAndWeakConfiguration(t *testing.T) {
	if _, err := NewRefreshCredentials("short"); err == nil {
		t.Fatal("expected weak pepper to fail closed")
	}
	authority, _ := NewRefreshCredentials(strings.Repeat("p", 32))
	for _, raw := range []string{"", "access.jwt.token", "grt_refresh_v1.short", "grt_refresh_v1.!!!!!!!!!!!!!!!!"} {
		if authority.Validate(raw) == nil {
			t.Fatalf("expected malformed credential %q to fail", raw)
		}
	}
}
