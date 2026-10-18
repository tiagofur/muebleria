package domain_test

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1209 PR1: the available-finish vocabulary is CLOSED — the catalog never
// offers a finish the renderer cannot draw, and never lists one twice.
func TestValidateHardwareFinishIDs(t *testing.T) {
	if err := domain.ValidateHardwareFinishIDs(nil); err != nil {
		t.Fatalf("nil list must be valid (no offer), got %v", err)
	}
	if err := domain.ValidateHardwareFinishIDs([]string{"chrome", "black-matte", "bronze", "brushed", "gold"}); err != nil {
		t.Fatalf("the full preset vocabulary must be valid, got %v", err)
	}

	unknown := domain.ValidateHardwareFinishIDs([]string{"chrome", "rose-gold"})
	if unknown == nil || !strings.Contains(unknown.Error(), "rose-gold") {
		t.Fatalf("an unknown preset id must fail closed naming it, got %v", unknown)
	}

	dup := domain.ValidateHardwareFinishIDs([]string{"chrome", "chrome"})
	if dup == nil || !strings.Contains(dup.Error(), "repetido") {
		t.Fatalf("a duplicated preset id must fail closed, got %v", dup)
	}
}
