package domain

import (
	"errors"
	"regexp"
	"time"
)

// #640 / WEB-DT: authoritative availability and integrity for published
// DesignRevision artifacts. Metadata proves a row was published; health
// proves what storage can actually serve right now.

// DesignArtifactHealthStatus is the server-authoritative state of one
// published artifact, derived exclusively from observable storage truth.
type DesignArtifactHealthStatus string

const (
	// DesignArtifactHealthAvailable: the metadata row exists, the bytes exist,
	// and both the observed size and SHA-256 match the persisted metadata.
	DesignArtifactHealthAvailable DesignArtifactHealthStatus = "available"
	// DesignArtifactHealthMissing: the metadata row exists but the backing
	// bytes cannot be found (or read) in storage.
	DesignArtifactHealthMissing DesignArtifactHealthStatus = "missing"
	// DesignArtifactHealthIntegrityMismatch: the bytes exist but the observed
	// size and/or SHA-256 differ from the published metadata, or the persisted
	// digest is not in the canonical form so integrity cannot be proven.
	DesignArtifactHealthIntegrityMismatch DesignArtifactHealthStatus = "integrity_mismatch"
)

func IsValidDesignArtifactHealthStatus(st DesignArtifactHealthStatus) bool {
	switch st {
	case DesignArtifactHealthAvailable, DesignArtifactHealthMissing, DesignArtifactHealthIntegrityMismatch:
		return true
	default:
		return false
	}
}

var (
	// ErrArtifactBytesMissing fails closed the signed-read authorization when
	// the artifact metadata exists but its bytes cannot be found (#640 §7).
	ErrArtifactBytesMissing = errors.New("design artifact bytes are missing from storage")
	// ErrArtifactBytesIntegrityMismatch fails closed the signed-read
	// authorization when stored bytes do not match the published metadata.
	ErrArtifactBytesIntegrityMismatch = errors.New("design artifact bytes do not match the published metadata")
)

// canonicalArtifactSHA256Pattern is the one persisted digest representation
// (OpenAPI `^sha256-[0-9a-f]{64}$`, DB CHECK in migration 000114). A second
// representation must never be invented (#640 §5).
var canonicalArtifactSHA256Pattern = regexp.MustCompile(`^sha256-[0-9a-f]{64}$`)

// IsValidCanonicalArtifactSHA256 reports whether a digest is exactly the
// canonical sha256-<64 lowercase hex> form.
func IsValidCanonicalArtifactSHA256(digest string) bool {
	return canonicalArtifactSHA256Pattern.MatchString(digest)
}

// DesignArtifactHealth is the read-model projection of one verification pass.
// CheckedAt is the server time of the observation; health is never persisted
// or cached across requests (#640 §6: correctness first).
type DesignArtifactHealth struct {
	Status    DesignArtifactHealthStatus `json:"status"`
	CheckedAt time.Time                  `json:"checked_at"`
}

// ClassifyDesignArtifactHealth is the pure, server-authoritative health
// decision for one artifact. Inputs come from the persisted metadata row and
// one observation of the backing bytes:
//
//   - bytesFound=false                          → missing
//   - persisted digest not canonical            → integrity_mismatch (fail
//     closed: arbitrary strings are never reinterpreted as digests)
//   - size or digest differs                    → integrity_mismatch
//   - everything matches                        → available
//
// `available` is NEVER derived from metadata presence alone.
func ClassifyDesignArtifactHealth(metaSizeBytes int64, metaSHA256 string, bytesFound bool, actualSizeBytes int64, actualSHA256 string) DesignArtifactHealthStatus {
	if !bytesFound {
		return DesignArtifactHealthMissing
	}
	if metaSizeBytes < 0 || !IsValidCanonicalArtifactSHA256(metaSHA256) {
		return DesignArtifactHealthIntegrityMismatch
	}
	if actualSizeBytes != metaSizeBytes {
		return DesignArtifactHealthIntegrityMismatch
	}
	if actualSHA256 != metaSHA256 {
		return DesignArtifactHealthIntegrityMismatch
	}
	return DesignArtifactHealthAvailable
}

// HealthError maps an unhealthy status to its typed fail-closed error for the
// authorization boundary. Healthy artifacts return nil.
func (st DesignArtifactHealthStatus) HealthError() error {
	switch st {
	case DesignArtifactHealthMissing:
		return ErrArtifactBytesMissing
	case DesignArtifactHealthIntegrityMismatch:
		return ErrArtifactBytesIntegrityMismatch
	default:
		return nil
	}
}
