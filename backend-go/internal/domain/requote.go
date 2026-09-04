package domain

import (
	"errors"
	"fmt"
)

// #394 / DT-10: explicit re-quote decision over an exact reconciliation
// (ADR-0003, digital-thread §§16, 25.5, 26).
//
// The new draft QuoteRevision is created ONLY by an explicit user action.
// Reconciliation/classification never writes anything by itself, and the
// accepted source revision is never rewritten: the builder derives the next
// commercial snapshot from the EXACT source QuoteRevision + EXACT
// DesignRevision inputs (#394: client-provided values are never trusted,
// only the inclusion decision is).
//
// Commercial-only mapping (digital-thread §20): the draft snapshot copies
// definition, version, parameters and material choices. Transform, room and
// technical client locators are authoring truth and are NEVER copied into
// the commercial snapshot.

var (
	// ErrRequoteBlockedByConflict: reconciliation conflicts mean there is no
	// reliable truth to turn into a quote. Fail closed — no automatic or
	// partial re-quote (digital-thread §17 gate, #394 §14/§33).
	ErrRequoteBlockedByConflict = errors.New("requote blocked: reconciliation conflicts require resolution first")
	// ErrRequoteNoCommercialChange: spatial-only or fully synced inputs do
	// not justify a new commercial revision (#394 §34/§35).
	ErrRequoteNoCommercialChange = errors.New("requote unnecessary: no commercial changes between quote and design revisions")
	// ErrRequoteInconsistentInput: the reconciliation result does not belong
	// to the provided snapshots.
	ErrRequoteInconsistentInput = errors.New("requote input inconsistent with reconciliation result")
)

// RequotePlan is the decision input: which design-driven commercial changes
// the user explicitly decided to incorporate. A nil Include set incorporates
// ALL design-driven changes; an explicit set incorporates only the listed
// FurnitureInstances (an empty non-nil set therefore incorporates nothing
// and is rejected). The set only gates incorporation of design truth —
// units already sold are always carried over, never silently dropped.
type RequotePlan struct {
	Include map[string]bool
}

// RequoteDraft is the computed next commercial snapshot plus the provenance
// the storage layer must record with the new revision.
type RequoteDraft struct {
	// Items is the next QuoteRevision commercial snapshot, deterministically
	// ordered by FurnitureInstanceID.
	Items []CommercialItemSnapshot
	// IncorporatedInstanceIDs lists the units whose commercial truth was
	// taken from the DesignRevision (modified configuration updates and
	// newly quoted modeled units), in FurnitureInstanceID order.
	IncorporatedInstanceIDs []string
	// Classification is the exact classification that justified the requote.
	Classification *ImpactClassificationResult
}

// BuildRequoteDraft derives the next draft QuoteRevision snapshot from the
// exact source snapshots and their exact reconciliation result.
//
// Rules (digital-thread §§16, 25.5; #394 §§20–24):
//   - synced: carried over verbatim from the quote (identical by definition);
//   - modified with commercial impact AND selected: definition, version,
//     parameters and material choices taken from the design snapshot, same
//     FurnitureInstanceID (identity survives configuration changes);
//   - modified without commercial impact (spatial-only): carried verbatim —
//     there is no commercial truth to incorporate;
//   - modified not selected: quote values kept (explicit user decision);
//   - modeled_not_quoted selected: incorporated from the design with the
//     SAME identity (no new FurnitureInstance is ever minted);
//   - modeled_not_quoted not selected: omitted (still not quoted);
//   - quoted_not_modeled: carried verbatim — a sold unit is never deleted
//     from the commercial snapshot because the design lacks it (it stays
//     pending placement; removal is a separate explicit commercial decision);
//   - removed: carried verbatim with its terminal lifecycle (never
//     resurrected, never dropped from history);
//   - conflict: impossible after the guard — fail closed anyway.
//
// The builder is pure: it deep-copies maps and never mutates its inputs.
func BuildRequoteDraft(quote QuoteRevisionSnapshot, design DesignRevisionSnapshot, recon *ReconciliationResult, plan RequotePlan) (*RequoteDraft, error) {
	if recon == nil {
		return nil, ErrInvalidRevisionSnapshot
	}
	if quote.ProjectID == "" || design.ProjectID == "" {
		return nil, ErrMissingProjectID
	}
	if quote.ProjectID != design.ProjectID || recon.ProjectID != quote.ProjectID {
		return nil, ErrCrossProjectReconciliation
	}
	if quote.QuoteRevisionID == "" || design.DesignRevisionID == "" {
		return nil, ErrInvalidRevisionID
	}
	if recon.QuoteRevisionID != quote.QuoteRevisionID || recon.DesignRevisionID != design.DesignRevisionID {
		return nil, ErrRequoteInconsistentInput
	}

	// Classify server-side from the exact reconciliation: the requote
	// decision may only rely on classification derived here, never on data
	// sent by a client (#394 §31).
	classification, err := ClassifyReconciliation(recon)
	if err != nil {
		return nil, err
	}
	if !classification.Summary.CanRequote {
		return nil, ErrRequoteBlockedByConflict
	}

	quoteItems := make(map[string]CommercialItemSnapshot, len(quote.Items))
	for _, item := range quote.Items {
		quoteItems[item.FurnitureInstanceID] = item
	}
	designItems := make(map[string]DesignRevisionItem, len(design.Items))
	for _, item := range design.Items {
		designItems[item.FurnitureInstanceID] = item
	}
	impactsByID := make(map[string]ChangeImpact, len(classification.Items))
	for _, item := range classification.Items {
		impactsByID[item.FurnitureInstanceID] = item.Impact
	}

	items := make([]CommercialItemSnapshot, 0, len(recon.Items))
	incorporated := []string{}

	for _, recItem := range recon.Items {
		qItem, inQuote := quoteItems[recItem.FurnitureInstanceID]
		dItem, inDesign := designItems[recItem.FurnitureInstanceID]
		if !inQuote && !inDesign {
			return nil, fmt.Errorf("%w: item %s absent from both snapshots", ErrRequoteInconsistentInput, recItem.FurnitureInstanceID)
		}

		switch recItem.Status {
		case ReconciliationStatusSynced:
			items = append(items, cloneCommercialItem(qItem))

		case ReconciliationStatusModified:
			impact := impactsByID[recItem.FurnitureInstanceID]
			selected := plan.Include == nil || plan.Include[recItem.FurnitureInstanceID]
			if !impact.Commercial || !selected {
				// Spatial-only modification, or an explicit user decision to
				// keep the quoted configuration: the commercial truth stays
				// with the quote.
				items = append(items, cloneCommercialItem(qItem))
				continue
			}
			items = append(items, commercialItemFromDesign(dItem))
			incorporated = append(incorporated, recItem.FurnitureInstanceID)

		case ReconciliationStatusModeledNotQuoted:
			selected := plan.Include == nil || plan.Include[recItem.FurnitureInstanceID]
			if !selected {
				continue
			}
			// Same physical unit, now quoted — identity is preserved, never
			// minted (#394 §22).
			items = append(items, commercialItemFromDesign(dItem))
			incorporated = append(incorporated, recItem.FurnitureInstanceID)

		case ReconciliationStatusQuotedNotModeled:
			// Sold unit absent from the design: keep the commercial truth.
			items = append(items, cloneCommercialItem(qItem))

		case ReconciliationStatusRemoved:
			// Terminal lifecycle recorded in the quote snapshot itself:
			// carried verbatim, never resurrected, never dropped.
			items = append(items, cloneCommercialItem(qItem))

		case ReconciliationStatusConflict:
			return nil, ErrRequoteBlockedByConflict

		default:
			return nil, fmt.Errorf("%w: unknown reconciliation status %s", ErrInvalidRevisionSnapshot, recItem.Status)
		}
	}

	if len(incorporated) == 0 {
		// Either nothing commercial changed at all, or the user's selection
		// incorporated no design truth: a new commercial revision identical
		// to its base would be misleading. Fail closed (#394 §34/§35).
		if !classification.Summary.RequiresRequote {
			return nil, ErrRequoteNoCommercialChange
		}
		return nil, fmt.Errorf("%w: the selection incorporates no design changes", ErrRequoteNoCommercialChange)
	}

	return &RequoteDraft{
		Items:                   items,
		IncorporatedInstanceIDs: incorporated,
		Classification:          classification,
	}, nil
}

// commercialItemFromDesign maps an authoring snapshot to the commercial
// snapshot, copying ONLY commercially relevant state. Transform, room and
// technical locators are deliberately dropped (digital-thread §20).
func commercialItemFromDesign(d DesignRevisionItem) CommercialItemSnapshot {
	item := CommercialItemSnapshot{
		FurnitureInstanceID: d.FurnitureInstanceID,
		LifecycleStatus:     "active",
	}
	if d.FurnitureDefinitionID != "" {
		item.FurnitureDefinitionID = d.FurnitureDefinitionID
	}
	if d.DefinitionVersion != nil {
		v := *d.DefinitionVersion
		item.DefinitionVersion = &v
	}
	if len(d.Parameters) > 0 {
		item.Parameters = make(map[string]any, len(d.Parameters))
		for k, v := range d.Parameters {
			item.Parameters[k] = v
		}
	}
	if len(d.MaterialChoices) > 0 {
		item.MaterialChoices = make(map[string]string, len(d.MaterialChoices))
		for k, v := range d.MaterialChoices {
			item.MaterialChoices[k] = v
		}
	}
	return item
}

// cloneCommercialItem deep-copies a snapshot so the builder output shares no
// mutable state with its input. Spatial evidence (transform/room) is
// deliberately stripped: the draft is a commercial snapshot and placement
// data never leaks into it (digital-thread §20).
func cloneCommercialItem(q CommercialItemSnapshot) CommercialItemSnapshot {
	if q.DefinitionVersion != nil {
		v := *q.DefinitionVersion
		q.DefinitionVersion = &v
	}
	params := q.Parameters
	if len(params) > 0 {
		q.Parameters = make(map[string]any, len(params))
		for k, v := range params {
			q.Parameters[k] = v
		}
	}
	materials := q.MaterialChoices
	if len(materials) > 0 {
		q.MaterialChoices = make(map[string]string, len(materials))
		for k, v := range materials {
			q.MaterialChoices[k] = v
		}
	}
	q.Transform = nil
	q.RoomID = ""
	return q
}
