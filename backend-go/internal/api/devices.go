package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 SEC-6: dedicated device credentials for the SketchUp extension. The
// flow is the OAuth device-grant shape adapted to Granete's session registry:
// enroll (anonymous, rate-limited) → the user approves the 6-char PIN from
// the web console → exchange consumes the enrollment and mints the hash-only
// device secret plus its registry session → the device re-mints transport
// tokens from the secret. Every token carries the registry session id, so
// revoking the device (or the session) cuts access on the next request.

const (
	deviceEnrollmentTTL    = 10 * time.Minute
	deviceClientType       = "sketchup"
	deviceSecretMinLength  = 64 // 32 bytes hex
	deviceDisplayNameLimit = 120
	// Same alphabet as the backend PIN generator: no modulo bias (256 % 32 == 0).
	deviceCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	deviceCodeLength   = 6
)

type enrollDeviceRequest struct {
	ClientType  string `json:"client_type"`
	DisplayName string `json:"display_name"`
}

type enrollDeviceResponse struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Server) HandleDeviceEnroll(w http.ResponseWriter, r *http.Request) {
	var req enrollDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.ClientType != deviceClientType || req.DisplayName == "" || len([]rune(req.DisplayName)) > deviceDisplayNameLimit {
		respondWithError(w, http.StatusBadRequest, "missing or invalid fields")
		return
	}

	code, err := generateDeviceCode()
	if err != nil {
		respondWithInternalError(w, err, "device-enroll: code entropy")
		return
	}

	enrollment, err := s.Store.CreateAuthDeviceEnrollment(r.Context(), storage.DeviceEnrollmentCommand{
		EnrollmentID: uuid.NewString(),
		Code:         code,
		ClientType:   req.ClientType,
		DisplayName:  req.DisplayName,
		ExpiresAt:    time.Now().Add(deviceEnrollmentTTL).UTC(),
		IP:           clientIP(r),
		RequestID:    RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithInternalError(w, err, "device-enroll: create")
		return
	}

	respondWithJSON(w, http.StatusCreated, enrollDeviceResponse{
		ID:        enrollment.ID,
		Code:      enrollment.Code,
		ExpiresAt: enrollment.ExpiresAt,
	})
}

type pollDeviceRequest struct {
	ID string `json:"id"`
}

type pollDeviceResponse struct {
	Status string `json:"status"`
}

func (s *Server) HandleDeviceEnrollPoll(w http.ResponseWriter, r *http.Request) {
	var req pollDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if _, err := uuid.Parse(strings.TrimSpace(req.ID)); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}

	enrollment, err := s.Store.GetAuthDeviceEnrollmentByID(r.Context(), strings.TrimSpace(req.ID))
	if err != nil {
		if errors.Is(err, storage.ErrEnrollmentNotFound) {
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		respondWithInternalError(w, err, "device-poll: lookup")
		return
	}

	if enrollment.Status == domain.EnrollmentStatusPending && time.Now().After(enrollment.ExpiresAt) {
		respondWithJSON(w, http.StatusOK, pollDeviceResponse{Status: domain.EnrollmentStatusExpired})
		return
	}
	respondWithJSON(w, http.StatusOK, pollDeviceResponse{Status: enrollment.Status})
}

type exchangeDeviceRequest struct {
	EnrollmentID string `json:"enrollment_id"`
}

type exchangeDeviceResponse struct {
	DeviceSecret string `json:"device_secret"`
}

func (s *Server) HandleDeviceExchange(w http.ResponseWriter, r *http.Request) {
	var req exchangeDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if _, err := uuid.Parse(strings.TrimSpace(req.EnrollmentID)); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}

	exchanged, err := s.Store.ExchangeAuthDeviceEnrollment(r.Context(), storage.ExchangeDeviceCommand{
		EnrollmentID: strings.TrimSpace(req.EnrollmentID),
		IP:           clientIP(r),
		RequestID:    RequestIDFromContext(r.Context()),
	})
	if err != nil {
		if errors.Is(err, storage.ErrEnrollmentNotFound) {
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		if errors.Is(err, storage.ErrEnrollmentConflict) {
			respondWithError(w, http.StatusConflict, "enrollment not exchangeable")
			return
		}
		respondWithInternalError(w, err, "device-exchange")
		return
	}

	respondWithJSON(w, http.StatusOK, exchangeDeviceResponse{DeviceSecret: exchanged.RawSecret})
}

type approveDeviceRequest struct {
	Code string `json:"code"`
}

// HandleDeviceApprove binds a pending enrollment to the authenticated user
// who types the PIN. The code is normalized server-side (case, separators):
// a user typing the displayed PIN with dashes or spaces still matches.
func (s *Server) HandleDeviceApprove(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req approveDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	code := normalizeDeviceCode(req.Code)
	if len(code) != deviceCodeLength {
		respondWithError(w, http.StatusBadRequest, "invalid code")
		return
	}

	approved, err := s.Store.ApproveAuthDeviceEnrollment(r.Context(), storage.ApproveDeviceEnrollmentCommand{
		Code:          code,
		ApprovingUser: claims.UserID,
		IP:            clientIP(r),
		RequestID:     RequestIDFromContext(r.Context()),
	})
	if err != nil {
		if errors.Is(err, storage.ErrEnrollmentConflict) {
			respondWithError(w, http.StatusConflict, "expired or already used")
			return
		}
		respondWithInternalError(w, err, "device-approve")
		return
	}
	respondWithJSON(w, http.StatusOK, pollDeviceResponse{Status: approved.Status})
}

// normalizeDeviceCode strips separators and casing from a typed PIN so the
// UI presentation (grouping, lowercase) never decides match success.
func normalizeDeviceCode(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(raw) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

type deviceTokenRequest struct {
	DeviceSecret string `json:"device_secret"`
}

type deviceTokenResponse struct {
	AccessToken     string    `json:"access_token"`
	AccessExpiresAt time.Time `json:"access_expires_at"`
}

// HandleDeviceToken re-mints the SketchUp transport token from the stored
// device secret. The token is registry-capped: its sid resolves to the
// device's auth_sessions row, exp never passes the session's absolute bound,
// and revoking the device cuts access on the next request.
func (s *Server) HandleDeviceToken(w http.ResponseWriter, r *http.Request) {
	var req deviceTokenRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	deviceID, secret, ok := splitDeviceSecret(req.DeviceSecret)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "invalid device secret")
		return
	}

	var response deviceTokenResponse
	err := s.Store.ResolveDeviceToken(r.Context(), storage.DeviceTokenCommand{
		DeviceID: deviceID,
		Secret:   secret,
		IP:       clientIP(r),
	}, func(txCtx context.Context, result storage.DeviceTokenResult) error {
		token, err := s.tokenAuthority().IssueTransportTokenUntil(
			result.User.ID, result.User.Email,
			auth.TokenContext{
				PlatformAdmin:                 result.User.PlatformAdmin,
				AuthStartedAt:                 result.Session.CreatedAt,
				SessionID:                     result.Session.ID,
				Roles:                         result.Roles,
				OrgID:                         result.OrgID,
				MembershipID:                  result.MembershipID,
				MembershipCredentialVersion:   result.MembershipCredentialVersion,
				OrganizationCredentialVersion: result.OrganizationCredentialVersion,
			},
			deviceClientType, result.Session.AbsoluteExpiresAt)
		if err != nil {
			return err
		}
		expiresAt, err := auth.AccessTokenExpiry(time.Now(), result.Session.CreatedAt, deviceClientType, result.Session.AbsoluteExpiresAt)
		if err != nil {
			return err
		}
		response = deviceTokenResponse{AccessToken: token, AccessExpiresAt: expiresAt}
		return nil
	})
	if err != nil {
		if errors.Is(err, storage.ErrDeviceNotFound) || errors.Is(err, storage.ErrDeviceRevoked) {
			// Uniform 401: no oracle distinguishing wrong secret, unknown
			// device, revoked device or inactive user.
			respondWithError(w, http.StatusUnauthorized, "invalid device credentials")
			return
		}
		respondWithInternalError(w, err, "device-token")
		return
	}
	respondWithJSON(w, http.StatusOK, response)
}

// splitDeviceSecret parses the "<uuid>:<64 hex>" exchange response shape.
func splitDeviceSecret(raw string) (deviceID, secret string, ok bool) {
	idx := strings.Index(raw, ":")
	if idx <= 0 || idx == len(raw)-1 {
		return "", "", false
	}
	deviceID, secret = raw[:idx], raw[idx+1:]
	if len(secret) < deviceSecretMinLength {
		return "", "", false
	}
	return deviceID, secret, true
}

type deviceView struct {
	ID          string     `json:"id"`
	ClientType  string     `json:"client_type"`
	DisplayName string     `json:"display_name"`
	CreatedAt   time.Time  `json:"created_at"`
	LastSeenAt  *time.Time `json:"last_seen_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
}

// HandleListMyDevices returns the caller's devices. Metadata only: the
// credential hash never leaves the storage layer.
func (s *Server) HandleListMyDevices(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	devices, err := s.Store.ListAuthDevicesByUser(r.Context(), claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "device-list")
		return
	}
	views := make([]deviceView, 0, len(devices))
	for _, d := range devices {
		views = append(views, deviceView{
			ID: d.ID, ClientType: d.ClientType, DisplayName: d.DisplayName,
			CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt, RevokedAt: d.RevokedAt,
		})
	}
	respondWithJSON(w, http.StatusOK, map[string][]deviceView{"devices": views})
}

type revokeDeviceRequest struct {
	DeviceID string `json:"device_id"`
}

// HandleRevokeDevice revokes the caller's own device and cuts its registry
// session in the same transaction.
func (s *Server) HandleRevokeDevice(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req revokeDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if _, err := uuid.Parse(strings.TrimSpace(req.DeviceID)); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid device id")
		return
	}

	err := s.Store.RevokeAuthDevice(r.Context(), storage.RevokeDeviceCommand{
		DeviceID:  strings.TrimSpace(req.DeviceID),
		OwnerUser: claims.UserID,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		if errors.Is(err, storage.ErrDeviceNotFound) {
			respondWithError(w, http.StatusNotFound, "device not found")
			return
		}
		respondWithInternalError(w, err, "device-revoke")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

// generateDeviceCode draws 6 characters from the 32-symbol alphabet with
// crypto/rand. 256 % 32 == 0, so byte%len is unbiased.
func generateDeviceCode() (string, error) {
	buf := make([]byte, deviceCodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, deviceCodeLength)
	for i, b := range buf {
		out[i] = deviceCodeAlphabet[int(b)%len(deviceCodeAlphabet)]
	}
	return string(out), nil
}
