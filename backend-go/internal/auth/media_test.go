package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testMediaKey = "unit-test-media-signing-key-0123456789"

func mustMediaAuthority(t *testing.T) *MediaAuthority {
	t.Helper()
	authority, err := NewMediaAuthority(testMediaKey)
	if err != nil {
		t.Fatalf("NewMediaAuthority: %v", err)
	}
	return authority
}

const canonicalMediaFile = "0123456789abcdef0123456789abcdef.png"

func TestMediaResourceKeyGrammar(t *testing.T) {
	valid := []string{
		canonicalMediaFile,
		"ffffffffffffffffffffffffffffffff.jpg",
		"00000000000000000000000000000000.webp",
	}
	for _, name := range valid {
		if key := MediaResourceKey(name); key != "media/"+name {
			t.Errorf("MediaResourceKey(%q) = %q, want media/%q", name, key, name)
		}
		if got := MediaFilenameFromResource("media/" + name); got != name {
			t.Errorf("MediaFilenameFromResource round-trip failed for %q: %q", name, got)
		}
	}
	invalid := []string{
		"",
		"abc.png",
		"0123456789abcdef0123456789abcde.png", // 31 hex chars
		"0123456789abcdef0123456789abcdef.gif",
		"0123456789ABCDEF0123456789ABCDEF.png",
		"../0123456789abcdef0123456789abcdef.png",
		"0123456789abcdef0123456789abcdef.png/x",
	}
	for _, name := range invalid {
		if key := MediaResourceKey(name); key != "" {
			t.Errorf("MediaResourceKey(%q) = %q, want empty", name, key)
		}
	}
	if got := MediaFilenameFromResource("media/../escape.png"); got != "" {
		t.Errorf("non-canonical resource must not yield a filename, got %q", got)
	}
}

func TestMediaAuthorityShortKeyFailsClosed(t *testing.T) {
	if _, err := NewMediaAuthority("short"); err == nil {
		t.Fatal("short media signing key must be rejected")
	}
	if _, err := NewMediaAuthority(""); err == nil {
		t.Fatal("empty media signing key must be rejected")
	}
}

func TestMediaGrantIssueValidateRoundTrip(t *testing.T) {
	authority := mustMediaAuthority(t)
	issuedAt := time.Now().Add(-time.Second)
	signed, claims, err := authority.Issue(MediaIssueRequest{
		ResourceKey: MediaResourceKey(canonicalMediaFile),
		OrgID:       "org-1",
		SessionID:   "sess-1",
		UserID:      "user-1",
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if !claims.ExpiresAt.Time.After(issuedAt) {
		t.Fatal("grant must expire in the future")
	}
	if claims.ExpiresAt.Sub(issuedAt) > MediaGrantTTL+time.Minute {
		t.Fatalf("grant TTL exceeds the policy bound: %v", claims.ExpiresAt.Sub(issuedAt))
	}

	parsed, err := authority.Validate(signed)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if parsed.Resource != "media/"+canonicalMediaFile || parsed.OrgID != "org-1" ||
		parsed.Op != MediaOperationRead || parsed.Typ != TokenTypeMediaRead ||
		parsed.SessionID != "sess-1" || parsed.UserID != "user-1" || parsed.Ver != MediaGrantVersion {
		t.Fatalf("round-trip claims mismatch: %+v", parsed)
	}
}

func TestMediaGrantAbsoluteCapWins(t *testing.T) {
	authority := mustMediaAuthority(t)
	cap := time.Now().Add(30 * time.Second)
	_, claims, err := authority.Issue(MediaIssueRequest{
		ResourceKey: MediaResourceKey(canonicalMediaFile),
		OrgID:       "org-1",
		AbsoluteCap: cap,
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if !claims.ExpiresAt.Time.After(time.Now()) || claims.ExpiresAt.After(cap.Add(time.Second)) {
		t.Fatalf("grant must be capped at the session's absolute expiry, got %v", claims.ExpiresAt)
	}

	if _, _, err := authority.Issue(MediaIssueRequest{
		ResourceKey: MediaResourceKey(canonicalMediaFile),
		OrgID:       "org-1",
		AbsoluteCap: time.Now().Add(-time.Second),
	}); err == nil {
		t.Fatal("grant with a passed absolute cap must be refused at minting")
	}
}

// A grant signed with a mismatched claim set fails closed even though the
// signature itself is valid: every claim is exact-policy material.
func TestMediaGrantExactClaimsFailClosed(t *testing.T) {
	authority := mustMediaAuthority(t)
	base := func(mutate func(*MediaClaims)) string {
		claims := &MediaClaims{
			Resource: MediaResourceKey(canonicalMediaFile), OrgID: "org-1",
			Op: MediaOperationRead, Typ: TokenTypeMediaRead, Ver: MediaGrantVersion,
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:  MediaResourceKey(canonicalMediaFile),
				Audience: jwt.ClaimStrings{MediaAudience},
				Issuer:   MediaIssuer,
				ID:       "jti-1",
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
				IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Second)),
				NotBefore: jwt.NewNumericDate(time.Now().Add(-time.Second)),
			},
		}
		mutate(claims)
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testMediaKey))
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	cases := map[string]func(*MediaClaims){
		"wrong typ":           func(c *MediaClaims) { c.Typ = TokenTypeAccessWeb },
		"wrong op":            func(c *MediaClaims) { c.Op = "write" },
		"wrong ver":           func(c *MediaClaims) { c.Ver = 2 },
		"wrong issuer":        func(c *MediaClaims) { c.Issuer = DefaultIssuer },
		"wrong audience":      func(c *MediaClaims) { c.Audience = jwt.ClaimStrings{AudienceWeb} },
		"two audiences":       func(c *MediaClaims) { c.Audience = jwt.ClaimStrings{MediaAudience, AudienceWeb} },
		"no jti":              func(c *MediaClaims) { c.ID = "" },
		"sub mismatch":        func(c *MediaClaims) { c.Subject = "media/other" },
		"non-canonical res":   func(c *MediaClaims) { c.Resource = "media/not-canonical.png"; c.Subject = "media/not-canonical.png" },
		"missing org":         func(c *MediaClaims) { c.OrgID = "" },
		"missing resource":    func(c *MediaClaims) { c.Resource = "" },
		"no iat":              func(c *MediaClaims) { c.IssuedAt = nil },
		"no nbf":              func(c *MediaClaims) { c.NotBefore = nil },
		"resource org folded": func(c *MediaClaims) { c.Resource = "org-1/media/" + canonicalMediaFile; c.Subject = "org-1/media/" + canonicalMediaFile },
	}
	for name, mutate := range cases {
		if _, err := authority.Validate(base(mutate)); err == nil {
			t.Errorf("%s: expected validation failure", name)
		}
	}

	// Expired grant reports the typed error so clients can re-authorize.
	expired := base(func(c *MediaClaims) {
		c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Second))
	})
	if _, err := authority.Validate(expired); err != ErrMediaTokenExpired {
		t.Errorf("expired grant: want ErrMediaTokenExpired, got %v", err)
	}
}

// Credential-class confusion is rejected in both directions — even if a
// deployment mistakenly used one secret for both authorities.
func TestMediaGrantSessionConfusionRejected(t *testing.T) {
	media := mustMediaAuthority(t)

	// Session token shape signed with the MEDIA key: disjoint iss/aud/typ/ver.
	sessionShaped, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &Claims{
		UserID: "user-1", OrgID: "org-1", Transport: "web", Typ: TokenTypeAccessWeb,
		Ver: TokenVersion, Sid: "sess-1",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "user-1", Audience: jwt.ClaimStrings{AudienceWeb}, Issuer: DefaultIssuer,
			ID: "jti-2", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt: jwt.NewNumericDate(time.Now()), NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}).SignedString([]byte(testMediaKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.Validate(sessionShaped); err == nil {
		t.Fatal("session-shaped token must not validate as a media grant")
	}

	// Media grant shape signed with the MEDIA key against the SESSION validator.
	grant, _, err := media.Issue(MediaIssueRequest{
		ResourceKey: MediaResourceKey(canonicalMediaFile), OrgID: "org-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	sessionAuthority, err := NewAuthority(mustKeyring(t, strings.Repeat("s", 40)), "")
	if err != nil {
		t.Fatal(err)
	}
	// Even with the same secret, Authority.Validate rejects the media class.
	sameSecretMedia, err := NewMediaAuthority(strings.Repeat("s", 40))
	if err != nil {
		t.Fatal(err)
	}
	grantSameSecret, _, err := sameSecretMedia.Issue(MediaIssueRequest{
		ResourceKey: MediaResourceKey(canonicalMediaFile), OrgID: "org-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sessionAuthority.Validate(grantSameSecret); err == nil {
		t.Fatal("media grant must not validate as a session credential even with a shared secret")
	}
	if _, err := sessionAuthority.Validate(grant); err == nil {
		t.Fatal("media grant must not validate as a session credential")
	}
}

func mustKeyring(t *testing.T, secret string) *Keyring {
	t.Helper()
	keyring, err := SingleKeyKeyring(secret)
	if err != nil {
		t.Fatalf("SingleKeyKeyring: %v", err)
	}
	return keyring
}
