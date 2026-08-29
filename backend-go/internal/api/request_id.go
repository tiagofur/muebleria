package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
)

const requestIDHeader = "X-Request-ID"

type requestIDContextKey struct{}
type requestIDWriter struct {
	http.ResponseWriter
	requestID string
}

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)

func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b[:])
}

func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDContextKey{}).(string)
	return id
}

func requestIDFromWriter(w http.ResponseWriter) string {
	if rw, ok := w.(*requestIDWriter); ok {
		return rw.requestID
	}
	return w.Header().Get(requestIDHeader)
}

func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if !validRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set(requestIDHeader, id)
		ctx := context.WithValue(r.Context(), requestIDContextKey{}, id)
		next.ServeHTTP(&requestIDWriter{ResponseWriter: w, requestID: id}, r.WithContext(ctx))
	})
}
