package api

import "strings"

// isDuplicateKey reports whether err represents a Postgres unique-constraint
// violation (e.g. a repeated code or id). All storage Create/Update methods
// wrap the driver error with fmt.Errorf("...: %w", err), so the original
// message — which contains "duplicate key" / "unique constraint" — is preserved
// in err.Error().
//
// This is string-based rather than pgconn.PgError + SQLSTATE "23505" to avoid
// importing pgconn into the api package and to keep behavior identical to the
// inline checks that existed here before the refactor. Upgrading to SQLSTATE
// is a deliberate future change (see TODO).
//
// TODO: inspect *pgconn.PgError.Code == "23505" via errors.As for robustness.
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}
