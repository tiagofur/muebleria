package auth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestHashAndCheckPassword(t *testing.T) {
	password := "mi-contraseña-secreta1"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}

	if !CheckPasswordHash(password, hash) {
		t.Error("expected password hash check to succeed")
	}

	if CheckPasswordHash("incorrecta", hash) {
		t.Error("expected password hash check to fail for incorrect password")
	}
}

func TestHashPassword_UsesCost12(t *testing.T) {
	hash, err := HashPassword("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatal(err)
	}
	if cost != BcryptCost {
		t.Errorf("bcrypt cost = %d, want %d (issue #19)", cost, BcryptCost)
	}
}

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		pw      string
		wantErr bool
	}{
		{"short1a", true},  // 7
		{"12345678", true}, // digits only
		{"abcdefgh", true}, // letters only
		{"pass1234", false},
		{"Passw0rd!", false},
		{"", true},
	}
	for _, c := range cases {
		err := ValidatePassword(c.pw)
		if c.wantErr && err == nil {
			t.Errorf("ValidatePassword(%q): expected error", c.pw)
		}
		if !c.wantErr && err != nil {
			t.Errorf("ValidatePassword(%q): unexpected %v", c.pw, err)
		}
	}
}

func TestValidatePassword_Message(t *testing.T) {
	err := ValidatePassword("ab")
	if err == nil || !strings.Contains(err.Error(), "8") {
		t.Errorf("expected min-length message, got %v", err)
	}
	err = ValidatePassword("abcdefgh")
	if err == nil || !strings.Contains(err.Error(), "letter") && !strings.Contains(err.Error(), "digit") {
		t.Errorf("expected letter/digit message, got %v", err)
	}
}

func TestDummyHash_IsValidBcrypt(t *testing.T) {
	if DummyHash == "" {
		t.Fatal("DummyHash not initialized")
	}
	if !CheckPasswordHash("dummy-password-for-timing", DummyHash) {
		t.Error("DummyHash should verify the known dummy password")
	}
}

// mustTestAuthority builds a single-key authority for the common case.
func mustTestAuthority(t *testing.T, secret string) *Authority {
	t.Helper()
	keyring, err := SingleKeyKeyring(secret)
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	authority, err := NewAuthority(keyring, "")
	if err != nil {
		t.Fatalf("authority: %v", err)
	}
	return authority
}

func TestAuthorityTokenLifecycle(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	userID := "user-uuid-123"
	email := "test@example.com"
	role := "vendedor"
	authority := mustTestAuthority(t, secret)

	token, err := authority.IssueTransportToken(userID, email, TokenContext{
		Roles: []string{role}, SessionID: "sess-1",
	}, "web")
	if err != nil {
		t.Fatal(err)
	}

	claims, err := authority.Validate(token)
	if err != nil {
		t.Fatal(err)
	}

	if claims.UserID != userID {
		t.Errorf("expected UserID = %s, got %s", userID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("expected Email = %s, got %s", claims.Email, email)
	}
	if claims.Role != role {
		t.Errorf("expected Role = %s, got %s", claims.Role, role)
	}
	if claims.Sid != "sess-1" {
		t.Errorf("expected Sid = sess-1, got %s", claims.Sid)
	}
	if claims.Typ != TokenTypeAccessWeb {
		t.Errorf("expected Typ = %s, got %s", TokenTypeAccessWeb, claims.Typ)
	}
	if claims.Issuer != DefaultIssuer {
		t.Errorf("expected Issuer = %s, got %s", DefaultIssuer, claims.Issuer)
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != AudienceWeb {
		t.Errorf("expected Audience = [%s], got %v", AudienceWeb, claims.Audience)
	}
	if claims.ID == "" {
		t.Error("expected jti set")
	}
	if claims.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt set")
	}
	// Access token should expire about AccessTokenTTL from now (issue #16).
	ttl := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if ttl < AccessTokenTTL-time.Second || ttl > AccessTokenTTL+time.Second {
		t.Errorf("token TTL = %v, want ~%v", ttl, AccessTokenTTL)
	}

	// A different key must not validate the token.
	if _, err := mustTestAuthority(t, "another-secret-key-0987654321fedcba").Validate(token); err == nil {
		t.Error("expected token validation to fail with incorrect secret key")
	}
}

// TestAuthority_KidHeaderAndRotation locks the zero-downtime rotation policy:
// tokens signed with a previous kid stay valid while it remains registered, and
// an unknown kid fails closed.
func TestAuthority_KidHeaderAndRotation(t *testing.T) {
	keyring, err := NewKeyring("k-new", map[string]string{
		"k-new": "new-secret-key-1234567890abcdef0",
		"k-old": "old-secret-key-1234567890abcdef0",
	})
	if err != nil {
		t.Fatal(err)
	}
	authority, err := NewAuthority(keyring, "")
	if err != nil {
		t.Fatal(err)
	}

	token, err := authority.IssueTransportToken("u1", "u@example.com", TokenContext{
		Roles: []string{"admin"}, SessionID: "sess-1",
	}, "web")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, err := (jwt.NewParser()).ParseUnverified(token, &Claims{})
	if err != nil {
		t.Fatal(err)
	}
	if kid, _ := parsed.Header["kid"].(string); kid != "k-new" {
		t.Fatalf("kid header = %q, want k-new", kid)
	}

	// A token signed with the previous key still validates while registered.
	oldAuthority := authorityForKid(t, "k-old", "old-secret-key-1234567890abcdef0")
	oldToken, err := oldAuthority.IssueTransportToken("u1", "u@example.com", TokenContext{
		Roles: []string{"admin"}, SessionID: "sess-1",
	}, "web")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(oldToken); err != nil {
		t.Fatalf("previous-kid token must validate during rotation: %v", err)
	}

	// An unknown kid is rejected — that is how a rotated-out key is revoked.
	unknownAuthority := authorityForKid(t, "k-gone", "gone-secret-key-1234567890abcdef0")
	unknownToken, err := unknownAuthority.IssueTransportToken("u1", "u@example.com", TokenContext{
		Roles: []string{"admin"}, SessionID: "sess-1",
	}, "web")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(unknownToken); err == nil {
		t.Fatal("unknown kid must be rejected")
	}
}

func authorityForKid(t *testing.T, kid, secret string) *Authority {
	t.Helper()
	keyring, err := NewKeyring(kid, map[string]string{kid: secret})
	if err != nil {
		t.Fatalf("keyring %s: %v", kid, err)
	}
	authority, err := NewAuthority(keyring, "")
	if err != nil {
		t.Fatalf("authority %s: %v", kid, err)
	}
	return authority
}

// TestKeyring_Validation locks the keyring invariants: non-empty, active kid
// registered, secrets ≥32 bytes, kid charset.
func TestKeyring_Validation(t *testing.T) {
	if _, err := NewKeyring("k1", nil); err == nil {
		t.Fatal("empty keyring must be rejected")
	}
	if _, err := NewKeyring("missing", map[string]string{"k1": "secret-key-1234567890abcdef"}); err == nil {
		t.Fatal("active kid without secret must be rejected")
	}
	if _, err := NewKeyring("k1", map[string]string{"k1": "short"}); err == nil {
		t.Fatal("short secret must be rejected")
	}
	if _, err := NewKeyring("bad kid!", map[string]string{"bad kid!": "secret-key-1234567890abcdef"}); err == nil {
		t.Fatal("invalid kid charset must be rejected")
	}
}

// TestValidate_RejectsWrongVersion locks the one-time token invalidation: a
// token whose Ver is neither current nor legacy is refused.
func TestValidate_RejectsWrongVersion(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)
	claims := &Claims{
		UserID: "u", Email: "e@x.com", Role: "admin", Ver: 1,
	}
	token, err := jwtNewSigned(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("v1 token must be rejected")
	}
}

// jwtNewSigned signs arbitrary claims with a bare secret and NO kid header —
// exactly the shape of a forged/legacy token, used for negative-policy tests.
func jwtNewSigned(claims *Claims, secret string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// signWithKID signs claims with an explicit kid header, the ver5 header shape.
func signWithKID(claims *Claims, secret, kid string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = kid
	return token.SignedString([]byte(secret))
}

// fullVer5Claims builds a policy-complete ver5 claims set for tamper tests.
func fullVer5Claims(typ string) *Claims {
	now := time.Now()
	return &Claims{
		UserID: "u1", Email: "u@example.com", Role: "admin",
		Roles: []string{"admin"},
		OrgID: "org-1", MembershipID: "m-1",
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
		Transport:                     "web",
		Sid:                           "sess-1",
		Typ:                           typ,
		Ver:                           TokenVersion,
		AuthStartedAt:                 jwt.NewNumericDate(now),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "u1",
			Audience:  jwt.ClaimStrings{AudienceWeb},
			Issuer:    DefaultIssuer,
			ID:        "jti-1",
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
}

// TestValidate_RejectsTokenTypeTamper locks the non-interchangeable credential
// classes: a ver5 token whose typ does not match its transport fails closed.
func TestValidate_RejectsTokenTypeTamper(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)

	claims := fullVer5Claims(TokenTypeDeviceSketchup) // web transport, sketchup typ
	token, err := signWithKID(claims, secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("typ/transport mismatch must be rejected")
	}

	claims = fullVer5Claims(TokenTypeAccessWeb)
	claims.Audience = jwt.ClaimStrings{AudienceSketchup}
	token, err = signWithKID(claims, secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("audience/transport mismatch must be rejected")
	}

	claims = fullVer5Claims(TokenTypeAccessWeb)
	claims.Issuer = "other-issuer"
	token, err = signWithKID(claims, secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("issuer mismatch must be rejected")
	}

	claims = fullVer5Claims(TokenTypeAccessWeb)
	claims.Sid = ""
	token, err = signWithKID(claims, secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("ver5 token without sid must be rejected")
	}

	claims = fullVer5Claims(TokenTypeAccessWeb)
	claims.ID = ""
	token, err = signWithKID(claims, secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("ver5 token without jti must be rejected")
	}
}

// TestValidate_RejectsNonHS256Algorithms pins the exact algorithm: HS384/HS512
// and unsigned tokens are refused even though they are HMAC or unsigned.
func TestValidate_RejectsNonHS256Algorithms(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)
	now := time.Now()

	for _, tc := range []struct {
		name  string
		token *jwt.Token
	}{
		{"hs384", jwt.NewWithClaims(jwt.SigningMethodHS384, fullVer5Claims(TokenTypeAccessWeb))},
		{"hs512", jwt.NewWithClaims(jwt.SigningMethodHS512, fullVer5Claims(TokenTypeAccessWeb))},
	} {
		signed, err := tc.token.SignedString([]byte(secret))
		if err != nil {
			t.Fatalf("%s sign: %v", tc.name, err)
		}
		if _, err := authority.Validate(signed); err == nil {
			t.Fatalf("%s token must be rejected", tc.name)
		}
	}

	// Unsigned ("alg":"none") token, hand-crafted: header.payload with an
	// empty signature segment.
	unsigned := base64RawURL([]byte(`{"alg":"none"}`)) + "." + base64RawURL(mustJSON(t, fullVer5Claims(TokenTypeAccessWeb))) + "."
	if _, err := authority.Validate(unsigned); err == nil {
		t.Fatal("unsigned token must be rejected")
	}
	_ = now
}

func base64RawURL(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func mustJSON(t *testing.T, v interface{}) []byte {
	t.Helper()
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return out
}

// TestValidate_RequiresEveryRegisteredClaim locks the fail-closed claims
// policy for ver5: a CORRECTLY SIGNED token missing any registered claim — or
// whose subject does not match its user — is not a valid credential. The
// minting helpers always emit these; validation must not depend on that.
func TestValidate_RequiresEveryRegisteredClaim(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)

	mustReject := func(name string, mutate func(*Claims)) {
		t.Helper()
		claims := fullVer5Claims(TokenTypeAccessWeb)
		mutate(claims)
		token, err := signWithKID(claims, secret, LegacyKeyID)
		if err != nil {
			t.Fatalf("%s: sign: %v", name, err)
		}
		if _, err := authority.Validate(token); err == nil {
			t.Fatalf("%s: token must be rejected", name)
		}
	}

	mustReject("missing exp", func(c *Claims) { c.ExpiresAt = nil })
	mustReject("missing iat", func(c *Claims) { c.IssuedAt = nil })
	mustReject("missing nbf", func(c *Claims) { c.NotBefore = nil })
	mustReject("missing sub", func(c *Claims) { c.Subject = "" })
	mustReject("sub mismatch", func(c *Claims) { c.Subject = "someone-else" })
	mustReject("missing iss", func(c *Claims) { c.Issuer = "" })
	mustReject("missing aud", func(c *Claims) { c.Audience = nil })
	mustReject("extra aud", func(c *Claims) {
		c.Audience = jwt.ClaimStrings{AudienceWeb, "someone-else"}
	})
	mustReject("missing jti", func(c *Claims) { c.ID = "" })
	mustReject("missing sid", func(c *Claims) { c.Sid = "" })
	mustReject("missing typ", func(c *Claims) { c.Typ = "" })
	mustReject("wrong typ", func(c *Claims) { c.Typ = TokenTypeDeviceSketchup })
	mustReject("missing user_id", func(c *Claims) { c.UserID = "" })
	mustReject("missing auth_started_at", func(c *Claims) { c.AuthStartedAt = nil })
	mustReject("iat in the future", func(c *Claims) {
		c.IssuedAt = jwt.NewNumericDate(time.Now().Add(5 * time.Minute))
	})

	// The unmodified claims set with the ver5 kid header is the control: it
	// must validate.
	token, err := signWithKID(fullVer5Claims(TokenTypeAccessWeb), secret, LegacyKeyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err != nil {
		t.Fatalf("complete ver5 claims must validate: %v", err)
	}
}

// TestValidate_Ver5RequiresKidHeader locks the residual exact-policy rule: a
// kidless token is only acceptable while it is ver4 (legacy window). A ver5
// token without a kid — even correctly signed with the legacy key — and a
// malformed (non-string or empty) kid are rejected for every version.
func TestValidate_Ver5RequiresKidHeader(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)

	// Kidless ver5, correctly signed with the legacy secret: rejected.
	kidless, err := jwtNewSigned(fullVer5Claims(TokenTypeAccessWeb), secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(kidless); err == nil {
		t.Fatal("ver5 token without kid header must be rejected")
	}

	// Non-string kid header: rejected before key resolution.
	malformed := jwt.NewWithClaims(jwt.SigningMethodHS256, fullVer5Claims(TokenTypeAccessWeb))
	malformed.Header["kid"] = 12345
	malformedSigned, err := malformed.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(malformedSigned); err == nil {
		t.Fatal("non-string kid header must be rejected")
	}

	// Empty-string kid header: malformed, rejected.
	empty := jwt.NewWithClaims(jwt.SigningMethodHS256, fullVer5Claims(TokenTypeAccessWeb))
	empty.Header["kid"] = ""
	emptySigned, err := empty.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(emptySigned); err == nil {
		t.Fatal("empty kid header must be rejected")
	}
}

// TestValidate_LegacyVer4StillValidates locks the transitional acceptance
// window (#460 SEC-9 removes it together with GenerateLegacyToken).
func TestValidate_LegacyVer4StillValidates(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)

	token, err := GenerateLegacyWebToken("u1", "u@example.com", TokenContext{
		Roles: []string{"admin"}, OrgID: "org-1", MembershipID: "m-1",
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := authority.Validate(token)
	if err != nil {
		t.Fatalf("legacy ver4 token must validate during transition: %v", err)
	}
	if claims.Ver != LegacyTokenVersion || claims.Sid != "" {
		t.Fatalf("legacy claims wrong: ver=%d sid=%q", claims.Ver, claims.Sid)
	}
}

func TestIssueTransportToken_PreservesAbsoluteSessionLifetimeAndMembershipCredentials(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)
	started := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	token, err := authority.IssueTransportToken("user-1", "user@example.com", TokenContext{
		Roles:                       []string{"admin"},
		OrgID:                       "org-1",
		MembershipID:                "membership-1",
		MembershipCredentialVersion: 7, OrganizationCredentialVersion: 1,
		AuthStartedAt: started,
		SessionID:     "sess-1",
	}, "web")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := authority.Validate(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.MembershipID != "membership-1" || claims.MembershipCredentialVersion != 7 {
		t.Fatalf("membership claims = %q/%d, want membership-1/7", claims.MembershipID, claims.MembershipCredentialVersion)
	}
	if claims.OrganizationCredentialVersion != 1 {
		t.Fatalf("organization credential version = %d, want 1", claims.OrganizationCredentialVersion)
	}
	if got := claims.AuthStartedAt.Time; !got.Equal(started) {
		t.Fatalf("auth_started_at = %s, want %s", got, started)
	}
	if want := started.Add(AccessTokenTTL); !claims.ExpiresAt.Time.Equal(want) {
		t.Fatalf("expiry = %s, want %s", claims.ExpiresAt.Time, want)
	}
}

func TestIssueTransportToken_RejectsMissingSessionID(t *testing.T) {
	authority := mustTestAuthority(t, "test-secret-key-1234567890abcdef")
	if _, err := authority.IssueTransportToken("user-1", "user@example.com", TokenContext{
		Roles: []string{"admin"},
	}, "web"); err == nil {
		t.Fatal("ver5 token without registry session id must be rejected")
	}
}

func TestIssueTransportToken_RejectsOrganizationScopeWithoutMembershipCredentials(t *testing.T) {
	authority := mustTestAuthority(t, "test-secret-key-1234567890abcdef")
	_, err := authority.IssueTransportToken("user-1", "user@example.com", TokenContext{OrgID: "org-1", Roles: []string{"admin"}, SessionID: "sess-1"}, "web")
	if err == nil {
		t.Fatal("organization-scoped token without membership credentials must be rejected")
	}
}

func TestIssueTransportToken_RejectsOrganizationScopeWithoutOrganizationCredentialVersion(t *testing.T) {
	authority := mustTestAuthority(t, "test-secret-key-1234567890abcdef")
	_, err := authority.IssueTransportToken("user-1", "user@example.com", TokenContext{
		OrgID:                       "org-1",
		Roles:                       []string{"admin"},
		MembershipID:                "membership-1",
		MembershipCredentialVersion: 1,
		SessionID:                   "sess-1",
	}, "web")
	if err == nil {
		t.Fatal("organization-scoped token without organization credential version must be rejected")
	}
}

func TestIssueSupportToken_PreservesCredentialEpochAndAbsoluteLifetime(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)
	started := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Second)
	token, err := authority.IssueSupportTokenFrom("platform-admin-1", "support@example.com", SupportClaims{
		OrgID:                         "organization-1",
		SessionID:                     "support-session-1",
		OrganizationCredentialVersion: 9,
		Reason:                        "customer support",
	}, started, "sess-support-1")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := authority.Validate(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Support == nil || claims.Support.OrganizationCredentialVersion != 9 {
		t.Fatalf("support claims = %+v, want credential version 9", claims.Support)
	}
	if claims.Sid != "sess-support-1" || claims.Typ != TokenTypeSupportAccess {
		t.Fatalf("sid/typ = %q/%q, want sess-support-1/%s", claims.Sid, claims.Typ, TokenTypeSupportAccess)
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != AudienceSupport {
		t.Fatalf("audience = %v, want [%s]", claims.Audience, AudienceSupport)
	}
	if !claims.AuthStartedAt.Time.Equal(started) {
		t.Fatalf("auth started at = %s, want %s", claims.AuthStartedAt.Time, started)
	}
	if want := started.Add(SupportTokenTTL); !claims.ExpiresAt.Time.Equal(want) {
		t.Fatalf("expiry = %s, want %s", claims.ExpiresAt.Time, want)
	}
}

func TestIssueSupportToken_RejectsMissingSessionCredentials(t *testing.T) {
	authority := mustTestAuthority(t, "test-secret-key-1234567890abcdef")
	tests := []SupportClaims{
		{SessionID: "support-session-1", OrganizationCredentialVersion: 1},
		{OrgID: "organization-1", OrganizationCredentialVersion: 1},
		{OrgID: "organization-1", SessionID: "support-session-1"},
	}
	for _, support := range tests {
		if _, err := authority.IssueSupportToken("platform-admin-1", "support@example.com", support, "sess-1"); err == nil {
			t.Fatalf("support claims %+v must be rejected", support)
		}
	}
	if _, err := authority.IssueSupportToken("platform-admin-1", "support@example.com", SupportClaims{
		OrgID: "organization-1", SessionID: "support-session-1", OrganizationCredentialVersion: 1,
	}, ""); err == nil {
		t.Fatal("support token without registry session id must be rejected")
	}
}

func TestValidate_RejectsSupportOrganizationMismatch(t *testing.T) {
	secret := "test-secret-key-1234567890abcdef"
	authority := mustTestAuthority(t, secret)
	now := time.Now()
	claims := &Claims{
		UserID: "platform-admin-1", Email: "support@example.com", OrgID: "organization-1",
		Support:       &SupportClaims{OrgID: "organization-2", SessionID: "support-session-1", OrganizationCredentialVersion: 1},
		Ver:           LegacyTokenVersion,
		AuthStartedAt: jwt.NewNumericDate(now),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	token, err := jwtNewSigned(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("support organization mismatch must be rejected")
	}
}

// TestValidate_RejectsKilessTokenUnderKeyringWithoutLegacyEntry documents the
// fail-closed rotation rule: ver4 tokens (no kid) only validate while the old
// secret is registered under the legacy kid.
func TestValidate_RejectsKilessTokenUnderKeyringWithoutLegacyEntry(t *testing.T) {
	keyring, err := NewKeyring("k-new", map[string]string{"k-new": "new-secret-key-1234567890abcdef0"})
	if err != nil {
		t.Fatal(err)
	}
	authority, err := NewAuthority(keyring, "")
	if err != nil {
		t.Fatal(err)
	}
	token, err := GenerateLegacyWebToken("u1", "u@example.com", TokenContext{
		Roles: []string{"admin"},
	}, "old-secret-key-1234567890abcdef0")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Validate(token); err == nil {
		t.Fatal("kidless ver4 token must fail closed when the legacy secret is not registered")
	}
}
