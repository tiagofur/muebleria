// Pilot / Multi-Org Readiness suite (F179 / #325 / ADR-0005).
//
// Purpose: prove, against a real PostgreSQL and through the real HTTP APIs
// (no mocks, no stubbed Store), that two independent workshops — the
// conceptual fixtures `pilot-a` and `pilot-b` — can coexist in one Granete
// installation with zero data leakage, and that basic real-world operations
// keep behaving correctly.
//
// Bootstrap mirrors the documented pilot onboarding (docs/pilot-onboarding.md):
// platform admin creates each organization with a cloned base catalog, enters
// via an audited support session, invites the owner, the owner accepts and
// then creates workshop data through the public APIs. Direct storage/SQL is
// used only where no public API exists (platform-admin bootstrap, base-catalog
// seed) or for justified assertions (ownership columns, time-travel for
// support-session expiry).
//
// Isolation contract under test (ADR-0005 §1): cross-org access is 404, never
// a 403 that confirms existence. A regression here must fail the Pilot Gate
// (scripts/pilot-gate.sh) before any deploy.

package pilotreadiness

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	pilotTestDBName = "muebles_pilot_readiness"
	pilotJWTSecret  = "pilot-readiness-jwt-secret-min-32-chars"
	pilotPassword   = "PilotGate2026"

	// nonexistentUUID is used to compare the "foreign org" response with the
	// "truly missing" response — they must be indistinguishable.
	nonexistentUUID = "11111111-1111-1111-1111-111111111111"
)

// errSkipDB marks "no PostgreSQL reachable" so TestMain can skip outside gate
// mode and hard-fail inside gate mode (PILOT_READINESS_GATE=1).
var errSkipDB = errors.New("postgresql not reachable")

var fx *fixture

type pilotUser struct {
	id    string
	email string
	token string
}

type pilotOrg struct {
	id   string
	slug string
	name string

	admin pilotUser // owner onboarded through invitation (real pilot flow)

	customer struct{ id, name string }
	project  struct{ id, name string }
	material struct{ id, code, name string } // org-specific board created via API
	media    struct{ name, url string }      // uploaded through POST /api/media
	settings domain.WorkshopSettings
}

type fixture struct {
	base      string // httptest server base URL
	ts        *httptest.Server
	store     *storage.PostgresStore
	pool      *pgxpool.Pool
	dsn       url.URL // DSN of the pilot test database
	adminPool *pgxpool.Pool
	mediaDir  string

	platform pilotUser // org-less platform console token

	a pilotOrg
	b pilotOrg
}

func TestMain(m *testing.M) {
	f, err := buildFixture()
	if err != nil {
		if errors.Is(err, errSkipDB) {
			fmt.Printf("SKIP: pilot readiness suite requires PostgreSQL: %v\n", err)
			fmt.Println("      start the dev DB (docker compose up -d db) or set DATABASE_URL;")
			fmt.Println("      the mandatory pre-deploy gate is scripts/pilot-gate.sh")
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "pilot readiness setup failed: %v\n", err)
		os.Exit(1)
	}
	fx = f
	code := m.Run()
	f.close()
	os.Exit(code)
}

// gateMode reports whether skips are forbidden (mandatory pre-deploy run).
func gateMode() bool { return os.Getenv("PILOT_READINESS_GATE") != "" }

// --- HTTP helpers -------------------------------------------------------------

func (f *fixture) do(t *testing.T, method, path, token string, body any) (int, []byte) {
	t.Helper()
	var rd io.Reader
	var rawBody []byte
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body for %s %s: %v", method, path, err)
		}
		rawBody = raw
		rd = bytes.NewReader(rawBody)
	}
	req, err := http.NewRequest(method, f.base+path, rd)
	if err != nil {
		t.Fatalf("build request %s %s: %v", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if method == http.MethodPost {
		req.Header.Set("Idempotency-Key", pilotIdempotencyKey(path, token, rawBody))
	}
	if method == http.MethodPut && strings.HasPrefix(path, "/api/org/members/") {
		req.Header.Set("If-Match", `"v1"`)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response of %s %s: %v", method, path, err)
	}
	return resp.StatusCode, raw
}

func pilotIdempotencyKey(path, token string, body []byte) string {
	fingerprint := sha256.Sum256(append([]byte(path+"\x00"+token+"\x00"), body...))
	return fmt.Sprintf("pilot-%x", fingerprint[:])
}

// want runs the request and demands one of the accepted status codes.
func (f *fixture) want(t *testing.T, method, path, token string, body any, accepted ...int) []byte {
	t.Helper()
	status, raw := f.do(t, method, path, token, body)
	for _, code := range accepted {
		if status == code {
			return raw
		}
	}
	t.Fatalf("%s %s: got status %d (want one of %v) body=%s", method, path, status, accepted, truncate(raw))
	return nil
}

func (f *fixture) decode(t *testing.T, method, path, token string, body any, accepted int, dst any) {
	t.Helper()
	raw := f.want(t, method, path, token, body, accepted)
	if err := json.Unmarshal(raw, dst); err != nil {
		t.Fatalf("%s %s: decode response: %v body=%s", method, path, err, truncate(raw))
	}
}

func truncate(b []byte) string {
	const max = 400
	if len(b) > max {
		return string(b[:max]) + "…"
	}
	return string(b)
}

type loginResponse struct {
	Token string `json:"token"`
	User  struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
	Roles        []string `json:"roles"`
	Organization *struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	} `json:"organization"`
	Memberships []struct {
		OrganizationID string   `json:"organization_id"`
		Roles          []string `json:"roles"`
	} `json:"memberships"`
	SelectionRequired bool `json:"selection_required"`
}

func (f *fixture) login(t *testing.T, email, org string) loginResponse {
	t.Helper()
	var resp loginResponse
	f.decode(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email":    email,
		"password": pilotPassword,
		"org":      org,
	}, http.StatusOK, &resp)
	return resp
}

// scopedToken returns an org-scoped token for email via the real login flow
// (org hint pre-selects the membership, ADR-0004 §6).
func (f *fixture) scopedToken(t *testing.T, email, slug string) string {
	t.Helper()
	resp := f.login(t, email, slug)
	if resp.Token == "" || resp.Organization == nil || resp.Organization.Slug != slug {
		t.Fatalf("login %s @ %s: expected org-scoped token, got %+v", email, slug, resp)
	}
	return resp.Token
}

// --- DB helpers (justified assertions only) ------------------------------------

func (f *fixture) queryRow(t *testing.T, sql string, args ...any) map[string]any {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), sql, args...)
	if err != nil {
		t.Fatalf("query %q: %v", firstLine(sql), err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatalf("query %q: no rows", firstLine(sql))
	}
	vals, err := rows.Values()
	if err != nil {
		t.Fatalf("query %q: scan: %v", firstLine(sql), err)
	}
	out := map[string]any{}
	for i, fd := range rows.FieldDescriptions() {
		out[fd.Name] = vals[i]
	}
	return out
}

func (f *fixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", firstLine(sql), err)
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// customerOrgID asserts the ownership column straight from the database —
// the API never exposes organization_id for customers, so this is the honest
// way to prove where the row landed.
func (f *fixture) customerOrgID(t *testing.T, id string) string {
	t.Helper()
	row := f.queryRow(t, `SELECT organization_id::text FROM customers WHERE id = $1`, id)
	org, _ := row["organization_id"].(string)
	return org
}

// --- Bootstrap ------------------------------------------------------------------

func buildFixture() (*fixture, error) {
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		base = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	ctx := context.Background()

	// Admin connection (to drop/create the throwaway database).
	adminURL := *u
	adminURL.Path = "/postgres"
	admin, err := pgxpool.New(ctx, adminURL.String())
	if err != nil {
		return skipOrErr("connect admin dsn: %w", err)
	}
	if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+pilotTestDBName+` WITH (FORCE)`); err != nil {
		admin.Close()
		return skipOrErr("drop test db: %w", err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+pilotTestDBName); err != nil {
		admin.Close()
		return skipOrErr("create test db: %w", err)
	}

	testURL := *u
	testURL.Path = "/" + pilotTestDBName
	pool, err := pgxpool.New(ctx, testURL.String())
	if err != nil {
		admin.Close()
		return skipOrErr("connect test db: %w", err)
	}

	f := &fixture{pool: pool, adminPool: admin, dsn: testURL, store: &storage.PostgresStore{Pool: pool}}

	if err := f.store.RunMigrations(ctx); err != nil {
		f.close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	// Base catalog for the initial organization (what platform orgs clone
	// from — mirrors cmd/admin seed / POST /api/seed without auth plumbing).
	if err := f.store.SeedCatalog(storage.WithOrgCtx(ctx, storage.InitialOrganizationID)); err != nil {
		f.close()
		return nil, fmt.Errorf("seed base catalog: %w", err)
	}

	// Platform admin bootstrap: same as `cmd/admin create-platform-admin`,
	// which has no public API by design.
	hash, err := auth.HashPassword(pilotPassword)
	if err != nil {
		f.close()
		return nil, fmt.Errorf("hash platform admin password: %w", err)
	}
	platformUser := mustStorageUser(f, "platform@pilot-readiness.test", "Platform Fixture", hash)
	if err := f.store.SetPlatformAdmin(ctx, platformUser.ID, true); err != nil {
		f.close()
		return nil, fmt.Errorf("set platform admin: %w", err)
	}

	// HTTP server: the real router over the real store.
	mediaDir, err := os.MkdirTemp("", "pilot-media-")
	if err != nil {
		f.close()
		return nil, fmt.Errorf("media temp dir: %w", err)
	}
	f.mediaDir = mediaDir
	server := api.NewServerWithMedia(f.store, pilotJWTSecret, nil, 1000, 1000, mediaDir)
	f.ts = httptest.NewServer(api.RegisterRoutes(server))
	f.base = f.ts.URL

	// Platform console token (org-less by design).
	var login loginResponse
	if err := f.request(&login, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": platformUser.Email, "password": pilotPassword,
	}, http.StatusOK); err != nil {
		f.close()
		return nil, fmt.Errorf("platform admin login: %w", err)
	}
	f.platform = pilotUser{id: login.User.ID, email: platformUser.Email, token: login.Token}

	// The two conceptual pilot organizations.
	if f.a, err = f.createPilotOrg("Piloto Alfa", "pilot-a", "owner-a@pilot-readiness.test",
		"MXN", 1.35, 100, "saw-guillotine", true, "PLOT-A-BOARD-18", "Tablero Fixture Alfa",
		"Cliente Fixture Alfa", "cliente-a@pilot-readiness.test", "Obra Fixture Alfa"); err != nil {
		f.close()
		return nil, err
	}
	if f.b, err = f.createPilotOrg("Piloto Beta", "pilot-b", "owner-b@pilot-readiness.test",
		"BRL", 1.5, 250, "cnc-nesting", false, "PLOT-B-BOARD-18", "Tablero Fixture Beta",
		"Cliente Fixture Beta", "cliente-b@pilot-readiness.test", "Obra Fixture Beta"); err != nil {
		f.close()
		return nil, err
	}
	return f, nil
}

// skipOrErr wraps connection failures: outside gate mode they mean "skip",
// inside gate mode (PILOT_READINESS_GATE=1) a skip would be a false green.
func skipOrErr(format string, err error) (*fixture, error) {
	wrapped := fmt.Errorf(format, err)
	if gateMode() {
		return nil, fmt.Errorf("gate mode (PILOT_READINESS_GATE=1): %w", wrapped)
	}
	return nil, errors.Join(errSkipDB, wrapped)
}

func (f *fixture) request(dst any, method, path, token string, body any, accepted int) error {
	var rd io.Reader
	var rawBody []byte
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rawBody = raw
		rd = bytes.NewReader(rawBody)
	}
	req, err := http.NewRequest(method, f.base+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if method == http.MethodPost {
		req.Header.Set("Idempotency-Key", pilotIdempotencyKey(path, token, rawBody))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != accepted {
		return fmt.Errorf("%s %s: status %d (want %d): %s", method, path, resp.StatusCode, accepted, truncate(raw))
	}
	if dst != nil {
		return json.Unmarshal(raw, dst)
	}
	return nil
}

func mustStorageUser(f *fixture, email, name, hash string) *domain.User {
	u := &domain.User{Email: email, Name: name, PasswordHash: hash, Active: true}
	if err := f.store.CreateUser(context.Background(), u); err != nil {
		f.close()
		panic(fmt.Sprintf("create storage user %s: %v", email, err))
	}
	return u
}

// createPilotOrg runs the full documented onboarding for one organization and
// seeds its workshop data through the public APIs.
func (f *fixture) createPilotOrg(name, slug, ownerEmail, currency string, margin float64, labor float64,
	cut string, vendedorCosts bool, matCode, matName, custName, custEmail, projName string) (pilotOrg, error) {
	var o pilotOrg
	o.name, o.slug = name, slug

	// 1. Platform creates the org with the base catalog cloned.
	var created struct {
		ID string `json:"id"`
	}
	err := f.request(&created, http.MethodPost, "/api/platform/organizations", f.platform.token, map[string]any{
		"name": name, "slug": slug, "type": "factory", "license_plan": "trial",
		"clone_catalog_from": storage.InitialOrganizationID,
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("create org %s: %w", slug, err)
	}
	o.id = created.ID

	// 2. Support session (audited) invites the owner — no SMTP in pilots.
	var ss struct {
		Token     string `json:"token"`
		SessionID string `json:"session_id"`
	}
	err = f.request(&ss, http.MethodPost, "/api/platform/organizations/"+o.id+"/support-session",
		f.platform.token, map[string]string{"reason": "pilot readiness fixture onboarding"}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("support session %s: %w", slug, err)
	}
	var inv struct {
		InvitationToken string `json:"invitation_token"`
	}
	err = f.request(&inv, http.MethodPost, "/api/org/invitations", ss.Token, map[string]any{
		"email": ownerEmail, "roles": []string{"admin"},
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("invite owner %s: %w", slug, err)
	}
	var ended map[string]bool
	if err := f.request(&ended, http.MethodDelete, "/api/platform/support-sessions/"+ss.SessionID,
		f.platform.token, nil, http.StatusOK); err != nil {
		return o, fmt.Errorf("end support session %s: %w", slug, err)
	}

	// 3. Owner accepts and enters the workshop.
	var accept loginResponse
	err = f.request(&accept, http.MethodPost, "/api/auth/accept-invitation", "", map[string]string{
		"token": inv.InvitationToken, "password": pilotPassword, "name": "Owner " + name,
	}, http.StatusOK)
	if err != nil {
		return o, fmt.Errorf("accept invitation %s: %w", slug, err)
	}
	if accept.Organization == nil || accept.Organization.Slug != slug {
		return o, fmt.Errorf("accept invitation %s: expected scoped token for %s", slug, slug)
	}
	o.admin = pilotUser{id: accept.User.ID, email: ownerEmail, token: accept.Token}
	tok := o.admin.token

	// 4. Workshop data, all through the public APIs.
	if err := f.request(&o.settings, http.MethodPut, "/api/settings", tok, map[string]any{
		"default_currency": currency, "default_margin_factor": margin,
		"default_labor_fixed_cost": labor, "default_cut_strategy": cut,
		"vendedor_can_view_costs": vendedorCosts,
	}, http.StatusOK); err != nil {
		return o, fmt.Errorf("settings %s: %w", slug, err)
	}

	var cust struct {
		ID string `json:"id"`
	}
	err = f.request(&cust, http.MethodPost, "/api/customers", tok, map[string]string{
		"name": custName, "email": custEmail, "phone": "00-0000-0000",
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("customer %s: %w", slug, err)
	}
	o.customer.id, o.customer.name = cust.ID, custName

	var mat struct {
		ID string `json:"id"`
	}
	err = f.request(&mat, http.MethodPost, "/api/catalog/materials", tok, map[string]any{
		"code": matCode, "name": matName, "manufacturer": "Maderas Fixture",
		"width_mm": 2750, "length_mm": 1850, "thickness_mm": 18,
		"board_price": 1200.50, "waste_percent": 8, "cost_per_m2": 25.5,
		"grain_default": true, "preview_color": "#a9714b",
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("material %s: %w", slug, err)
	}
	o.material.id, o.material.code, o.material.name = mat.ID, matCode, matName

	var proj struct {
		ID string `json:"id"`
	}
	err = f.request(&proj, http.MethodPost, "/api/projects", tok, map[string]any{
		"name": projName, "customer_id": cust.ID,
		"margin_factor": margin, "labor_fixed_cost": labor, "currency": currency,
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("project %s: %w", slug, err)
	}
	o.project.id, o.project.name = proj.ID, projName

	mediaName, mediaURL, err := f.uploadMediaTok(tok)
	if err != nil {
		return o, fmt.Errorf("media %s: %w", slug, err)
	}
	o.media.name, o.media.url = mediaName, mediaURL

	var photo struct {
		ID string `json:"id"`
	}
	err = f.request(&photo, http.MethodPost, "/api/projects/"+proj.ID+"/photos", tok, map[string]any{
		"url": mediaURL, "caption": "fixture photo",
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("photo %s: %w", slug, err)
	}

	var evt struct {
		ID string `json:"id"`
	}
	err = f.request(&evt, http.MethodPost, "/api/projects/"+proj.ID+"/events", tok, map[string]any{
		"type": "quote_created", "source": "api", "note": "fixture lifecycle event",
	}, http.StatusCreated)
	if err != nil {
		return o, fmt.Errorf("event %s: %w", slug, err)
	}

	// Production-related entity: a quality issue on the project (OC-060,
	// manufacturing-scoped subresource).
	var quality struct {
		Issues []struct {
			ID string `json:"id"`
		} `json:"issues"`
	}
	err = f.request(&quality, http.MethodPost, "/api/projects/"+proj.ID+"/quality/issue", tok, map[string]any{
		"description": "Alineación de frente fuera de tolerancia (fixture)",
		"category":    "dimensional",
	}, http.StatusOK)
	if err != nil {
		return o, fmt.Errorf("quality issue %s: %w", slug, err)
	}

	return o, nil
}

// uploadMediaTok posts a minimal PNG through the real multipart endpoint.
func (f *fixture) uploadMediaTok(token string) (name, mediaURL string, err error) {
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 56)...)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	file, err := mw.CreateFormFile("file", "fixture.png")
	if err != nil {
		return "", "", err
	}
	if _, err := file.Write(png); err != nil {
		return "", "", err
	}
	if err := mw.Close(); err != nil {
		return "", "", err
	}

	req, err := http.NewRequest(http.MethodPost, f.base+"/api/media", &buf)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return "", "", fmt.Errorf("POST /api/media: status %d: %s", resp.StatusCode, truncate(raw))
	}
	var out struct {
		URL      string `json:"url"`
		Filename string `json:"filename"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", err
	}
	return out.Filename, out.URL, nil
}

func (f *fixture) close() {
	if f.ts != nil {
		f.ts.Close()
	}
	if f.pool != nil {
		f.pool.Close()
	}
	if f.mediaDir != "" {
		_ = os.RemoveAll(f.mediaDir)
	}
	if f.adminPool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = f.adminPool.Exec(ctx, `DROP DATABASE IF EXISTS `+pilotTestDBName+` WITH (FORCE)`)
		f.adminPool.Close()
	}
}

// inviteAndAccept invites email into the org (admin token may be a regular
// org admin or a support-session token) and accepts the invitation, returning
// the login response (new users get a scoped token; users with several
// memberships get selection_required).
func (f *fixture) inviteAndAccept(t *testing.T, adminToken, email string, roles ...string) loginResponse {
	t.Helper()
	var inv struct {
		InvitationToken string `json:"invitation_token"`
	}
	f.decode(t, http.MethodPost, "/api/org/invitations", adminToken, map[string]any{
		"email": email, "roles": roles,
	}, http.StatusCreated, &inv)

	var accept loginResponse
	f.decode(t, http.MethodPost, "/api/auth/accept-invitation", "", map[string]string{
		"token": inv.InvitationToken, "password": pilotPassword, "name": "Member " + email,
	}, http.StatusOK, &accept)
	if accept.User.ID == "" {
		t.Fatalf("accept invitation for %s: no user id in response", email)
	}
	return accept
}

// startSupportSession opens an audited support session into orgID.
func (f *fixture) startSupportSession(t *testing.T, orgID, reason string) (token, sessionID string) {
	t.Helper()
	var ss struct {
		Token     string `json:"token"`
		SessionID string `json:"session_id"`
	}
	f.decode(t, http.MethodPost, "/api/platform/organizations/"+orgID+"/support-session",
		f.platform.token, map[string]string{"reason": reason}, http.StatusCreated, &ss)
	return ss.Token, ss.SessionID
}

func (f *fixture) endSupportSession(t *testing.T, sessionID string) {
	t.Helper()
	f.want(t, http.MethodDelete, "/api/platform/support-sessions/"+sessionID, f.platform.token, nil, http.StatusOK)
}
