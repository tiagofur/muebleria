package domain_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestFlattenAndUnflattenMap(t *testing.T) {
	nested := map[string]any{
		"parameters": map[string]any{
			"toeKickHeight":  float64(120),
			"panelThickness": float64(18),
		},
		"rules": map[string]any{
			"hingeDrilling": "system32",
		},
	}

	flat := make(map[string]any)
	domain.FlattenMap("", nested, flat)

	assert.Equal(t, float64(120), flat["parameters.toeKickHeight"])
	assert.Equal(t, float64(18), flat["parameters.panelThickness"])
	assert.Equal(t, "system32", flat["rules.hingeDrilling"])

	unflattened := domain.UnflattenMap(flat)
	assert.Equal(t, nested, unflattened)
}

func TestExecuteThreeWayRebase_SafeAutomaticMerge(t *testing.T) {
	// Rule 9.2: Customer changes toeKickHeight, Granete fixes hingeDrilling -> safe automatic merge
	overlayID := uuid.New()
	orgID := uuid.New()
	oldBaseID := uuid.New()
	newBaseID := uuid.New()

	input := domain.ThreeWayRebaseInput{
		OverlayID:        overlayID,
		OrganizationID:   orgID,
		OldBaseReleaseID: oldBaseID,
		NewBaseReleaseID: newBaseID,
		OldBaseValues: map[string]any{
			"parameters.toeKickHeight": float64(100),
			"rules.hingeDrilling":      "legacy",
		},
		NewBaseValues: map[string]any{
			"parameters.toeKickHeight": float64(100),
			"rules.hingeDrilling":      "system32", // upstream changed
		},
		CustomValues: map[string]any{
			"parameters.toeKickHeight": float64(120), // customer changed
		},
	}

	result := domain.ExecuteThreeWayRebase(input)

	assert.False(t, result.HasConflicts, "safe automatic merge should not produce conflicts")
	assert.Empty(t, result.Conflicts)

	// Custom override is preserved
	assert.Equal(t, float64(120), result.MergedOverrides["parameters.toeKickHeight"])
	// Upstream change does not need an override; it is directly in NewBase
	_, hasHinge := result.MergedOverrides["rules.hingeDrilling"]
	assert.False(t, hasHinge, "upstream change should flow from NewBase without custom override")
}

func TestExecuteThreeWayRebase_SameFieldConflict(t *testing.T) {
	// Rule 9.3: Upstream and customer both changed panelThickness since OldBase -> explicit conflict
	overlayID := uuid.New()
	orgID := uuid.New()
	oldBaseID := uuid.New()
	newBaseID := uuid.New()

	input := domain.ThreeWayRebaseInput{
		OverlayID:        overlayID,
		OrganizationID:   orgID,
		OldBaseReleaseID: oldBaseID,
		NewBaseReleaseID: newBaseID,
		OldBaseValues: map[string]any{
			"parameters.panelThickness": float64(18),
		},
		NewBaseValues: map[string]any{
			"parameters.panelThickness": float64(19),
		},
		CustomValues: map[string]any{
			"parameters.panelThickness": float64(15),
		},
	}

	result := domain.ExecuteThreeWayRebase(input)

	assert.True(t, result.HasConflicts, "same-field modification must trigger explicit conflict")
	require.Len(t, result.Conflicts, 1)

	c := result.Conflicts[0]
	assert.Equal(t, domain.ConflictSameField, c.ConflictType)
	assert.Equal(t, "parameters.panelThickness", c.Path)
	assert.Equal(t, float64(18), c.OldBaseValue)
	assert.Equal(t, float64(19), c.NewBaseValue)
	assert.Equal(t, float64(15), c.CustomValue)
	assert.Equal(t, "pending", c.Status)
}

func TestExecuteThreeWayRebase_ConvergentValues(t *testing.T) {
	// Both upstream and customer set panelThickness to 19 -> no conflict
	input := domain.ThreeWayRebaseInput{
		OverlayID:        uuid.New(),
		OrganizationID:   uuid.New(),
		OldBaseReleaseID: uuid.New(),
		NewBaseReleaseID: uuid.New(),
		OldBaseValues: map[string]any{
			"parameters.panelThickness": float64(18),
		},
		NewBaseValues: map[string]any{
			"parameters.panelThickness": float64(19),
		},
		CustomValues: map[string]any{
			"parameters.panelThickness": float64(19),
		},
	}

	result := domain.ExecuteThreeWayRebase(input)

	assert.False(t, result.HasConflicts)
	assert.Empty(t, result.Conflicts)
	assert.Equal(t, float64(19), result.MergedOverrides["parameters.panelThickness"])
}

func TestExecuteThreeWayRebase_CrossFieldDependencyConflict(t *testing.T) {
	// Upstream set panelThickness to 10; customer set jointDepth to 12.
	// Physical collision: jointDepth >= panelThickness
	input := domain.ThreeWayRebaseInput{
		OverlayID:        uuid.New(),
		OrganizationID:   uuid.New(),
		OldBaseReleaseID: uuid.New(),
		NewBaseReleaseID: uuid.New(),
		OldBaseValues: map[string]any{
			"parameters.panelThickness": float64(18),
			"parameters.jointDepth":     float64(8),
		},
		NewBaseValues: map[string]any{
			"parameters.panelThickness": float64(10), // upstream made panel thinner
			"parameters.jointDepth":     float64(8),
		},
		CustomValues: map[string]any{
			"parameters.jointDepth": float64(12), // customer made joint deeper
		},
	}

	result := domain.ExecuteThreeWayRebase(input)

	assert.True(t, result.HasConflicts, "cross-field dependency must be flagged")
	require.NotEmpty(t, result.Conflicts)

	var found bool
	for _, c := range result.Conflicts {
		if c.ConflictType == domain.ConflictCrossFieldDependency {
			found = true
			assert.Equal(t, "parameters.jointDepth", c.Path)
		}
	}
	assert.True(t, found, "expected cross_field_dependency conflict")
}

func TestApplyConflictResolution(t *testing.T) {
	actorID := uuid.New()
	conflict := domain.LibraryOverlayConflict{
		ID:           uuid.New(),
		Path:         "parameters.panelThickness",
		OldBaseValue: float64(18),
		NewBaseValue: float64(19),
		CustomValue:  float64(15),
		Status:       "pending",
	}

	// 1. Keep custom
	err := domain.ApplyConflictResolution(&conflict, domain.ResolutionKeepCustom, nil, actorID)
	require.NoError(t, err)
	assert.Equal(t, "resolved", conflict.Status)
	assert.Equal(t, float64(15), conflict.ResolvedValue)
	assert.Equal(t, &actorID, conflict.ResolvedBy)

	// 2. Adopt upstream
	err = domain.ApplyConflictResolution(&conflict, domain.ResolutionAdoptUpstream, nil, actorID)
	require.NoError(t, err)
	assert.Equal(t, float64(19), conflict.ResolvedValue)

	// 3. Custom value
	err = domain.ApplyConflictResolution(&conflict, domain.ResolutionCustomValue, float64(16), actorID)
	require.NoError(t, err)
	assert.Equal(t, float64(16), conflict.ResolvedValue)
}
