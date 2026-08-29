package storage

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRecordRLSDenialCountsOnlyAuthorizationFailures(t *testing.T) {
	before := RLSDenialTotal()
	if _, ok := RecordRLSDenial(errors.New("ordinary failure")); ok {
		t.Fatal("ordinary error counted as RLS denial")
	}
	total, ok := RecordRLSDenial(&pgconn.PgError{Code: "42501"})
	if !ok || total != before+1 {
		t.Fatalf("total = %d, ok = %v, want %d, true", total, ok, before+1)
	}
}
