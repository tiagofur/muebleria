package testutil

import "testing"

func TestLeastFreshTOTPCounter(t *testing.T) {
	tests := []struct {
		name    string
		current int64
		last    int64
		want    int64
		ok      bool
	}{
		{name: "uses previous interval before any counter", current: 100, last: 98, want: 99, ok: true},
		{name: "uses current interval after previous", current: 100, last: 99, want: 100, ok: true},
		{name: "uses future interval after current", current: 100, last: 100, want: 101, ok: true},
		{name: "reports exhausted acceptance window", current: 100, last: 101, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := LeastFreshTOTPCounter(tt.current, tt.last)
			if ok != tt.ok || (ok && got != tt.want) {
				t.Fatalf("LeastFreshTOTPCounter(%d, %d) = (%d, %t), want (%d, %t)", tt.current, tt.last, got, ok, tt.want, tt.ok)
			}
		})
	}
}
