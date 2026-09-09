package engine

import (
	"reflect"
	"testing"
)

// #637 / DT-MAT: the provenance classifier must keep the four honest states
// distinct and never promote a quoted, inherited or absent role into an
// authored one — nor demote an authored role because the quote disagrees.
func TestClassifyMaterialRoleProvenance_States(t *testing.T) {
	cases := []struct {
		name    string
		working map[string]string
		quoted  map[string]string
		want    []MaterialRoleProvenance
	}{
		{
			name:    "authored role wins even when the quote disagrees",
			working: map[string]string{"FRENTES": "mat-authored"},
			quoted:  map[string]string{"FRENTES": "mat-quoted"},
			want: []MaterialRoleProvenance{
				{Role: "FRENTES", WorkingChoice: "mat-authored", QuotedChoice: "mat-quoted", EffectiveChoice: "mat-authored", Provenance: MaterialProvenanceAuthored},
			},
		},
		{
			name:    "quoted choice missing from working copy is the candidate",
			working: map[string]string{},
			quoted:  map[string]string{"FRENTES": "mat-roble", "INTERIOR": "mat-blanco"},
			want: []MaterialRoleProvenance{
				{Role: "FRENTES", QuotedChoice: "mat-roble", Provenance: MaterialProvenanceQuotedMissingFromWorking},
				{Role: "INTERIOR", QuotedChoice: "mat-blanco", Provenance: MaterialProvenanceQuotedMissingFromWorking},
			},
		},
		{
			name:    "alias-governed role is inherited default, not a candidate",
			working: map[string]string{"FRENTE": "mat-authored"},
			quoted:  map[string]string{"ZOCLO": "mat-quoted-zoclo"},
			want: []MaterialRoleProvenance{
				{Role: "FRENTE", WorkingChoice: "mat-authored", EffectiveChoice: "mat-authored", Provenance: MaterialProvenanceAuthored},
				{Role: "ZOCLO", QuotedChoice: "mat-quoted-zoclo", EffectiveChoice: "mat-authored", Provenance: MaterialProvenanceInheritedDefault},
			},
		},
		{
			name:    "role present in working only stays authored",
			working: map[string]string{"FRENTES": "mat-x"},
			quoted:  nil,
			want: []MaterialRoleProvenance{
				{Role: "FRENTES", WorkingChoice: "mat-x", EffectiveChoice: "mat-x", Provenance: MaterialProvenanceAuthored},
			},
		},
		{
			name:    "no choices at all yields no roles",
			working: nil,
			quoted:  nil,
			want:    []MaterialRoleProvenance{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyMaterialRoleProvenance(tc.working, tc.quoted)
			if len(got) != len(tc.want) {
				t.Fatalf("roles = %+v, want %+v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("role[%d] = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// A key carried with an empty value by either side must not surface as an
// invented choice: the role stays visible and honestly unresolved.
func TestClassifyMaterialRoleProvenance_EmptyValuesAreNotChoices(t *testing.T) {
	got := ClassifyMaterialRoleProvenance(
		map[string]string{"FRENTES": "  ", "LATERAL": "mat-l"},
		map[string]string{"ZOCLO": ""},
	)
	want := []MaterialRoleProvenance{
		{Role: "FRENTES", Provenance: MaterialProvenanceMissingUnresolved},
		{Role: "LATERAL", WorkingChoice: "mat-l", EffectiveChoice: "mat-l", Provenance: MaterialProvenanceAuthored},
		{Role: "ZOCLO", Provenance: MaterialProvenanceMissingUnresolved},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("roles = %+v, want %+v", got, want)
	}
}

func TestReconcilableMaterialChoices_FillOnlyMissingQuotedRoles(t *testing.T) {
	working := map[string]string{
		"FRENTES": "mat-authored-front", // authored: never overwritten
		"FRENTE":  "mat-authored-alias", // authored alias governs ZOCLO/PUERTA
	}
	quoted := map[string]string{
		"FRENTES": "mat-quoted-front",  // differs from authored → ignored
		"INTERIOR": "mat-blanco",        // missing from working → filled
		"ZOCLO":   "mat-quoted-zoclo",  // alias-governed → NOT filled
		"PUERTA":  "mat-quoted-puerta", // alias-governed → NOT filled
	}
	got := ReconcilableMaterialChoices(working, quoted)
	want := map[string]string{"INTERIOR": "mat-blanco"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reconcilable = %v, want %v", got, want)
	}
}

func TestReconcilableMaterialChoices_NoQuoteMeansNothingToFill(t *testing.T) {
	if got := ReconcilableMaterialChoices(map[string]string{"FRENTES": "mat-x"}, nil); len(got) != 0 {
		t.Fatalf("reconcilable = %v, want empty", got)
	}
}
