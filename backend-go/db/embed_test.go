package db

import (
	"strings"
	"testing"
)

func TestEmbeddedMigrationsParsesAndOrders(t *testing.T) {
	migs, err := EmbeddedMigrations()
	if err != nil {
		t.Fatalf("EmbeddedMigrations returned error: %v", err)
	}
	if len(migs) < 5 {
		t.Fatalf("expected at least 5 embedded migrations, got %d", len(migs))
	}

	// Ordered ascending by version.
	for i := 1; i < len(migs); i++ {
		if migs[i].Version <= migs[i-1].Version {
			t.Fatalf("migrations not sorted: %d after %d", migs[i].Version, migs[i-1].Version)
		}
	}

	// Known anchors: first is the init schema, the grain migration is present.
	if migs[0].Version != 1 {
		t.Errorf("first migration version = %d, want 1", migs[0].Version)
	}
	if migs[0].Name == "" {
		t.Errorf("first migration has empty name")
	}
	if migs[0].SQL == "" || !strings.Contains(migs[0].SQL, "CREATE TABLE") {
		t.Errorf("first migration SQL missing CREATE TABLE body")
	}

	var grain Migration
	for _, m := range migs {
		if m.Version == 5 {
			grain = m
		}
	}
	if grain.SQL == "" {
		t.Fatalf("migration 5 not found")
	}
	if !strings.Contains(grain.SQL, "grain_default") {
		t.Errorf("migration 5 SQL does not reference grain_default")
	}
}

func TestParseMigrationName(t *testing.T) {
	cases := []struct {
		in        string
		wantVer   int
		wantName  string
		wantError bool
	}{
		{"000005_grain_to_material.up.sql", 5, "grain_to_material", false},
		{"000001_init_schema.up.sql", 1, "init_schema", false},
		{"12_single.up.sql", 12, "single", false},
		{"no_prefix.up.sql", 0, "", true},
		{"000001_.up.sql", 0, "", true}, // empty name part
		{"abc_init.up.sql", 0, "", true}, // non-numeric version
		{"_noVersion.up.sql", 0, "", true},
	}
	for _, c := range cases {
		got, err := parseMigrationName(c.in)
		if c.wantError {
			if err == nil {
				t.Errorf("parseMigrationName(%q): expected error, got %+v", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseMigrationName(%q): unexpected error: %v", c.in, err)
			continue
		}
		if got.Version != c.wantVer {
			t.Errorf("parseMigrationName(%q): version = %d, want %d", c.in, got.Version, c.wantVer)
		}
		if got.Name != c.wantName {
			t.Errorf("parseMigrationName(%q): name = %q, want %q", c.in, got.Name, c.wantName)
		}
	}
}
