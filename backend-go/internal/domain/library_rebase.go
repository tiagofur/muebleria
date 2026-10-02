package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/google/uuid"
)

// RebaseConflictType classifies detected collisions during 3-way rebase.
type RebaseConflictType string

const (
	ConflictSameField                 RebaseConflictType = "same_field"
	ConflictCrossFieldDependency      RebaseConflictType = "cross_field_dependency"
	ConflictStructuralIncompatibility RebaseConflictType = "structural_incompatibility"
)

// ResolutionAction defines allowed user choices for resolving a conflict.
type ResolutionAction string

const (
	ResolutionKeepCustom     ResolutionAction = "keep_custom"
	ResolutionAdoptUpstream  ResolutionAction = "adopt_upstream"
	ResolutionCustomValue    ResolutionAction = "custom_value"
	ResolutionReplaceResource ResolutionAction = "replace_resource"
)

var (
	ErrInvalidResolutionAction = errors.New("unsupported conflict resolution action")
	ErrCustomValueRequired     = errors.New("custom_value resolution requires a non-nil resolvedValue")
)

// LibraryOverlay represents an organization-specific overlay attached to an upstream release.
type LibraryOverlay struct {
	ID                uuid.UUID       `json:"id"`
	OrganizationID    uuid.UUID       `json:"organizationId"`
	LibraryID         uuid.UUID       `json:"libraryId"`
	BaseReleaseID     uuid.UUID       `json:"baseReleaseId"`
	Status            string          `json:"status"` // "active" | "draft" | "rebase_conflict" | "archived"
	Overrides         json.RawMessage `json:"overrides"`
	CustomResourceIDs []uuid.UUID     `json:"customResourceIds"`
	// Version backs the optimistic-concurrency If-Match contract (#875
	// slice 4): every overrides update bumps it; a stale token conflicts.
	Version   int64     `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// LibraryOverlayConflict represents a recorded collision requiring explicit human resolution.
type LibraryOverlayConflict struct {
	ID               uuid.UUID          `json:"id"`
	OverlayID        uuid.UUID          `json:"overlayId"`
	OrganizationID   uuid.UUID          `json:"organizationId"`
	OldBaseReleaseID uuid.UUID          `json:"oldBaseReleaseId"`
	NewBaseReleaseID uuid.UUID          `json:"newBaseReleaseId"`
	ConflictType     RebaseConflictType `json:"conflictType"`
	Path             string             `json:"path"`
	OldBaseValue     any                `json:"oldBaseValue,omitempty"`
	NewBaseValue     any                `json:"newBaseValue,omitempty"`
	CustomValue      any                `json:"customValue,omitempty"`
	Status           string             `json:"status"` // "pending" | "resolved" | "ignored"
	ResolutionAction *ResolutionAction  `json:"resolutionAction,omitempty"`
	ResolvedValue    any                `json:"resolvedValue,omitempty"`
	ResolvedBy       *uuid.UUID         `json:"resolvedBy,omitempty"`
	ResolvedAt       *time.Time         `json:"resolvedAt,omitempty"`
	CreatedAt        time.Time          `json:"createdAt"`
}

// ThreeWayRebaseInput contains all parameters needed to execute a 3-way rebase.
type ThreeWayRebaseInput struct {
	OverlayID        uuid.UUID
	OrganizationID   uuid.UUID
	OldBaseReleaseID uuid.UUID
	NewBaseReleaseID uuid.UUID
	OldBaseValues    map[string]any // flattened key-value of OldBase parameters/rules
	NewBaseValues    map[string]any // flattened key-value of NewBase parameters/rules
	CustomValues     map[string]any // customer's explicit overrides
	CustomResourceIDs []uuid.UUID
}

// ThreeWayRebaseResult contains the outcome of a 3-way rebase pass.
type ThreeWayRebaseResult struct {
	HasConflicts    bool
	Conflicts       []LibraryOverlayConflict
	MergedOverrides map[string]any
}

// FlattenMap flattens a nested map[string]any into a dot-separated single-level map.
// e.g. {"parameters": {"toeKickHeight": 120}} -> "parameters.toeKickHeight": 120
func FlattenMap(prefix string, source map[string]any, dest map[string]any) {
	for k, v := range source {
		fullKey := k
		if prefix != "" {
			fullKey = prefix + "." + k
		}
		if childMap, ok := v.(map[string]any); ok {
			FlattenMap(fullKey, childMap, dest)
		} else {
			dest[fullKey] = v
		}
	}
}

// UnflattenMap reconstructs a nested map[string]any from a dot-separated map.
func UnflattenMap(source map[string]any) map[string]any {
	result := make(map[string]any)
	for k, v := range source {
		parts := strings.Split(k, ".")
		curr := result
		for i := 0; i < len(parts)-1; i++ {
			part := parts[i]
			if _, exists := curr[part]; !exists {
				curr[part] = make(map[string]any)
			}
			if nextMap, ok := curr[part].(map[string]any); ok {
				curr = nextMap
			} else {
				newMap := make(map[string]any)
				curr[part] = newMap
				curr = newMap
			}
		}
		curr[parts[len(parts)-1]] = v
	}
	return result
}

// ExecuteThreeWayRebase performs the deterministic 3-way rebase between OLD BASE, NEW BASE, and CUSTOM.
func ExecuteThreeWayRebase(input ThreeWayRebaseInput) ThreeWayRebaseResult {
	result := ThreeWayRebaseResult{
		MergedOverrides: make(map[string]any),
		Conflicts:       make([]LibraryOverlayConflict, 0),
	}

	// 1. Collect all distinct paths from custom overrides and upstream changes
	allPaths := make(map[string]struct{})
	for k := range input.CustomValues {
		allPaths[k] = struct{}{}
	}
	for k := range input.NewBaseValues {
		if !rebaseValuesEqual(input.OldBaseValues[k], input.NewBaseValues[k]) {
			allPaths[k] = struct{}{}
		}
	}

	// 2. Evaluate each path against 3-way rules
	for path := range allPaths {
		oldVal, hadOld := input.OldBaseValues[path]
		newVal, hadNew := input.NewBaseValues[path]
		customVal, hasCustom := input.CustomValues[path]

		upstreamChanged := hadOld != hadNew || !rebaseValuesEqual(oldVal, newVal)

		switch {
		case !hasCustom && upstreamChanged:
			// Case A: Upstream changed, customer never customized this -> safe auto-adopt from NewBase.
			// No override needed in customer overlay; it inherits from NewBase directly.
			continue

		case hasCustom && !upstreamChanged:
			// Case B: Customer customized, upstream did not change -> safe keep custom.
			result.MergedOverrides[path] = customVal

		case hasCustom && upstreamChanged:
			// Case C: Both upstream and customer changed since OldBase
			if rebaseValuesEqual(customVal, newVal) {
				// Converged on same value: keep custom (or clean adopt)
				result.MergedOverrides[path] = customVal
			} else {
				// Explicit collision!
				conflict := LibraryOverlayConflict{
					ID:               uuid.New(),
					OverlayID:        input.OverlayID,
					OrganizationID:   input.OrganizationID,
					OldBaseReleaseID: input.OldBaseReleaseID,
					NewBaseReleaseID: input.NewBaseReleaseID,
					ConflictType:     ConflictSameField,
					Path:             path,
					OldBaseValue:     oldVal,
					NewBaseValue:     newVal,
					CustomValue:      customVal,
					Status:           "pending",
					CreatedAt:        time.Now().UTC(),
				}
				result.Conflicts = append(result.Conflicts, conflict)
			}
		}
	}

	// 3. Cross-field physical dependency checks (e.g. jointDepth vs panelThickness)
	checkCrossFieldDependencies(&result, input)

	result.HasConflicts = len(result.Conflicts) > 0
	return result
}

// checkCrossFieldDependencies validates physical sanity between related paths.
func checkCrossFieldDependencies(result *ThreeWayRebaseResult, input ThreeWayRebaseInput) {
	effectivePanelThickness := resolveEffectiveFloat(
		result.MergedOverrides["parameters.panelThickness"],
		input.NewBaseValues["parameters.panelThickness"],
		input.OldBaseValues["parameters.panelThickness"],
	)

	effectiveJointDepth := resolveEffectiveFloat(
		result.MergedOverrides["parameters.jointDepth"],
		input.NewBaseValues["parameters.jointDepth"],
		input.OldBaseValues["parameters.jointDepth"],
	)

	if effectivePanelThickness > 0 && effectiveJointDepth > 0 {
		// In physical woodworking, jointDepth cannot exceed panelThickness
		if effectiveJointDepth >= effectivePanelThickness {
			// Check if this condition arose from conflicting changes
			conflict := LibraryOverlayConflict{
				ID:               uuid.New(),
				OverlayID:        input.OverlayID,
				OrganizationID:   input.OrganizationID,
				OldBaseReleaseID: input.OldBaseReleaseID,
				NewBaseReleaseID: input.NewBaseReleaseID,
				ConflictType:     ConflictCrossFieldDependency,
				Path:             "parameters.jointDepth",
				OldBaseValue:     input.OldBaseValues["parameters.jointDepth"],
				NewBaseValue:     input.NewBaseValues["parameters.jointDepth"],
				CustomValue:      input.CustomValues["parameters.jointDepth"],
				Status:           "pending",
				CreatedAt:        time.Now().UTC(),
			}
			result.Conflicts = append(result.Conflicts, conflict)
		}
	}
}

func resolveEffectiveFloat(vals ...any) float64 {
	for _, v := range vals {
		if v == nil {
			continue
		}
		switch n := v.(type) {
		case float64:
			return n
		case float32:
			return float64(n)
		case int:
			return float64(n)
		case int64:
			return float64(n)
		}
	}
	return 0
}

// rebaseValuesEqual checks semantic equality between two interface{} values.
func rebaseValuesEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	// Handle numeric comparisons across float64 and int
	fa, oka := rebaseToFloat64(a)
	fb, okb := rebaseToFloat64(b)
	if oka && okb {
		return fa == fb
	}

	return reflect.DeepEqual(a, b)
}

func rebaseToFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	default:
		return 0, false
	}
}

// ApplyConflictResolution applies an explicit human resolution to an existing conflict.
func ApplyConflictResolution(conflict *LibraryOverlayConflict, action ResolutionAction, resolvedValue any, actorID uuid.UUID) error {
	now := time.Now().UTC()
	switch action {
	case ResolutionKeepCustom:
		conflict.Status = "resolved"
		conflict.ResolutionAction = &action
		conflict.ResolvedValue = conflict.CustomValue
		conflict.ResolvedBy = &actorID
		conflict.ResolvedAt = &now
		return nil

	case ResolutionAdoptUpstream:
		conflict.Status = "resolved"
		conflict.ResolutionAction = &action
		conflict.ResolvedValue = conflict.NewBaseValue
		conflict.ResolvedBy = &actorID
		conflict.ResolvedAt = &now
		return nil

	case ResolutionCustomValue:
		if resolvedValue == nil {
			return ErrCustomValueRequired
		}
		conflict.Status = "resolved"
		conflict.ResolutionAction = &action
		conflict.ResolvedValue = resolvedValue
		conflict.ResolvedBy = &actorID
		conflict.ResolvedAt = &now
		return nil

	case ResolutionReplaceResource:
		conflict.Status = "resolved"
		conflict.ResolutionAction = &action
		conflict.ResolvedValue = resolvedValue
		conflict.ResolvedBy = &actorID
		conflict.ResolvedAt = &now
		return nil

	default:
		return fmt.Errorf("%w: %s", ErrInvalidResolutionAction, action)
	}
}
