package main

import (
	"strings"
	"testing"
)

func TestBrowserGateTargetPairRejectsUnsafePreparation(t *testing.T) {
	const secret = "do-not-print-this-password"
	const runtimeURL = "postgres://granete_app:" + secret + "@127.0.0.1:56321/granete_gate?sslmode=disable"
	const migrationURL = "postgres://postgres:" + secret + "@127.0.0.1:56321/granete_gate?sslmode=disable"
	cases := []struct {
		name, runtime, migration, isolated, testDB, port string
	}{
		{name: "organization marker absent", runtime: runtimeURL, migration: migrationURL, testDB: "1", port: "56321"},
		{name: "database marker absent", runtime: runtimeURL, migration: migrationURL, isolated: "1", port: "56321"},
		{name: "runtime URL absent", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "migration URL absent", runtime: runtimeURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "runtime persistent", runtime: "postgres://granete_app:" + secret + "@127.0.0.1:56321/muebles", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "admin persistent", runtime: runtimeURL, migration: "postgres://postgres:" + secret + "@127.0.0.1:56321/muebles", isolated: "1", testDB: "1", port: "56321"},
		{name: "different instance", runtime: runtimeURL, migration: "postgres://postgres:" + secret + "@127.0.0.1:56322/granete_gate", isolated: "1", testDB: "1", port: "56321"},
		{name: "different database", runtime: runtimeURL, migration: "postgres://postgres:" + secret + "@127.0.0.1:56321/granete_test_other", isolated: "1", testDB: "1", port: "56321"},
		{name: "runtime target override", runtime: runtimeURL + "&dbname=muebles", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "admin target override", runtime: runtimeURL, migration: migrationURL + "&host=example.invalid", isolated: "1", testDB: "1", port: "56321"},
		{name: "runtime session marker override", runtime: runtimeURL + "&options=-c%20granete.browser_gate_identity%3Dforged", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "mixed-case runtime session marker override", runtime: runtimeURL + "&Options=-c%20granete.browser_gate_identity%3Dforged", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "admin session marker override", runtime: runtimeURL, migration: migrationURL + "&options=-c%20granete.browser_gate_identity%3Dforged", isolated: "1", testDB: "1", port: "56321"},
		{name: "non-loopback target", runtime: "postgres://granete_app:" + secret + "@localhost:56321/granete_gate", migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "runtime owner role", runtime: migrationURL, migration: migrationURL, isolated: "1", testDB: "1", port: "56321"},
		{name: "missing expected port", runtime: runtimeURL, migration: migrationURL, isolated: "1", testDB: "1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ORGANIZATION_TEST_ISOLATED", tc.isolated)
			t.Setenv("GRANETE_TEST_DATABASE", tc.testDB)
			if err := validateBrowserGateTargetPair(tc.runtime, tc.migration, tc.port); err == nil {
				t.Fatal("unsafe preparation was accepted")
			} else if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "postgres://") {
				t.Fatalf("preflight leaked a database URL or password: %v", err)
			}
		})
	}
}

func TestBrowserGateTargetPairAcceptsExplicitDisposableRoles(t *testing.T) {
	t.Setenv("ORGANIZATION_TEST_ISOLATED", "1")
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	t.Setenv("PGHOST", "persistent.example.invalid")
	t.Setenv("PGDATABASE", "muebles")
	const runtime = "postgres://granete_app:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable"
	const admin = "postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable"
	if err := validateBrowserGateTargetPair(runtime, admin, "56321"); err != nil {
		t.Fatalf("valid disposable preparation rejected: %v", err)
	}
}
