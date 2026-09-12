package api

import (
	"bytes"
	"context"
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
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #667 / M1 correction round R1/R3/R5: these tests drive the REAL router
// (RegisterRoutes: ServeMux patterns, AuthMiddleware with its tenant
// transaction, RequireIdempotency receipts) against a throwaway PostgreSQL
// database and a real filesystem — never direct handler calls with hand-set
// path values. The URLs are the EXACT shapes the generated TypeScript client
// builds (packages/storage/src/openapi/generated/client.ts):
//
//	GET    /hardware-assets                     listHardwareAssets
//	GET    /hardware-assets/{assetId}           getHardwareAsset
//	POST   /hardware-assets/uploads             startHardwareAssetUpload (+Idempotency-Key)
//	GET    /hardware-assets/uploads/{id}        getHardwareAssetUploadSession
//	POST   /hardware-assets/uploads/{id}:finalize  finalizeHardwareAssetUpload (+key)
//	POST   /hardware-assets/uploads/{id}:cancel   cancelHardwareAssetUpload (no key)
//	POST   /hardware-assets/{assetId}:retire    retireHardwareAsset (+key)
//	POST   /hardware-assets/{assetId}/revisions/{revisionId}:authorize
//	GET    /api/hardware-assets/files/{key}?grant=…   (byte readback, grant-auth)

const (
	hwRouterOrg   = storage.InitialOrganizationID
	hwRouterUser  = "21000000-0000-0000-0000-0000000000e3"
	hwRouterEmail = "asset-router@test.local"
)

type hwRouterEnv struct {
	store    *storage.PostgresStore
	pool     *pgxpool.Pool
	srv      *Server
	router   http.Handler
	token    string
	mediaDir string
}

func newHwAssetRouterEnv(t *testing.T) *hwRouterEnv {
	t.Helper()
	store, pool := hwAssetE2EStore(t)

	// Real actor rows: the auth middleware re-reads user, membership, session
	// and organization state on every request. The backfilled initial
	// organization is born suspended in a fresh database; the fixture opts it
	// back in AFTER seeding its admin membership (the team invariant requires
	// an active admin) — throwaway DB.
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		VALUES ($1, $2, 'x', 'Asset Router', 'active', $2)
		ON CONFLICT (id) DO NOTHING`, hwRouterUser, hwRouterEmail); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, ARRAY['admin']::text[])`, hwRouterOrg, hwRouterUser); err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		UPDATE organizations SET status = 'active' WHERE id = $1`, hwRouterOrg); err != nil {
		t.Fatalf("activate fixture org: %v", err)
	}
	var membershipID string
	var membershipVersion, orgVersion int64
	var orgStatus string
	if err := pool.QueryRow(context.Background(), `
		SELECT m.id::text, m.version, o.credential_version, o.status
		FROM memberships m JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = $1 AND m.organization_id = $2`, hwRouterUser, hwRouterOrg,
	).Scan(&membershipID, &membershipVersion, &orgVersion, &orgStatus); err != nil {
		t.Fatalf("read membership/org state: %v", err)
	}
	if orgStatus != "active" {
		t.Fatalf("fixture org status = %q, want active", orgStatus)
	}

	authority := mustAuthority("hw-asset-router-jwt-secret-0123456789")
	session, err := store.CreateAuthSession(context.Background(), storage.CreateAuthSessionCommand{
		UserID:            hwRouterUser,
		MembershipID:      membershipID,
		OrganizationID:    hwRouterOrg,
		ClientType:        domain.SessionClientWeb,
		AbsoluteExpiresAt: time.Now().Add(2 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create auth session: %v", err)
	}
	tc := auth.TokenContext{
		Roles:                         []string{"admin"},
		OrgID:                         hwRouterOrg,
		MembershipID:                  membershipID,
		MembershipCredentialVersion:   membershipVersion,
		OrganizationCredentialVersion: orgVersion,
		SessionID:                     session.ID,
	}
	token, err := authority.IssueTransportTokenUntil(hwRouterUser, hwRouterEmail, tc, "web", session.AbsoluteExpiresAt)
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}

	mediaDir := t.TempDir()
	srv := &Server{
		Store:       store,
		Tokens:      authority,
		MediaTokens: mustMediaAuthority(t, "hw-asset-router-media-key-0123456789"),
		MediaDir:    mediaDir,
	}
	return &hwRouterEnv{
		store: store, pool: pool, srv: srv,
		router: RegisterRoutes(srv), token: token, mediaDir: mediaDir,
	}
}

// do runs one authenticated JSON request through the real router.
func (e *hwRouterEnv) do(t *testing.T, method, target, body string, idemKey string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Authorization", "Bearer "+e.token)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)
	return rr
}

// uploadBytes issues the multipart byte upload through the real router at the
// canonical client URL.
func (e *hwRouterEnv) uploadBytes(t *testing.T, sessionID, representation, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut,
		"/api/hardware-assets/uploads/"+sessionID+"/bytes/"+representation, &buf)
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)
	return rr
}

// readWithGrant fetches the bytes through the real grant route.
func (e *hwRouterEnv) readWithGrant(t *testing.T, grantURL string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, grantURL, nil)
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)
	return rr
}

type hwAssetJSON struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Revisions []struct {
		ID              string `json:"id"`
		RevisionNumber  int64  `json:"revision_number"`
		Representation  string `json:"representation"`
		Sha256          string `json:"sha256"`
		ValidationState string `json:"validation_state"`
	} `json:"revisions"`
}

// R1: the full walkthrough through the REAL router at the generated client's
// exact URLs — including detail, retire, authorize and byte readback, which
// the /asset/-prefixed patterns never served.
func TestHardwareAssets_RouterCanonicalClientWalkthrough(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	// start upload (idempotent command through the router).
	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Tirador router","provenance":"P","license":"L",
		  "origin":{"source_units":"mm","up_axis":"z"}}`, "hwasset-walk-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	content := []byte(strings.Repeat("router-skp-bytes-", 128))
	if rr := e.uploadBytes(t, session.ID, "skp", "handle.skp", content); rr.Code != http.StatusOK {
		t.Fatalf("bytes = %d %s", rr.Code, rr.Body.String())
	}

	// finalize through the router, with the declared idempotency key.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-walk-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var asset hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}
	if len(asset.Revisions) != 1 || asset.Revisions[0].RevisionNumber != 1 {
		t.Fatalf("asset revisions = %+v", asset.Revisions)
	}

	// detail at the generated client URL (R1: was 404 under /asset/).
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/"+asset.ID, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("detail (client URL) = %d %s", rr.Code, rr.Body.String())
	}
	var detail hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.ID != asset.ID || len(detail.Revisions) != 1 || detail.Revisions[0].Sha256 != asset.Revisions[0].Sha256 {
		t.Fatalf("detail mismatch: %+v vs %+v", detail, asset)
	}

	// list at the generated client URL, carrying revisions (R2 via API).
	rr = e.do(t, http.MethodGet, "/api/hardware-assets", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list = %d %s", rr.Code, rr.Body.String())
	}
	var list []hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != asset.ID || len(list[0].Revisions) != 1 ||
		list[0].Revisions[0].Sha256 != asset.Revisions[0].Sha256 ||
		list[0].Revisions[0].ValidationState != "pending" {
		t.Fatalf("list lost revisions/facts: %+v", list)
	}

	// authorize at the generated client URL (R1: was 404).
	rr = e.do(t, http.MethodPost,
		"/api/hardware-assets/"+asset.ID+"/revisions/"+asset.Revisions[0].ID+":authorize", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize (client URL) = %d %s", rr.Code, rr.Body.String())
	}
	var grant struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}

	// byte readback through the grant route.
	if rr := e.readWithGrant(t, grant.URL); rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), content) {
		t.Fatalf("grant read = %d (%d bytes, want %d)", rr.Code, rr.Body.Len(), len(content))
	}

	// retire at the generated client URL, with the declared idempotency key.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/"+asset.ID+":retire", "", "hwasset-walk-ret-0001")
	if rr.Code != http.StatusOK {
		t.Fatalf("retire (client URL) = %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/"+asset.ID, "", "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"retired"`) {
		t.Fatalf("post-retire detail = %d %s", rr.Code, rr.Body.String())
	}
}

// R1: the declared idempotency contract is actually enforced for finalize and
// retire — missing key 400, replay returns the same outcome, key reuse with a
// different payload is a typed conflict.
func TestHardwareAssets_RouterIdempotencyContract(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Idem"}`, "hwasset-idem-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	content := []byte("idempotent skp content")
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", content); rr.Code != http.StatusOK {
		t.Fatalf("bytes = %d %s", rr.Code, rr.Body.String())
	}

	// finalize WITHOUT key → the declared contract must reject it.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("finalize without key = %d %s (want 400)", rr.Code, rr.Body.String())
	}

	// finalize with key, then replay the same key: the SAME asset, never a
	// duplicate.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-idem-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var first hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-idem-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize replay = %d %s", rr.Code, rr.Body.String())
	}
	var replay hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &replay); err != nil {
		t.Fatal(err)
	}
	if replay.ID != first.ID {
		t.Fatalf("replay created a different asset: %s vs %s", replay.ID, first.ID)
	}

	// retire without key → 400; with key → 200; replay → 200 same asset.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/"+first.ID+":retire", "", "")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("retire without key = %d %s (want 400)", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/"+first.ID+":retire", "", "hwasset-idem-ret-0001")
	if rr.Code != http.StatusOK {
		t.Fatalf("retire = %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/"+first.ID+":retire", "", "hwasset-idem-ret-0001")
	if rr.Code != http.StatusOK {
		t.Fatalf("retire replay = %d %s", rr.Code, rr.Body.String())
	}

	// Key reuse with a DIFFERENT payload → typed conflict, no second effect.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Different"}`, "hwasset-idem-start-0001")
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("incompatible key reuse = %d %s (want 409 conflict)", rr.Code, rr.Body.String())
	}
}

// R3: the session's representation is authoritative — a thumbnail payload on
// an SKP session is refused BEFORE any limit/inspection/file write, and the
// staged state stays untouched.
func TestHardwareAssets_RouterUploadRepresentationMismatch(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Sesión SKP"}`, "hwasset-rep-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	// A REAL PNG on the /bytes/thumbnail URL of an SKP session.
	png := []byte{
		0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
		0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
		0x90, 0x77, 0x53, 0xde,
		0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
	}
	rr = e.uploadBytes(t, session.ID, "thumbnail", "fake.png", png)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("cross-representation upload = %d %s (want 400)", rr.Code, rr.Body.String())
	}

	// No staged metadata, no file: the session stays pristine.
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/uploads/"+session.ID, "", "")
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), `"staged"`) {
		t.Fatalf("session after refused upload = %d %s", rr.Code, rr.Body.String())
	}
	entries, err := os.ReadDir(filepath.Join(e.mediaDir, hwRouterOrg, "hardware-assets", session.ID))
	if err == nil && len(entries) > 0 {
		t.Fatalf("refused upload left files: %v", entries)
	}

	// The valid SKP upload on the SAME session still works afterwards.
	if rr := e.uploadBytes(t, session.ID, "skp", "real.skp", []byte("valid skp bytes")); rr.Code != http.StatusOK {
		t.Fatalf("valid re-upload = %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-rep-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var asset hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}
	if len(asset.Revisions) != 1 || asset.Revisions[0].Representation != "skp" {
		t.Fatalf("revision representation = %+v", asset.Revisions)
	}
}

// R5: a late identical upload after finalize must fail WITHOUT deleting the
// finalized revision's blob; the grant path keeps verifying the original
// digest. Deterministic equivalent of the upload/finalize interleave (same
// state machine transition), plus a barrier-driven true interleave below.
func TestHardwareAssets_RouterLateUploadKeepsFinalizedBytes(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Late upload"}`, "hwasset-late-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	content := []byte(strings.Repeat("late-upload-blob-", 128))
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", content); rr.Code != http.StatusOK {
		t.Fatalf("bytes = %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-late-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var asset hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}

	// The late upload: identical bytes → the same content-addressed key the
	// finalized revision references. It must be refused (session finalized)
	// and MUST NOT delete the blob.
	late := e.uploadBytes(t, session.ID, "skp", "a-again.skp", content)
	if late.Code == http.StatusOK {
		t.Fatalf("late upload on finalized session = %d (must fail)", late.Code)
	}

	// The blob still exists on disk with the original bytes.
	var storageKey string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT storage_key FROM hardware_asset_revisions WHERE id = $1`, asset.Revisions[0].ID,
	).Scan(&storageKey); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(storageKey))
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("finalized blob was deleted by the late upload: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("finalized blob content changed: %d bytes", len(got))
	}

	// The authorize path still verifies the original digest end to end.
	rr = e.do(t, http.MethodPost,
		"/api/hardware-assets/"+asset.ID+"/revisions/"+asset.Revisions[0].ID+":authorize", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize after late upload = %d %s", rr.Code, rr.Body.String())
	}
	var grant struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	if rr := e.readWithGrant(t, grant.URL); rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), content) {
		t.Fatalf("grant read after late upload = %d", rr.Code)
	}

	// A late upload with DIFFERENT content lands on a different key: refused
	// on the finalized session, and neither the finalized blob nor any
	// staged association changes.
	rr = e.uploadBytes(t, session.ID, "skp", "other.skp", []byte("completely different bytes"))
	if rr.Code == http.StatusOK {
		t.Fatalf("different-content late upload = %d (must fail)", rr.Code)
	}
	if _, err := os.ReadFile(path); err != nil {
		t.Fatalf("finalized blob affected by different-content upload: %v", err)
	}
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/uploads/"+session.ID, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("session readback = %d", rr.Code)
	}
}

// blockingReader is the barrier for the true upload/finalize interleave: the
// multipart body stalls mid-stream until release is closed.
type blockingReader struct {
	inner    *bytes.Reader
	started  chan struct{}
	release  chan struct{}
	once     sync.Once
	released bool
}

func (b *blockingReader) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	if !b.released {
		<-b.release
		b.released = true
	}
	return b.inner.Read(p)
}

// R5: TRUE interleave with controlled barriers — an upload stalls mid-body
// while the same session finalizes; when released, its identical content maps
// to the finalized revision's key and the compensation must leave the blob
// intact.
func TestHardwareAssets_RouterConcurrentUploadWithFinalizeBarrier(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Barrier"}`, "hwasset-bar-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	content := []byte(strings.Repeat("barrier-blob-", 150))
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", content); rr.Code != http.StatusOK {
		t.Fatalf("bytes = %d %s", rr.Code, rr.Body.String())
	}

	// The racing upload starts while the session is STILL PREPARed (it passes
	// the session gate) and stalls mid-body: identical content will later map
	// to the same content-addressed key the finalize below references.
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "race.skp")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	blocker := &blockingReader{inner: bytes.NewReader(body.Bytes()), started: make(chan struct{}), release: make(chan struct{})}
	req := httptest.NewRequest(http.MethodPut,
		"/api/hardware-assets/uploads/"+session.ID+"/bytes/skp", blocker)
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rrCh := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := httptest.NewRecorder()
		e.router.ServeHTTP(rec, req)
		rrCh <- rec
	}()
	<-blocker.started // the racing upload is in flight, mid-body, session still prepared.

	// Finalize wins the race while the racing upload is stalled.
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "", "hwasset-bar-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var asset hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}

	// Release the racing upload: it renames onto the same key and its record
	// fails on the finalized session — the compensation must keep the blob.
	close(blocker.release)
	select {
	case rec := <-rrCh:
		if rec.Code == http.StatusOK {
			t.Fatalf("racing upload = %d (must fail on finalized session)", rec.Code)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("racing upload did not finish")
	}

	var storageKey string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT storage_key FROM hardware_asset_revisions WHERE id = $1`, asset.Revisions[0].ID,
	).Scan(&storageKey); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(storageKey))); err != nil {
		t.Fatalf("racing upload destroyed the finalized blob: %v", err)
	}
	rr = e.do(t, http.MethodPost,
		"/api/hardware-assets/"+asset.ID+"/revisions/"+asset.Revisions[0].ID+":authorize", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize after racing upload = %d %s", rr.Code, rr.Body.String())
	}
}

// R5 (storage serialization, driven through the router): two sessions that
// append revisions to the SAME asset must serialize — distinct revision
// numbers, no raw constraint failure.
func TestHardwareAssets_RouterTwoSessionsSameAssetSerialize(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	// Session 1 creates the asset.
	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Serialize A"}`, "hwasset-ser-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start 1 = %d %s", rr.Code, rr.Body.String())
	}
	var s1 struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &s1); err != nil {
		t.Fatal(err)
	}
	if rr := e.uploadBytes(t, s1.ID, "skp", "a.skp", []byte("serialize-one")); rr.Code != http.StatusOK {
		t.Fatalf("bytes 1 = %d", rr.Code)
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+s1.ID+":finalize", "", "hwasset-ser-fin-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize 1 = %d %s", rr.Code, rr.Body.String())
	}
	var asset hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}

	// Sessions 2 and 3 target the same asset.
	startTargeted := func(key, name string) string {
		rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
			fmt.Sprintf(`{"representation":"skp","display_name":%q,"asset_id":%q}`, name, asset.ID), key)
		if rr.Code != http.StatusCreated {
			t.Fatalf("start %s = %d %s", name, rr.Code, rr.Body.String())
		}
		var s struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &s); err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	s2 := startTargeted("hwasset-ser-start-0002", "Serialize B")
	s3 := startTargeted("hwasset-ser-start-0003", "Serialize C")
	if rr := e.uploadBytes(t, s2, "skp", "b.skp", []byte("serialize-two")); rr.Code != http.StatusOK {
		t.Fatalf("bytes 2 = %d", rr.Code)
	}
	if rr := e.uploadBytes(t, s3, "skp", "c.skp", []byte("serialize-three")); rr.Code != http.StatusOK {
		t.Fatalf("bytes 3 = %d", rr.Code)
	}

	barrier := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	finalize := func(sessionID, key string) {
		<-barrier
		results <- e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+sessionID+":finalize", "", key)
	}
	go finalize(s2, "hwasset-ser-fin-0002")
	go finalize(s3, "hwasset-ser-fin-0003")
	close(barrier)

	for i := 0; i < 2; i++ {
		select {
		case rec := <-results:
			if rec.Code != http.StatusCreated {
				t.Fatalf("concurrent same-asset finalize = %d %s (must serialize, not fail)", rec.Code, rec.Body.String())
			}
		case <-time.After(60 * time.Second):
			t.Fatal("concurrent finalize did not finish")
		}
	}
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/"+asset.ID, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("detail = %d", rr.Code)
	}
	var after hwAssetJSON
	if err := json.Unmarshal(rr.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Revisions) != 3 {
		t.Fatalf("revisions after concurrent finalize = %d (want 3): %+v", len(after.Revisions), after.Revisions)
	}
	seen := map[int64]bool{}
	for _, r := range after.Revisions {
		if seen[r.RevisionNumber] {
			t.Fatalf("duplicate revision number %d", r.RevisionNumber)
		}
		seen[r.RevisionNumber] = true
	}
}

// --- Ronda residual R5: limpieza de archivos DESPUÉS del commit externo ------

// hwAssetInstallCommitFailsOnSessionUpdate instala, en la BD desechable de esta
// prueba, un trigger de constraint DIFERIDO que revienta el COMMIT cuando la
// sesión se actualiza. Es la inyección local que fuerza el fallo AL CONFIRMAR,
// después de que el handler haya renderizado (nunca mata conexiones ajenas).
func hwAssetInstallCommitFailsOnSessionUpdate(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		CREATE OR REPLACE FUNCTION hwasset_raise_at_commit() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'hwasset: forced commit failure';
		END; $$;`); err != nil {
		t.Fatalf("install raise function: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		CREATE CONSTRAINT TRIGGER hwasset_fail_commit_after_update
		AFTER UPDATE ON hardware_asset_upload_sessions
		DEFERRABLE INITIALLY DEFERRED
		FOR EACH ROW EXECUTE FUNCTION hwasset_raise_at_commit()`); err != nil {
		t.Fatalf("install deferred trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS hwasset_fail_commit_after_update ON hardware_asset_upload_sessions`)
		_, _ = pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS hwasset_raise_at_commit()`)
	})
}

// hwAssetStagedFileOnDisk devuelve el contenido actual del archivo staged de
// la sesión (clave leída de la fila confirmada).
func (e *hwRouterEnv) hwAssetStagedFileOnDisk(t *testing.T, sessionID string) (key string, content []byte) {
	t.Helper()
	if err := e.pool.QueryRow(context.Background(),
		`SELECT staged_storage_key FROM hardware_asset_upload_sessions WHERE id = $1`, sessionID,
	).Scan(&key); err != nil {
		t.Fatalf("read staged key: %v", err)
	}
	path := filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(key))
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("staged file %s: %v", key, err)
	}
	return key, content
}

// RED 1: re-upload B sobre A staged con fallo AL CONFIRMAR la transacción
// externa: la referencia A y sus bytes deben sobrevivir intactos.
func TestHardwareAssets_RouterReUploadCommitFailurePreservesPreviousBytes(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Reupload"}`, "hwasset-ru-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	contentA := []byte(strings.Repeat("bytes-A-original-", 100))
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", contentA); rr.Code != http.StatusOK {
		t.Fatalf("bytes A = %d %s", rr.Code, rr.Body.String())
	}
	keyA, storedA := e.hwAssetStagedFileOnDisk(t, session.ID)
	if !bytes.Equal(storedA, contentA) {
		t.Fatalf("setup: staged A content mismatch")
	}

	// Fallo al confirmar: el handler ya corrió (y con el código revisado ya
	// habría borrado A) cuando el COMMIT revienta.
	hwAssetInstallCommitFailsOnSessionUpdate(t, e.pool)
	contentB := []byte(strings.Repeat("bytes-B-nuevo-", 100))
	rr = e.uploadBytes(t, session.ID, "skp", "b.skp", contentB)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("re-upload with forced commit failure = %d (want 500)", rr.Code)
	}

	// El estado confirmado sigue siendo A y sus bytes existen.
	keyAfter, storedAfter := e.hwAssetStagedFileOnDisk(t, session.ID)
	if keyAfter != keyA {
		t.Fatalf("staged key after rollback = %s, want %s", keyAfter, keyA)
	}
	if !bytes.Equal(storedAfter, contentA) {
		t.Fatalf("staged A bytes were lost across the commit failure")
	}

	// Con el trigger retirado explícitamente (el cleanup del fixture corre al
	// final del test), el re-upload B tiene éxito y A se recolecta de forma
	// segura (post-commit, con lock de sesión).
	if _, err := e.pool.Exec(context.Background(),
		`DROP TRIGGER IF EXISTS hwasset_fail_commit_after_update ON hardware_asset_upload_sessions`); err != nil {
		t.Fatalf("drop trigger: %v", err)
	}
	rr = e.uploadBytes(t, session.ID, "skp", "b-again.skp", contentB)
	if rr.Code != http.StatusOK {
		t.Fatalf("re-upload after trigger removal = %d %s", rr.Code, rr.Body.String())
	}
	keyB, storedB := e.hwAssetStagedFileOnDisk(t, session.ID)
	if !bytes.Equal(storedB, contentB) {
		t.Fatalf("staged B content mismatch after successful re-upload")
	}
	if _, err := os.Stat(filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(keyA))); !os.IsNotExist(err) {
		t.Fatalf("replaced key A was not collected after the successful commit: %v", err)
	}
	_ = keyB
}

// RED 2: cancelación con fallo al confirmar: la sesión preparada conservada
// debe seguir teniendo sus bytes.
func TestHardwareAssets_RouterCancelCommitFailurePreservesBytes(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Cancel"}`, "hwasset-ca-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	contentA := []byte(strings.Repeat("cancel-bytes-", 100))
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", contentA); rr.Code != http.StatusOK {
		t.Fatalf("bytes A = %d", rr.Code)
	}
	keyA, _ := e.hwAssetStagedFileOnDisk(t, session.ID)

	hwAssetInstallCommitFailsOnSessionUpdate(t, e.pool)
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":cancel", "", "")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("cancel with forced commit failure = %d (want 500)", rr.Code)
	}

	// Rollback: la sesión sigue prepared y sus bytes existen.
	rr = e.do(t, http.MethodGet, "/api/hardware-assets/uploads/"+session.ID, "", "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"prepared"`) {
		t.Fatalf("session after rolled-back cancel = %d %s", rr.Code, rr.Body.String())
	}
	keyAfter, storedAfter := e.hwAssetStagedFileOnDisk(t, session.ID)
	if keyAfter != keyA || !bytes.Equal(storedAfter, contentA) {
		t.Fatalf("staged bytes lost across the rolled-back cancel")
	}

	// Cancelación exitosa posterior (trigger retirado explícitamente): la
	// sesión queda cancelled y los bytes staged se recolectan post-commit.
	if _, err := e.pool.Exec(context.Background(),
		`DROP TRIGGER IF EXISTS hwasset_fail_commit_after_update ON hardware_asset_upload_sessions`); err != nil {
		t.Fatalf("drop trigger: %v", err)
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":cancel", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("cancel after trigger removal = %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(keyA))); !os.IsNotExist(err) {
		t.Fatalf("staged file was not collected after the successful cancel: %v", err)
	}
}

// RED 3: dos re-uploads concurrentes sobre la MISMA sesión con barreras:
// los bytes elegidos por el intento ganador nunca desaparecen y la clave
// reemplazada se recolecta exactamente una vez.
func TestHardwareAssets_RouterConcurrentReUploadsBarrier(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Race"}`, "hwasset-ra-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	contentA := []byte(strings.Repeat("race-A-", 120))
	if rr := e.uploadBytes(t, session.ID, "skp", "a.skp", contentA); rr.Code != http.StatusOK {
		t.Fatalf("bytes A = %d", rr.Code)
	}
	keyA, _ := e.hwAssetStagedFileOnDisk(t, session.ID)

	// Dos uploads en vuelo, ambos estancados mid-body tras pasar el gate de
	// sesión (aún prepared).
	contentB1 := []byte(strings.Repeat("race-B1-", 120))
	contentB2 := []byte(strings.Repeat("race-B2-", 120))
	startStalled := func(content []byte, name string) (*blockingReader, chan *httptest.ResponseRecorder) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		blocker := &blockingReader{inner: bytes.NewReader(body.Bytes()), started: make(chan struct{}), release: make(chan struct{})}
		req := httptest.NewRequest(http.MethodPut,
			"/api/hardware-assets/uploads/"+session.ID+"/bytes/skp", blocker)
		req.Header.Set("Authorization", "Bearer "+e.token)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rrCh := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			rec := httptest.NewRecorder()
			e.router.ServeHTTP(rec, req)
			rrCh <- rec
		}()
		return blocker, rrCh
	}
	b1, ch1 := startStalled(contentB1, "b1.skp")
	b2, ch2 := startStalled(contentB2, "b2.skp")
	<-b1.started
	<-b2.started

	close(b1.release)
	close(b2.release)
	for _, ch := range []chan *httptest.ResponseRecorder{ch1, ch2} {
		select {
		case rec := <-ch:
			if rec.Code != http.StatusOK {
				t.Fatalf("concurrent re-upload = %d %s", rec.Code, rec.Body.String())
			}
		case <-time.After(30 * time.Second):
			t.Fatal("concurrent re-upload did not finish")
		}
	}

	// La elección final (confirmada) tiene sus bytes en disco con contenido
	// exacto; la clave reemplazada A fue recolectada.
	finalKey, finalContent := e.hwAssetStagedFileOnDisk(t, session.ID)
	known := map[string][]byte{}
	sum := func(b []byte) string {
		s := sha256.Sum256(b)
		return "sha256-" + hex.EncodeToString(s[:])
	}
	known[sum(contentB1)] = contentB1
	known[sum(contentB2)] = contentB2
	var stagedSHA string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT staged_sha256 FROM hardware_asset_upload_sessions WHERE id = $1`, session.ID,
	).Scan(&stagedSHA); err != nil {
		t.Fatal(err)
	}
	expected, ok := known[stagedSHA]
	if !ok {
		t.Fatalf("staged sha %s no corresponde a ningún concurrente", stagedSHA)
	}
	if !bytes.Equal(finalContent, expected) {
		t.Fatalf("los bytes elegidos por el intento ganador fueron alterados/destruidos")
	}
	if _, err := os.Stat(filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(keyA))); !os.IsNotExist(err) {
		t.Fatalf("la clave reemplazada A no fue recolectada: %v", err)
	}
	_ = finalKey
}

// RED 2b (expiración): el sweep perezoso abandona sesiones expiradas DENTRO
// de la transacción del start-upload. Con fallo AL CONFIRMAR ese request, la
// sesión vieja debe volver a prepared con su referencia y bytes intactos; el
// borrado inline del HEAD revisado los destruía antes del commit.
func TestHardwareAssets_RouterExpirySweepCommitFailurePreservesBytes(t *testing.T) {
	e := newHwAssetRouterEnv(t)

	// Sesión vieja preparada con bytes staged, ya expirada.
	rr := e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Vieja expirada"}`, "hwasset-ex-start-0001")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start old = %d %s", rr.Code, rr.Body.String())
	}
	var oldSession struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &oldSession); err != nil {
		t.Fatal(err)
	}
	contentOld := []byte(strings.Repeat("expired-session-bytes-", 64))
	if rr := e.uploadBytes(t, oldSession.ID, "skp", "old.skp", contentOld); rr.Code != http.StatusOK {
		t.Fatalf("bytes old = %d %s", rr.Code, rr.Body.String())
	}
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE hardware_asset_upload_sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, oldSession.ID); err != nil {
		t.Fatalf("expire old session: %v", err)
	}
	keyOld, gotOld := e.hwAssetStagedFileOnDisk(t, oldSession.ID)
	if !bytes.Equal(gotOld, contentOld) {
		t.Fatal("fixture: staged bytes mismatch before sweep")
	}

	// El siguiente start ejecuta el sweep dentro de SU transacción; el
	// trigger diferido revienta el COMMIT (la sesión vieja fue actualizada).
	hwAssetInstallCommitFailsOnSessionUpdate(t, e.pool)
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Barre expiradas"}`, "hwasset-ex-start-0002")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("start with forced commit failure = %d (want 500)", rr.Code)
	}

	// Rollback: la sesión vieja sigue prepared, referencia y bytes intactos.
	var status, stagedKey *string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT status::text, staged_storage_key FROM hardware_asset_upload_sessions WHERE id = $1`, oldSession.ID,
	).Scan(&status, &stagedKey); err != nil {
		t.Fatal(err)
	}
	if status == nil || *status != "prepared" || stagedKey == nil || *stagedKey != keyOld {
		t.Fatalf("old session after rolled-back sweep: status=%v staged=%v (want prepared/%s)", status, stagedKey, keyOld)
	}
	path := filepath.Join(e.mediaDir, hwRouterOrg, filepath.FromSlash(keyOld))
	if got, err := os.ReadFile(path); err != nil || !bytes.Equal(got, contentOld) {
		t.Fatalf("old session staged bytes destroyed by rolled-back sweep: err=%v len=%d", err, len(got))
	}

	// Sin el trigger, el mismo start commitea: el sweep abandona la sesión y
	// la recolección post-commit elimina SUS bytes (no los de nadie más).
	if _, err := e.pool.Exec(context.Background(),
		`DROP TRIGGER IF EXISTS hwasset_fail_commit_after_update ON hardware_asset_upload_sessions`); err != nil {
		t.Fatalf("drop trigger: %v", err)
	}
	rr = e.do(t, http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Barre expiradas 2"}`, "hwasset-ex-start-0003")
	if rr.Code != http.StatusCreated {
		t.Fatalf("start after trigger removal = %d %s", rr.Code, rr.Body.String())
	}
	if err := e.pool.QueryRow(context.Background(),
		`SELECT status::text FROM hardware_asset_upload_sessions WHERE id = $1`, oldSession.ID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status == nil || *status != "cancelled" {
		t.Fatalf("old session after committed sweep: status=%v (want cancelled)", status)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("committed sweep must collect the abandoned staged file post-commit: stat err=%v", err)
	}
}
