package storage

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F133: only the two known cut strategies persist; anything else falls back
// to saw-guillotine, mirroring TS resolveWorkshopSettings.
func TestNormalizeWorkshopSettings_CutStrategy(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"cnc-nesting survives", "cnc-nesting", "cnc-nesting"},
		{"saw-guillotine survives", "saw-guillotine", "saw-guillotine"},
		{"empty falls back to saw", "", "saw-guillotine"},
		{"garbage falls back to saw", "laser-cut", "saw-guillotine"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ws := normalizeWorkshopSettings(domain.WorkshopSettings{
				DefaultCutStrategy: tc.in,
			})
			if ws.DefaultCutStrategy != tc.want {
				t.Fatalf("normalize(%q) = %q, want %q", tc.in, ws.DefaultCutStrategy, tc.want)
			}
		})
	}
}
