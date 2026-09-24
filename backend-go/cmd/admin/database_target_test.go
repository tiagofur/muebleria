package main

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestOpenStoreRejectsUnsafeConfigurationBeforeConnecting(t *testing.T) {
	const secret = "do-not-print-this-password"
	cases := []struct {
		name       string
		adminURL   string
		runtimeURL string
		testMode   string
	}{
		{name: "missing migration URL"},
		{name: "empty migration URL", adminURL: ""},
		{name: "whitespace migration URL", adminURL: "  "},
		{name: "runtime URL is not an admin URL", runtimeURL: "postgres://user:password@127.0.0.1:65432/runtime"},
		{name: "malformed URL", adminURL: "postgres://admin:" + secret + "@127.0.0.1:invalid/db"},
		{name: "incomplete URL", adminURL: "postgres://admin:" + secret + "@127.0.0.1:65432/"},
		{name: "unsupported scheme", adminURL: "https://admin:" + secret + "@127.0.0.1:65432/db"},
		{name: "missing host", adminURL: "postgres:///db"},
		{name: "test preparation rejects persistent database", adminURL: "postgres://admin:" + secret + "@127.0.0.1:65432/muebles", testMode: "1"},
		{name: "query cannot override test database", adminURL: "postgres://admin:" + secret + "@127.0.0.1:65432/granete_test?dbname=muebles", testMode: "1"},
		{name: "query cannot override explicit host", adminURL: "postgres://admin:" + secret + "@127.0.0.1:65432/manual_db?host=another-host"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MIGRATION_DATABASE_URL", tc.adminURL)
			t.Setenv("DATABASE_URL", tc.runtimeURL)
			t.Setenv("GRANETE_TEST_DATABASE", tc.testMode)
			calls := 0
			store, closeStore, err := openStore(func(string) (*storage.PostgresStore, error) {
				calls++
				return &storage.PostgresStore{}, nil
			})
			if err == nil || store != nil || closeStore != nil || calls != 0 {
				t.Fatalf("expected rejection before connector; store=%v close=%v calls=%d err=%v", store != nil, closeStore != nil, calls, err)
			}
			if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), tc.runtimeURL) && tc.runtimeURL != "" {
				t.Fatalf("error disclosed a database URL or password: %v", err)
			}
		})
	}
}

func TestOpenStoreUsesExplicitAdminURLWithoutTestRestriction(t *testing.T) {
	const adminURL = "postgres://admin:secret@127.0.0.1:65432/manual_db?sslmode=disable"
	t.Setenv("MIGRATION_DATABASE_URL", adminURL)
	t.Setenv("DATABASE_URL", "postgres://runtime:secret@127.0.0.1:65433/other_db")
	t.Setenv("GRANETE_TEST_DATABASE", "")
	calls := 0
	store, closeStore, err := openStore(func(got string) (*storage.PostgresStore, error) {
		calls++
		if got != adminURL {
			t.Errorf("connector received wrong admin URL")
		}
		return &storage.PostgresStore{}, nil
	})
	if err != nil || store == nil || closeStore == nil || calls != 1 {
		t.Fatalf("expected one explicit connection; store=%v close=%v calls=%d err=%v", store != nil, closeStore != nil, calls, err)
	}
	closeStore()
}

func TestOpenStoreAllowsExplicitIsolatedTestAdminURL(t *testing.T) {
	const adminURL = "postgres://admin:secret@127.0.0.1:65432/granete_test?sslmode=disable"
	t.Setenv("MIGRATION_DATABASE_URL", adminURL)
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	calls := 0
	store, closeStore, err := openStore(func(got string) (*storage.PostgresStore, error) {
		calls++
		if got != adminURL {
			t.Errorf("connector received wrong isolated URL")
		}
		return &storage.PostgresStore{}, nil
	})
	if err != nil || store == nil || closeStore == nil || calls != 1 {
		t.Fatalf("expected one isolated connection; store=%v close=%v calls=%d err=%v", store != nil, closeStore != nil, calls, err)
	}
	closeStore()
}

func TestOpenStoreRedactsConnectorError(t *testing.T) {
	const secret = "do-not-print-this-password"
	t.Setenv("MIGRATION_DATABASE_URL", "postgres://admin:"+secret+"@127.0.0.1:65432/manual_db")
	t.Setenv("GRANETE_TEST_DATABASE", "")
	store, closeStore, err := openStore(func(raw string) (*storage.PostgresStore, error) {
		return nil, errors.New("connection failed: " + raw)
	})
	if err == nil || store != nil || closeStore != nil {
		t.Fatalf("expected connection failure; store=%v close=%v err=%v", store != nil, closeStore != nil, err)
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "postgres://") {
		t.Fatalf("connector error disclosed credentials: %v", err)
	}
}

func TestUsageNamesRequiredMigrationURL(t *testing.T) {
	oldStderr := os.Stderr
	file, err := os.CreateTemp(t.TempDir(), "usage-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = file
	t.Cleanup(func() { os.Stderr = oldStderr })
	usage()
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	output, err := os.ReadFile(file.Name())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), "MIGRATION_DATABASE_URL") || strings.Contains(string(output), "DATABASE_URL    Postgres DSN (defaults") {
		t.Fatalf("admin usage does not state the required explicit target")
	}
}

func TestOpenStoreAgainstDisposablePostgres(t *testing.T) {
	if testing.Short() || os.Getenv("ADMIN_CLI_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("requires an explicitly prepared disposable PostgreSQL container")
	}
	if os.Getenv("GRANETE_TEST_DATABASE") != "1" {
		t.Fatal("disposable PostgreSQL check requires the test database marker")
	}
	raw := os.Getenv("MIGRATION_DATABASE_URL")
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() != "127.0.0.1" || !strings.HasPrefix(u.Path, "/granete_test_admin_") || u.User == nil {
		t.Fatal("disposable PostgreSQL check requires an explicit loopback test target")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || port == 5445 {
		t.Fatal("disposable PostgreSQL check requires a non-habitual explicit host port")
	}
	if err := storage.ValidateTestAdminDatabaseURL(raw); err != nil {
		t.Fatal("disposable PostgreSQL target rejected by test guard")
	}

	store, closeStore, err := openStore()
	if err != nil {
		t.Fatalf("admin store did not connect to the verified disposable target: %v", err)
	}
	defer closeStore()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var database, user string
	var serverPort int
	if err := store.Pool.QueryRow(ctx, "SELECT current_database(), current_user, inet_server_port()").Scan(&database, &user, &serverPort); err != nil {
		t.Fatal("could not read back the disposable PostgreSQL destination")
	}
	if database != strings.TrimPrefix(u.Path, "/") || user != u.User.Username() || serverPort != 5432 {
		t.Fatalf("connected to an unexpected PostgreSQL destination: database=%q user=%q server_port=%d", database, user, serverPort)
	}
	t.Logf("verified disposable PostgreSQL destination: database=%q user=%q server_port=%d", database, user, serverPort)
}
