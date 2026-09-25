package storage_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestValidateTestDatabaseURL_FailClosed(t *testing.T) {
	// Ensure env vars are clean for testing
	origGraneteEnv := os.Getenv("GRANETE_ENV")
	origTestFlag := os.Getenv("GRANETE_TEST_DATABASE")
	origOrgFlag := os.Getenv("ORGANIZATION_TEST_ISOLATED")
	defer func() {
		os.Setenv("GRANETE_ENV", origGraneteEnv)
		os.Setenv("GRANETE_TEST_DATABASE", origTestFlag)
		os.Setenv("ORGANIZATION_TEST_ISOLATED", origOrgFlag)
	}()

	os.Unsetenv("GRANETE_ENV")
	os.Unsetenv("GRANETE_TEST_DATABASE")
	os.Unsetenv("ORGANIZATION_TEST_ISOLATED")

	// Negative proof 1: Rejects "muebles" regardless of flags (upper, lower, mixed)
	mueblesDSNs := []string{
		"postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable",
		"postgres://postgres:postgres@127.0.0.1:5432/muebles",
		"postgres://user:pass@remote:5432/MUEBLES?sslmode=require",
		"postgres://user:pass@remote:5432/Muebles",
	}
	for _, dsn := range mueblesDSNs {
		if err := storage.ValidateTestDatabaseURL(dsn); err == nil {
			t.Errorf("expected rejection for muebles DSN %q, got nil", dsn)
		}
	}

	// Negative proof 2: Rejects production env
	os.Setenv("GRANETE_ENV", "production")
	os.Setenv("GRANETE_TEST_DATABASE", "1")
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5432/granete_test"); err == nil {
		t.Errorf("expected rejection when GRANETE_ENV=production, got nil")
	}
	os.Unsetenv("GRANETE_ENV")

	// Negative proof 3: Without test flag (GRANETE_TEST_DATABASE=1 or ORGANIZATION_TEST_ISOLATED=1), REJECT everything
	os.Unsetenv("GRANETE_TEST_DATABASE")
	os.Unsetenv("ORGANIZATION_TEST_ISOLATED")
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5432/granete_test"); err == nil {
		t.Errorf("expected rejection for granete_test without test flag, got nil")
	}

	// Negative proof 4: Even with flag=1, arbitrary or non-test databases MUST BE REJECTED
	os.Setenv("GRANETE_TEST_DATABASE", "1")
	arbitraryDSNs := []string{
		"postgres://postgres:secret@localhost:5432/granete_dev",
		"postgres://postgres:secret@localhost:5432/cliente_demo",
		"postgres://postgres:secret@localhost:5432/staging",
		"postgres://postgres:secret@localhost:5432/arbitrary_db",
		"postgres://postgres:secret@localhost:5432/custom_database",
	}
	for _, dsn := range arbitraryDSNs {
		if err := storage.ValidateTestDatabaseURL(dsn); err == nil {
			t.Errorf("expected rejection for arbitrary db %q with flag=1, got nil", dsn)
		}
	}

	// Negative proof 5: /postgres is strictly REJECTED as a writable test database
	postgresDSN := "postgres://postgres:secret@localhost:5432/postgres?sslmode=disable"
	if err := storage.ValidateTestDatabaseURL(postgresDSN); err == nil {
		t.Errorf("expected rejection for /postgres in ValidateTestDatabaseURL, got nil")
	}

	// Positive proof 1: Accepts valid test database names when flag=1
	allowedDSNs := []string{
		"postgres://postgres:postgres@localhost:5432/granete_gate",
		"postgres://postgres:postgres@localhost:5445/muebles_multiorg_test",
		"postgres://postgres:postgres@localhost:5432/granete_test",
		"postgres://postgres:postgres@localhost:5432/muebles_pilot_readiness",
		"postgres://postgres:postgres@localhost:5432/granete_test_1234",
		"postgres://postgres:postgres@localhost:5432/granete_gate_456",
		"postgres://postgres:postgres@localhost:5432/muebles_multiorg_test_789",
		"postgres://postgres:postgres@localhost:5432/muebles_pilot_run_1",
		"postgres://postgres:postgres@localhost:5432/hwassets_api_e2e_999",
	}
	for _, dsn := range allowedDSNs {
		if err := storage.ValidateTestDatabaseURL(dsn); err != nil {
			t.Errorf("expected DSN %q to be allowed, got err: %v", dsn, err)
		}
	}

	// Positive proof 2: ORGANIZATION_TEST_ISOLATED=1 also satisfies test flag
	os.Unsetenv("GRANETE_TEST_DATABASE")
	os.Setenv("ORGANIZATION_TEST_ISOLATED", "1")
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5432/granete_gate"); err != nil {
		t.Errorf("expected granete_gate to be allowed with ORGANIZATION_TEST_ISOLATED=1, got: %v", err)
	}
	os.Unsetenv("ORGANIZATION_TEST_ISOLATED")
}

func TestValidateTestAdminDatabaseURL(t *testing.T) {
	origTestFlag := os.Getenv("GRANETE_TEST_DATABASE")
	defer os.Setenv("GRANETE_TEST_DATABASE", origTestFlag)

	// Admin validator requires test flag
	os.Unsetenv("GRANETE_TEST_DATABASE")
	if err := storage.ValidateTestAdminDatabaseURL("postgres://postgres:postgres@localhost:5432/postgres"); err == nil {
		t.Errorf("expected rejection for admin connection without test flag")
	}

	os.Setenv("GRANETE_TEST_DATABASE", "1")

	// /postgres IS allowed for admin maintenance connection
	if err := storage.ValidateTestAdminDatabaseURL("postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"); err != nil {
		t.Errorf("expected /postgres to be allowed for ValidateTestAdminDatabaseURL, got %v", err)
	}

	// Allowed test database names are also allowed for admin connection
	if err := storage.ValidateTestAdminDatabaseURL("postgres://postgres:postgres@localhost:5432/granete_test"); err != nil {
		t.Errorf("expected granete_test to be allowed for ValidateTestAdminDatabaseURL, got %v", err)
	}

	// /muebles is strictly forbidden even for admin validator
	if err := storage.ValidateTestAdminDatabaseURL("postgres://postgres:postgres@localhost:5445/muebles"); err == nil {
		t.Errorf("expected /muebles to be rejected by ValidateTestAdminDatabaseURL")
	}

	// Arbitrary non-test DB is rejected by admin validator
	if err := storage.ValidateTestAdminDatabaseURL("postgres://postgres:postgres@localhost:5432/granete_dev"); err == nil {
		t.Errorf("expected granete_dev to be rejected by ValidateTestAdminDatabaseURL")
	}
}

func TestTestDBValidatorsRejectAmbiguousTargets(t *testing.T) {
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	t.Setenv("ORGANIZATION_TEST_ISOLATED", "")
	t.Setenv("GRANETE_ENV", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("NODE_ENV", "")
	const secret = "synthetic-password-not-for-logs"
	cases := []struct {
		name string
		url  string
	}{
		{"database override", "postgres://admin:" + secret + "@127.0.0.1:65432/granete_test?dbname=muebles"},
		{"host override", "postgres://admin:" + secret + "@127.0.0.1:65432/granete_test?host=another-host"},
		{"port override", "postgres://admin:" + secret + "@127.0.0.1:65432/granete_test?port=5445"},
		{"service override", "postgres://admin:" + secret + "@127.0.0.1:65432/granete_test?service=other-target"},
		{"missing explicit host", "postgres:///granete_test"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, validator := range []struct {
				name string
				fn   func(string) error
			}{
				{"writable", storage.ValidateTestDatabaseURL},
				{"admin", storage.ValidateTestAdminDatabaseURL},
			} {
				err := validator.fn(tc.url)
				if err == nil {
					t.Errorf("%s validator accepted ambiguous target", validator.name)
					continue
				}
				if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "postgres://") {
					t.Errorf("%s validator leaked credentials", validator.name)
				}
			}
		})
	}
}

func TestGuardDoesNotLeakPassword(t *testing.T) {
	origTestFlag := os.Getenv("GRANETE_TEST_DATABASE")
	defer os.Setenv("GRANETE_TEST_DATABASE", origTestFlag)

	os.Setenv("GRANETE_TEST_DATABASE", "1")
	secretPassword := "super-secret-password-xyz123"

	rejectedDSNs := []string{
		"postgres://admin:" + secretPassword + "@localhost:5445/muebles?sslmode=disable",
		"postgres://admin:" + secretPassword + "@localhost:5432/granete_dev",
		"postgres://admin:" + secretPassword + "@localhost:5432/postgres",
		"postgres://admin:" + secretPassword + "@localhost:5432/granete_test%zz",
		"postgres://admin:" + secretPassword + "@[::1]:namedport/granete_test",
	}

	for _, dsn := range rejectedDSNs {
		err := storage.ValidateTestDatabaseURL(dsn)
		if err == nil {
			t.Fatalf("expected error for DSN %s", dsn)
		}
		if strings.Contains(err.Error(), secretPassword) {
			t.Errorf("ValidateTestDatabaseURL leaked password for DSN %q: %q contains %q", dsn, err.Error(), secretPassword)
		}
		if strings.Contains(err.Error(), "admin:") {
			t.Errorf("ValidateTestDatabaseURL leaked userinfo for DSN %q: %q", dsn, err.Error())
		}

		if !strings.HasSuffix(dsn, "/postgres") {
			adminErr := storage.ValidateTestAdminDatabaseURL(dsn)
			if adminErr == nil {
				t.Fatalf("expected error for admin DSN %s", dsn)
			}
			if strings.Contains(adminErr.Error(), secretPassword) {
				t.Errorf("ValidateTestAdminDatabaseURL leaked password for DSN %q: %q contains %q", dsn, adminErr.Error(), secretPassword)
			}
			if strings.Contains(adminErr.Error(), "admin:") {
				t.Errorf("ValidateTestAdminDatabaseURL leaked userinfo for DSN %q: %q", dsn, adminErr.Error())
			}
		}
	}
}

func TestTestDatabaseURL_Helper(t *testing.T) {
	origFlag := os.Getenv("GRANETE_TEST_DATABASE")
	origURL := os.Getenv("DATABASE_URL")
	origMigrationURL := os.Getenv("MIGRATION_DATABASE_URL")
	defer func() {
		os.Setenv("GRANETE_TEST_DATABASE", origFlag)
		os.Setenv("DATABASE_URL", origURL)
		os.Setenv("MIGRATION_DATABASE_URL", origMigrationURL)
	}()

	os.Setenv("GRANETE_TEST_DATABASE", "1")
	os.Setenv("DATABASE_URL", "postgres://granete_app:runtime@localhost:5432/granete_test")
	os.Setenv("MIGRATION_DATABASE_URL", "postgres://postgres:postgres@localhost:5432/granete_test")

	url := storage.TestDatabaseURL(t)
	if url != "postgres://granete_app:runtime@localhost:5432/granete_test" {
		t.Fatalf("unexpected url: %s", url)
	}

	adminURL := storage.TestAdminDatabaseURL(t)
	if !strings.HasSuffix(adminURL, "/postgres") {
		t.Fatalf("unexpected admin url: %s", adminURL)
	}
}

type guardFatal struct{ message string }

func (e guardFatal) Error() string { return e.message }

type guardT struct{}

func (guardT) Helper()          {}
func (guardT) Skip(args ...any) { panic(guardFatal{message: "skip"}) }
func (guardT) Fatalf(format string, args ...any) {
	panic(guardFatal{message: fmt.Sprintf(format, args...)})
}

func testAdminURLFailure(t *testing.T, want string, action func()) {
	t.Helper()
	defer func() {
		recovered := recover()
		failure, ok := recovered.(guardFatal)
		if !ok {
			t.Fatalf("TestAdminDatabaseURL did not fail closed: %#v", recovered)
		}
		if !strings.Contains(failure.message, want) {
			t.Fatalf("unexpected failure %q; want %q", failure.message, want)
		}
	}()
	action()
}

func TestTestAdminDatabaseURL_UsesOnlyMigrationAuthority(t *testing.T) {
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	t.Setenv("DATABASE_URL", "postgres://granete_app:runtime-secret@localhost:5432/granete_test")
	t.Setenv("MIGRATION_DATABASE_URL", "")
	testAdminURLFailure(t, "skip", func() { storage.TestAdminDatabaseURL(guardT{}) })

	t.Setenv("MIGRATION_DATABASE_URL", "postgres://postgres:admin-secret@localhost:5432/muebles")
	testAdminURLFailure(t, "rejected unsafe database", func() { storage.TestAdminDatabaseURL(guardT{}) })
}

func TestTestMigrationDatabaseURL_UsesOnlyMigrationAuthority(t *testing.T) {
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	t.Setenv("DATABASE_URL", "postgres://granete_app:runtime-secret@localhost:5432/granete_test")
	t.Setenv("MIGRATION_DATABASE_URL", "")
	testAdminURLFailure(t, "skip", func() { storage.TestMigrationDatabaseURL(guardT{}, "granete_test_migration") })

	t.Setenv("MIGRATION_DATABASE_URL", "postgres://postgres:admin-secret@localhost:5432/postgres")
	migrationURL := storage.TestMigrationDatabaseURL(t, "granete_test_migration")
	if !strings.Contains(migrationURL, "postgres://postgres:admin-secret@localhost:5432/granete_test_migration") {
		t.Fatalf("unexpected migration URL: %s", migrationURL)
	}

	testAdminURLFailure(t, "rejected unsafe database", func() { storage.TestMigrationDatabaseURL(guardT{}, "muebles") })
}
