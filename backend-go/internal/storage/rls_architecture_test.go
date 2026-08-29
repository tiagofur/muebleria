package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTenantRLS_ArchitectureGuards(t *testing.T) {
	root := filepath.Clean("../..")
	var violations []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		text := string(content)
		if strings.Contains(text, "InitialOrganizationID") &&
			rel != "internal/storage/organizations.go" &&
			!strings.HasPrefix(rel, "cmd/admin/") {
			violations = append(violations, rel+": runtime InitialOrganizationID")
		}
		if strings.HasPrefix(rel, "internal/storage/") &&
			rel != "internal/storage/migrations.go" &&
			rel != "internal/storage/postgres.go" &&
			rel != "internal/storage/rls_readiness.go" &&
			(strings.Contains(text, "s.Pool.Query(") ||
				strings.Contains(text, "s.Pool.QueryRow(") ||
				strings.Contains(text, "s.Pool.Exec(")) {
			violations = append(violations, rel+": repository escaped contextual transaction")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("tenant architecture violations:\n%s", strings.Join(violations, "\n"))
	}
}
