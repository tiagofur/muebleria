package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

var strongVersionETag = regexp.MustCompile(`^"v([1-9][0-9]*)"$`)

func FormatVersionETag(version int64) string { return fmt.Sprintf(`"v%d"`, version) }

func ParseVersionETag(value string) (int64, error) {
	m := strongVersionETag.FindStringSubmatch(value)
	if m == nil {
		return 0, fmt.Errorf("invalid strong version ETag")
	}
	return strconv.ParseInt(m[1], 10, 64)
}

func RequireIfMatch(w http.ResponseWriter, r *http.Request) (int64, bool) {
	value := r.Header.Get("If-Match")
	if value == "" {
		respondWithAPIError(w, http.StatusPreconditionRequired, openapi.ApiErrorCodePreconditionRequired, "If-Match es obligatorio", nil)
		return 0, false
	}
	version, err := ParseVersionETag(value)
	if err != nil {
		// A malformed token is a client bug or a corrupted cache; log the
		// exact value so the offending writer is diagnosable from the log
		// alone (#875 slice 4 gate: a 400 with no attributable origin).
		slog.Warn("if-match rejected",
			"op", "require if-match",
			"value", value,
			"path", r.URL.Path,
			"request_id", RequestIDFromContext(r.Context()))
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "If-Match inválido", nil)
		return 0, false
	}
	return version, true
}
