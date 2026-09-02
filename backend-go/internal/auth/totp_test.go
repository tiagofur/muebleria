package auth

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// RFC 6238 Appendix B test vectors (SHA1, 8 digits) truncated to the 6-digit
// form our fixed profile uses. Seed: ASCII "12345678901234567890".
var rfc6238Vectors = []struct {
	unix   int64
	code8  string
	code6  string
}{
	{59, "94287082", "287082"},
	{1111111109, "07081804", "081804"},
	{1111111111, "14050471", "050471"},
	{1234567890, "89005924", "005924"},
	{2000000000, "69279037", "279037"},
	{20000000000, "65353130", "353130"},
}

func TestTOTPRFC6238Vectors(t *testing.T) {
	seed := []byte("12345678901234567890")
	for _, v := range rfc6238Vectors {
		at := time.Unix(v.unix, 0).UTC()
		if got := TOTPCode(seed, TOTPCounter(at)); got != v.code6 {
			t.Errorf("TOTPCode(t=%d) = %s, want %s (8-digit vector %s)", v.unix, got, v.code6, v.code8)
		}
	}
}

func TestVerifyTOTPWindowAndReplayCounter(t *testing.T) {
	raw, _, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret: %v", err)
	}
	now := time.Unix(1_700_000_000, 0).UTC().Truncate(TOTPPeriod).Add(7 * time.Second)
	counter := TOTPCounter(now)
	code := TOTPCode(raw, counter)

	// Exact interval and ±1 window accept.
	for _, offset := range []time.Duration{-TOTPPeriod, 0, TOTPPeriod} {
		ver, err := VerifyTOTP(raw, code, now.Add(offset))
		if err != nil {
			t.Fatalf("window offset %v rejected a valid code: %v", offset, err)
		}
		if ver.Counter != counter {
			t.Fatalf("accepted counter %d, want %d", ver.Counter, counter)
		}
	}
	// Two intervals out rejects.
	if _, err := VerifyTOTP(raw, code, now.Add(2*TOTPPeriod)); err == nil {
		t.Fatal("code accepted outside the ±1 window")
	}
	if _, err := VerifyTOTP(raw, code, now.Add(-2*TOTPPeriod)); err == nil {
		t.Fatal("stale code accepted outside the ±1 window")
	}

	// The next interval's code is a DIFFERENT string and verifies as counter+1.
	nextCode := TOTPCode(raw, counter+1)
	if nextCode == code {
		t.Fatal("adjacent counters produced identical codes")
	}
	ver, err := VerifyTOTP(raw, nextCode, now.Add(TOTPPeriod))
	if err != nil || ver.Counter != counter+1 {
		t.Fatalf("next-interval code: ver=%+v err=%v", ver, err)
	}
}

func TestVerifyTOTPInputNormalization(t *testing.T) {
	raw, _, _ := GenerateTOTPSecret()
	now := time.Unix(1_700_000_000, 0).UTC()
	code := TOTPCode(raw, TOTPCounter(now))
	if _, err := VerifyTOTP(raw, " "+code+" ", now); err != nil {
		t.Fatalf("spaced code rejected: %v", err)
	}
	if _, err := VerifyTOTP(raw, "12345", now); err == nil {
		t.Fatal("short code accepted")
	}
	if _, err := VerifyTOTP(raw, "1234567", now); err == nil {
		t.Fatal("long code accepted")
	}
	if _, err := VerifyTOTP(raw, "abcdef", now); err == nil {
		t.Fatal("non-digit code accepted")
	}
}

func TestGenerateTOTPSecretEntropy(t *testing.T) {
	a, aEnc, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret: %v", err)
	}
	if len(a) != TOTPSecretLen {
		t.Fatalf("secret length %d", len(a))
	}
	b, _, _ := GenerateTOTPSecret()
	if hex.EncodeToString(a) == hex.EncodeToString(b) {
		t.Fatal("two secrets identical")
	}
	// The base32 form must round-trip for provisioning URI consumers.
	decoded, err := totpBase32.DecodeString(aEnc)
	if err != nil {
		t.Fatalf("encoded secret not base32: %v", err)
	}
	if hex.EncodeToString(decoded) != hex.EncodeToString(a) {
		t.Fatal("base32 round-trip mismatch")
	}
}

func TestBuildTOTPProvisioningURI(t *testing.T) {
	uri := BuildTOTPProvisioningURI("ana@taller.mx", "Granete", "JBSWY3DPEHPK3PXP")
	// `@` is a legal path character and the canonical otpauth label keeps the
	// bare email (every authenticator renders `Issuer:email`).
	want := "otpauth://totp/Granete:ana@taller.mx?algorithm=SHA1&digits=6&issuer=Granete&period=30&secret=JBSWY3DPEHPK3PXP"
	if uri != want {
		t.Fatalf("uri mismatch:\n got %s\nwant %s", uri, want)
	}
	// A label with a `/` must not break the path grammar.
	uri = BuildTOTPProvisioningURI("ana/taller", "Granete", "JBSWY3DPEHPK3PXP")
	if !strings.HasPrefix(uri, "otpauth://totp/Granete:ana%2Ftaller?") {
		t.Fatalf("slash not escaped: %s", uri)
	}
}

func TestGenerateRecoveryCodes(t *testing.T) {
	codes, err := GenerateRecoveryCodes(10)
	if err != nil {
		t.Fatalf("codes: %v", err)
	}
	if len(codes) != 10 {
		t.Fatalf("count %d", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 11 || c[5] != '-' {
			t.Fatalf("malformed code %q", c)
		}
		for _, r := range c {
			if r == '0' || r == '1' || r == 'O' || r == 'I' {
				t.Fatalf("confusable rune %q in %q", r, c)
			}
		}
		if seen[c] {
			t.Fatalf("duplicate code %q", c)
		}
		seen[c] = true
	}
	if _, err := GenerateRecoveryCodes(0); err == nil {
		t.Fatal("zero count accepted")
	}
}
