package domain

import (
	"errors"
	"strings"
	"testing"
)

// #640: the pure health classifier proves the canonical semantics — available
// is derived from observed bytes matching persisted metadata, never from
// metadata presence alone.

var healthTestDigest = "sha256-" + strings.Repeat("ab", 32)
var healthTestOtherDigest = "sha256-" + strings.Repeat("cd", 32)

func TestClassifyDesignArtifactHealth(t *testing.T) {
	type meta struct {
		size int64
		sha  string
	}
	type actual struct {
		found bool
		size  int64
		sha   string
	}
	cases := []struct {
		name   string
		meta   meta
		actual actual
		want   DesignArtifactHealthStatus
	}{
		{
			name:   "healthy bytes match size and digest",
			meta:   meta{42, healthTestDigest},
			actual: actual{true, 42, healthTestDigest},
			want:   DesignArtifactHealthAvailable,
		},
		{
			name:   "bytes deleted behind metadata",
			meta:   meta{42, healthTestDigest},
			actual: actual{false, 0, ""},
			want:   DesignArtifactHealthMissing,
		},
		{
			name:   "tampered bytes same size different digest",
			meta:   meta{42, healthTestDigest},
			actual: actual{true, 42, healthTestOtherDigest},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
		{
			name:   "tampered bytes different size",
			meta:   meta{42, healthTestDigest},
			actual: actual{true, 43, healthTestDigest},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
		{
			name:   "tampered bytes differ in both",
			meta:   meta{42, healthTestDigest},
			actual: actual{true, 7, healthTestOtherDigest},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
		{
			name:   "malformed persisted digest fails closed even with bytes",
			meta:   meta{42, "sha256:" + strings.Repeat("ab", 32)},
			actual: actual{true, 42, healthTestDigest},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
		{
			name:   "empty persisted digest fails closed",
			meta:   meta{42, ""},
			actual: actual{true, 42, healthTestDigest},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
		{
			name:   "uppercase hex digest is not canonical",
			meta:   meta{42, "sha256-" + strings.Repeat("AB", 32)},
			actual: actual{true, 42, "sha256-" + strings.Repeat("AB", 32)},
			want:   DesignArtifactHealthIntegrityMismatch,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyDesignArtifactHealth(tc.meta.size, tc.meta.sha, tc.actual.found, tc.actual.size, tc.actual.sha)
			if got != tc.want {
				t.Fatalf("health = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestDesignArtifactHealthStatus_HealthError(t *testing.T) {
	if err := DesignArtifactHealthAvailable.HealthError(); err != nil {
		t.Fatalf("available must not carry an error: %v", err)
	}
	if !errors.Is(DesignArtifactHealthMissing.HealthError(), ErrArtifactBytesMissing) {
		t.Fatal("missing must map to ErrArtifactBytesMissing")
	}
	if !errors.Is(DesignArtifactHealthIntegrityMismatch.HealthError(), ErrArtifactBytesIntegrityMismatch) {
		t.Fatal("integrity_mismatch must map to ErrArtifactBytesIntegrityMismatch")
	}
}

func TestIsValidCanonicalArtifactSHA256(t *testing.T) {
	valid := []string{
		healthTestDigest,
		"sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	}
	for _, v := range valid {
		if !IsValidCanonicalArtifactSHA256(v) {
			t.Errorf("%s must be canonical", v)
		}
	}
	invalid := []string{
		"",
		"sha256:",
		"sha256-" + strings.Repeat("ab", 31),
		"sha256-" + strings.Repeat("ab", 33),
		"sha256-" + strings.Repeat("AB", 32),
		"sha1-" + strings.Repeat("ab", 32),
		strings.Repeat("ab", 64),
		" sha256-" + strings.Repeat("ab", 32),
	}
	for _, v := range invalid {
		if IsValidCanonicalArtifactSHA256(v) {
			t.Errorf("%q must NOT be canonical", v)
		}
	}
}
