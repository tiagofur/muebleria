// Package db embeds the SQL migration files and parses them into ordered,
// versioned migration descriptors.
//
// Migrations live in db/migration and follow the naming convention
// NNNNN_name.up.sql, where NNNNN is a zero-padded sequence number. They are
// embedded into the binary with go:embed so the server is self-contained —
// no external files or migrate CLI are needed at runtime. RunMigrations
// (in package storage) consumes the slice returned by EmbeddedMigrations.
package db

import (
	"embed"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

//go:embed migration/*.up.sql
var migrationFS embed.FS

// Migration is a single parsed migration: its numeric version (derived from
// the filename prefix), a human-readable name, and the SQL body to execute.
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// EmbeddedMigrations parses every embedded *.up.sql file into a Migration and
// returns them ordered ascending by version. Filenames are expected to match
// NNNNN_description.up.sql; files that do not match are ignored.
func EmbeddedMigrations() ([]Migration, error) {
	entries, err := migrationFS.ReadDir("migration")
	if err != nil {
		return nil, fmt.Errorf("reading embedded migration dir: %w", err)
	}

	var out []Migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".up.sql") {
			continue
		}
		m, err := parseMigrationName(e.Name())
		if err != nil {
			return nil, fmt.Errorf("parsing migration filename %q: %w", e.Name(), err)
		}
		body, err := migrationFS.ReadFile("migration/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("reading embedded migration %q: %w", e.Name(), err)
		}
		m.SQL = string(body)
		out = append(out, m)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// parseMigrationName extracts the numeric version and descriptive name from a
// filename like "000005_grain_to_material.up.sql".
func parseMigrationName(filename string) (Migration, error) {
	stem := strings.TrimSuffix(filename, ".up.sql")
	parts := strings.SplitN(stem, "_", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return Migration{}, fmt.Errorf("expected NNNNN_name.up.sql, got %q", filename)
	}
	version, err := strconv.Atoi(parts[0])
	if err != nil {
		return Migration{}, fmt.Errorf("invalid version prefix %q in %q", parts[0], filename)
	}
	return Migration{Version: version, Name: parts[1]}, nil
}
