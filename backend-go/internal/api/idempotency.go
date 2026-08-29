package api

import (
	"bytes"
	"context"
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
		response, replayed, err := store.ExecuteIdempotent(r.Context(), request, func(ctx context.Context) (storage.IdempotencyResponse, error) {
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
		if replayed {
			response.Header.Set("Idempotency-Replayed", "true")
		}
		copyIdempotentResponse(w, response)
	})
}
