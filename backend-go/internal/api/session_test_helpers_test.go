package api

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// mustAuthority builds a single-key token authority for handler/middleware
// tests. Secrets must satisfy the production 32-byte minimum.
func mustAuthority(secret string) *auth.Authority {
	keyring, err := auth.SingleKeyKeyring(secret)
	if err != nil {
		panic(fmt.Sprintf("test keyring: %v", err))
	}
	authority, err := auth.NewAuthority(keyring, "")
	if err != nil {
		panic(fmt.Sprintf("test authority: %v", err))
	}
	return authority
}

// --- stubStore: session registry hooks (#460 / SEC-1) ---

func (s *stubStore) CreateAuthSession(_ context.Context, cmd storage.CreateAuthSessionCommand) (*domain.AuthSession, error) {
	if s.authSessions == nil {
		s.authSessions = map[string]*domain.AuthSession{}
	}
	if s.nextAuthSessionID == "" {
		s.nextAuthSessionID = "sess-1"
	}
	id := s.nextAuthSessionID
	s.nextAuthSessionID = "sess-" + fmt.Sprint(len(s.authSessions)+2)
	now := time.Now()
	out := &domain.AuthSession{
		ID: id, UserID: cmd.UserID, ClientType: cmd.ClientType,
		CreatedAt: now, AbsoluteExpiresAt: cmd.AbsoluteExpiresAt,
	}
	if cmd.MembershipID != "" {
		out.MembershipID = &cmd.MembershipID
	}
	if cmd.OrganizationID != "" {
		out.ActiveOrganizationID = &cmd.OrganizationID
	}
	if cmd.SupportSessionID != "" {
		out.SupportSessionID = &cmd.SupportSessionID
	}
	s.authSessions[id] = out
	return out, nil
}

func (s *stubStore) GetAuthSessionForRequest(_ context.Context, sessionID, expectedUserID string) (*domain.AuthSession, error) {
	if session, ok := s.authSessions[sessionID]; ok && session.UserID == expectedUserID {
		return session, nil
	}
	return nil, storage.ErrAuthSessionNotFound
}

func (s *stubStore) UpdateAuthSessionScope(_ context.Context, sessionID, membershipID, organizationID string) error {
	session, ok := s.authSessions[sessionID]
	if !ok {
		return storage.ErrAuthSessionNotFound
	}
	session.MembershipID = nil
	if membershipID != "" {
		session.MembershipID = &membershipID
	}
	session.ActiveOrganizationID = nil
	if organizationID != "" {
		session.ActiveOrganizationID = &organizationID
	}
	return nil
}

func (s *stubStore) RevokeAuthSession(_ context.Context, sessionID, revokedBy, reason string) (bool, error) {
	session, ok := s.authSessions[sessionID]
	if !ok || session.RevokedAt != nil {
		return false, nil
	}
	now := time.Now()
	session.RevokedAt = &now
	if revokedBy != "" {
		session.RevokedBy = &revokedBy
	}
	if reason != "" {
		session.RevokeReason = &reason
	}
	return true, nil
}

func (s *stubStore) ListOwnAuthSessions(_ context.Context, userID string, _ int) ([]storage.AuthSessionDirectoryEntry, error) {
	return s.stubSessionDirectory(userID, "", ""), nil
}

func (s *stubStore) ListMembershipAuthSessions(_ context.Context, _ string, organizationID, membershipID string, _ int) ([]storage.AuthSessionDirectoryEntry, error) {
	return s.stubSessionDirectory("", organizationID, membershipID), nil
}

func (s *stubStore) ListPlatformUserAuthSessions(_ context.Context, userID string, _ int) ([]storage.AuthSessionDirectoryEntry, error) {
	return s.stubSessionDirectory(userID, "", ""), nil
}

func (s *stubStore) stubSessionDirectory(userID, organizationID, membershipID string) []storage.AuthSessionDirectoryEntry {
	out := make([]storage.AuthSessionDirectoryEntry, 0)
	for _, session := range s.authSessions {
		if userID != "" && session.UserID != userID {
			continue
		}
		if organizationID != "" && (session.ActiveOrganizationID == nil || *session.ActiveOrganizationID != organizationID) {
			continue
		}
		if membershipID != "" && (session.MembershipID == nil || *session.MembershipID != membershipID) {
			continue
		}
		out = append(out, storage.AuthSessionDirectoryEntry{
			ID: session.ID, UserID: session.UserID, MembershipID: session.MembershipID,
			ActiveOrganizationID: session.ActiveOrganizationID, ClientType: session.ClientType,
			CreatedAt: session.CreatedAt, LastSeenAt: session.LastSeenAt,
			AbsoluteExpiresAt: session.AbsoluteExpiresAt, RevokedAt: session.RevokedAt,
			DeviceHint: session.DeviceHint,
		})
	}
	return out
}

func (s *stubStore) RevokeOwnAuthSession(_ context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error) {
	return s.stubRevokeSession(cmd, cmd.ActorUserID, "", "")
}

func (s *stubStore) RevokeMembershipAuthSession(_ context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error) {
	return s.stubRevokeSession(cmd, "", cmd.OrganizationID, cmd.TargetMembershipID)
}

func (s *stubStore) RevokePlatformAuthSession(_ context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error) {
	return s.stubRevokeSession(cmd, cmd.TargetUserID, "", "")
}

func (s *stubStore) stubRevokeSession(cmd storage.RevokeAuthSessionCommand, userID, organizationID, membershipID string) (*storage.AuthSessionRevocation, error) {
	session, ok := s.authSessions[cmd.SessionID]
	if !ok || (userID != "" && session.UserID != userID) ||
		(organizationID != "" && (session.ActiveOrganizationID == nil || *session.ActiveOrganizationID != organizationID)) ||
		(membershipID != "" && (session.MembershipID == nil || *session.MembershipID != membershipID)) {
		return nil, storage.ErrAuthSessionNotFound
	}
	revoked := session.RevokedAt == nil
	if revoked {
		now := time.Now()
		session.RevokedAt = &now
	}
	return &storage.AuthSessionRevocation{Session: storage.AuthSessionDirectoryEntry{
		ID: session.ID, UserID: session.UserID, MembershipID: session.MembershipID,
		ActiveOrganizationID: session.ActiveOrganizationID, ClientType: session.ClientType,
		CreatedAt: session.CreatedAt, LastSeenAt: session.LastSeenAt,
		AbsoluteExpiresAt: session.AbsoluteExpiresAt, RevokedAt: session.RevokedAt,
		DeviceHint: session.DeviceHint,
	}, Revoked: revoked}, nil
}

func (s *stubStore) CreateAuthRefreshCredential(_ context.Context, cmd storage.CreateAuthRefreshCredentialCommand) (*storage.AuthRefreshCredential, error) {
	return &storage.AuthRefreshCredential{ID: "refresh-1", FamilyID: "family-1", SessionID: cmd.SessionID, UserID: cmd.UserID, Generation: 1, ExpiresAt: time.Now().Add(auth.WebSessionAbsoluteTTL)}, nil
}

func (s *stubStore) RotateAuthRefreshCredential(_ context.Context, _ storage.RotateAuthRefreshCredentialCommand, _ storage.AuthRefreshRotationCallback) (*storage.AuthRefreshRotation, error) {
	return nil, storage.ErrRefreshInvalid
}

func (s *stubStore) LogoutByRefreshCredential(_ context.Context, _ []byte, _, _ string) error {
	return nil
}

// mintSessionToken mints a ver5 token bound to a registry row on the stub so
// middleware-routed tests exercise the live session path (#460).
func mintSessionToken(t *testing.T, authority *auth.Authority, st *stubStore, userID, email string, tc auth.TokenContext, transport string) string {
	t.Helper()
	session, err := st.CreateAuthSession(context.Background(), storage.CreateAuthSessionCommand{
		UserID:            userID,
		MembershipID:      tc.MembershipID,
		OrganizationID:    tc.OrgID,
		ClientType:        sessionClientType(transport),
		AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(transport)),
	})
	if err != nil {
		t.Fatalf("create auth session: %v", err)
	}
	tc.SessionID = session.ID
	// SEC-4B: web mints require the registry cap, exactly like production.
	var token string
	if transport == "web" {
		token, err = authority.IssueTransportTokenUntil(userID, email, tc, transport, session.AbsoluteExpiresAt)
	} else {
		token, err = authority.IssueTransportToken(userID, email, tc, transport)
	}
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return token
}

// issueTransportTokenCapped mints like production does since SEC-4B: web
// always carries the registry's absolute cap.
func issueTransportTokenCapped(a *auth.Authority, userID, email string, tc auth.TokenContext, transport string) (string, error) {
	if transport == "web" {
		return a.IssueTransportTokenUntil(userID, email, tc, transport, time.Now().Add(auth.WebSessionAbsoluteTTL))
	}
	return a.IssueTransportToken(userID, email, tc, transport)
}
