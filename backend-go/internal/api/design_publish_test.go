package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func timeNowPlusHour() time.Time { return time.Now().Add(time.Hour) }

// #392 / DT-8 staged publish API handler tests (withClaims + stubStore):
// role guards, generated-DTO decode, typed error mapping, multipart artifact
// upload with server-side SHA-256, extension capability boundary and the
// signed artifact read path.

const (
	publishTestSessionID = "54000000-0000-0000-0000-000000000001"
	publishTestRevision  = "53000000-0000-0000-0000-000000000001"
)

func publishRequest(method, target, body, role string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, target, reader), "admin-1", role)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("sessionId", publishTestSessionID)
	req.SetPathValue("revisionId", publishTestRevision)
	return req
}

func publishManifestJSON(items ...string) string {
	itemJSON := make([]string, 0, len(items))
	for _, id := range items {
		itemJSON = append(itemJSON, fmt.Sprintf(`{"furnitureInstanceId":%q}`, id))
	}
	return fmt.Sprintf(`{
		"schemaVersion": 1,
		"projectId": %q,
		"designId": %q,
		"baseRevisionId": null,
		"source": {"client":"sketchup","sketchupVersion":"24.0.145","pluginVersion":"0.1.0"},
		"items": [%s]
	}`, designTestProjectID, designTestDesignID, strings.Join(itemJSON, ","))
}

func TestHandleDesignPublishPrepare_Returns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := publishRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/publish:prepare",
		`{"manifest":`+publishManifestJSON(designTestInstanceID)+`}`, string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishPrepare(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.prepareDesignPublishCmd == nil {
		t.Fatal("store must receive prepare command")
	}
	cmd := *store.prepareDesignPublishCmd
	if cmd.DesignID != designTestDesignID || cmd.Manifest.ProjectID != designTestProjectID {
		t.Fatalf("command mismatch: %+v", cmd)
	}
	if len(cmd.Manifest.Items) != 1 || cmd.Manifest.Items[0].FurnitureInstanceID != designTestInstanceID {
		t.Fatalf("manifest items lost: %+v", cmd.Manifest.Items)
	}
	body := rr.Body.String()
	for _, key := range []string{`"status":"prepared"`, `"required_artifacts"`, `"expires_at"`} {
		if !strings.Contains(body, key) {
			t.Fatalf("session DTO missing %s: %s", key, body)
		}
	}
}

func TestHandleDesignPublishPrepare_RoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := publishRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/publish:prepare",
		`{"manifest":`+publishManifestJSON()+`}`, string(domain.RoleProduccion))
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishPrepare(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
	if store.prepareDesignPublishCmd != nil {
		t.Fatal("production role must not prepare publications")
	}
}

func TestHandleDesignPublishPrepare_DuplicateManifestIDsRejected(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := publishRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/publish:prepare",
		`{"manifest":`+publishManifestJSON(designTestInstanceID, designTestInstanceID)+`}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishPrepare(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for duplicate manifest IDs (body=%s)", rr.Code, rr.Body.String())
	}
	if store.prepareDesignPublishCmd != nil {
		t.Fatal("duplicate IDs must never reach the store")
	}
}

func TestHandleDesignPublishPrepare_TypedErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"manifest mismatch is 409", domain.ErrPublishManifestWorkingCopyMismatch, http.StatusConflict},
		{"stale base is 409", domain.ErrDesignRevisionConflict, http.StatusConflict},
		{"unknown design is 404", domain.ErrDesignNotFound, http.StatusNotFound},
		{"invalid manifest is 400", domain.ErrPublishManifestInvalid, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{prepareDesignPublishErr: tc.err}
			srv := &Server{Store: store}
			req := publishRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/publish:prepare",
				`{"manifest":`+publishManifestJSON()+`}`, string(domain.RoleAdmin))
			rr := httptest.NewRecorder()

			srv.HandleDesignPublishPrepare(rr, req)

			if rr.Code != tc.code {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.code, rr.Body.String())
			}
		})
	}
}

func multipartUploadBody(t *testing.T, field, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return &buf, writer.FormDataContentType()
}

func newPublishUploadEnv(t *testing.T) (*Server, string, *stubStore) {
	t.Helper()
	dir := t.TempDir()
	store := &stubStore{publishSessionDetail: &storage.DesignPublishSessionDetail{
		Session: &domain.DesignPublishSession{
			ID:        publishTestSessionID,
			DesignID:  designTestDesignID,
			Status:    "prepared",
			ExpiresAt: timeNowPlusHour(),
		},
	}}
	srv := &Server{Store: store, MediaDir: dir}
	return srv, dir, store
}

func TestHandleDesignPublishArtifactUpload_StoresAndHashes(t *testing.T) {
	srv, dir, store := newPublishUploadEnv(t)

	content := []byte("fake skp bytes \x00\x01\x02")
	body, contentType := multipartUploadBody(t, "file", "model.skp", content)
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+"/artifacts/model", body),
		"admin-1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("sessionId", publishTestSessionID)
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishArtifactUpload(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.recordDesignPublishArtifactCmd == nil {
		t.Fatal("store must receive the artifact metadata")
	}
	cmd := *store.recordDesignPublishArtifactCmd
	sum := sha256.Sum256(content)
	wantSHA := "sha256-" + hex.EncodeToString(sum[:])
	if cmd.SHA256 != wantSHA {
		t.Fatalf("sha = %s, want %s", cmd.SHA256, wantSHA)
	}
	if cmd.SizeBytes != int64(len(content)) || cmd.ContentType != "application/octet-stream" {
		t.Fatalf("metadata mismatch: %+v", cmd)
	}
	if !strings.HasPrefix(cmd.StorageKey, "designs/publish/"+publishTestSessionID+"/model-") ||
		!strings.HasSuffix(cmd.StorageKey, ".skp") {
		t.Fatalf("storage key = %s", cmd.StorageKey)
	}
	// The file physically exists under the org partition at the storage key.
	path := filepath.Join(dir, storage.InitialOrganizationID, filepath.FromSlash(cmd.StorageKey))
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("artifact file must exist at %s: %v", path, err)
	}
	if !bytes.Equal(got, content) {
		t.Fatal("artifact bytes differ from upload")
	}
}

func TestHandleDesignPublishArtifactUpload_ManifestMustBeJSON(t *testing.T) {
	srv, _, store := newPublishUploadEnv(t)

	body, contentType := multipartUploadBody(t, "file", "model.skp", []byte("not json"))
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+"/artifacts/manifest", body),
		"admin-1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("sessionId", publishTestSessionID)
	req.SetPathValue("kind", "manifest")
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishArtifactUpload(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for invalid manifest artifact (body=%s)", rr.Code, rr.Body.String())
	}
	if store.recordDesignPublishArtifactCmd != nil {
		t.Fatal("invalid manifest must not be staged")
	}
}

func TestHandleDesignPublishArtifactUpload_ModelRequiresSkpFilename(t *testing.T) {
	srv, _, store := newPublishUploadEnv(t)

	body, contentType := multipartUploadBody(t, "file", "model.zip", []byte("zip"))
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+"/artifacts/model", body),
		"admin-1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("sessionId", publishTestSessionID)
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishArtifactUpload(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.recordDesignPublishArtifactCmd != nil {
		t.Fatal("non-.skp model artifact must not be staged")
	}
}

func TestHandleDesignPublishArtifactUpload_SessionNotPreparedRejected(t *testing.T) {
	store := &stubStore{getPublishSessionErr: domain.ErrPublishSessionNotFound}
	srv := &Server{Store: store, MediaDir: t.TempDir()}

	body, contentType := multipartUploadBody(t, "file", "model.skp", []byte("x"))
	req := withClaims(httptest.NewRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+"/artifacts/model", body),
		"admin-1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("sessionId", publishTestSessionID)
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishArtifactUpload(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.recordDesignPublishArtifactCmd != nil {
		t.Fatal("unknown session must not accept artifacts")
	}
}

func TestHandleDesignPublishFinalize_Returns201Revision(t *testing.T) {
	store := &stubStore{publishSessionDetail: &storage.DesignPublishSessionDetail{
		Session: &domain.DesignPublishSession{
			ID: publishTestSessionID, DesignID: designTestDesignID, Status: "finalized",
			FinalizedRevisionID: strPtr(publishTestRevision),
		},
	}}
	srv := &Server{Store: store}
	req := publishRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+":finalize", "", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishFinalize(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.finalizeDesignPublishCmd == nil {
		t.Fatal("store must receive finalize command")
	}
	if cmd := *store.finalizeDesignPublishCmd; cmd.SessionID != publishTestSessionID || cmd.DesignID != designTestDesignID {
		t.Fatalf("command mismatch: %+v", cmd)
	}
	if !strings.Contains(rr.Body.String(), `"source_type":"sketchup"`) {
		t.Fatalf("finalize must publish a sketchup-source revision: %s", rr.Body.String())
	}
}

func TestHandleDesignPublishFinalize_MissingArtifactsRejected(t *testing.T) {
	store := &stubStore{publishSessionDetail: &storage.DesignPublishSessionDetail{
		Session: &domain.DesignPublishSession{
			ID: publishTestSessionID, DesignID: designTestDesignID, Status: "prepared",
			ExpiresAt: timeNowPlusHour(),
		},
	}}
	srv := &Server{Store: store, MediaDir: t.TempDir()}
	req := publishRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/publish/"+publishTestSessionID+":finalize", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignPublishFinalize(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when artifacts are missing (body=%s)", rr.Code, rr.Body.String())
	}
	if store.finalizeDesignPublishCmd != nil {
		t.Fatal("finalize must not run without every required artifact")
	}
}

func TestHandleDesignRevisionArtifacts_List(t *testing.T) {
	store := &stubStore{listDesignRevisionArtifactsResult: []domain.DesignRevisionArtifact{
		{ID: "a1", DesignRevisionID: publishTestRevision, Kind: domain.DesignPublishArtifactModel,
			ContentType: "application/octet-stream", SizeBytes: 42, SHA256: "sha256-" + strings.Repeat("ab", 32)},
	}}
	srv := &Server{Store: store}
	req := publishRequest(http.MethodGet,
		"/api/designs/"+designTestDesignID+"/revisions/"+publishTestRevision+"/artifacts", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignRevisionArtifacts(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"kind":"model"`) || !strings.Contains(rr.Body.String(), `"sha256":"sha256-`) {
		t.Fatalf("artifact metadata missing: %s", rr.Body.String())
	}
}

// The SketchUp extension credential gains exactly the staged-publish POST
// surface and the artifact read path — nothing else (#392 §34).
func TestDesignPublish_ExtensionCapabilityBoundary(t *testing.T) {
	allowed := [][2]string{
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish:prepare"},
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish/" + publishTestSessionID + "/artifacts/model"},
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish/" + publishTestSessionID + "/artifacts/manifest"},
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish/" + publishTestSessionID + "/artifacts/preview"},
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish/" + publishTestSessionID + ":finalize"},
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/revisions/" + publishTestRevision + "/artifacts/preview:authorize"},
		{http.MethodGet, "/api/design-artifacts/designs/publish/" + publishTestSessionID + "/model-abcdef123456.skp"},
	}
	for _, c := range allowed {
		if !extensionClientMayAccess(c[0], c[1]) {
			t.Errorf("extension must access %s %s", c[0], c[1])
		}
	}

	denied := [][2]string{
		// Bare revision publish stays web-only for the extension bearer.
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/revisions"},
		// Unknown artifact kinds are not part of the grant.
		{http.MethodPost, "/api/designs/" + designTestDesignID + "/publish/" + publishTestSessionID + "/artifacts/bom"},
		// Arbitrary design mutations stay out.
		{http.MethodDelete, "/api/designs/" + designTestDesignID},
		{http.MethodPut, "/api/designs/" + designTestDesignID + "/revisions/" + publishTestRevision},
	}
	for _, c := range denied {
		if extensionClientMayAccess(c[0], c[1]) {
			t.Errorf("extension must NOT access %s %s", c[0], c[1])
		}
	}
}

// The full router must register the #392 patterns without ServeMux conflicts
// (the publish command router coexists with the more-specific artifact path).
func TestDesignPublish_RouterRegistration(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store, Tokens: mustAuthority("design-publish-router-test-jwt-secret-0123456789"), allowedOrigins: []string{"http://localhost"}}
	router := RegisterRoutes(server)
	if router == nil {
		t.Fatal("RegisterRoutes must succeed")
	}
}

func TestHandleDesignRevisionArtifactAuthorize_MintsGrant(t *testing.T) {
	media := mustMediaAuthority(t, "design-publish-test-media-signing-key-0123456789")
	store := &stubStore{getDesignRevisionArtifactResult: &domain.DesignRevisionArtifact{
		ID: "a1", DesignRevisionID: publishTestRevision, Kind: domain.DesignPublishArtifactModel,
		StorageKey:  "designs/publish/" + publishTestSessionID + "/model-abcdef123456.skp",
		ContentType: "application/octet-stream", SizeBytes: 3, SHA256: "sha256-" + strings.Repeat("ab", 32),
	}}
	srv := &Server{Store: store, MediaTokens: media}
	req := publishRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/revisions/"+publishTestRevision+"/artifacts/model:authorize", "", string(domain.RoleAdmin))
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()

	srv.HandleDesignRevisionArtifactAuthorize(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	var grant struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(grant.URL, "/api/design-artifacts/designs/publish/") ||
		!strings.Contains(grant.URL, "grant=") {
		t.Fatalf("grant URL = %s", grant.URL)
	}
}

func TestHandleDesignRevisionArtifactAuthorize_UnknownArtifact404(t *testing.T) {
	media := mustMediaAuthority(t, "design-publish-test-media-signing-key-0123456789")
	store := &stubStore{getDesignRevisionArtifactErr: domain.ErrDesignRevisionNotFound}
	srv := &Server{Store: store, MediaTokens: media}
	req := publishRequest(http.MethodPost,
		"/api/designs/"+designTestDesignID+"/revisions/"+publishTestRevision+"/artifacts/model:authorize", "", string(domain.RoleAdmin))
	req.SetPathValue("kind", "model")
	rr := httptest.NewRecorder()

	srv.HandleDesignRevisionArtifactAuthorize(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func strPtr(v string) *string { return &v }
