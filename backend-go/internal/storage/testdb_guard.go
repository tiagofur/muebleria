package storage

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

var (
	ErrTestDBGuardRejected = errors.New("test database guard rejected connection")
)

// Allowed test database prefixes and names.
// Any database written to or migrated in automated tests MUST match one of these
// AND must NOT be "muebles", production, or an arbitrary non-test database.
var allowedTestDBNames = map[string]bool{
	"postgres":             true, // CI service container & default maintenance DB
	"granete_gate":         true, // Gate A / Organization browser gate
	"muebles_multiorg_test": true, // Multi-org migration & RLS isolation tests
	"granete_test":         true, // Canonical ephemeral test runner DB
}

var allowedTestDBPrefixes = []string{
	"granete_test_",
	"granete_gate_",
	"muebles_multiorg_test_",
	"muebles_pilot_",
	"hwassets_api_e2e_",
}

// ValidateTestDatabaseURL inspects a connection string intended for automated tests
// and ensures it does NOT point to a persistent development or production database ("muebles").
// It enforces fail-closed behavior before any migration, table creation, or DML occurs.
func ValidateTestDatabaseURL(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return fmt.Errorf("%w: empty database URL", ErrTestDBGuardRejected)
	}

	// 1. Check production environment markers
	if strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_ENV"))) == "production" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) == "production" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("NODE_ENV"))) == "production" {
		return fmt.Errorf("%w: production environment detected", ErrTestDBGuardRejected)
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("%w: invalid database URL (%v)", ErrTestDBGuardRejected, err)
	}

	dbName := strings.TrimPrefix(u.Path, "/")
	if i := strings.IndexByte(dbName, '?'); i >= 0 {
		dbName = dbName[:i]
	}
	dbName = strings.TrimSpace(dbName)

	// 2. Reject "muebles" or empty db name immediately
	if dbName == "" {
		return fmt.Errorf("%w: missing database name in URL %q", ErrTestDBGuardRejected, rawURL)
	}
	if strings.EqualFold(dbName, "muebles") {
		return fmt.Errorf("%w: persistent development database %q is strictly forbidden for tests", ErrTestDBGuardRejected, dbName)
	}

	// 3. Reject anything containing "prod" in host or db name
	if strings.Contains(strings.ToLower(dbName), "prod") || strings.Contains(strings.ToLower(u.Host), "prod") {
		return fmt.Errorf("%w: production keyword detected in db or host %q", ErrTestDBGuardRejected, rawURL)
	}

	// 4. Validate against allowlist or explicit test database flag
	isAllowedName := allowedTestDBNames[dbName]
	if !isAllowedName {
		for _, prefix := range allowedTestDBPrefixes {
			if strings.HasPrefix(dbName, prefix) {
				isAllowedName = true
				break
			}
		}
	}

	// If GRANETE_TEST_DATABASE=1 is set, any non-"muebles" database with test prefix or created by test runner is permitted.
	hasTestFlag := os.Getenv("GRANETE_TEST_DATABASE") == "1" || os.Getenv("ORGANIZATION_TEST_ISOLATED") == "1"

	if !isAllowedName && !hasTestFlag {
		return fmt.Errorf("%w: database %q is not in the test database allowlist and GRANETE_TEST_DATABASE=1 is not set", ErrTestDBGuardRejected, dbName)
	}

	return nil
}
