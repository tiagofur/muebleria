// Command testdb-preflight validates the organization browser gate's database
// targets without opening a connection. The gate runs it before any process
// capable of migrating or writing business data.
package main

import (
	"fmt"
	"net/url"
	"os"
	"strconv"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func main() {
	if err := validateBrowserGateTargetPair(
		os.Getenv("DATABASE_URL"),
		os.Getenv("MIGRATION_DATABASE_URL"),
		os.Getenv("ORGANIZATION_GATE_POSTGRES_PORT"),
	); err != nil {
		fmt.Fprintf(os.Stderr, "organization browser database preflight rejected: %v\n", err)
		os.Exit(1)
	}
}

func validateBrowserGateTargetPair(runtimeURL, migrationURL, expectedPort string) error {
	if os.Getenv("ORGANIZATION_TEST_ISOLATED") != "1" || os.Getenv("GRANETE_TEST_DATABASE") != "1" {
		return fmt.Errorf("both organization and test database markers are required")
	}
	port, err := strconv.Atoi(expectedPort)
	if err != nil || port < 1 || port > 65535 || port == 5445 || strconv.Itoa(port) != expectedPort {
		return fmt.Errorf("disposable PostgreSQL host port is missing or invalid")
	}
	if err := storage.ValidateTestDatabaseURL(runtimeURL); err != nil {
		return fmt.Errorf("runtime target rejected: %w", err)
	}
	if err := storage.ValidateTestAdminDatabaseURL(migrationURL); err != nil {
		return fmt.Errorf("migration target rejected: %w", err)
	}
	for _, target := range []struct {
		name, raw, user string
	}{
		{name: "runtime", raw: runtimeURL, user: "granete_app"},
		{name: "migration", raw: migrationURL, user: "postgres"},
	} {
		u, err := url.Parse(target.raw)
		if err != nil || u.Hostname() != "127.0.0.1" || u.Port() != expectedPort || u.Path != "/granete_gate" {
			return fmt.Errorf("%s target must match the disposable loopback instance and granete_gate database", target.name)
		}
		if u.User == nil || u.User.Username() != target.user {
			return fmt.Errorf("%s target must use its dedicated database role", target.name)
		}
		if password, ok := u.User.Password(); !ok || password == "" {
			return fmt.Errorf("%s target requires an explicit password", target.name)
		}
	}
	return nil
}
