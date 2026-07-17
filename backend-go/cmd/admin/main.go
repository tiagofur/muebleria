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

Environment:
  DATABASE_URL    Postgres DSN (defaults to local dev).
  ADMIN_PASSWORD  If set, used instead of the interactive prompt.

The password must be at least 8 characters.
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
