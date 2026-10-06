package domain_test

// #1164: Go<->Ruby parity pin for the library manifestHash contract. The
// same fixture is asserted by the SketchUp extension's Ruby suite
// (library_manifest_hash_test.rb); changing the digest algorithm on either
// side without the other must break here first.
import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestManifestHashParityFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/fixtures/library-manifest-hash-parity.json")
	if err != nil {
		t.Fatalf("read parity fixture: %v", err)
	}
	var fx struct {
		Manifest       domain.LibraryManifest `json:"manifest"`
		ExpectedDigest string                 `json:"expectedDigest"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parse parity fixture: %v", err)
	}

	hash, finalBytes, err := domain.ComputeManifestHash(&fx.Manifest)
	if err != nil {
		t.Fatalf("compute manifest hash: %v", err)
	}
	if hash != fx.ExpectedDigest {
		t.Errorf("computed digest %s != pinned expectedDigest %s", hash, fx.ExpectedDigest)
	}

	// The digest is reproducible from the SERVED form: round-trip the
	// canonical bytes through a generic document (destroying struct order,
	// exactly like the server's jsonb storage does) and recompute — the
	// manifestHash field itself is excluded from the payload and must not
	// influence the result.
	var generic map[string]any
	if err := json.Unmarshal(finalBytes, &generic); err != nil {
		t.Fatalf("round-trip manifest: %v", err)
	}
	reordered, err := json.Marshal(generic)
	if err != nil {
		t.Fatalf("re-marshal manifest: %v", err)
	}
	var parsed domain.LibraryManifest
	if err := json.Unmarshal(reordered, &parsed); err != nil {
		t.Fatalf("parse reordered manifest: %v", err)
	}
	recomputed, _, err := domain.ComputeManifestHash(&parsed)
	if err != nil {
		t.Fatalf("recompute manifest hash: %v", err)
	}
	if recomputed != fx.ExpectedDigest {
		t.Errorf("digest recomputed from jsonb-style bytes %s != pinned %s", recomputed, fx.ExpectedDigest)
	}
}
