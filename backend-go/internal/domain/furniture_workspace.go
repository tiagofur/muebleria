package domain

import (
	"sort"
)

// #500 / WEB-DT-1 final authority correction: the contextual projection of
// the Project Furniture matrix is SERVER-owned. Design presence, commercial
// presence, action-required codes/messages, quantity grouping, summary counts
// and the contextual release reference all derive here (deterministically,
// from authoritative snapshots) so React — and later the #389-consistent
// surfaces — only render, filter and detail.
//
// Semantics parity contract with the SketchUp Project Furniture panel
// (#389 / DT-5): presence joins strictly by FurnitureInstance.id; grouping
// keys by QuoteLine (#386 commercial quantity provenance), never by definition;
// terminal units stay visible as history.

// FurnitureWorkspaceContextKind values for the selected design context.
const (
	FurnitureWorkspaceContextNone     = "none"
	FurnitureWorkspaceContextWorking  = "working"
	FurnitureWorkspaceContextRevision = "revision"
)

// FurnitureWorkspaceAction codes (canonical read-model vocabulary).
const (
	FurnitureWorkspaceActionPendingPlacement = "pending_placement"
	FurnitureWorkspaceActionQuotedNotModeled  = "quoted_not_modeled"
	FurnitureWorkspaceActionModeledNotQuoted  = "modeled_not_quoted"
	FurnitureWorkspaceActionModified         = "modified"
	FurnitureWorkspaceActionRemoved          = "removed"
	FurnitureWorkspaceActionConflict         = "conflict"
)

// furnitureWorkspaceActionCopy carries the human (es) reason and remediation
// for each action code. Server-owned: clients never invent these strings.
var furnitureWorkspaceActionCopy = map[string]struct{ Message, Remediation string }{
	FurnitureWorkspaceActionPendingPlacement: {
		Message:     "Pendiente de colocar en el diseño",
		Remediation: "Colocá la unidad desde el panel de muebles",
	},
	FurnitureWorkspaceActionQuotedNotModeled: {
		Message:     "Cotizada pero no modelada",
		Remediation: "Colocá la unidad en el diseño",
	},
	FurnitureWorkspaceActionModeledNotQuoted: {
		Message:     "Modelada pero no cotizada",
		Remediation: "Incorporá la unidad en una nueva revisión de cotización",
	},
	FurnitureWorkspaceActionModified: {
		Message:     "Modificada respecto de la cotización",
		Remediation: "Generá una nueva revisión de cotización para incorporar el cambio",
	},
	FurnitureWorkspaceActionRemoved: {
		Message:     "Retirada del diseño",
		Remediation: "Confirmá la baja o reincorporá la unidad",
	},
	FurnitureWorkspaceActionConflict: {
		Message:     "Conflicto entre cotización y diseño",
		Remediation: "Resolvé el conflicto antes de cotizar o producir",
	},
}

// FurnitureWorkspaceAction is the server-derived action projection for a unit.
type FurnitureWorkspaceAction struct {
	Code        string
	Message     string
	Remediation string
}

// FurnitureWorkspaceCommercial is the per-unit commercial presence derived
// strictly from the selected immutable QuoteRevision snapshot.
type FurnitureWorkspaceCommercial struct {
	Present         bool
	LifecycleStatus string // in-revision lifecycle; "" when absent
}

// FurnitureWorkspaceDesign is the per-unit design presence derived from the
// selected design context joined by furnitureInstanceId.
type FurnitureWorkspaceDesign struct {
	Presence         string // none | placed | pending
	ContextKind      string // none | working | revision
	DesignID         string
	DesignRevisionID string
}

// FurnitureWorkspaceCommercialGrouping represents exact commercial quantity
// grouping provenance (#386 / DT-2 / QuoteLine ↔ FurnitureInstance).
// Multiple QuoteLines with the same definition never merge groups.
type FurnitureWorkspaceCommercialGrouping struct {
	QuoteRevisionID string
	QuoteLineID     string
	UnitIndex       int
	UnitTotal       int
}

// FurnitureWorkspaceUnit is the authoritative per-unit projection.
type FurnitureWorkspaceUnit struct {
	Instance           FurnitureInstance
	Commercial         FurnitureWorkspaceCommercial
	Design             FurnitureWorkspaceDesign
	CommercialGrouping *FurnitureWorkspaceCommercialGrouping
	ActionRequired     *FurnitureWorkspaceAction
	Reconciliation     *ReconciliationItem
}

// FurnitureWorkspaceSummary aggregates the server-derived counts.
type FurnitureWorkspaceSummary struct {
	Total          int
	ActiveUnits    int
	Quoted         int
	Placed         int
	Pending        int
	ActionRequired int
	Removed        int
	Cancelled      int
}

// FurnitureWorkspaceQuoteContext echoes the selected exact commercial context.
type FurnitureWorkspaceQuoteContext struct {
	ID             string
	RevisionNumber int
	Status         string
}

// FurnitureWorkspaceDesignHeader echoes the selected exact design context.
type FurnitureWorkspaceDesignHeader struct {
	Kind                 string
	DesignID             string
	DesignRevisionID     string
	DesignRevisionNumber int
}

// FurnitureWorkspaceRelease is the exact contextual release reference.
type FurnitureWorkspaceRelease struct {
	ID                          string
	ReleaseNumber               int
	DesignRevisionID            string
	DesignRevisionNumber        int
	QuoteRevisionID             string
	ManufacturingStale          bool
	CurrentDesignRevisionID     string
	CurrentDesignRevisionNumber int
}

// FurnitureWorkspace is the full authoritative projection.
type FurnitureWorkspace struct {
	ProjectID            string
	QuoteRevision        *FurnitureWorkspaceQuoteContext
	DesignContext        FurnitureWorkspaceDesignHeader
	Release              *FurnitureWorkspaceRelease
	LatestProjectRelease *FurnitureWorkspaceRelease
	Summary              FurnitureWorkspaceSummary
	Units                []FurnitureWorkspaceUnit
}

// FurnitureWorkspaceInputs carries the authoritative snapshots the pure
// projection derives from.
type FurnitureWorkspaceInputs struct {
	ProjectID string
	Instances []FurnitureInstance
	// Quote is the selected immutable commercial snapshot (nil when absent).
	Quote *QuoteRevisionDetail
	// CommercialGroupingByInstance maps furnitureInstanceId to its QuoteLine grouping (#386).
	CommercialGroupingByInstance map[string]FurnitureWorkspaceCommercialGrouping
	// DesignContextKind: none | working | revision.
	DesignContextKind string
	// DesignID / DesignRevisionID echo the selected exact design context.
	DesignID         string
	DesignRevisionID string
	// DesignRevisionNumber echoes the exact revision number (0 otherwise).
	DesignRevisionNumber int
	// DesignItemInstanceIDs: identities present in the selected design context.
	DesignItemInstanceIDs []string
	// Reconciliation is the server-computed result for the exact revision
	// pair (nil for working-copy or absent contexts).
	Reconciliation *ReconciliationResult
	// Release is the newest ProductionRelease pin (nil when none exists).
	Release        *ProductionRelease
	ReleaseStale   bool
	ReleaseCurrent *ProductionReleaseStaleness
}

// BuildFurnitureWorkspace derives the deterministic contextual projection.
// Pure: no I/O, no clocks (instance ordering uses stored timestamps).
func BuildFurnitureWorkspace(inputs FurnitureWorkspaceInputs) *FurnitureWorkspace {
	placedIDs := make(map[string]bool, len(inputs.DesignItemInstanceIDs))
	for _, id := range inputs.DesignItemInstanceIDs {
		placedIDs[id] = true
	}
	hasDesignContext := inputs.DesignContextKind != FurnitureWorkspaceContextNone

	reconciliationByID := make(map[string]ReconciliationItem)
	if inputs.Reconciliation != nil {
		for _, item := range inputs.Reconciliation.Items {
			reconciliationByID[item.FurnitureInstanceID] = item
		}
	}

	quoteItems := make(map[string]QuoteRevisionItem)
	if inputs.Quote != nil {
		for _, item := range inputs.Quote.Items {
			quoteItems[item.FurnitureInstanceID] = item
		}
	}

	// Deterministic ordering: creation, then identity.
	ordered := make([]FurnitureInstance, len(inputs.Instances))
	copy(ordered, inputs.Instances)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CreatedAt.Before(ordered[j].CreatedAt)
	})

	workspace := &FurnitureWorkspace{
		ProjectID: inputs.ProjectID,
		DesignContext: FurnitureWorkspaceDesignHeader{
			Kind:                 inputs.DesignContextKind,
			DesignRevisionNumber: inputs.DesignRevisionNumber,
		},
		Units: make([]FurnitureWorkspaceUnit, 0, len(ordered)),
	}
	if hasDesignContext {
		workspace.DesignContext.DesignID = inputs.DesignID
		workspace.DesignContext.DesignRevisionID = inputs.DesignRevisionID
	}
	if inputs.Quote != nil {
		workspace.QuoteRevision = &FurnitureWorkspaceQuoteContext{
			ID:             inputs.Quote.ID,
			RevisionNumber: inputs.Quote.RevisionNumber,
			Status:         inputs.Quote.Status,
		}
	}
	if inputs.Release != nil {
		releaseRef := &FurnitureWorkspaceRelease{
			ID:                   inputs.Release.ID,
			ReleaseNumber:        inputs.Release.ReleaseNumber,
			DesignRevisionID:     inputs.Release.DesignRevisionID,
			DesignRevisionNumber: inputs.Release.DesignRevisionNumber,
			QuoteRevisionID:      inputs.Release.QuoteRevisionID,
			ManufacturingStale:   inputs.ReleaseStale,
		}
		if inputs.ReleaseCurrent != nil {
			releaseRef.CurrentDesignRevisionID = inputs.ReleaseCurrent.CurrentDesignRevisionID
			releaseRef.CurrentDesignRevisionNumber = inputs.ReleaseCurrent.CurrentDesignRevisionNumber
		}
		workspace.LatestProjectRelease = releaseRef

		// Blocker 3: Release belongs to the selected context ONLY when pins match exact revisions:
		// - DesignContextKind MUST be revision (working copy never claims a contextual release)
		// - DesignRevisionID must match exactly
		// - If Quote is selected, QuoteRevisionID must match (or release has no quoteRevisionId)
		// - If Release specifies a QuoteRevisionID, Quote must be selected and match
		isContextual := inputs.DesignContextKind == FurnitureWorkspaceContextRevision &&
			inputs.DesignRevisionID != "" &&
			inputs.Release.DesignRevisionID == inputs.DesignRevisionID

		if isContextual && inputs.Release.QuoteRevisionID != "" {
			if inputs.Quote == nil || inputs.Quote.ID != inputs.Release.QuoteRevisionID {
				isContextual = false
			}
		}

		if isContextual {
			workspace.Release = releaseRef
		}
	}

	for _, instance := range ordered {
		design := FurnitureWorkspaceDesign{
			Presence:         FurnitureWorkspaceDesignPresenceNone,
			ContextKind:      inputs.DesignContextKind,
			DesignID:         workspace.DesignContext.DesignID,
			DesignRevisionID: inputs.DesignRevisionID,
		}
		if hasDesignContext {
			if placedIDs[instance.ID] {
				design.Presence = FurnitureWorkspaceDesignPresencePlaced
			} else {
				design.Presence = FurnitureWorkspaceDesignPresencePending
			}
		}

		commercial := FurnitureWorkspaceCommercial{}
		if item, ok := quoteItems[instance.ID]; ok {
			commercial.Present = true
			commercial.LifecycleStatus = item.LifecycleStatus
		}

		// Action priority: a non-synced server reconciliation wins; otherwise
		// a pending placement in the selected design context.
		var action *FurnitureWorkspaceAction
		if item, ok := reconciliationByID[instance.ID]; ok && item.Status != ReconciliationStatusSynced {
			if actionCopy, found := furnitureWorkspaceActionCopy[string(item.Status)]; found {
				action = &FurnitureWorkspaceAction{
					Code:        string(item.Status),
					Message:     actionCopy.Message,
					Remediation: actionCopy.Remediation,
				}
			}
		} else if design.Presence == FurnitureWorkspaceDesignPresencePending {
			actionCopy := furnitureWorkspaceActionCopy[FurnitureWorkspaceActionPendingPlacement]
			action = &FurnitureWorkspaceAction{
				Code:        FurnitureWorkspaceActionPendingPlacement,
				Message:     actionCopy.Message,
				Remediation: actionCopy.Remediation,
			}
		}

		var reconciliation *ReconciliationItem
		if item, ok := reconciliationByID[instance.ID]; ok {
			itemCopy := item
			reconciliation = &itemCopy
		}

		// Blocker 2: commercialGrouping comes strictly from QuoteLine provenance.
		var commercialGrouping *FurnitureWorkspaceCommercialGrouping
		if g, ok := inputs.CommercialGroupingByInstance[instance.ID]; ok {
			gCopy := g
			if inputs.Quote != nil {
				gCopy.QuoteRevisionID = inputs.Quote.ID
			}
			commercialGrouping = &gCopy
		}

		workspace.Units = append(workspace.Units, FurnitureWorkspaceUnit{
			Instance:           instance,
			Commercial:         commercial,
			Design:             design,
			CommercialGrouping: commercialGrouping,
			ActionRequired:     action,
			Reconciliation:     reconciliation,
		})

		workspace.Summary.Total++
		if instance.LifecycleStatus == FurnitureInstanceLifecycleActive {
			workspace.Summary.ActiveUnits++
		}
		if instance.LifecycleStatus == FurnitureInstanceLifecycleRemoved {
			workspace.Summary.Removed++
		}
		if instance.LifecycleStatus == FurnitureInstanceLifecycleCancelled {
			workspace.Summary.Cancelled++
		}
		if commercial.Present {
			workspace.Summary.Quoted++
		}
		if design.Presence == FurnitureWorkspaceDesignPresencePlaced {
			workspace.Summary.Placed++
		}
		if design.Presence == FurnitureWorkspaceDesignPresencePending {
			workspace.Summary.Pending++
		}
		if action != nil {
			workspace.Summary.ActionRequired++
		}
	}

	return workspace
}

// Presence vocabulary constants (mirror the generated enum).
const (
	FurnitureWorkspaceDesignPresenceNone    = "none"
	FurnitureWorkspaceDesignPresencePlaced  = "placed"
	FurnitureWorkspaceDesignPresencePending = "pending"
)
