package engine

import (
	"sort"
	"strings"
)

// #637 / DT-MAT: material provenance classification for one design working
// item against the quoted board choices of its current quote line.
//
// The classifier is a pure read-side helper for the explicit reconciliation
// flow: it DETECTS lost quoted provenance and never mutates anything. It
// keeps four honest states distinct instead of collapsing them into a plain
// material id:
//
//	authored                     explicit choice in the working copy — design
//	                             truth; reconciliation NEVER overwrites it
//	quoted_missing_from_working  the current quote line carries a choice the
//	                             working copy lost (pre-#621 placements) —
//	                             the only reconciliation candidate
//	inherited_default            no explicit choice, but the explicit legacy
//	                             alias contract (FRENTE inheritance) proves
//	                             which authored choice governs the role
//	missing_unresolved           nothing explicit, nothing quoted, nothing
//	                             provably inherited — no choice is fabricated
//
// EffectiveChoice is only set when the SERVER can prove what resolves today
// (the authored choice for the role, or an authored choice reached through
// the alias table). SketchUp's visual default textures are local render
// state, never server truth, so they never appear here.

type MaterialProvenance string

const (
	MaterialProvenanceAuthored                 MaterialProvenance = "authored"
	MaterialProvenanceQuotedMissingFromWorking MaterialProvenance = "quoted_missing_from_working"
	MaterialProvenanceInheritedDefault         MaterialProvenance = "inherited_default"
	MaterialProvenanceMissingUnresolved        MaterialProvenance = "missing_unresolved"
)

// MaterialRoleProvenance is the per-role provenance read model. Choice values
// are material ids; an absent choice is simply omitted.
type MaterialRoleProvenance struct {
	Role            string             `json:"role"`
	WorkingChoice   string             `json:"workingChoice,omitempty"`
	QuotedChoice    string             `json:"quotedChoice,omitempty"`
	EffectiveChoice string             `json:"effectiveChoice,omitempty"`
	Provenance      MaterialProvenance `json:"provenance"`
}

func provenanceRoleKeys(maps ...map[string]string) []string {
	seen := map[string]bool{}
	roles := make([]string, 0)
	for _, m := range maps {
		for role := range m {
			trimmed := strings.TrimSpace(role)
			if trimmed == "" || seen[trimmed] {
				continue
			}
			seen[trimmed] = true
			roles = append(roles, trimmed)
		}
	}
	sort.Strings(roles)
	return roles
}

// ClassifyMaterialRoleProvenance classifies the union of the roles carried by
// the working choices and the quoted choices of one unit. Roles neither side
// mentions do not appear: without a choice there is no provenance to report
// and no repair candidate to compute. Quoted values are reported exactly as
// the quote line carries them (per-role explicit); only the working side
// walks the legacy alias contract, because only authored truth governs what
// the design resolves with today.
func ClassifyMaterialRoleProvenance(working, quoted map[string]string) []MaterialRoleProvenance {
	out := make([]MaterialRoleProvenance, 0, len(working)+len(quoted))
	for _, role := range provenanceRoleKeys(working, quoted) {
		entry := MaterialRoleProvenance{Role: role, Provenance: MaterialProvenanceMissingUnresolved}
		if quotedChoice := strings.TrimSpace(quoted[role]); quotedChoice != "" {
			entry.QuotedChoice = quotedChoice
		}
		switch workingChoice := strings.TrimSpace(working[role]); {
		case workingChoice != "":
			entry.WorkingChoice = workingChoice
			entry.EffectiveChoice = workingChoice
			entry.Provenance = MaterialProvenanceAuthored
		default:
			// No explicit working choice: an authored alias (e.g. PUERTA ←
			// authored FRENTE) already governs the role, and reconciliation
			// must not override that authored truth.
			if inherited := resolveBoardOptionChoiceID(role, working); inherited != "" {
				entry.EffectiveChoice = inherited
				entry.Provenance = MaterialProvenanceInheritedDefault
			} else if entry.QuotedChoice != "" {
				entry.Provenance = MaterialProvenanceQuotedMissingFromWorking
			}
		}
		out = append(out, entry)
	}
	return out
}

// ReconcilableMaterialChoices returns ONLY the roles whose quoted choice may
// be repaired into the working copy: quoted, missing from the working copy,
// and not governed by an authored alias. The result is deterministic and
// never includes an authored or alias-governed role.
func ReconcilableMaterialChoices(working, quoted map[string]string) map[string]string {
	reconcilable := map[string]string{}
	if len(quoted) == 0 {
		return reconcilable
	}
	for _, entry := range ClassifyMaterialRoleProvenance(working, quoted) {
		if entry.Provenance == MaterialProvenanceQuotedMissingFromWorking {
			reconcilable[entry.Role] = entry.QuotedChoice
		}
	}
	return reconcilable
}
