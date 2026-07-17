package engine

import (
	"fmt"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// DefaultStructureRevision is the assumed revision for legacy structures that
// omit Revision (#108). Mirrors TS DEFAULT_STRUCTURE_REVISION.
const DefaultStructureRevision = 1

// StructureRevisionError is a domain error raised by ResolveStructureRevision
// when a pin points to a revision that is neither the current one nor present
// in History. Mirrors TS ResolutionError context.
type StructureRevisionError struct {
	StructureID        string
	StructureCode      string
	Pin                int
	CurrentRevision    int
	AvailableRevisions []int
}

func (e *StructureRevisionError) Error() string {
	return fmt.Sprintf(
		"structure revision pin %d not found for structure %q (current=%d, available=%v)",
		e.Pin, e.StructureCode, e.CurrentRevision, e.AvailableRevisions,
	)
}

// StructureRevisionNumber normalises a Structure.Revision value, treating 0
// (legacy / missing) as DefaultStructureRevision. Mirrors TS structureRevision().
func StructureRevisionNumber(s domain.Structure) int {
	if s.Revision <= 0 {
		return DefaultStructureRevision
	}
	return s.Revision
}

// SnapshotStructureRevision builds an immutable StructureRevision from the
// current BOM-relevant fields of s. Mirrors TS snapshotStructureRevision().
func SnapshotStructureRevision(s domain.Structure) domain.StructureRevision {
	return domain.StructureRevision{
		Revision:   StructureRevisionNumber(s),
		Code:       s.Code,
		Name:       s.Name,
		WidthMm:    s.WidthMm,
		HeightMm:   s.HeightMm,
		DepthMm:    s.DepthMm,
		Components: s.Components,
		Presets:    s.Presets,
	}
}

// BumpStructureRevision applies an edit to a published structure (#108):
// the previous revision is snapshotted and prepended to History, and the
// returned structure carries Revision = current+1 plus the new draft fields.
//
// Mirrors TS bumpStructureRevision(). The caller passes nextDraft already
// populated with the new editable fields; ID/Revision/History are derived here
// and override anything nextDraft carries (matches the TS smuggling guard).
func BumpStructureRevision(current domain.Structure, nextDraft domain.Structure) domain.Structure {
	oldRevision := StructureRevisionNumber(current)
	snapshot := SnapshotStructureRevision(current)
	existingHistory := current.History
	if existingHistory == nil {
		existingHistory = []domain.StructureRevision{}
	}
	history := make([]domain.StructureRevision, 0, len(existingHistory)+1)
	history = append(history, snapshot)
	history = append(history, existingHistory...)

	return domain.Structure{
		ID:         current.ID,
		Code:       nextDraft.Code,
		Name:       nextDraft.Name,
		WidthMm:    nextDraft.WidthMm,
		HeightMm:   nextDraft.HeightMm,
		DepthMm:    nextDraft.DepthMm,
		Components: nextDraft.Components,
		Presets:    nextDraft.Presets,
		Notes:      nextDraft.Notes,
		Active:     nextDraft.Active,
		Revision:   oldRevision + 1,
		History:    history,
		CreatedAt:  current.CreatedAt,
		UpdatedAt:  current.UpdatedAt,
	}
}

// ResolveStructureRevision resolves which revision of s to use for BOM
// resolution, honoring pin (#108):
//   - pin == nil or pin == current → current.
//   - pin matches an entry in History → that frozen snapshot.
//   - otherwise → *StructureRevisionError (never silent fallback).
//
// Mirrors TS resolveStructureRevision() including the rich error context.
func ResolveStructureRevision(s domain.Structure, pin *int) (domain.StructureRevision, error) {
	current := StructureRevisionNumber(s)

	if pin == nil || *pin == current {
		return domain.StructureRevision{
			Revision:   current,
			Code:       s.Code,
			Name:       s.Name,
			WidthMm:    s.WidthMm,
			HeightMm:   s.HeightMm,
			DepthMm:    s.DepthMm,
			Components: s.Components,
			Presets:    s.Presets,
		}, nil
	}

	for _, h := range s.History {
		if h.Revision == *pin {
			return h, nil
		}
	}

	available := []int{current}
	for _, h := range s.History {
		available = append(available, h.Revision)
	}
	sort.Ints(available)

	return domain.StructureRevision{}, &StructureRevisionError{
		StructureID:        s.ID,
		StructureCode:      s.Code,
		Pin:                *pin,
		CurrentRevision:    current,
		AvailableRevisions: available,
	}
}

// ResolveStructureForPin resolves s honoring pin and returns a fully-shaped
// domain.Structure ready to feed ResolveBom / expandComposedModuleParts.
//
// ID/Notes/Active/History/CreatedAt/UpdatedAt are carried over from s so the
// object is shape-complete; BOM-relevant fields come from the resolved
// revision. Mirrors TS resolveStructureForPin().
func ResolveStructureForPin(s domain.Structure, pin *int) (domain.Structure, error) {
	resolved, err := ResolveStructureRevision(s, pin)
	if err != nil {
		return domain.Structure{}, err
	}
	out := s
	out.Code = resolved.Code
	out.Name = resolved.Name
	out.WidthMm = resolved.WidthMm
	out.HeightMm = resolved.HeightMm
	out.DepthMm = resolved.DepthMm
	out.Components = resolved.Components
	out.Presets = resolved.Presets
	out.Revision = resolved.Revision
	return out, nil
}

// CaptureProjectItemStructurePins pegs StructureRevisionPin onto each project
// item based on its module's current structure revision (#108). Used when a
// project is closed (quoted/accepted/produced) so the BOM stays frozen against
// later edits. Reopening conserves pins (mirrors TS reopen semantics).
//
// Items whose module has no structure or whose structure is missing from the
// catalog are returned unchanged (pin set to nil).
//
// Mirrors TS captureProjectItemStructurePins().
func CaptureProjectItemStructurePins(items []domain.ProjectItem, catalog domain.Catalog) []domain.ProjectItem {
	modulesByID := make(map[string]domain.Module, len(catalog.Modules))
	for _, m := range catalog.Modules {
		modulesByID[m.ID] = m
	}
	structuresByID := make(map[string]domain.Structure, len(catalog.Structures))
	for _, s := range catalog.Structures {
		structuresByID[s.ID] = s
	}

	out := make([]domain.ProjectItem, len(items))
	for i, item := range items {
		module, ok := modulesByID[item.ModuleID]
		if !ok || module.StructureID == "" {
			out[i] = item
			continue
		}
		structure, ok := structuresByID[module.StructureID]
		if !ok {
			out[i] = item
			continue
		}
		rev := StructureRevisionNumber(structure)
		// Always write a fresh pin (overwrites stale ones from previous closes).
		pinned := item
		pinned.StructureRevisionPin = &rev
		out[i] = pinned
	}
	return out
}
