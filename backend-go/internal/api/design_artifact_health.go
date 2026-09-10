package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #640 / WEB-DT: authoritative artifact health verification.
//
// The bytes of a published artifact live on the filesystem under the
// organization media namespace; only the API layer owns MediaDir. This file
// is the single verification boundary: it observes the backing bytes of one
// DesignRevisionArtifact and feeds the observation to the pure domain
// classifier. Health is computed per request and never persisted — there is
// no second artifact-health store.
//
// Cost (#640 §8): one stat plus one streaming SHA-256 pass per artifact per
// request; a size mismatch short-circuits without hashing. Current DEMO
// artifacts are small (manifest ≤1 MiB, preview ≤16 MiB, .skp model ≤256 MiB
// worst case), so direct verification is the correctness-first choice; no
// cache is introduced.

// verifyDesignArtifactHealth observes the backing bytes of one published
// artifact under the caller's organization partition and classifies health.
// Bytes that cannot be found or read classify as missing: an unreadable file
// can never prove availability. The revision and its metadata are never
// mutated.
func (s *Server) verifyDesignArtifactHealth(ctx context.Context, a domain.DesignRevisionArtifact) domain.DesignArtifactHealth {
	status := domain.DesignArtifactHealthMissing
	if path, ok := s.designArtifactStoragePath(ctx, a.StorageKey); ok {
		if actualSize, actualSHA, found := hashDesignArtifactFile(path); found {
			status = domain.ClassifyDesignArtifactHealth(a.SizeBytes, a.SHA256, true, actualSize, actualSHA)
		}
	}
	return domain.DesignArtifactHealth{Status: status, CheckedAt: time.Now().UTC()}
}

// hashDesignArtifactFile streams one file and returns its size and canonical
// sha256-<hex> digest. found=false means the file is absent or unreadable.
func hashDesignArtifactFile(path string) (int64, string, bool) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return 0, "", false
	}
	hasher := sha256.New()
	size, err := io.Copy(hasher, f)
	if err != nil {
		return 0, "", false
	}
	return size, "sha256-" + hex.EncodeToString(hasher.Sum(nil)), true
}

// toDesignRevisionArtifactDTOWithHealth projects one artifact with its
// authoritative health. Storage keys and paths never leave the server.
func (s *Server) toDesignRevisionArtifactDTOWithHealth(ctx context.Context, a domain.DesignRevisionArtifact) openapi.DesignRevisionArtifact {
	dto := toDesignRevisionArtifactDTO(a)
	health := s.verifyDesignArtifactHealth(ctx, a)
	dto.Health = openapi.DesignArtifactHealth{
		Status:    openapi.DesignArtifactHealthStatus(health.Status),
		CheckedAt: health.CheckedAt.Format(time.RFC3339Nano),
	}
	return dto
}

// toDesignRevisionDTOWithArtifactHealth projects a revision whose embedded
// artifacts carry authoritative health (#640 read model).
func (s *Server) toDesignRevisionDTOWithArtifactHealth(ctx context.Context, rev domain.DesignRevision) openapi.DesignRevision {
	dto := toDesignRevisionDTO(rev)
	if rev.Artifacts != nil {
		dto.Artifacts = make([]openapi.DesignRevisionArtifact, 0, len(rev.Artifacts))
		for _, a := range rev.Artifacts {
			dto.Artifacts = append(dto.Artifacts, s.toDesignRevisionArtifactDTOWithHealth(ctx, a))
		}
	}
	return dto
}
