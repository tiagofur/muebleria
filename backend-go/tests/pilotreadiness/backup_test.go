// Backup/restore readiness (F179 / docs/deployment.md §5.2): a pg_dump of
// the pilot database restored into a scratch database keeps every ownership
// column and all per-org data intact, and the media tree survives a
// tar/gzip round-trip with every DB-referenced file present.
//
// The production media restore (docker volume + chown) lives in
// scripts/restore.sh and is exercised by scripts/pilot-gate.sh + the runbook;
// here we prove the invariant that matters for pilots: no restore path may
// merge or reassign organizations.

package pilotreadiness

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const restoreTestDBName = "muebles_pilot_readiness_restore"

func TestPilotReadiness_BackupRestore(t *testing.T) {
	pgDump, err := exec.LookPath("pg_dump")
	if err != nil {
		t.Skipf("pg_dump not in PATH — install postgresql-client to run the backup/restore leg of the pilot gate: %v", err)
	}
	pgRestore, err := exec.LookPath("pg_restore")
	if err != nil {
		t.Skipf("pg_restore not in PATH — install postgresql-client to run the backup/restore leg of the pilot gate: %v", err)
	}

	// --- 1. Dump the live pilot database (custom format, like backup.sh) ---
	dumpFile := filepath.Join(t.TempDir(), "pilot-readiness.dump")
	if err := runTool(t, pgDump, "--format=custom", "--no-owner", "--no-privileges",
		"--file", dumpFile, fx.dsn.String()); err != nil {
		t.Skipf("pg_dump failed (often a client/server version mismatch): %v", err)
	}

	// --- 2. Restore into a scratch database --------------------------------
	ctx := context.Background()
	if _, err := fx.adminPool.Exec(ctx, `DROP DATABASE IF EXISTS `+restoreTestDBName+` WITH (FORCE)`); err != nil {
		t.Fatalf("drop restore db: %v", err)
	}
	if _, err := fx.adminPool.Exec(ctx, `CREATE DATABASE `+restoreTestDBName); err != nil {
		t.Fatalf("create restore db: %v", err)
	}
	restoreDSN := fx.dsn
	restoreDSN.Path = "/" + restoreTestDBName
	if err := runTool(t, pgRestore, "--no-owner", "--no-privileges",
		"--dbname", restoreDSN.String(), dumpFile); err != nil {
		t.Skipf("pg_restore failed (often a client/server version mismatch): %v", err)
	}

	pool, err := pgxpool.New(ctx, restoreDSN.String())
	if err != nil {
		t.Fatalf("connect restored db: %v", err)
	}
	defer func() {
		pool.Close()
		_, _ = fx.adminPool.Exec(ctx, `DROP DATABASE IF EXISTS `+restoreTestDBName+` WITH (FORCE)`)
	}()

	// --- 3. Ownership and integrity assertions on the restored copy --------
	q := func(sql string, args ...any) map[string]any {
		rows, err := pool.Query(ctx, sql, args...)
		if err != nil {
			t.Fatalf("restored db query %q: %v", firstLine(sql), err)
		}
		defer rows.Close()
		if !rows.Next() {
			t.Fatalf("restored db query %q: no rows", firstLine(sql))
		}
		vals, err := rows.Values()
		if err != nil {
			t.Fatalf("restored db query %q: scan: %v", firstLine(sql), err)
		}
		out := map[string]any{}
		for i, fd := range rows.FieldDescriptions() {
			out[fd.Name] = vals[i]
		}
		return out
	}

	row := q(`SELECT COUNT(*)::int AS n FROM organizations WHERE slug IN ($1, $2)`, fx.a.slug, fx.b.slug)
	if n, ok := toInt(row["n"]); !ok || n != 2 {
		t.Fatalf("restored db: expected both pilot orgs, found %v", row["n"])
	}

	for _, org := range []pilotOrg{fx.a, fx.b} {
		row := q(`SELECT organization_id::text AS org FROM customers WHERE id = $1`, org.customer.id)
		if row["org"] != org.id {
			t.Fatalf("restored db: customer of %s moved to org %v (want %s)", org.slug, row["org"], org.id)
		}
		row = q(`
			SELECT organization_id::text AS org, sales_organization_id::text AS sales,
			       manufacturing_organization_id::text AS mfg
			FROM projects WHERE id = $1`, org.project.id)
		if row["org"] != org.id || row["sales"] != org.id || row["mfg"] != org.id {
			t.Fatalf("restored db: project of %s lost ownership: %v", org.slug, row)
		}
		row = q(`SELECT default_currency AS cur FROM workshop_settings WHERE organization_id = $1`, org.id)
		if row["cur"] != org.settings.DefaultCurrency {
			t.Fatalf("restored db: workshop settings of %s corrupted (currency %v)", org.slug, row["cur"])
		}
		row = q(`SELECT COUNT(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.organization_id = $2`, org.admin.email, org.id)
		if n, ok := toInt(row["n"]); !ok || n != 1 {
			t.Fatalf("restored db: membership of %s in %s missing (count=%v)", org.admin.email, org.slug, row["n"])
		}
	}

	// Cross-membership must not appear after restore.
	row = q(`SELECT COUNT(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.organization_id = $2`,
		fx.a.admin.email, fx.b.id)
	if n, ok := toInt(row["n"]); !ok || n != 0 {
		t.Fatalf("restored db: owner of A gained a membership in B during restore (count=%v)", row["n"])
	}

	// --- 4. Media round-trip (tar.gz, like backup.sh's media leg) ----------
	archive := filepath.Join(t.TempDir(), "media.tar.gz")
	if err := tarGzDir(fx.mediaDir, archive); err != nil {
		t.Fatalf("archive media dir: %v", err)
	}
	restoredMedia := t.TempDir()
	if err := untarGz(archive, restoredMedia); err != nil {
		t.Fatalf("restore media archive: %v", err)
	}
	for _, org := range []pilotOrg{fx.a, fx.b} {
		// The file uploaded through the API is under the org's subdirectory…
		if _, err := os.Stat(filepath.Join(restoredMedia, org.id, org.media.name)); err != nil {
			t.Fatalf("media restore: %s's upload %s missing after round-trip: %v", org.slug, org.media.name, err)
		}
		// …and every media URL referenced by the restored DB resolves.
		urls, err := pool.Query(ctx, `
			SELECT ph.url FROM project_photos ph
			JOIN projects p ON p.id = ph.project_id
			WHERE p.organization_id = $1`, org.id)
		if err != nil {
			t.Fatalf("restored db: list photos of %s: %v", org.slug, err)
		}
		defer urls.Close()
		for urls.Next() {
			var u string
			if err := urls.Scan(&u); err != nil {
				t.Fatalf("scan photo url: %v", err)
			}
			name := strings.TrimPrefix(u, "/api/media/")
			if name == u || name == "" {
				t.Fatalf("photo url %q is not a managed media path", u)
			}
			if _, err := os.Stat(filepath.Join(restoredMedia, org.id, name)); err != nil {
				t.Fatalf("media restore: DB-referenced file %s of %s missing after round-trip: %v", name, org.slug, err)
			}
		}
		if err := urls.Err(); err != nil {
			t.Fatalf("iterate photos of %s: %v", org.slug, err)
		}
	}
}

// runTool executes pg_dump/pg_restore. A client/server version mismatch is
// environmental (skip); a newer pg_restore emitting session SETs the older
// server ignores is tolerated as a warning — the assertions below still
// verify the restored data. Anything else is a hard failure.
func runTool(t *testing.T, path string, args ...string) error {
	t.Helper()
	cmd := exec.Command(path, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	msg := stderr.String()
	if err == nil {
		return nil
	}
	if strings.Contains(msg, "server version mismatch") || strings.Contains(msg, "unsupported version") {
		return fmt.Errorf("%s: %w (%s)", filepath.Base(path), err, strings.TrimSpace(msg))
	}
	if filepath.Base(path) == "pg_restore" &&
		strings.Contains(msg, "unrecognized configuration parameter") &&
		strings.Contains(msg, "errors ignored on restore") {
		t.Logf("pg_restore tolerated a client/server version gap: %s", strings.TrimSpace(msg))
		return nil
	}
	t.Fatalf("%s %v: %v\nstderr: %s", path, args, err, msg)
	return nil
}

// tarGzDir archives srcDir (preserving relative subpaths) into dstFile.
func tarGzDir(srcDir, dstFile string) error {
	out, err := os.Create(dstFile)
	if err != nil {
		return err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
}

// untarGz extracts a tar.gz made by tarGzDir into dstDir, refusing path escapes.
func untarGz(srcFile, dstDir string) error {
	in, err := os.Open(srcFile)
	if err != nil {
		return err
	}
	defer in.Close()
	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(hdr.Name)
		if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return fmt.Errorf("archive entry escapes destination: %q", hdr.Name)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		dst := filepath.Join(dstDir, clean)
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return err
		}
		f, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
		if err != nil {
			return err
		}
		if _, err := io.Copy(f, tr); err != nil {
			f.Close()
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
	}
}
