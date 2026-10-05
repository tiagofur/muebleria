package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// TestInvitationPreviewReadOnly covers the read-only preflight behind
// POST /api/auth/invitations:preview (#1108) against real PostgreSQL with the
// unprivileged runtime role: pending invitations expose their context, every
// terminal state maps to its typed error, and nothing is consumed.
func TestInvitationPreviewReadOnly(t *testing.T) {
	migrationStore, adminPool := migrationConnectStore(t)
	if err := migrationStore.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := context.Background()
	if _, err := adminPool.Exec(ctx, `
		INSERT INTO organizations (id, name, slug) VALUES
		 ('a60f0000-0000-0000-0000-000000000001', 'Taller Preview', 'taller-preview'),
		 ('a60f0000-0000-0000-0000-000000000002', 'Taller Preview B', 'taller-preview-b')
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatalf("seed organizations: %v", err)
	}
	if _, err := adminPool.Exec(ctx, `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES
		 ('a60f0000-0000-0000-0000-000000000003', 'invited@example.test', 'invited@example.test', 'x', 'Invited User', 'active'),
		 ('a60f0000-0000-0000-0000-000000000004', 'admin@example.test', 'admin@example.test', 'x', 'Org Admin', 'active')
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatalf("seed users: %v", err)
	}
	// Active orgs require an active admin (team invariant trigger): satisfy it
	// before flipping the organization status.
	if _, err := adminPool.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles, status) VALUES
		 ('a60f0000-0000-0000-0000-000000000001', 'a60f0000-0000-0000-0000-000000000004', ARRAY['admin']::text[], 'active'),
		 ('a60f0000-0000-0000-0000-000000000002', 'a60f0000-0000-0000-0000-000000000004', ARRAY['admin']::text[], 'active')
		ON CONFLICT DO NOTHING`); err != nil {
		t.Fatalf("seed admin memberships: %v", err)
	}
	if _, err := adminPool.Exec(ctx, `
		INSERT INTO invitations (id, organization_id, email, normalized_email, roles, status, token_hash, expires_at, invited_by) VALUES
		 ('a60f0000-0000-0000-0000-000000000011', 'a60f0000-0000-0000-0000-000000000001', 'invited@example.test', 'invited@example.test', '{admin}', 'pending', 'hash-preview-user', NOW()+interval '1 day', NULL),
		 ('a60f0000-0000-0000-0000-000000000012', 'a60f0000-0000-0000-0000-000000000001', 'new-hire@example.test', 'new-hire@example.test', '{vendedor}', 'pending', 'hash-preview-new', NOW()+interval '1 day', NULL),
		 ('a60f0000-0000-0000-0000-000000000013', 'a60f0000-0000-0000-0000-000000000002', 'expired@example.test', 'expired@example.test', '{vendedor}', 'pending', 'hash-preview-expired', NOW()-interval '1 day', NULL)
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatalf("seed invitations: %v", err)
	}
	if _, err := adminPool.Exec(ctx, `
		UPDATE invitations SET token_hash='hash-preview-rotated-new', previous_token_hashes='{hash-preview-rotated}'
		WHERE id='a60f0000-0000-0000-0000-000000000012'`); err != nil {
		t.Fatalf("rotate invitation token: %v", err)
	}
	store, _ := connectStore(t)
	if _, err := adminPool.Exec(ctx, `UPDATE organizations SET status='active' WHERE id IN ('a60f0000-0000-0000-0000-000000000001','a60f0000-0000-0000-0000-000000000002')`); err != nil {
		t.Fatalf("activate organizations: %v", err)
	}

	t.Run("pending with existing account exposes context", func(t *testing.T) {
		preview, err := store.PreviewInvitation(ctx, "hash-preview-user")
		if err != nil {
			t.Fatalf("preview: %v", err)
		}
		if preview.OrganizationName != "Taller Preview" || preview.Email != "invited@example.test" {
			t.Fatalf("context=%+v", preview)
		}
		if !preview.AccountExists || !preview.CurrentToken {
			t.Fatalf("flags=%+v", preview)
		}
		if len(preview.Roles) != 1 || preview.Roles[0] != domain.UserRole("admin") {
			t.Fatalf("roles=%v", preview.Roles)
		}
	})
	t.Run("pending without account flags account_exists false", func(t *testing.T) {
		preview, err := store.PreviewInvitation(ctx, "hash-preview-rotated-new")
		if err != nil {
			t.Fatalf("preview: %v", err)
		}
		if preview.AccountExists {
			t.Fatalf("account_exists=%v", preview.AccountExists)
		}
	})
	t.Run("expired maps to typed error", func(t *testing.T) {
		if _, err := store.PreviewInvitation(ctx, "hash-preview-expired"); !errors.Is(err, storage.ErrInvitationExpired) {
			t.Fatalf("err=%v", err)
		}
	})
	t.Run("rotated token maps to typed error", func(t *testing.T) {
		if _, err := store.PreviewInvitation(ctx, "hash-preview-rotated"); !errors.Is(err, storage.ErrInvitationTokenRotated) {
			t.Fatalf("err=%v", err)
		}
	})
	t.Run("unknown hash maps to not found", func(t *testing.T) {
		if _, err := store.PreviewInvitation(ctx, "hash-preview-missing"); !errors.Is(err, storage.ErrInvitationNotFound) {
			t.Fatalf("err=%v", err)
		}
	})
	t.Run("preview does not consume the invitation", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			if _, err := store.PreviewInvitation(ctx, "hash-preview-user"); err != nil {
				t.Fatalf("preview %d: %v", i, err)
			}
		}
		var status string
		if err := adminPool.QueryRow(ctx, `SELECT status FROM invitations WHERE id='a60f0000-0000-0000-0000-000000000011'`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != "pending" {
			t.Fatalf("status=%q want pending", status)
		}
	})
}
