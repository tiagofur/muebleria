package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

const IdempotencyRetention = 24 * time.Hour

var validIdempotencyKey = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`)

type idempotencyReceipt struct {
	fingerprint string
	expiresAt   time.Time
	done        chan struct{}
	status      int
	header      http.Header
	body        []byte
}

type IdempotencyStore struct {
	mu       sync.Mutex
	receipts map[string]*idempotencyReceipt
	now      func() time.Time
}

func NewIdempotencyStore() *IdempotencyStore {
	return &IdempotencyStore{receipts: map[string]*idempotencyReceipt{}, now: time.Now}
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

func copyResponse(w http.ResponseWriter, status int, header http.Header, body []byte) {
	for key, values := range header {
		w.Header()[key] = append([]string(nil), values...)
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (s *Server) RequireIdempotency(operation string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if !validIdempotencyKey.MatchString(key) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Idempotency-Key inválido", nil)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
		if err != nil {
			respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest, "request body too large", nil)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		claims := claimsFromRequest(r)
		actor, org := "anonymous", ""
		if claims != nil {
			actor, org = claims.UserID, claims.OrgID
		}
		canonicalBody := body
		var jsonValue any
		if len(body) > 0 && json.Unmarshal(body, &jsonValue) == nil {
			if normalized, marshalErr := json.Marshal(jsonValue); marshalErr == nil {
				canonicalBody = normalized
			}
		}
		h := sha256.Sum256(append([]byte(r.Method+"\x00"+r.URL.Path+"\x00"), canonicalBody...))
		fingerprint := hex.EncodeToString(h[:])
		scope := actor + "\x00" + org + "\x00" + operation + "\x00" + key

		for {
			s.idempotency.mu.Lock()
			now := s.idempotency.now()
			for k, receipt := range s.idempotency.receipts {
				if !receipt.expiresAt.After(now) {
					delete(s.idempotency.receipts, k)
				}
			}
			receipt, exists := s.idempotency.receipts[scope]
			if exists {
				if receipt.fingerprint != fingerprint {
					s.idempotency.mu.Unlock()
					respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeIdempotencyConflict, "La clave de idempotencia ya fue usada con otro payload", nil)
					return
				}
				done := receipt.done
				s.idempotency.mu.Unlock()
				<-done
				w.Header().Set("Idempotency-Replayed", "true")
				copyResponse(w, receipt.status, receipt.header, receipt.body)
				return
			}
			receipt = &idempotencyReceipt{fingerprint: fingerprint, expiresAt: now.Add(IdempotencyRetention), done: make(chan struct{})}
			s.idempotency.receipts[scope] = receipt
			s.idempotency.mu.Unlock()
			cw := &captureWriter{header: make(http.Header)}
			cw.header.Set(requestIDHeader, RequestIDFromContext(r.Context()))
			next.ServeHTTP(cw, r)
			receipt.status = cw.status
			receipt.header = cw.header.Clone()
			receipt.body = append([]byte(nil), cw.body.Bytes()...)
			close(receipt.done)
			copyResponse(w, receipt.status, receipt.header, receipt.body)
			return
		}
	})
}
