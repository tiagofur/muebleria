package storage

import (
	"errors"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgconn"
)

var rlsDenialTotal atomic.Uint64

// RecordRLSDenial increments the process-local security counter for PostgreSQL
// authorization/RLS denials. It deliberately records no tenant or row data.
func RecordRLSDenial(err error) (uint64, bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		return rlsDenialTotal.Load(), false
	}
	return rlsDenialTotal.Add(1), true
}

func RLSDenialTotal() uint64 {
	return rlsDenialTotal.Load()
}
