package engine

// #467 / SU-AUTH-1 authority semantics. The authoring client sends only
// occurrence identity + position intent — never relationship topology, never
// range decisions. These tests pin the server-side half of that boundary on
// the canonical cabinet (one movable internal shelf + quantity-bound
// shelfCount):
//
//   - add/duplicate without client-authored relationships materialize
//     server-owned relationship identities (non-colliding, per occurrence);
//   - remove with NO relationships in the request leaves relationship
//     cleanup entirely to the server (no orphan machining survives);
//   - move changes only the dependent relationship machining while unrelated
//     manual machining stays byte-identical;
//   - a position outside the furniture envelope rejects server-side with the
//     canonical TRANSFORM_INVALID code;
//   - every resolved layout publishes the explicit authoring capability for
//     movable internals only.

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func cabinetWithShelfCountBinding(t *testing.T) (domain.Module, domain.Catalog) {
	t.Helper()
	module, catalog := authoringCabinetCatalog()
	min, max, step := 0.0, 5.0, 1.0
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{{
		Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
		DefaultValue: float64(1), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration, Min: &min, Max: &max, Step: &step,
		Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "comp-shelf",
			Relationship: &domain.FurnitureParameterRelationshipBinding{Kind: "shelf-support", SourceRole: "shelf-edge", Targets: []domain.FurnitureParameterRelationshipTarget{
				{ComponentID: "comp-side", Role: "inside-face"}, {ComponentID: "comp-side-r", Role: "inside-face"},
			}}},
	}}
	return module, catalog
}

func resolveAuthority(t *testing.T, module domain.Module, catalog domain.Catalog, count float64, occurrences []AuthoringOccurrence) *AuthoringResolveResult {
	t.Helper()
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		EvaluatedParameters: map[string]any{"shelfCount": count},
		Occurrences:         occurrences,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("resolve rejected: %+v", result.StructuralIssues)
	}
	return result
}

func shelfIds(result *AuthoringResolveResult) []string {
	ids := []string{}
	for _, component := range result.Layout.Components {
		if component.ComponentDefinitionID == "mod-comp-shelf" {
			ids = append(ids, component.ComponentInstanceID)
		}
	}
	return ids
}

func relationshipSources(result *AuthoringResolveResult) map[string]string {
	sources := map[string]string{}
	for _, relationship := range result.Normalized.Relationships {
		sources[relationship.RelationshipID] = relationship.Source.ComponentInstanceID
	}
	return sources
}

func relationshipOpIDs(result *AuthoringResolveResult) map[string]bool {
	ids := map[string]bool{}
	for _, op := range result.Machining.Operations {
		if op.Provenance.SourceKind == "relationship" {
			ids[op.Provenance.RelationshipID] = true
		}
	}
	return ids
}

// Add with NO client-authored relationship: the server materializes a
// distinct relationship identity for the new occurrence and derives its
// machining. Client-proposed occurrence identity is canonical (#477: the
// occurrence set carries it and the normalized receipt echoes it).
func TestAuthoringAuthorityAddWithoutClientRelationshipTopology(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	snapshot := append(defaultAuthoringOccurrences(),
		occurrence("shelf-02", "mod-comp-shelf", &[3]float64{18, 18, 520}))
	result := resolveAuthority(t, module, catalog, 2, snapshot)

	ids := shelfIds(result)
	if len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("each added occurrence keeps a distinct identity: %+v", ids)
	}
	for _, id := range ids {
		if id != "shelf-01" && id != "shelf-02" {
			t.Fatalf("unexpected occurrence identity: %q", id)
		}
	}

	sources := relationshipSources(result)
	if len(sources) != 2 {
		t.Fatalf("the server must materialize one relationship per occurrence: %+v", sources)
	}
	for relationshipID, source := range sources {
		if relationshipID == "" || source == "" {
			t.Fatalf("materialized relationships need server-owned identity: %+v", sources)
		}
		if relationshipID == "shelf-01" || relationshipID == "shelf-02" {
			t.Fatalf("relationship identity must not alias occurrence identity: %q", relationshipID)
		}
	}
	ops := relationshipOpIDs(result)
	if len(ops) != len(sources) {
		t.Fatalf("each materialized relationship must derive machining: ops=%+v rels=%+v", ops, sources)
	}
	for relationshipID := range sources {
		if !ops[relationshipID] {
			t.Fatalf("relationship %q left no machining", relationshipID)
		}
	}
}

// Duplicate reuses the add mechanics with the source pose: the source
// identity survives, the duplicate gets its own occurrence identity and its
// own server-materialized relationship identity.
func TestAuthoringAuthorityDuplicateKeepsSourceAndAllocatesDistinctIdentity(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	snapshot := append(defaultAuthoringOccurrences(),
		occurrence("shelf-dup-01", "mod-comp-shelf", &[3]float64{18, 18, 150}))
	result := resolveAuthority(t, module, catalog, 2, snapshot)

	ids := shelfIds(result)
	if len(ids) != 2 {
		t.Fatalf("duplicate must render source + copy: %+v", ids)
	}
	if ids[0] == ids[1] {
		t.Fatal("duplicate collapsed onto the source identity")
	}
	hasSource, hasDuplicate := false, false
	for _, id := range ids {
		hasSource = hasSource || id == "shelf-01"
		hasDuplicate = hasDuplicate || id == "shelf-dup-01"
	}
	if !hasSource || !hasDuplicate {
		t.Fatalf("source and duplicate identities must both survive: %+v", ids)
	}

	sources := relationshipSources(result)
	if len(sources) != 2 {
		t.Fatalf("source and duplicate each need a relationship: %+v", sources)
	}
	seen := map[string]bool{}
	for _, source := range sources {
		if seen[source] {
			t.Fatalf("two relationships share source occurrence %q", source)
		}
		seen[source] = true
	}
}

// Remove sends the occurrence set minus the target and NO relationships: the
// server owns cleanup — the normalized receipt carries only the surviving
// relationships and no orphan relationship machining remains.
func TestAuthoringAuthorityRemoveCleanupIsServerOwned(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	base := resolveAuthority(t, module, catalog, 1, defaultAuthoringOccurrences())
	if len(base.Normalized.Relationships) != 1 {
		t.Fatalf("base must carry the server-materialized relationship: %+v", base.Normalized.Relationships)
	}

	removed := make([]AuthoringOccurrence, 0, len(defaultAuthoringOccurrences()))
	for _, occ := range defaultAuthoringOccurrences() {
		if occ.ComponentInstanceID != "shelf-01" {
			removed = append(removed, occ)
		}
	}
	after := resolveAuthority(t, module, catalog, 0, removed)

	if len(shelfIds(after)) != 0 {
		t.Fatalf("removed shelf must not materialize: %+v", shelfIds(after))
	}
	if len(after.Normalized.Relationships) != 0 {
		t.Fatalf("server must clean the dependent relationships: %+v", after.Normalized.Relationships)
	}
	if len(relationshipOpIDs(after)) != 0 {
		t.Fatalf("orphan relationship machining survived the removal: %+v", relationshipOpIDs(after))
	}
	manualOps := 0
	for _, op := range after.Machining.Operations {
		if op.Provenance.SourceKind == "manualHardwarePlacement" {
			manualOps++
		}
	}
	if manualOps == 0 {
		t.Fatal("unrelated manual machining must survive the removal")
	}
	if base.Machining.ManufacturingFingerprint == after.Machining.ManufacturingFingerprint {
		t.Fatal("removal must change the manufacturing fingerprint")
	}
}

// Move changes ONLY the dependent relationship machining: the shelf-support
// holes follow the authored height while the door hinge machining stays
// byte-identical.
func TestAuthoringAuthorityMoveChangesOnlyDependentMachining(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	moveTo := func(z float64) *AuthoringResolveResult {
		occ := defaultAuthoringOccurrences()
		occ[5] = occurrence("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, z})
		return resolveAuthority(t, module, catalog, 1, occ)
	}
	low, high := moveTo(350), moveTo(520)

	shelfZ := func(result *AuthoringResolveResult) float64 {
		for _, op := range result.Machining.Operations {
			if op.Provenance.SourceKind == "relationship" && len(op.Holes) > 0 {
				return op.Holes[0].YMm
			}
		}
		t.Fatal("no relationship machining to follow")
		return 0
	}
	if shelfZ(low) == shelfZ(high) {
		t.Fatalf("dependent machining must follow the move: %v vs %v", shelfZ(low), shelfZ(high))
	}

	manualJSON := func(result *AuthoringResolveResult) string {
		ops := map[string]any{}
		for _, op := range result.Machining.Operations {
			if op.Provenance.SourceKind == "manualHardwarePlacement" {
				ops[op.OperationID] = op
			}
		}
		raw, _ := json.Marshal(ops)
		return string(raw)
	}
	if manualJSON(low) != manualJSON(high) {
		t.Fatalf("unrelated manual machining changed across the move:\n%s\n%s", manualJSON(low), manualJSON(high))
	}
}

// Position range validity is server-side: the shared TS transport validator
// accepts any finite magnitude (5000 mm here passes every client check), and
// Go/domain evaluates it against the ACTUAL furniture envelope (height 720),
// rejecting with the canonical TRANSFORM_INVALID code.
func TestAuthoringAuthorityRejectsPositionOutsideFurnitureEnvelope(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	occ := defaultAuthoringOccurrences()
	occ[5] = occurrence("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, 5000})
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		EvaluatedParameters: map[string]any{"shelfCount": 1},
		Occurrences:         occ,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) == 0 {
		t.Fatal("out-of-envelope position must reject server-side")
	}
	found := false
	for _, issue := range result.StructuralIssues {
		if issue.Code == "TRANSFORM_INVALID" && issue.EntityID == "shelf-01" {
			found = true
			if !strings.Contains(issue.Message, "height") || !strings.Contains(issue.Remediation, "envelope") {
				t.Fatalf("range rejection must explain the envelope: %+v", issue)
			}
		}
	}
	if !found {
		t.Fatalf("expected TRANSFORM_INVALID on shelf-01, got: %+v", result.StructuralIssues)
	}

	occ[5] = occurrence("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, 520})
	resolveAuthority(t, module, catalog, 1, occ) // in-envelope accepts
}

// Every resolved layout publishes the explicit authoring capability for
// movable internals only: the shelf carries movable+axis, structural parts
// (sides, door) carry none — clients fail closed on absence instead of
// inferring from slot/role/name.
func TestLayoutPublishesAuthoringCapabilityForMovableInternalsOnly(t *testing.T) {
	module, catalog := cabinetWithShelfCountBinding(t)

	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("layout: %v", err)
	}
	for _, component := range layout.Components {
		if component.ComponentDefinitionID == "mod-comp-shelf" {
			if component.AuthoringCapability == nil || !component.AuthoringCapability.Movable {
				t.Fatalf("movable internal must publish its authoring capability: %+v", component)
			}
			if component.AuthoringCapability.Axis != LayoutAuthoringAxisZ {
				t.Fatalf("first authoring slice publishes the vertical axis, got %q", component.AuthoringCapability.Axis)
			}
			continue
		}
		if component.AuthoringCapability != nil {
			t.Fatalf("structural part %s must not publish an authoring capability", component.ComponentInstanceID)
		}
	}
}
