package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #640: authoritative artifact health at the API boundary. Every fixture uses
// a real temporary filesystem and real artifact metadata: available is only
// ever derived from observed bytes, and authorization fails closed with typed
// errors for missing or tampered artifacts.

// artifactHealthEnv stages one published model artifact whose backing bytes
// are physically present under the organization media partition.
type artifactHealthEnv struct {
	srv     *Server
	store   *stubStore
	dir     string
	storage string // server storage key
	path    string // absolute backing file path
	sha256  string // digest of the staged bytes
	size    int64
}

func newArtifactHealthEnv(t *testing.T, content []byte) *artifactHealthEnv {
	t.Helper()
	dir := t.TempDir()
	sum := sha256.Sum256(content)
	sha := "sha256-" + hex.EncodeToString(sum[:])
	key := "designs/publish/" + publishTestSessionID + "/model-" + hex.EncodeToString(sum[:6]) + ".skp"
	path := filepath.Join(dir, storage.InitialOrganizationID, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o640); err != nil {
		t.Fatal(err)
	}

	artifact := &domain.DesignRevisionArtifact{
		ID: "a1", DesignRevisionID: publishTestRevision, Kind: domain.DesignPublishArtifactModel,
		StorageKey: key, ContentType: "application/octet-stream",
		SizeBytes: int64(len(content)), SHA256: sha,
	}
	store := &stubStore{
		getDesignRevisionArtifactResult: artifact,
		listDesignRevisionArtifactsResult: []domain.DesignRevisionArtifact{*artifact},
	}
	srv := &Server{
		Store:      store,
		MediaDir:   dir,
		MediaTokens: mustMediaAuthority(t, "design-artifact-health-test-media-key-0123456789"),
	}
	return &artifactHealthEnv{srv: srv, store: store, dir: dir, storage: key, path: path, sha256: sha, size: int64(len(content))}
}

func (e *artifactHealthEnv) listArtifacts(t *testing.T) []map[string]any {
	t.Helper()
	req := publishRequest(http.MethodGet,
		"/api/designs/"+designTestDesignID+"/revisions/"+publishTestRevision+"/artifacts", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	e.srv.HandleDesignRevisionArtifacts(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	var parsed []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed
}

func (e *artifactHealthEnv) authorize(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := publishRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/revisions/"+publishTestRevision+"/artifacts/model:authorize", "", string(domain.RoleAdmin))
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()
	e.srv.HandleDesignRevisionArtifactAuthorize(rr, req)
	return rr
}

func TestDesignArtifactHealth_HealthyBytesAreAvailableAndGrantable(t *testing.T) {
	env := newArtifactHealthEnv(t, []byte("healthy model bytes \x00\x01"))

	listed := env.listArtifacts(t)
	if len(listed) != 1 {
		t.Fatalf("listed %d artifacts, want 1", len(listed))
	}
	health, ok := listed[0]["health"].(map[string]any)
	if !ok {
		t.Fatalf("artifact must carry health: %v", listed[0])
	}
	if health["status"] != "available" {
		t.Fatalf("health.status = %v, want available", health["status"])
	}
	if checkedAt, _ := health["checked_at"].(string); checkedAt == "" {
		t.Fatal("health.checked_at must be present")
	}
	// The original metadata stays intact (no regeneration, no storage key leak).
	if listed[0]["sha256"] != env.sha256 || listed[0]["size_bytes"] != float64(env.size) {
		t.Fatalf("metadata drifted: %v", listed[0])
	}
	if body, _ := json.Marshal(listed[0]); strings.Contains(string(body), env.storage) {
		t.Fatal("storage key must never leave the server")
	}

	rr := env.authorize(t)
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "grant=") {
		t.Fatalf("healthy artifact must mint a grant: %s", rr.Body.String())
	}
}

func TestDesignArtifactHealth_MissingBytesFailClosed(t *testing.T) {
	env := newArtifactHealthEnv(t, []byte("model bytes that will vanish"))
	if err := os.Remove(env.path); err != nil {
		t.Fatal(err)
	}

	listed := env.listArtifacts(t)
	health, _ := listed[0]["health"].(map[string]any)
	if health["status"] != "missing" {
		t.Fatalf("health.status = %v, want missing", health["status"])
	}
	// Metadata survives byte loss verbatim: missing bytes never regenerate or
	// rewrite the published record.
	if listed[0]["sha256"] != env.sha256 || listed[0]["size_bytes"] != float64(env.size) {
		t.Fatalf("metadata drifted after byte loss: %v", listed[0])
	}

	rr := env.authorize(t)
	if rr.Code != http.StatusConflict {
		t.Fatalf("authorize status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "ARTIFACT_MISSING") {
		t.Fatalf("authorize must return typed ARTIFACT_MISSING: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "grant=") {
		t.Fatal("missing bytes must never mint a grant")
	}
}

func TestDesignArtifactHealth_TamperedBytesFailClosed(t *testing.T) {
	tamperCases := []struct {
		name    string
		content []byte
	}{
		{"digest differs same size", []byte("tampered model bytes")}, // 20 bytes, like the original
		{"size and digest differ", []byte("tampered different length")},
	}
	for _, tc := range tamperCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newArtifactHealthEnv(t, []byte("original model bytes"))
			if err := os.WriteFile(env.path, tc.content, 0o640); err != nil {
				t.Fatal(err)
			}

			listed := env.listArtifacts(t)
			health, _ := listed[0]["health"].(map[string]any)
			if health["status"] != "integrity_mismatch" {
				t.Fatalf("health.status = %v, want integrity_mismatch", health["status"])
			}
			// Published metadata is immutable: the tampered bytes are reported,
			// the recorded digest is never rewritten to match them.
			if listed[0]["sha256"] != env.sha256 || listed[0]["size_bytes"] != float64(env.size) {
				t.Fatalf("metadata drifted after tampering: %v", listed[0])
			}

			rr := env.authorize(t)
			if rr.Code != http.StatusConflict {
				t.Fatalf("authorize status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "ARTIFACT_INTEGRITY_MISMATCH") {
				t.Fatalf("authorize must return typed ARTIFACT_INTEGRITY_MISMATCH: %s", rr.Body.String())
			}
			if strings.Contains(rr.Body.String(), "grant=") {
				t.Fatal("tampered bytes must never mint a grant")
			}
		})
	}
}

// Foreign design/revision/artifact (including cross-tenant lookups resolved
// as not-found by RLS in production) stays a plain 404: byte state never
// becomes a tenant information oracle because health only runs after the
// tenant-scoped resolution succeeds.
func TestDesignArtifactHealth_UnresolvedArtifactStays404(t *testing.T) {
	env := newArtifactHealthEnv(t, []byte("bytes exist but the caller cannot resolve the artifact"))
	env.store.getDesignRevisionArtifactErr = domain.ErrDesignRevisionNotFound

	rr := env.authorize(t)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("authorize status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "ARTIFACT_MISSING") || strings.Contains(rr.Body.String(), "ARTIFACT_INTEGRITY_MISMATCH") {
		t.Fatalf("unresolved artifact must not leak byte state: %s", rr.Body.String())
	}
}

// Without observable storage no grant can be proven safe: fail closed typed,
// never mint against an unverifiable MediaDir.
func TestDesignArtifactHealth_UnconfiguredStorageFailsClosed(t *testing.T) {
	env := newArtifactHealthEnv(t, []byte("bytes on disk, but storage is unconfigured"))
	env.srv.MediaDir = ""

	rr := env.authorize(t)
	if rr.Code != http.StatusConflict {
		t.Fatalf("authorize status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "ARTIFACT_MISSING") {
		t.Fatalf("unconfigured storage must fail closed as ARTIFACT_MISSING: %s", rr.Body.String())
	}
}
