package storage

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestPresentationMaterialProvenanceCoversAllServerOwnedStates(t *testing.T) {
	tests := []struct {
		name      string
		source    domain.DesignMaterialProvenance
		inherited bool
		resolved  bool
		want      domain.DesignMaterialProvenance
	}{
		{name: "authored", source: domain.DesignMaterialProvenanceAuthored, resolved: true, want: domain.DesignMaterialProvenanceAuthored},
		{name: "quoted", source: domain.DesignMaterialProvenanceQuoted, resolved: true, want: domain.DesignMaterialProvenanceQuoted},
		{name: "inherited default", source: domain.DesignMaterialProvenanceAuthored, inherited: true, resolved: true, want: domain.DesignMaterialProvenanceInheritedDefault},
		{name: "unresolved", source: domain.DesignMaterialProvenanceQuoted, resolved: false, want: domain.DesignMaterialProvenanceUnresolved},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := presentationMaterialProvenance(tt.source, tt.inherited, tt.resolved); got != tt.want {
				t.Fatalf("provenance = %q, want %q", got, tt.want)
			}
		})
	}
}
