package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	directoryAPIUser    = "a0000000-0000-0000-0000-000000000001"
	directoryCurrentSID = "b0000000-0000-0000-0000-000000000001"
	directoryOtherSID   = "b0000000-0000-0000-0000-000000000002"
)

func directoryClaimsRequest(method, path string, claims *auth.Claims, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
}

func TestSessionDirectorySelfMarksCurrentAndCurrentRevokeCutsAccess(t *testing.T) {
	now := time.Now()
	store := &stubStore{
		getUserByEmail: &domain.User{ID: directoryAPIUser, Email: "directory@test.com", AccountStatus: domain.AccountStatusActive},
		authSessions: map[string]*domain.AuthSession{
			directoryCurrentSID: {ID: directoryCurrentSID, UserID: directoryAPIUser, ClientType: domain.SessionClientWeb, CreatedAt: now.Add(-time.Hour), AbsoluteExpiresAt: now.Add(time.Hour)},
			directoryOtherSID:   {ID: directoryOtherSID, UserID: directoryAPIUser, ClientType: domain.SessionClientMobile, CreatedAt: now.Add(-2 * time.Hour), AbsoluteExpiresAt: now.Add(time.Hour)},
		},
	}
	server := &Server{Store: store}
	claims := &auth.Claims{UserID: directoryAPIUser, Sid: directoryCurrentSID}

	listRecorder := httptest.NewRecorder()
	server.HandleListMySessions(listRecorder, directoryClaimsRequest(http.MethodGet, "/api/auth/sessions", claims, ""))
	if listRecorder.Code != http.StatusOK || listRecorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("list status/cache=%d/%q body=%s", listRecorder.Code, listRecorder.Header().Get("Cache-Control"), listRecorder.Body.String())
	}
	var directory openapi.SessionDirectory
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &directory); err != nil {
		t.Fatal(err)
	}
	if len(directory.Items) != 2 {
		t.Fatalf("items=%d", len(directory.Items))
	}
	currentCount := 0
	for _, item := range directory.Items {
		if item.IsCurrent {
			currentCount++
			if item.ID != directoryCurrentSID {
				t.Fatalf("client selected current session: %+v", item)
			}
		}
	}
	if currentCount != 1 {
		t.Fatalf("current count=%d", currentCount)
	}

	revokeRequest := directoryClaimsRequest(http.MethodPost, "/api/auth/sessions/"+directoryCurrentSID+"/revoke", claims, "")
	revokeRequest.SetPathValue("sessionId", directoryCurrentSID)
	revokeRecorder := httptest.NewRecorder()
	server.HandleRevokeMySession(revokeRecorder, revokeRequest)
	if revokeRecorder.Code != http.StatusOK || store.authSessions[directoryCurrentSID].RevokedAt == nil {
		t.Fatalf("current revoke status=%d body=%s", revokeRecorder.Code, revokeRecorder.Body.String())
	}

	authority := mustAuthority("session-directory-api-secret-32-bytes-min")
	token, err := issueTransportTokenCapped(authority, directoryAPIUser, "directory@test.com", auth.TokenContext{SessionID: directoryCurrentSID}, "web")
	if err != nil {
		t.Fatal(err)
	}
	accessRequest := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	accessRequest.Header.Set("Authorization", "Bearer "+token)
	accessRecorder := httptest.NewRecorder()
	AuthMiddleware(authority, store)(okHandler()).ServeHTTP(accessRecorder, accessRequest)
	if accessRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("revoked current access status=%d body=%s", accessRecorder.Code, accessRecorder.Body.String())
	}
}

func TestSessionDirectoryOrganizationCapabilityAndExactScope(t *testing.T) {
	organizationID := "c0000000-0000-0000-0000-000000000001"
	membershipID := "d0000000-0000-0000-0000-000000000001"
	targetUserID := "a0000000-0000-0000-0000-000000000002"
	sessionID := "b0000000-0000-0000-0000-000000000003"
	team := []storage.OrgTeamMember{{MembershipID: membershipID, UserID: targetUserID, Roles: []domain.UserRole{domain.RoleVendedor}, Status: domain.MembershipStatusActive}}
	server, capabilityStore := teamCapabilityServer(domain.OrganizationTypeFactory, team)
	capabilityStore.stubStore.getOrgByID.ID = organizationID
	capabilityStore.stubStore.authSessions = map[string]*domain.AuthSession{
		sessionID: {ID: sessionID, UserID: targetUserID, MembershipID: &membershipID, ActiveOrganizationID: &organizationID, ClientType: domain.SessionClientWeb, CreatedAt: time.Now().Add(-time.Hour), AbsoluteExpiresAt: time.Now().Add(time.Hour)},
	}

	adminClaims := &auth.Claims{UserID: directoryAPIUser, OrgID: organizationID, Roles: []string{string(domain.RoleAdmin)}}
	listRequest := directoryClaimsRequest(http.MethodGet, "/api/org/memberships/"+membershipID+"/sessions", adminClaims, "")
	listRequest.SetPathValue("membershipId", membershipID)
	listRecorder := httptest.NewRecorder()
	server.HandleListMembershipSessions(listRecorder, listRequest)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("admin list status=%d body=%s", listRecorder.Code, listRecorder.Body.String())
	}

	sellerClaims := &auth.Claims{UserID: "seller", OrgID: organizationID, Roles: []string{string(domain.RoleVendedor)}}
	sellerRequest := directoryClaimsRequest(http.MethodGet, "/api/org/memberships/"+membershipID+"/sessions", sellerClaims, "")
	sellerRequest.SetPathValue("membershipId", membershipID)
	sellerRecorder := httptest.NewRecorder()
	server.HandleListMembershipSessions(sellerRecorder, sellerRequest)
	if sellerRecorder.Code != http.StatusForbidden {
		t.Fatalf("seller list status=%d body=%s", sellerRecorder.Code, sellerRecorder.Body.String())
	}

	revokeRequest := directoryClaimsRequest(http.MethodPost, "/api/org/memberships/"+membershipID+"/sessions/"+sessionID+"/revoke", adminClaims, `{"reason":"lost device"}`)
	revokeRequest.SetPathValue("membershipId", membershipID)
	revokeRequest.SetPathValue("sessionId", sessionID)
	revokeRecorder := httptest.NewRecorder()
	server.HandleRevokeMembershipSession(revokeRecorder, revokeRequest)
	if revokeRecorder.Code != http.StatusOK || capabilityStore.stubStore.authSessions[sessionID].RevokedAt == nil {
		t.Fatalf("admin revoke status=%d body=%s", revokeRecorder.Code, revokeRecorder.Body.String())
	}
}

func TestSessionDirectoryRoutesRejectQueryTokenAndNonPlatform(t *testing.T) {
	store := &stubStore{getUserByEmail: &domain.User{ID: directoryAPIUser, Email: "directory@test.com", AccountStatus: domain.AccountStatusActive}}
	server := &Server{Store: store, JWTSecret: "session-directory-routes-secret-32-bytes"}
	router := RegisterRoutes(server)

	queryRecorder := httptest.NewRecorder()
	router.ServeHTTP(queryRecorder, httptest.NewRequest(http.MethodGet, "/api/auth/sessions?token=secret-in-url", nil))
	if queryRecorder.Code != http.StatusUnauthorized || queryRecorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("query token status/cache=%d/%q body=%s", queryRecorder.Code, queryRecorder.Header().Get("Cache-Control"), queryRecorder.Body.String())
	}

	authority := server.tokenAuthority()
	session := &domain.AuthSession{ID: directoryCurrentSID, UserID: directoryAPIUser, ClientType: domain.SessionClientWeb, CreatedAt: time.Now(), AbsoluteExpiresAt: time.Now().Add(time.Hour)}
	store.authSessions = map[string]*domain.AuthSession{directoryCurrentSID: session}
	token, err := issueTransportTokenCapped(authority, directoryAPIUser, "directory@test.com", auth.TokenContext{SessionID: directoryCurrentSID}, "web")
	if err != nil {
		t.Fatal(err)
	}
	platformRequest := httptest.NewRequest(http.MethodGet, "/api/platform/users/"+directoryAPIUser+"/sessions", nil)
	platformRequest.Header.Set("Authorization", "Bearer "+token)
	platformRecorder := httptest.NewRecorder()
	router.ServeHTTP(platformRecorder, platformRequest)
	if platformRecorder.Code != http.StatusForbidden {
		t.Fatalf("non-platform status=%d body=%s", platformRecorder.Code, platformRecorder.Body.String())
	}
}
