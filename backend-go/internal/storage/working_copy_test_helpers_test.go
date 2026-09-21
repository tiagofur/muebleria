package storage_test

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #810 test discipline: every working-copy write follows the product writers'
// precondition — read the current working copy, hold its canonical
// workingVersion token (updated_at), then write. Feature tests that only seed
// state use these helpers; the boundary semantics themselves (stale token,
// missing token, concurrent writers, reset precondition) are proven by
// working_copy_write_boundary_test.go with explicit tokens.

func UpdateWorkingCopyCurrent(ctx context.Context, store *storage.PostgresStore, cmd storage.UpdateDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	wc, err := store.GetDesignWorkingCopy(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	stamp := wc.UpdatedAt
	cmd.ExpectedWorkingVersion = &stamp
	return store.UpdateDesignWorkingCopy(ctx, cmd)
}

func ResetWorkingCopyCurrent(ctx context.Context, store *storage.PostgresStore, cmd storage.ResetDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	wc, err := store.GetDesignWorkingCopy(ctx, cmd.DesignID)
	if err != nil {
		return nil, err
	}
	stamp := wc.UpdatedAt
	cmd.ExpectedWorkingVersion = &stamp
	return store.ResetDesignWorkingCopy(ctx, cmd)
}
