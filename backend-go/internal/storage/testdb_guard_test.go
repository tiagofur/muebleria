package storage_test

import (
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestValidateTestDatabaseURL_FailClosed(t *testing.T) {
	// Ensure env vars are clean for testing
	origGraneteEnv := os.Getenv("GRANETE_ENV")
	origTestFlag := os.Getenv("GRANETE_TEST_DATABASE")
	defer func() {
		os.Setenv("GRANETE_ENV", origGraneteEnv)
		os.Setenv("GRANETE_TEST_DATABASE", origTestFlag)
	}()

	os.Unsetenv("GRANETE_ENV")
	os.Unsetenv("GRANETE_TEST_DATABASE")

	// Negative proof 1: Rejects "muebles" regardless of flags
	mueblesDSNs := []string{
		"postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable",
		"postgres://postgres:postgres@127.0.0.1:5432/muebles",
		"postgres://user:pass@remote:5432/MUEBLES?sslmode=require",
	}
	for _, dsn := range mueblesDSNs {
		if err := storage.ValidateTestDatabaseURL(dsn); err == nil {
			t.Errorf("expected rejection for muebles DSN %q, got nil", dsn)
		}
	}

	// Negative proof 2: Rejects production env
	os.Setenv("GRANETE_ENV", "production")
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5432/postgres"); err == nil {
		t.Errorf("expected rejection when GRANETE_ENV=production, got nil")
	}
	os.Unsetenv("GRANETE_ENV")

	// Negative proof 3: Rejects unknown / non-test DB name when GRANETE_TEST_DATABASE is not set
	unknownDSN := "postgres://postgres:postgres@localhost:5432/my_custom_db"
	if err := storage.ValidateTestDatabaseURL(unknownDSN); err == nil {
		t.Errorf("expected rejection for unlisted db %q without GRANETE_TEST_DATABASE=1, got nil", unknownDSN)
	}

	// Positive proof 1: Accepts allowlisted names
	allowedDSNs := []string{
		"postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable",
		"postgres://postgres:postgres@localhost:5432/granete_gate",
		"postgres://postgres:postgres@localhost:5445/muebles_multiorg_test",
		"postgres://postgres:postgres@localhost:5432/granete_test",
		"postgres://postgres:postgres@localhost:5432/granete_test_1234",
		"postgres://postgres:postgres@localhost:5432/muebles_pilot_run_1",
		"postgres://postgres:postgres@localhost:5432/hwassets_api_e2e_999",
	}
	for _, dsn := range allowedDSNs {
		if err := storage.ValidateTestDatabaseURL(dsn); err != nil {
			t.Errorf("expected DSN %q to be allowed, got err: %v", dsn, err)
		}
	}

	// Positive proof 2: Accepts custom test DB when GRANETE_TEST_DATABASE=1 is set (and not muebles)
	os.Setenv("GRANETE_TEST_DATABASE", "1")
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5432/ephemeral_custom_test"); err != nil {
		t.Errorf("expected ephemeral db to be allowed with GRANETE_TEST_DATABASE=1, got: %v", err)
	}

	// Even with GRANETE_TEST_DATABASE=1, "muebles" MUST STILL BE REJECTED
	if err := storage.ValidateTestDatabaseURL("postgres://postgres:postgres@localhost:5445/muebles"); err == nil {
		t.Errorf("muebles must NEVER be allowed even with GRANETE_TEST_DATABASE=1")
	}
}
