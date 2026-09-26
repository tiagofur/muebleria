// Package testutil contains fixture-only helpers shared by integration tests.
package testutil

// LeastFreshTOTPCounter returns the earliest counter in the verifier's ±1
// acceptance window that is strictly newer than last. Test fixtures use this
// to exercise the production replay boundary without waiting an entire TOTP
// period between otherwise independent requests.
func LeastFreshTOTPCounter(current, last int64) (int64, bool) {
	for candidate := current - 1; candidate <= current+1; candidate++ {
		if candidate > last {
			return candidate, true
		}
	}
	return 0, false
}
