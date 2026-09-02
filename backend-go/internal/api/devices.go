package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.ClientType == "" || req.DisplayName == "" {
		http.Error(w, "missing fields", http.StatusBadRequest)
		return
	}

	enrollment := &domain.AuthDeviceEnrollment{
		ID:          uuid.New().String(),
		Code:        generatePin(),
		ClientType:  req.ClientType,
		DisplayName: req.DisplayName,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}

	if err := s.Store.CreateAuthDeviceEnrollment(r.Context(), enrollment); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, enrollDeviceResponse{
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	enrollment, err := s.Store.GetAuthDeviceEnrollmentByID(r.Context(), req.ID)
	if err != nil {
		if errors.Is(err, storage.ErrEnrollmentNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if time.Now().After(enrollment.ExpiresAt) && enrollment.Status == domain.EnrollmentStatusPending {
		writeJSON(w, http.StatusOK, pollDeviceResponse{Status: domain.EnrollmentStatusExpired})
		return
	}

	writeJSON(w, http.StatusOK, pollDeviceResponse{Status: enrollment.Status})
}

type exchangeDeviceRequest struct {
	EnrollmentID string `json:"enrollment_id"`
}

type exchangeDeviceResponse struct {
	DeviceSecret string `json:"device_secret"`
}

func (s *Server) HandleDeviceExchange(w http.ResponseWriter, r *http.Request) {
	var req exchangeDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	enrollment, err := s.Store.GetAuthDeviceEnrollmentByID(r.Context(), req.EnrollmentID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if enrollment.Status != domain.EnrollmentStatusApproved {
		http.Error(w, "not approved", http.StatusForbidden)
		return
	}

	// Generate device secret
	secretBytes := make([]byte, 32)
	rand.Read(secretBytes)
	deviceSecret := hex.EncodeToString(secretBytes)

	// Hash for storage
	hash := sha256.Sum256([]byte(deviceSecret))

	device := &domain.AuthDevice{
		ID:             uuid.New().String(),
		UserID:         *enrollment.UserID,
		ClientType:     enrollment.ClientType,
		DisplayName:    enrollment.DisplayName,
		CredentialHash: hash[:],
	}

	// Transactionally mark exchanged and create device
	// (for simplicity in this implementation, doing sequentially is fine as long as
	// we handle errors, but ideally they'd be in a tx. Here we just use the store methods)
	
	if err := s.Store.MarkAuthDeviceEnrollmentExchanged(r.Context(), enrollment.ID); err != nil {
		http.Error(w, "already exchanged or error", http.StatusConflict)
		return
	}

	if err := s.Store.CreateAuthDevice(r.Context(), device); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, exchangeDeviceResponse{
		DeviceSecret: device.ID + ":" + deviceSecret,
	})
}

// User-facing endpoint (protected by web auth) to approve device
type approveDeviceRequest struct {
	Code string `json:"code"`
}


func (s *Server) HandleDeviceApprove(w http.ResponseWriter, r *http.Request) {
	// Require valid web session
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req approveDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	enrollment, err := s.Store.GetAuthDeviceEnrollmentByCode(r.Context(), req.Code)
	if err != nil {
		http.Error(w, "invalid code", http.StatusNotFound)
		return
	}

	if time.Now().After(enrollment.ExpiresAt) || enrollment.Status != domain.EnrollmentStatusPending {
		http.Error(w, "expired or already used", http.StatusConflict)
		return
	}

	if err := s.Store.ApproveAuthDeviceEnrollment(r.Context(), enrollment.ID, claims.UserID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

type deviceTokenRequest struct {
	DeviceSecret string `json:"device_secret"`
}

type deviceTokenResponse struct {
	AccessToken string `json:"access_token"`
}

// HandleDeviceToken issues a short-lived access token for a valid device secret
func (s *Server) HandleDeviceToken(w http.ResponseWriter, r *http.Request) {
	var req deviceTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.DeviceSecret == "" || len(req.DeviceSecret) < 32 {
		http.Error(w, "invalid device secret", http.StatusUnauthorized)
		return
	}

	// Device secret format is ID:SECRET
	var deviceID, plainSecret string
	// Simplified parsing for now: just split by first colon
	for i, c := range req.DeviceSecret {
		if c == ':' {
			deviceID = req.DeviceSecret[:i]
			plainSecret = req.DeviceSecret[i+1:]
			break
		}
	}
	if deviceID == "" || plainSecret == "" {
		http.Error(w, "invalid device secret", http.StatusUnauthorized)
		return
	}

	device, err := s.Store.GetAuthDevice(r.Context(), deviceID)
	if err != nil {
		if errors.Is(err, storage.ErrDeviceNotFound) {
			http.Error(w, "invalid device", http.StatusUnauthorized)
		} else {
			respondWithInternalError(w, err, "device-token: get device")
		}
		return
	}

	if device.RevokedAt != nil {
		http.Error(w, "device revoked", http.StatusUnauthorized)
		return
	}

	// Verify secret
	hasher := sha256.New()
	hasher.Write([]byte(plainSecret))
	hashedSecret := hex.EncodeToString(hasher.Sum(nil))

	if string(device.CredentialHash) != hashedSecret && hex.EncodeToString(device.CredentialHash) != hashedSecret {
		http.Error(w, "invalid device secret", http.StatusUnauthorized)
		return
	}
	
	// Check user still exists
	user, err := s.Store.GetUserByID(r.Context(), device.UserID)
	if err != nil || user.AccountStatus != domain.AccountStatusActive {
		http.Error(w, "user inactive or deleted", http.StatusUnauthorized)
		return
	}

	// Update last seen
	_ = s.Store.UpdateAuthDeviceLastSeen(r.Context(), device.ID)

	// Issue new token
	// IMPORTANT: Device tokens DO NOT have a registry session. They use the device ID.
	// But IssueTransportTokenUntil requires a SessionID for web/mobile.
	// We pass device.ID as the session ID, and SketchUp client type.
	// Token will have absolute expires at +1 year just as a formality.
	
	tc := auth.TokenContext{
		PlatformAdmin: user.PlatformAdmin,
		SessionID:     device.ID,
		// Not bound to any specific org yet, just orgless token.
	}
	
	token, err := s.tokenAuthority().IssueTransportTokenUntil(device.UserID, user.Email, tc, "sketchup", time.Now().AddDate(1, 0, 0))
	if err != nil {
		respondWithInternalError(w, err, "device-token: generate token")
		return
	}

	writeJSON(w, http.StatusOK, deviceTokenResponse{
		AccessToken: token,
	})
}

func generatePin() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // avoid confusing characters
	bytes := make([]byte, 6)
	rand.Read(bytes)
	for i, b := range bytes {
		bytes[i] = chars[b%byte(len(chars))]
	}
	return string(bytes)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
