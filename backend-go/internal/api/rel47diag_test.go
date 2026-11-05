package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestRel47Diag(t *testing.T) {
	store, err := storage.NewPostgresStore("postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	jwtSecret := "NaELFF8dDjaGCGgEak7YLD/Eaown4pcQNrbDE9XEf/YtX+Cm7WemVnFmbQoDwvjj"
	authority := mustAuthority(jwtSecret)
	server := &Server{Store: store, JWTSecret: jwtSecret, Tokens: authority}
	token, _ := auth.GenerateLegacyWebToken(
		"34c70d5a-3504-45ce-8dd9-cd0d5fc3e9bf", "tiagofur@gmail.com",
		auth.TokenContext{
			Roles: []string{"admin"}, OrgID: "00000000-0000-0000-0000-000000000001",
			MembershipID:                "b7773333-035a-4855-bc0d-f1ab03684151",
			MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
		}, jwtSecret)

	reqBody := map[string]any{
		"schemaId": "granete.sketchup-authoring-resolve.v1", "schemaName": "granete.sketchup-authoring-resolve",
		"schemaVersion": "1.0", "messageId": "d47", "idempotencyKey": "d47",
		"sentAt": time.Now().UTC().Format(time.RFC3339),
		"source": map[string]any{"client": "granete-for-sketchup", "clientVersion": "0.1.99", "host": "sketchup", "hostVersion": "2026"},
		"units":  map[string]any{"length": "mm", "angle": "deg", "precisionMm": 0.01},
		"coordinateSystem": map[string]any{"handedness": "right", "upAxis": "z", "projectFrameId": "granete-project"},
		"furniture": map[string]any{
			"furnitureDefinitionId": "ab9f86a1-683c-4bd7-a4d4-e7e2505ecd01",
			"catalogRevision":       "dummy",
			"libraryReleaseId":      "631e0e60-5b52-43a4-b9e2-2d4e986b7e5c",
			"parameters":            map[string]any{},
			"materialChoices":       map[string]string{"CAJON": "0aa9f32b-a89a-4da8-aec1-5d5713503b79"},
		},
	}
	raw, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/resolve", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	AuthMiddleware(authority, store)(http.HandlerFunc(server.HandleFurnitureAuthoringResolve)).ServeHTTP(rec, req)
	body := rec.Body.String()
	if len(body) > 700 {
		body = body[:700]
	}
	t.Logf("HTTP %d body: %s", rec.Code, body)
}
