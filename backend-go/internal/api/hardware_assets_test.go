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
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #667 / M1 API tests: role guards, server-computed digests, demonstrable
// content checks, configurable limits, fail-closed finalize and the signed
// byte read. The end-to-end test runs the whole recorrido against a real
// throwaway PostgreSQL + real filesystem (never mocks).

func hwAssetRequest(method, target, body, role string) *http.Request {
	req := withClaims(httptest.NewRequest(method, target, strings.NewReader(body)), "admin-1", role)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

func hwAssetMultipart(t *testing.T, srv *Server, sessionID, representation, filename, role string, content []byte) *httptest.ResponseRecorder {
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
	req := withClaims(httptest.NewRequest(http.MethodPut,
		"/api/hardware-assets/uploads/"+sessionID+"/bytes/"+representation, &buf), "admin-1", role)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.SetPathValue("sessionId", sessionID)
	req.SetPathValue("representation", representation)
	rr := httptest.NewRecorder()
	srv.HandleHardwareAssetUploadBytes(rr, req)
	return rr
}

// 7: mutation without the catalog role is refused everywhere.
func TestHardwareAssets_RoleGuards(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	for _, tc := range []struct {
		name   string
		call   func(rr *httptest.ResponseRecorder)
		method string
		role   string
	}{
		{"start", func(rr *httptest.ResponseRecorder) {
			req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/uploads",
				`{"representation":"skp","display_name":"X"}`, string(domain.RoleVendedor))
			srv.HandleHardwareAssetUploadStart(rr, req)
		}, http.MethodPost, string(domain.RoleVendedor)},
		{"bytes", func(rr *httptest.ResponseRecorder) {
			rr2 := hwAssetMultipart(t, srv, "54000000-0000-0000-0000-000000000001", "skp", "a.skp", string(domain.RoleVendedor), []byte("x"))
			rr.Code = rr2.Code
		}, http.MethodPut, string(domain.RoleVendedor)},
		{"finalize", func(rr *httptest.ResponseRecorder) {
			req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/uploads/54000000-0000-0000-0000-000000000001:finalize", "", string(domain.RoleProduccion))
			req.SetPathValue("sessionId", "54000000-0000-0000-0000-000000000001")
			srv.HandleHardwareAssetUploadFinalize(rr, req)
		}, http.MethodPost, string(domain.RoleProduccion)},
		{"retire", func(rr *httptest.ResponseRecorder) {
			req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/74000000-0000-0000-0000-000000000001:retire", "", string(domain.RoleProduccion))
			req.SetPathValue("assetId", "74000000-0000-0000-0000-000000000001")
			srv.HandleHardwareAssetRetire(rr, req)
		}, http.MethodPost, string(domain.RoleProduccion)},
	} {
		rr := httptest.NewRecorder()
		tc.call(rr)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("%s: status = %d, want 403", tc.name, rr.Code)
		}
	}
}

// 4: content inspection — GLB must carry the glTF magic, thumbnails must be
// sniffable images; a fake extension is refused (never validation by name).
func TestHardwareAssets_BytesContentInspection(t *testing.T) {
	dir := t.TempDir()
	store := &stubStore{assetSession: &domain.HardwareAssetUploadSession{
		ID: "54000000-0000-0000-0000-000000000001", Status: "prepared",
		Representation: domain.HardwareAssetRepresentationSKP,
		ExpiresAt:      time.Now().Add(time.Hour),
	}}
	// R3: each upload targets a different representation, so the test aligns
	// the stub session's representation with the URL before each call.
	setSessionRepresentation := func(rep domain.HardwareAssetRepresentation) {
		store.assetSession.Representation = rep
	}
	srv := &Server{Store: store, MediaDir: dir}
	sessionID := "54000000-0000-0000-0000-000000000001"

	// GLB without the format magic → refused even with .glb extension.
	setSessionRepresentation(domain.HardwareAssetRepresentationGLB)
	rr := hwAssetMultipart(t, srv, sessionID, "glb", "fake.glb", string(domain.RoleAdmin), []byte("not a gltf file at all"))
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "glTF") {
		t.Fatalf("fake glb = %d %s", rr.Code, rr.Body.String())
	}
	// Thumbnail that is not an image → refused.
	setSessionRepresentation(domain.HardwareAssetRepresentationThumbnail)
	rr = hwAssetMultipart(t, srv, sessionID, "thumbnail", "fake.png", string(domain.RoleAdmin), []byte("definitely not an image"))
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "miniatura") {
		t.Fatalf("fake thumbnail = %d %s", rr.Code, rr.Body.String())
	}
	// SKP is opaque binary: accepted with .skp name, server computes facts.
	setSessionRepresentation(domain.HardwareAssetRepresentationSKP)
	content := []byte("opaque sketchup container bytes")
	store.recordAssetBytesArmed = true
	rr = hwAssetMultipart(t, srv, sessionID, "skp", "real.skp", string(domain.RoleAdmin), content)
	if rr.Code != http.StatusOK {
		t.Fatalf("skp upload = %d %s", rr.Code, rr.Body.String())
	}
	var staged struct {
		Sha256   string `json:"sha256"`
		Size     int64  `json:"size_bytes"`
		Contents string `json:"content_type"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &staged); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	if staged.Sha256 != "sha256-"+hex.EncodeToString(sum[:]) || staged.Size != int64(len(content)) {
		t.Fatalf("server-side digest/size = %+v", staged)
	}
	if store.promoteAssetBytesCmd == nil || !strings.HasPrefix(store.promoteAssetBytesCmd.StorageKey, "hardware-assets/"+sessionID+"/skp-") {
		t.Fatalf("canonical storage key = %+v", store.promoteAssetBytesCmd)
	}
	// The staged file lives on disk under the org partition.
	path := filepath.Join(dir, storage.InitialOrganizationID, filepath.FromSlash(store.promoteAssetBytesCmd.StorageKey))
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("staged file missing: %v", err)
	}
	// A traversal-looking session can never reach outside MediaDir (keys are
	// server-generated; the pattern check refuses non-canonical keys).
	if auth.HardwareAssetResourceKey("hardware-assets/../../etc/skp-aabbccddeeff.skp") != "" {
		t.Fatal("traversal key must not be canonical")
	}
}

// 4: configurable limits — a tiny configured cap rejects oversized uploads
// (413) before any byte is staged.
func TestHardwareAssets_ConfigurableLimit(t *testing.T) {
	dir := t.TempDir()
	srv := &Server{
		Store: &stubStore{assetSession: &domain.HardwareAssetUploadSession{
			ID: "54000000-0000-0000-0000-000000000001", Status: "prepared",
			Representation: domain.HardwareAssetRepresentationSKP,
			ExpiresAt:      time.Now().Add(time.Hour),
		}},
		MediaDir: dir,
	}
	srv.SetHardwareAssetLimits(map[domain.HardwareAssetRepresentation]int64{
		domain.HardwareAssetRepresentationSKP: 8,
	})
	rr := hwAssetMultipart(t, srv, "54000000-0000-0000-0000-000000000001", "skp", "big.skp", string(domain.RoleAdmin), []byte("more than eight bytes"))
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize = %d %s", rr.Code, rr.Body.String())
	}
}

// 9: finalize fails closed when the staged file vanished — no asset row is
// written (belt-and-braces runs BEFORE the transactional finalize).
func TestHardwareAssets_FinalizeFailsClosedOnMissingFile(t *testing.T) {
	sessionID := "54000000-0000-0000-0000-000000000001"
	store := &stubStore{
		assetSession: &domain.HardwareAssetUploadSession{
			ID: sessionID, Status: "prepared", ExpiresAt: time.Now().Add(time.Hour),
			Staged: &domain.HardwareAssetStagedBytes{
				StorageKey:  "hardware-assets/" + sessionID + "/skp-aabbccddeeff.skp",
				ContentType: "application/octet-stream",
				SizeBytes:   10,
				SHA256:      "sha256-" + strings.Repeat("0", 64),
			},
		},
		assetFinalized: &domain.HardwareAsset{ID: "74000000-0000-0000-0000-000000000099"},
	}
	srv := &Server{Store: store, MediaDir: t.TempDir()}
	req := hwAssetRequest(http.MethodPost, "/api/hardware-assets/uploads/"+sessionID+":finalize", "", string(domain.RoleAdmin))
	req.SetPathValue("sessionId", sessionID)
	rr := httptest.NewRecorder()
	srv.HandleHardwareAssetUploadFinalize(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("finalize with missing file = %d %s", rr.Code, rr.Body.String())
	}
	if store.assetFinalizeCmd != nil {
		t.Fatal("the transactional finalize must not run when bytes are missing")
	}
}

// G + 1: signed read roundtrip — grant only after byte verification, exact
// byte readback, tampered bytes fail closed, bearer reads are refused.
func TestHardwareAssets_AuthorizeAndReadBytes(t *testing.T) {
	content := []byte("real asset bytes for the host consumer")
	dir := t.TempDir()
	sum := sha256.Sum256(content)
	sha := "sha256-" + hex.EncodeToString(sum[:])
	key := "hardware-assets/54000000-0000-0000-0000-000000000001/skp-" + hex.EncodeToString(sum[:6]) + ".skp"
	path := filepath.Join(dir, storage.InitialOrganizationID, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o640); err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{assetRevisionResult: &domain.HardwareAssetRevision{
			ID: "75000000-0000-0000-0000-000000000001", OrganizationID: storage.InitialOrganizationID,
			Representation: domain.HardwareAssetRepresentationSKP, StorageKey: key,
			ContentType: "application/octet-stream", SizeBytes: int64(len(content)), SHA256: sha,
			IntegrityVerifiedAt: time.Now(),
		}},
		MediaDir:    dir,
		MediaTokens: mustMediaAuthority(t, "hardware-asset-test-media-key-0123456789"),
	}
	authorize := func() *httptest.ResponseRecorder {
		req := hwAssetRequest(http.MethodPost,
			"/api/hardware-assets/74000000-0000-0000-0000-000000000001/revisions/75000000-0000-0000-0000-000000000001:authorize",
			"", string(domain.RoleAdmin))
		rr := httptest.NewRecorder()
		srv.HandleHardwareAssetRevisionAuthorize(rr, req)
		return rr
	}
	rr := authorize()
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize = %d %s", rr.Code, rr.Body.String())
	}
	var grant struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(grant.URL, "?grant=") || strings.Contains(grant.URL, "Bearer") {
		t.Fatalf("grant URL must be a short-lived media grant, never a session credential: %q", grant.URL)
	}

	read := func(grantURL, key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, grantURL, nil)
		req.SetPathValue("key", key)
		rr := httptest.NewRecorder()
		srv.hardwareAssetFileGetAuth(http.HandlerFunc(srv.HandleHardwareAssetFileGet)).ServeHTTP(rr, req)
		return rr
	}
	keyPath := strings.TrimPrefix(grant.URL, "/api/hardware-assets/files/")
	keyPath = keyPath[:strings.Index(keyPath, "?")]
	rr = read(grant.URL, keyPath)
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), content) {
		t.Fatalf("grant read = %d (%d bytes)", rr.Code, rr.Body.Len())
	}
	// A grant for one asset pointed at another is not found (exact binding).
	rr = read(grant.URL, "hardware-assets/54000000-0000-0000-0000-000000000001/skp-000000000000.skp")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("mispointed grant = %d", rr.Code)
	}
	// Bearer-token reads are refused: grants only.
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/hardware-assets/files/"+key, nil), "admin-1", string(domain.RoleAdmin))
	req.Header.Set("Authorization", "Bearer x")
	rr = httptest.NewRecorder()
	srv.hardwareAssetFileGetAuth(http.HandlerFunc(srv.HandleHardwareAssetFileGet)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bearer read = %d", rr.Code)
	}
	// Tampered bytes fail closed at authorize time (#640 pattern).
	if err := os.WriteFile(path, []byte("tampered asset bytes"), 0o640); err != nil {
		t.Fatal(err)
	}
	if rr := authorize(); rr.Code != http.StatusConflict {
		t.Fatalf("authorize after tamper = %d %s", rr.Code, rr.Body.String())
	}
	// Missing bytes at authorize time read as ARTIFACT_MISSING, never 200.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if rr := authorize(); rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "ARTIFACT") {
		t.Fatalf("authorize after removal = %d %s", rr.Code, rr.Body.String())
	}
}

// E: the hardware PUT validates the binding before persistence and the
// client-echoed facts are replaced by server-resolved ones.
func TestHardwarePut_VisualBindingResolvedServerSide(t *testing.T) {
	store := &stubStore{
		assetResolvedBinding: &domain.HardwareVisualAssetBinding{
			AssetID:         "74000000-0000-0000-0000-000000000001",
			AssetRevisionID: "75000000-0000-0000-0000-000000000001",
			Representation:  domain.HardwareAssetRepresentationSKP,
			SHA256:          "sha256-" + strings.Repeat("a", 64),
			ValidationState: domain.HardwareAssetValidationPending,
		},
	}
	resolveCalls := [2]string{}
	store.assetResolveBindingCmd = &resolveCalls
	srv := &Server{Store: store}

	body := `{"id":"66000000-0000-0000-0000-000000000001","code":"HW-VIS","name":"Tirador","unit":"piece","cost_per_unit":10,"active":true,
		"visual_asset":{"assetId":"74000000-0000-0000-0000-000000000001","assetRevisionId":"75000000-0000-0000-0000-000000000001","sha256":"client-fake-digest"}}`
	req := hwAssetRequest(http.MethodPut, "/api/catalog/hardware/66000000-0000-0000-0000-000000000001", body, string(domain.RoleAdmin))
	req.SetPathValue("id", "66000000-0000-0000-0000-000000000001")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("put = %d %s", rr.Code, rr.Body.String())
	}
	if resolveCalls[0] != "74000000-0000-0000-0000-000000000001" || resolveCalls[1] != "75000000-0000-0000-0000-000000000001" {
		t.Fatalf("resolve calls = %v", resolveCalls)
	}
	if !strings.Contains(rr.Body.String(), "sha256-aaaaaaaa") || strings.Contains(rr.Body.String(), "client-fake-digest") {
		t.Fatalf("response must carry server-resolved facts: %s", rr.Body.String())
	}

	// An unresolvable binding is refused with the previous association kept.
	store.assetResolvedBinding = nil
	rr = httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid binding = %d %s", rr.Code, rr.Body.String())
	}
}

// Existing binding to a retired asset survives non-visual updates (e.g. name/price).
func TestHardwarePut_ExistingBindingToRetiredAssetPreserved(t *testing.T) {
	existingBinding := &domain.HardwareVisualAssetBinding{
		AssetID:         "74000000-0000-0000-0000-000000000001",
		AssetRevisionID: "75000000-0000-0000-0000-000000000001",
		Representation:  domain.HardwareAssetRepresentationSKP,
		SHA256:          "sha256-" + strings.Repeat("a", 64),
		ValidationState: domain.HardwareAssetValidationPending,
	}
	store := &stubStore{
		hardwareReturnedByID: &domain.Hardware{
			ID:          "66000000-0000-0000-0000-000000000001",
			Code:        "HW-VIS",
			Name:        "Tirador Original",
			VisualAsset: existingBinding,
		},
		// If resolution is attempted, nil causes failure
		assetResolvedBinding: nil,
	}
	srv := &Server{Store: store}

	body := `{"id":"66000000-0000-0000-0000-000000000001","code":"HW-VIS","name":"Tirador Renombrado","unit":"piece","cost_per_unit":15,"active":true,
		"visual_asset":{"assetId":"74000000-0000-0000-0000-000000000001","assetRevisionId":"75000000-0000-0000-0000-000000000001"}}`
	req := hwAssetRequest(http.MethodPut, "/api/catalog/hardware/66000000-0000-0000-0000-000000000001", body, string(domain.RoleAdmin))
	req.SetPathValue("id", "66000000-0000-0000-0000-000000000001")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("put existing binding = %d %s", rr.Code, rr.Body.String())
	}
	if store.updateHardwareReceived == nil || store.updateHardwareReceived.Name != "Tirador Renombrado" {
		t.Fatalf("update not called with new name: %+v", store.updateHardwareReceived)
	}
	if store.updateHardwareReceived.VisualAsset == nil || store.updateHardwareReceived.VisualAsset.AssetRevisionID != "75000000-0000-0000-0000-000000000001" {
		t.Fatalf("existing binding lost or altered: %+v", store.updateHardwareReceived.VisualAsset)
	}
}

// --- End-to-end: real throwaway PostgreSQL + real filesystem ----------------

func hwAssetE2EStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Skipf("bad DATABASE_URL: %v", err)
	}
	dbName := "hwassets_api_e2e_" + fmt.Sprint(time.Now().UnixNano()%1000000)
	admin, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	if _, err := admin.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, dbName)); err != nil {
		admin.Close()
		t.Skipf("drop throwaway db: %v", err)
	}
	if _, err := admin.Exec(context.Background(), fmt.Sprintf(`CREATE DATABASE %s`, dbName)); err != nil {
		admin.Close()
		t.Skipf("create throwaway db: %v", err)
	}
	u.Path = "/" + dbName
	pool, err := pgxpool.New(context.Background(), u.String())
	if err != nil {
		t.Fatalf("connect e2e db: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, dbName))
		admin.Close()
	})
	store := &storage.PostgresStore{Pool: pool}
	// Migration 00094 hits a rare PostgreSQL catalog race ("tuple
	// concurrently updated") on freshly created databases; one retry clears
	// it (idempotent runner: applied versions are skipped).
	var migErr error
	for attempt := 0; attempt < 3; attempt++ {
		migErr = store.RunMigrations(context.Background())
		if migErr == nil || !strings.Contains(migErr.Error(), "tuple concurrently updated") {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if migErr != nil {
		t.Fatalf("migrations: %v", migErr)
	}
	// A real actor row: durable audit requires a UUID actor.
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		VALUES ('21000000-0000-0000-0000-0000000000e2', 'asset-e2e@test.local', 'x', 'Asset E2E', 'active', 'asset-e2e@test.local')
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatalf("seed e2e user: %v", err)
	}
	return store, pool
}

// hwAssetE2EActor is the seeded UUID actor of the throwaway DB: durable
// audit requires a real user id (never a test label).
const hwAssetE2EActor = "21000000-0000-0000-0000-0000000000e2"

// Handler-level walkthrough (NOT the router E2E — the router/auth/idempotency
// proof lives in hardware_assets_router_test.go): iniciar carga, recibir
// bytes, finalizar con verificación real, consultar, autorizar y recuperar
// los bytes exactos con handlers directos.
func TestHardwareAssets_HandlerLevelByteWalkthrough(t *testing.T) {
	store, pool := hwAssetE2EStore(t)

	mediaAuthority, err := auth.NewMediaAuthority("hardware-asset-e2e-media-key-0123456789")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: store, MediaDir: t.TempDir(), MediaTokens: mediaAuthority}

	e2eReq := func(method, target, body string) *http.Request {
		req := withClaims(httptest.NewRequest(method, target, strings.NewReader(body)), hwAssetE2EActor, string(domain.RoleAdmin))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		return req
	}

	// 1. Start (session row in the real DB).
	req := e2eReq(http.MethodPost, "/api/hardware-assets/uploads",
		`{"representation":"skp","display_name":"Tirador e2e","provenance":"Proveedor","license":"Interna",
		  "origin":{"source_units":"mm","up_axis":"z","anchor_offset_mm":{"x_mm":10,"y_mm":0,"z_mm":12}}}`)
	rr := httptest.NewRecorder()
	srv.HandleHardwareAssetUploadStart(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("start = %d %s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}

	// 2. Bytes (real file, server-side digest).
	content := []byte(strings.Repeat("skp-e2e-bytes-", 200))
	rr = hwAssetMultipart(t, srv, session.ID, "skp", "handle.skp", string(domain.RoleAdmin), content)
	if rr.Code != http.StatusOK {
		t.Fatalf("bytes = %d %s", rr.Code, rr.Body.String())
	}

	// 3. Finalize (disk verification + immutable revision).
	req = e2eReq(http.MethodPost, "/api/hardware-assets/uploads/"+session.ID+":finalize", "")
	req.SetPathValue("sessionId", session.ID)
	rr = httptest.NewRecorder()
	srv.HandleHardwareAssetUploadFinalize(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("finalize = %d %s", rr.Code, rr.Body.String())
	}
	var asset struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		Revisions []struct {
			ID                  string `json:"id"`
			Sha256              string `json:"sha256"`
			SizeBytes           int64  `json:"size_bytes"`
			ValidationState     string `json:"validation_state"`
			IntegrityVerifiedAt string `json:"integrity_verified_at"`
			Origin              *struct {
				SourceUnits string `json:"source_units"`
				UpAxis      string `json:"up_axis"`
			} `json:"origin"`
		} `json:"revisions"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &asset); err != nil {
		t.Fatal(err)
	}
	if asset.Status != "active" || len(asset.Revisions) != 1 || asset.Revisions[0].ValidationState != "pending" {
		t.Fatalf("asset = %+v", asset)
	}
	sum := sha256.Sum256(content)
	if asset.Revisions[0].Sha256 != "sha256-"+hex.EncodeToString(sum[:]) {
		t.Fatalf("digest = %s", asset.Revisions[0].Sha256)
	}

	// 4. Consult.
	req = e2eReq(http.MethodGet, "/api/hardware-assets/uploads/"+session.ID, "")
	req.SetPathValue("sessionId", session.ID)
	rr = httptest.NewRecorder()
	srv.HandleHardwareAssetUploadGet(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"finalized_asset_id"`) {
		t.Fatalf("consult = %d %s", rr.Code, rr.Body.String())
	}

	// 5. Authorize + read the exact bytes back.
	req = e2eReq(http.MethodPost,
		"/api/hardware-assets/"+asset.ID+"/revisions/"+asset.Revisions[0].ID+":authorize", "")
	req.SetPathValue("assetId", asset.ID)
	req.SetPathValue("revisionId", asset.Revisions[0].ID)
	rr = httptest.NewRecorder()
	srv.HandleHardwareAssetRevisionAuthorize(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("authorize = %d %s", rr.Code, rr.Body.String())
	}
	var grant struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	key := grant.URL[len("/api/hardware-assets/files/"):]
	key = key[:strings.Index(key, "?")]
	getReq := httptest.NewRequest(http.MethodGet, grant.URL, nil)
	getReq.SetPathValue("key", key)
	rr = httptest.NewRecorder()
	srv.hardwareAssetFileGetAuth(http.HandlerFunc(srv.HandleHardwareAssetFileGet)).ServeHTTP(rr, getReq)
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), content) {
		t.Fatalf("byte readback = %d (%d bytes, want %d)", rr.Code, rr.Body.Len(), len(content))
	}

	// Cleanup rows (throwaway DB dropped in t.Cleanup anyway; explicit for clarity).
	_, _ = pool.Exec(context.Background(),
		`DELETE FROM hardware_asset_upload_sessions WHERE id = $1`, session.ID)
	_, _ = pool.Exec(context.Background(),
		`DELETE FROM hardware_assets WHERE id = $1`, asset.ID)
}
