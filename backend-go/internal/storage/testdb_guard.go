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

// Allowed test database names and prefixes.
// A writable test/business connection MUST match one of these AND have an explicit test environment marker.
// NOTE: "postgres" is NOT an allowed writable test/business database. It is only permitted for admin/maintenance connections via ValidateTestAdminDatabaseURL.
var allowedWritableTestDBNames = map[string]bool{
	"granete_gate":         true, // Gate A / Organization browser gate
	"muebles_multiorg_test": true, // Multi-org migration & RLS isolation tests
	"granete_test":         true, // Canonical ephemeral test runner DB
	"muebles_pilot_readiness": true, // Pilot readiness integration test DB
}

var allowedWritableTestDBPrefixes = []string{
	"granete_test_",
	"granete_gate_",
	"muebles_multiorg_test_",
	"muebles_pilot_",
	"hwassets_api_e2e_",
}

// SanitizeDatabaseURL redacts credentials and sensitive query params from a database URL.
// It returns safe descriptors like "host=... db=..." without username, password, or tokens.
func SanitizeDatabaseURL(rawURL string) string {
	if strings.TrimSpace(rawURL) == "" {
		return "empty"
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "invalid-url"
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if i := strings.IndexByte(dbName, '?'); i >= 0 {
		dbName = dbName[:i]
	}
	host := u.Host
	if host == "" {
		host = "unknown-host"
	}
	return fmt.Sprintf("host=%s db=%s", host, dbName)
}

func parseAndValidateCommon(rawURL string) (*url.URL, string, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, "", fmt.Errorf("%w: empty database URL", ErrTestDBGuardRejected)
	}

	// 1. Check production environment markers
	if strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_ENV"))) == "production" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) == "production" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("NODE_ENV"))) == "production" {
		return nil, "", fmt.Errorf("%w: production environment detected (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, "", fmt.Errorf("%w: invalid database URL (%v)", ErrTestDBGuardRejected, err)
	}

	dbName := strings.TrimPrefix(u.Path, "/")
	if i := strings.IndexByte(dbName, '?'); i >= 0 {
		dbName = dbName[:i]
	}
	dbName = strings.TrimSpace(dbName)

	if dbName == "" {
		return nil, "", fmt.Errorf("%w: missing database name (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	// 2. Reject "muebles" or anything containing "prod"
	if strings.EqualFold(dbName, "muebles") {
		return nil, "", fmt.Errorf("%w: persistent development database %q is strictly forbidden for tests (%s)", ErrTestDBGuardRejected, dbName, SanitizeDatabaseURL(rawURL))
	}

	if strings.Contains(strings.ToLower(dbName), "prod") || strings.Contains(strings.ToLower(u.Host), "prod") {
		return nil, "", fmt.Errorf("%w: production keyword detected (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	return u, dbName, nil
}

// IsAllowedTestDBName checks if dbName matches the strict test database allowlist or prefixes.
func IsAllowedTestDBName(dbName string) bool {
	if allowedWritableTestDBNames[dbName] {
		return true
	}
	for _, prefix := range allowedWritableTestDBPrefixes {
		if strings.HasPrefix(dbName, prefix) {
			return true
		}
	}
	return false
}

// ValidateTestDatabaseURL inspects a connection string intended for automated tests
// and ensures it connects to an allowed ephemeral test database.
// Contract: MUST satisfy BOTH:
//  1. Explicit test environment marker (GRANETE_TEST_DATABASE=1 or ORGANIZATION_TEST_ISOLATED=1).
//  2. Distinct, unequivocal allowed test database name (e.g., granete_test_*, muebles_multiorg_test_*).
//
// Connecting to "/postgres" or persistent "/muebles" as a writable test database is strictly REJECTED.
func ValidateTestDatabaseURL(rawURL string) error {
	_, dbName, err := parseAndValidateCommon(rawURL)
	if err != nil {
		return err
	}

	// Reject /postgres for writable test/business connection
	if strings.EqualFold(dbName, "postgres") {
		return fmt.Errorf("%w: /postgres cannot be used as a writable test database; use ValidateTestAdminDatabaseURL for maintenance operations only (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	// BOTH conditions required:
	// 1. Explicit test environment flag
	hasTestFlag := os.Getenv("GRANETE_TEST_DATABASE") == "1" || os.Getenv("ORGANIZATION_TEST_ISOLATED") == "1"
	if !hasTestFlag {
		return fmt.Errorf("%w: test environment flag (GRANETE_TEST_DATABASE=1 or ORGANIZATION_TEST_ISOLATED=1) is required (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	// 2. Distinct test database name
	if !IsAllowedTestDBName(dbName) {
		return fmt.Errorf("%w: database %q is not an allowed test database name (%s)", ErrTestDBGuardRejected, dbName, SanitizeDatabaseURL(rawURL))
	}

	return nil
}

// ValidateTestAdminDatabaseURL inspects a maintenance/admin connection string
// used strictly for fixture setup/teardown (e.g., CREATE DATABASE, DROP DATABASE).
// It permits connecting to "/postgres" or an allowed test database ONLY when GRANETE_TEST_DATABASE=1
// or ORGANIZATION_TEST_ISOLATED=1 is set, and strictly rejects production or "muebles".
func ValidateTestAdminDatabaseURL(rawURL string) error {
	_, dbName, err := parseAndValidateCommon(rawURL)
	if err != nil {
		return err
	}

	hasTestFlag := os.Getenv("GRANETE_TEST_DATABASE") == "1" || os.Getenv("ORGANIZATION_TEST_ISOLATED") == "1"
	if !hasTestFlag {
		return fmt.Errorf("%w: test environment flag is required for test admin connection (%s)", ErrTestDBGuardRejected, SanitizeDatabaseURL(rawURL))
	}

	// Permitted admin target databases: /postgres or an allowed test DB name
	if !strings.EqualFold(dbName, "postgres") && !IsAllowedTestDBName(dbName) {
		return fmt.Errorf("%w: admin connection to %q is not allowed (%s)", ErrTestDBGuardRejected, dbName, SanitizeDatabaseURL(rawURL))
	}

	return nil
}

