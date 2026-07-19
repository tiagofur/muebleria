// Command admin provisions and rotates the admin user account.
//
// The HTTP server no longer creates an admin at boot (the old seed with a
// hardcoded password was removed — see GitHub issue #2). Use this CLI instead:
//
//	go run ./cmd/admin create         --email <email> [--name <name>]
//	go run ./cmd/admin reset-password --email <email>
//
// The password is prompted interactively without echo. For non-interactive use
// (e.g. CI), set ADMIN_PASSWORD in the environment.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"golang.org/x/term"
)



func main() {
	log.SetFlags(0)

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "create":
		runCreate(os.Args[2:])
	case "reset-password":
		runResetPassword(os.Args[2:])
	case "seed":
		runSeed(os.Args[2:])
	case "clean-media":
		runCleanMedia(os.Args[2:])
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `Usage:
  admin create         --email <email> [--name <name>]
  admin reset-password --email <email>
  admin seed
  admin clean-media [--apply]

Environment:
  DATABASE_URL    Postgres DSN (defaults to local dev).
  ADMIN_PASSWORD  If set, used instead of the interactive prompt.
  MEDIA_DIR       Catalog image directory (defaults to ~/.muebles-media).

clean-media scans material_boards.image_url, material_boards.preview_texture_url,
hardwares.image_url and modules.image_url, and reports any URL whose file is
missing on disk. Pass --apply to set those columns to '' so the catalog shows
"Sin foto" instead of a broken <img>. Default is dry-run (no DB changes).
`)
}

func runCreate(args []string) {
	fs := flag.NewFlagSet("create", flag.ExitOnError)
	email := fs.String("email", "", "admin email (required)")
	name := fs.String("name", "Administrator", "admin display name")
	_ = fs.Parse(args)

	if err := validateEmail(*email); err != nil {
		fatal(err)
	}

	password, err := readPassword("Admin password")
	if err != nil {
		fatal(err)
	}
	if err := auth.ValidatePassword(password); err != nil {
		fatal(err)
	}

	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := context.Background()

	// Idempotent: if the user already exists (any active state), do nothing.
	if existing, err := store.GetUserByEmailAnyState(ctx, *email); err == nil && existing != nil {
		log.Printf("User %q already exists (active=%v); nothing to do.", *email, existing.Active)
		return
	} else if err != nil && !strings.Contains(err.Error(), "not found") {
		fatal(fmt.Errorf("checking existing user: %w", err))
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fatal(fmt.Errorf("hashing password: %w", err))
	}

	u := &domain.User{
		Email:        *email,
		PasswordHash: hash,
		Name:         *name,
		Role:         domain.RoleAdmin,
		Active:       true,
	}
	if err := store.CreateUser(ctx, u); err != nil {
		fatal(fmt.Errorf("creating admin user: %w", err))
	}

	log.Printf("Admin user created: %s", *email)
}

func runResetPassword(args []string) {
	fs := flag.NewFlagSet("reset-password", flag.ExitOnError)
	email := fs.String("email", "", "admin email (required)")
	_ = fs.Parse(args)

	if err := validateEmail(*email); err != nil {
		fatal(err)
	}

	password, err := readPassword("New password")
	if err != nil {
		fatal(err)
	}
	if err := auth.ValidatePassword(password); err != nil {
		fatal(err)
	}

	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := context.Background()

	u, err := store.GetUserByEmailAnyState(ctx, *email)
	if err != nil {
		fatal(fmt.Errorf("locating user: %w", err))
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fatal(fmt.Errorf("hashing password: %w", err))
	}

	if err := store.UpdateUserPassword(ctx, u.ID, hash); err != nil {
		fatal(fmt.Errorf("updating password: %w", err))
	}

	log.Printf("Password updated for %s", *email)
}

func openStore() (*storage.PostgresStore, func(), error) {
	// The CLI needs DATABASE_URL but does not need JWT_SECRET. Load the DSN
	// directly from the environment to avoid forcing JWT_SECRET to be set.
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	store, err := storage.NewPostgresStore(dsn)
	if err != nil {
		return nil, nil, err
	}
	return store, func() { store.Close() }, nil
}

func readPassword(label string) (string, error) {
	if env, ok := os.LookupEnv("ADMIN_PASSWORD"); ok {
		if strings.TrimSpace(env) == "" {
			return "", errors.New("ADMIN_PASSWORD is set but empty")
		}
		return env, nil
	}

	fmt.Fprintf(os.Stderr, "%s: ", label)
	bytes, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", fmt.Errorf("reading password: %w", err)
	}
	if len(bytes) == 0 {
		return "", errors.New("password is empty")
	}
	return string(bytes), nil
}

func validateEmail(email string) error {
	if strings.TrimSpace(email) == "" {
		return errors.New("--email is required")
	}
	if !strings.Contains(email, "@") {
		return fmt.Errorf("invalid email %q", email)
	}
	return nil
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "admin: %v\n", err)
	os.Exit(1)
}

func runSeed(args []string) {
	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := context.Background()

	log.Println("Cleaning database tables...")
	truncateQuery := `
		TRUNCATE TABLE 
			board_parts, 
			components, 
			customers, 
			edge_bands, 
			hardware_lines, 
			hardwares, 
			material_boards, 
			module_categories, 
			module_components, 
			module_presets, 
			modules, 
			option_group_members, 
			option_groups, 
			project_item_choices, 
			project_items, 
			project_level_choices, 
			projects, 
			quote_snapshots, 
			snapshot_prices, 
			structure_components, 
			structure_presets, 
			structures, 
			workshop_settings 
		CASCADE;
	`
	if _, err := store.Pool.Exec(ctx, truncateQuery); err != nil {
		fatal(fmt.Errorf("cleaning tables: %w", err))
	}

	log.Println("Seeding database with demo data...")
	if err := store.SeedCatalog(ctx); err != nil {
		fatal(fmt.Errorf("seeding catalog: %w", err))
	}

	log.Println("Backfilling owner_user_id for demo customer and project...")
	backfillProjectQuery := `
		UPDATE projects
		SET owner_user_id = (
			SELECT id FROM users
			WHERE role = 'admin' AND active = true
			ORDER BY created_at ASC
			LIMIT 1
		)
		WHERE owner_user_id IS NULL;
	`
	backfillCustomerQuery := `
		UPDATE customers
		SET owner_user_id = (
			SELECT id FROM users
			WHERE role = 'admin' AND active = true
			ORDER BY created_at ASC
			LIMIT 1
		)
		WHERE owner_user_id IS NULL;
	`

	if _, err := store.Pool.Exec(ctx, backfillProjectQuery); err != nil {
		fatal(fmt.Errorf("backfilling project owner: %w", err))
	}
	if _, err := store.Pool.Exec(ctx, backfillCustomerQuery); err != nil {
		fatal(fmt.Errorf("backfilling customer owner: %w", err))
	}

	log.Println("✓ Database seeded successfully with demo data linked to admin.")
}

// runCleanMedia scans catalog image_url / preview_texture_url columns for URLs
// whose underlying file no longer exists on disk (typical after losing the
// media directory: git clean, re-clone, machine change). Without --apply it
// only reports; with --apply it sets the dangling column to ''.
//
// This is the recovery path for the historical "se pierden las imágenes"
// symptom: the file is gone but the DB row still references it, so the catalog
// shows a broken <img>. Cleaning the URL makes the UI show "Sin foto".
func runCleanMedia(args []string) {
	fs := flag.NewFlagSet("clean-media", flag.ExitOnError)
	apply := fs.Bool("apply", false, "set dangling image_url/preview_texture_url columns to '' (default: dry-run)")
	_ = fs.Parse(args)

	mediaDir := resolveMediaDir()

	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := context.Background()

	// (table, column) pairs that hold catalog media URLs. Each is scanned and,
	// when --apply is set, updated independently so a failure on one column
	// does not block the others.
	targets := []struct {
		table, column string
	}{
		{"material_boards", "image_url"},
		{"material_boards", "preview_texture_url"},
		{"hardwares", "image_url"},
		{"modules", "image_url"},
	}

	totalDangling := 0
	totalCleared := 0
	for _, t := range targets {
		query := fmt.Sprintf("SELECT id, %s FROM %s WHERE %s <> '' AND %s IS NOT NULL", t.column, t.table, t.column, t.column)
		rows, err := store.Pool.Query(ctx, query)
		if err != nil {
			fatal(fmt.Errorf("scanning %s.%s: %w", t.table, t.column, err))
		}
		type dangling struct {
			id  string
			url string
		}
		var found []dangling
		for rows.Next() {
			var id, url string
			if err := rows.Scan(&id, &url); err != nil {
				rows.Close()
				fatal(fmt.Errorf("scanning row in %s.%s: %w", t.table, t.column, err))
			}
			name := mediaFilenameFromURL(url)
			if name == "" {
				// External URL or malformed — leave it alone, it's not our file.
				continue
			}
			path := filepath.Join(mediaDir, name)
			if _, err := os.Stat(path); err == nil {
				continue // file exists, healthy
			} else if !os.IsNotExist(err) {
				// Permission or other FS error — report but do not touch.
				log.Printf("  ! %s.%s id=%s: stat error: %v", t.table, t.column, id, err)
				continue
			}
			found = append(found, dangling{id, url})
		}
		rows.Close()

		if len(found) == 0 {
			continue
		}
		totalDangling += len(found)
		for _, d := range found {
			log.Printf("  • %s.%s id=%s url=%s", t.table, t.column, d.id, d.url)
		}

		if !*apply {
			continue
		}
		// Clear each dangling row individually. Cheap and avoids constructing
		// a parameterized IN-list; counts are small in practice.
		for _, d := range found {
			upd := fmt.Sprintf("UPDATE %s SET %s = '' WHERE id = $1", t.table, t.column)
			if _, err := store.Pool.Exec(ctx, upd, d.id); err != nil {
				log.Printf("  ! failed to clear %s.%s id=%s: %v", t.table, t.column, d.id, err)
				continue
			}
			totalCleared++
		}
	}

	if totalDangling == 0 {
		log.Printf("No dangling media URLs in %s.", mediaDir)
		return
	}
	if *apply {
		log.Printf("✓ Cleared %d/%d dangling URLs in DB. (mediaDir=%s)", totalCleared, totalDangling, mediaDir)
	} else {
		log.Printf("Found %d dangling URL(s) in DB. Re-run with --apply to clear them. (mediaDir=%s)", totalDangling, mediaDir)
	}
}

// resolveMediaDir mirrors the server's MediaDir resolution (env override or
// default ~/.muebles-media). Kept here rather than imported from internal/api
// so the admin CLI does not pull the HTTP layer.
func resolveMediaDir() string {
	if v := strings.TrimSpace(os.Getenv("MEDIA_DIR")); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fatal(fmt.Errorf("resolving home dir for media store: %w", err))
	}
	return filepath.Join(home, ".muebles-media")
}

// mediaFilenameFromURL extracts the on-disk filename from a stored media URL.
// Mirrors internal/api.mediaFilenameFromURL so the admin CLI stays decoupled
// from the HTTP package. Returns "" for anything that is not a catalog media
// URL or that looks like a path-escape attempt.
func mediaFilenameFromURL(raw string) string {
	if raw == "" {
		return ""
	}
	url := strings.TrimSpace(raw)
	const prefix = "/api/media/"
	idx := strings.Index(url, prefix)
	if idx < 0 {
		return ""
	}
	name := url[idx+len(prefix):]
	if i := strings.Index(name, "?"); i >= 0 {
		name = name[:i]
	}
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, "/\\") {
		return ""
	}
	return name
}
