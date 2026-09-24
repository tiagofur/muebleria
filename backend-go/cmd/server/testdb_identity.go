package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

var browserGateMarkerPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func validateBrowserGateServerTargets(runtimeURL, migrationURL string) error {
	if os.Getenv("ORGANIZATION_TEST_ISOLATED") != "1" || os.Getenv("GRANETE_TEST_DATABASE") != "1" ||
		storage.ValidateTestDatabaseURL(runtimeURL) != nil ||
		storage.ValidateTestAdminDatabaseURL(migrationURL) != nil {
		return fmt.Errorf("disposable browser database targets are required")
	}
	if os.Getenv("PGOPTIONS") != "" {
		return fmt.Errorf("ambient PostgreSQL session options are not permitted")
	}
	for _, raw := range []string{runtimeURL, migrationURL} {
		parsed, err := url.Parse(raw)
		if err != nil {
			return fmt.Errorf("database URL session options are not permitted")
		}
		for key := range parsed.Query() {
			if strings.EqualFold(key, "options") {
				return fmt.Errorf("database URL session options are not permitted")
			}
		}
	}
	return nil
}

// browserGateDatabaseIdentityHandler augments the existing health response only
// in the disposable browser gate. It never serves a production diagnostic route.
func browserGateDatabaseIdentityHandler(
	next http.Handler,
	read func(context.Context) (database, role, marker string, err error),
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/health" ||
			r.Header.Get("X-Granete-Test-Database-Probe") != "1" {
			next.ServeHTTP(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		database, role, marker, err := read(ctx)
		if err != nil || database != "granete_gate" || role != "granete_app" ||
			!browserGateMarkerPattern.MatchString(marker) {
			http.Error(w, "test database identity unavailable", http.StatusServiceUnavailable)
			return
		}
		digest := sha256.Sum256([]byte(marker))
		w.Header().Set("X-Granete-Test-Database", database)
		w.Header().Set("X-Granete-Test-Role", role)
		w.Header().Set("X-Granete-Test-Identity", hex.EncodeToString(digest[:]))
		next.ServeHTTP(w, r)
	})
}
