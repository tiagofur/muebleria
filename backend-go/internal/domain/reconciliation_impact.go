package domain

import (
	"fmt"
	"strings"
)

// #394 / DT-10: semantic impact classification over the exact #393
// ReconciliationResult (ADR-0003, digital-thread §§15–16, 25, 28, 30–31).
//
// Classification ANSWERS "what kind of impact does each detected change have"
// and never re-compares the quote and design snapshots: Reconcile (#393) is
// the single comparison authority, so classification cannot drift from it.
// An item may carry several impacts at once (e.g. a width change is both
// commercial and manufacturing); impacts are NOT a mutually exclusive enum.
//
// Semantic groups (digital-thread §15 fingerprints, implemented as the
// normalized comparison contract over StructuredDifference paths):
//
//	commercial    — may change what is sold, how much is sold, or what should
//	                be charged (price / commercial scope).
//	manufacturing — may change what will eventually have to be fabricated
//	                (V1 boundary: definition, version, parameters and material
//	                choices are the inputs that fully determine BOM resolution;
//	                the authoritative resolved-BOM fingerprint arrives with the
//	                preflight/release slice #395 and will extend this group).
//	spatial       — placement-only change (transform / room) that does not
//	                touch commercial or manufacturing truth. Only classifiable
//	                when BOTH snapshots carried explicit spatial evidence;
//	                #394 never invents it (digital-thread §15, #393 §42).

// ChangeImpact is the non-exclusive set of semantic impacts of one difference
// or one reconciliation item.
type ChangeImpact struct {
	Commercial    bool `json:"commercial"`
	Manufacturing bool `json:"manufacturing"`
	Spatial       bool `json:"spatial"`
}

// IsZero reports whether the impact carries no semantic change.
func (c ChangeImpact) IsZero() bool {
	return !c.Commercial && !c.Manufacturing && !c.Spatial
}

// ImpactClassificationItem is the per-FurnitureInstance classification result.
type ImpactClassificationItem struct {
	FurnitureInstanceID string               `json:"furnitureInstanceId"`
	Status              ReconciliationStatus `json:"status"`
	Impact              ChangeImpact         `json:"impact"`
}

// ImpactClassificationSummary aggregates the classification strictly derived
// from the classified items.
type ImpactClassificationSummary struct {
	// RequiresRequote derives from commercial impacts only: a commercial
	// change means the sold scope/price may have moved and the user should
	// explicitly decide whether to create a new draft QuoteRevision. It is
	// NEVER a user-set flag and is false for spatial-only or
	// manufacturing-only changes.
	RequiresRequote bool `json:"requiresRequote"`
	// RequiresResolution is true when reconciliation reported conflicts:
	// there is no reliable truth to turn into a quote until they are fixed.
	RequiresResolution bool `json:"requiresResolution"`
	// CanRequote is false exactly when conflicts block the explicit requote
	// flow (fail-closed: conflict never produces an automatic requote).
	CanRequote          bool `json:"canRequote"`
	CommercialChanges   int  `json:"commercialChanges"`
	ManufacturingChanges int `json:"manufacturingChanges"`
	SpatialChanges      int  `json:"spatialChanges"`
}

// ImpactClassificationResult is the full deterministic classification of a
// ReconciliationResult.
type ImpactClassificationResult struct {
	ProjectID        string                       `json:"projectId"`
	QuoteRevisionID  string                       `json:"quoteRevisionId"`
	DesignRevisionID string                       `json:"designRevisionId"`
	Summary          ImpactClassificationSummary `json:"summary"`
	Items            []ImpactClassificationItem  `json:"items"`
}

// Difference-path prefixes of the normalized commercial / manufacturing
// comparison contract. Every path Reconcile can emit is classified by
// ClassifyDifferencePath; unknown paths fail closed as
// commercial+manufacturing so a future comparison extension can never be
// silently ignored.
const (
	diffPathDefinitionID   = "furnitureDefinitionId"
	diffPathDefinitionVer  = "definitionVersion"
	diffPathParamPrefix    = "parameters."
	diffPathMaterialPrefix = "materialChoices."
	diffPathTransformPre   = "transform."
	diffPathRoom           = "room"
)

// NoImpact is the zero classification used for statuses that carry no
// semantic change of their own.
var NoImpact = ChangeImpact{}

// CommercialAndManufacturingImpact classifies paths that change the sold
// product configuration and therefore both what is charged and what must be
// fabricated.
var CommercialAndManufacturingImpact = ChangeImpact{Commercial: true, Manufacturing: true}

// CommercialOnlyImpact classifies changes that affect the commercial scope
// without asserting a manufacturing delta (e.g. a unit that is sold but
// absent from the published design: manufacturing truth comes from design,
// and design carries no delta for it).
var CommercialOnlyImpact = ChangeImpact{Commercial: true}

// spatialOnly classifies placement-affecting paths (transform / room) that
// leave commercial and manufacturing truth untouched.
func spatialOnly() ChangeImpact { return ChangeImpact{Spatial: true} }

// ClassifyDifferencePath maps one normalized StructuredDifference path to its
// semantic impact groups. This is the SINGLE classification policy shared by
// backend and (via the generated contract) any surface that needs to explain
// WHY a change has an impact — UI conditionals must not fork it.
func ClassifyDifferencePath(path string) ChangeImpact {
	switch {
	case path == diffPathDefinitionID, path == diffPathDefinitionVer:
		return CommercialAndManufacturingImpact
	case strings.HasPrefix(path, diffPathParamPrefix):
		return CommercialAndManufacturingImpact
	case strings.HasPrefix(path, diffPathMaterialPrefix):
		return CommercialAndManufacturingImpact
	case strings.HasPrefix(path, diffPathTransformPre), path == diffPathRoom:
		return spatialOnly()
	default:
		// Fail-closed: an unrecognized difference may affect price and BOM;
		// it must never be classified as harmless.
		return CommercialAndManufacturingImpact
	}
}

// classifyStatusImpact assigns the status-level impact for items whose
// semantic does not come from per-path differences.
func classifyStatusImpact(status ReconciliationStatus) ChangeImpact {
	switch status {
	case ReconciliationStatusModeledNotQuoted:
		// A modeled unit missing from the commercial snapshot changes the
		// sold scope (pending quote) and will eventually be fabricated.
		return ChangeImpact{Commercial: true, Manufacturing: true}
	case ReconciliationStatusQuotedNotModeled:
		// A sold unit absent from the published design is commercially
		// visible (pending placement); manufacturing truth lives in the
		// design, which reports no delta for it.
		return CommercialOnlyImpact
	default:
		// synced (nothing changed), removed (already reflected in the quote
		// snapshot itself) and conflict (no reliable truth — handled through
		// RequiresResolution/CanRequote) carry no per-item impact.
		return NoImpact
	}
}

// ClassifyReconciliation classifies an exact #393 ReconciliationResult into
// commercial / manufacturing / spatial impacts per FurnitureInstance plus the
// derived requote decision summary. Pure and deterministic: it only reads the
// reconciliation output and never re-compares the underlying snapshots.
func ClassifyReconciliation(recon *ReconciliationResult) (*ImpactClassificationResult, error) {
	if recon == nil {
		return nil, ErrInvalidRevisionSnapshot
	}
	if recon.ProjectID == "" {
		return nil, ErrMissingProjectID
	}
	if recon.QuoteRevisionID == "" || recon.DesignRevisionID == "" {
		return nil, ErrInvalidRevisionID
	}

	items := make([]ImpactClassificationItem, 0, len(recon.Items))
	summary := ImpactClassificationSummary{CanRequote: true}

	for _, item := range recon.Items {
		impact := classifyStatusImpact(item.Status)
		for _, diff := range item.Differences {
			diffImpact := ClassifyDifferencePath(diff.Path)
			impact.Commercial = impact.Commercial || diffImpact.Commercial
			impact.Manufacturing = impact.Manufacturing || diffImpact.Manufacturing
			impact.Spatial = impact.Spatial || diffImpact.Spatial
		}
		if item.Status == ReconciliationStatusModified && len(item.Differences) == 0 {
			// Reconcile never emits modified without differences; treat the
			// inconsistency as corrupt input instead of guessing.
			return nil, fmt.Errorf("%w: modified item %s without differences", ErrInvalidRevisionSnapshot, item.FurnitureInstanceID)
		}

		items = append(items, ImpactClassificationItem{
			FurnitureInstanceID: item.FurnitureInstanceID,
			Status:              item.Status,
			Impact:              impact,
		})

		if impact.Commercial {
			summary.CommercialChanges++
		}
		if impact.Manufacturing {
			summary.ManufacturingChanges++
		}
		if impact.Spatial {
			summary.SpatialChanges++
		}
		if item.Status == ReconciliationStatusConflict {
			summary.RequiresResolution = true
			summary.CanRequote = false
		}
	}

	// requiresRequote is DERIVED, never stored as an independent flag and
	// never user-set: it exists exactly when a commercial impact exists.
	summary.RequiresRequote = summary.CommercialChanges > 0

	return &ImpactClassificationResult{
		ProjectID:        recon.ProjectID,
		QuoteRevisionID:  recon.QuoteRevisionID,
		DesignRevisionID: recon.DesignRevisionID,
		Summary:          summary,
		Items:            items,
	}, nil
}
