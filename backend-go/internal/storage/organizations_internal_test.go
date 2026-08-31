package storage

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type membershipScanRow struct{ err error }

func (row membershipScanRow) Scan(...any) error { return row.err }

func TestScanMembershipWithOrgClassifiesOnlyMissingRows(t *testing.T) {
	if _, err := scanMembershipWithOrg(membershipScanRow{err: pgx.ErrNoRows}); !errors.Is(err, ErrMembershipNotFound) {
		t.Fatalf("missing row error = %v, want ErrMembershipNotFound", err)
	}
	scanErr := errors.New("scan failure")
	if _, err := scanMembershipWithOrg(membershipScanRow{err: scanErr}); !errors.Is(err, scanErr) {
		t.Fatalf("scan error = %v, want original failure", err)
	}
}
