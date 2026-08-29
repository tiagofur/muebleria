package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

var validIdempotencyKey = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`)

var sensitiveIdempotencyOperations = map[string]bool{
	"org.create-invitation": true, "org.resend-invitation": true, "auth.accept-invitation": true,
}

func idempotencyReceiptCipher(secret string) (func([]byte) ([]byte, error), func([]byte) ([]byte, error), error) {
	key := sha256.Sum256([]byte("granete:idempotency-receipt:v1:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	seal := func(plain []byte) ([]byte, error) {
		nonce := make([]byte, gcm.NonceSize())
		if _, err := cryptorand.Read(nonce); err != nil {
			return nil, err
		}
		return append([]byte("gcm1:"), gcm.Seal(nonce, nonce, plain, nil)...), nil
	}
	open := func(sealed []byte) ([]byte, error) {
		if !bytes.HasPrefix(sealed, []byte("gcm1:")) {
			return nil, errors.New("sensitive idempotency receipt is not encrypted")
		}
		payload := sealed[5:]
		if len(payload) < gcm.NonceSize() {
			return nil, errors.New("invalid sensitive idempotency receipt")
		}
		return gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
	}
	return seal, open, nil
}

type durableIdempotencyStore interface {
	ExecuteIdempotent(context.Context, storage.IdempotencyRequest, func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error)
}

type captureWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *captureWriter) Header() http.Header { return w.header }
func (w *captureWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *captureWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(p)
}

func copyIdempotentResponse(w http.ResponseWriter, response storage.IdempotencyResponse) {
	for key, values := range response.Header {
		w.Header()[key] = append([]string(nil), values...)
	}
	w.WriteHeader(response.Status)
	_, _ = w.Write(response.Body)
}

func (s *Server) RequireIdempotency(operation string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if !validIdempotencyKey.MatchString(key) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Idempotency-Key inválido", nil)
			return
		}
		store, ok := s.Store.(durableIdempotencyStore)
		if !ok {
			respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError, "El almacenamiento durable de idempotencia no está disponible", nil)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
		if err != nil {
			respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest, "request body too large", nil)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		claims := claimsFromRequest(r)
		actorID, scopeActor, org := "", "anonymous", ""
		if claims != nil {
			actorID, scopeActor, org = claims.UserID, claims.UserID, claims.OrgID
		}
		canonicalBody := body
		var jsonValue any
		if len(body) > 0 && json.Unmarshal(body, &jsonValue) == nil {
			if normalized, marshalErr := json.Marshal(jsonValue); marshalErr == nil {
				canonicalBody = normalized
			}
		}
		fingerprintInput := []byte(r.Method + "\x00" + r.URL.Path + "\x00" + r.Header.Get("If-Match") + "\x00")
		hash := sha256.Sum256(append(fingerprintInput, canonicalBody...))
		scopeHash := sha256.Sum256([]byte(scopeActor + "\x00" + org + "\x00" + operation + "\x00" + key))
		request := storage.IdempotencyRequest{
			ScopeKey:       hex.EncodeToString(scopeHash[:]),
			Fingerprint:    hex.EncodeToString(hash[:]),
			ActorUserID:    actorID,
			OrganizationID: org,
		}
		if sensitiveIdempotencyOperations[operation] {
			seal, open, cipherErr := idempotencyReceiptCipher(s.JWTSecret)
			if cipherErr != nil {
				respondWithInternalError(w, cipherErr, "idempotency receipt cipher")
				return
			}
			request.SealBody, request.OpenBody = seal, open
		}
		if operation == "auth.accept-invitation" {
			if recorder, ok := s.Store.(interface {
				RecordInvitationAcceptanceFailure(context.Context, string, string, string) error
			}); ok {
				var payload struct {
					Token string `json:"token"`
				}
				if json.Unmarshal(body, &payload) == nil && payload.Token != "" {
					tokenHash := hashInvitationToken(payload.Token)
					request.AfterRollback = func(ctx context.Context, response storage.IdempotencyResponse) error {
						var apiErr openapi.ApiError
						reason := "rejected"
						if json.Unmarshal(response.Body, &apiErr) == nil && apiErr.Code != "" {
							reason = string(apiErr.Code)
						}
						return recorder.RecordInvitationAcceptanceFailure(ctx, tokenHash, reason, clientIP(r))
					}
				}
			}
		}
		response, replayed, err := store.ExecuteIdempotent(r.Context(), request, func(ctx context.Context) (storage.IdempotencyResponse, error) {
			if claims != nil {
				if setter, ok := s.Store.(tenantActorSetter); ok {
					var setErr error
					ctx, setErr = setter.SetTenantActor(ctx, storage.TenantActor{OrganizationID: claims.OrgID, UserID: claims.UserID})
					if setErr != nil {
						return storage.IdempotencyResponse{}, setErr
					}
				}
			}
			cw := &captureWriter{header: make(http.Header)}
			cw.header.Set(requestIDHeader, RequestIDFromContext(r.Context()))
			next.ServeHTTP(cw, r.WithContext(ctx))
			return storage.IdempotencyResponse{Status: cw.status, Header: cw.header.Clone(), Body: append([]byte(nil), cw.body.Bytes()...)}, nil
		})
		if errors.Is(err, storage.ErrIdempotencyConflict) {
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeIdempotencyConflict, "La clave de idempotencia ya fue usada con otro payload", nil)
			return
		}
		if err != nil {
			respondWithInternalError(w, err, "durable idempotency")
			return
		}
		// Stores may return a receipt shared with another concurrent replay.
		// Never mutate its header map while decorating this response.
		response.Header = response.Header.Clone()
		if replayed {
			response.Header.Set("Idempotency-Replayed", "true")
		}
		copyIdempotentResponse(w, response)
	})
}
