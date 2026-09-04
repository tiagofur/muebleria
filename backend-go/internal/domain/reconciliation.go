package domain

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// (ADR-0003, digital-thread §§15–16, 25, 26, 28, 30–31).
//
// Reconciliation is a pure comparison operation between an exact QuoteRevision
// and an exact DesignRevision. It DETECTS differences and NEVER mutates either side.
// Join key is strictly FurnitureInstance.id (physical unit identity).

type ReconciliationStatus string

const (
	ReconciliationStatusSynced           ReconciliationStatus = "synced"
	ReconciliationStatusQuotedNotModeled ReconciliationStatus = "quoted_not_modeled"
	ReconciliationStatusModeledNotQuoted ReconciliationStatus = "modeled_not_quoted"
	ReconciliationStatusModified         ReconciliationStatus = "modified"
	ReconciliationStatusRemoved          ReconciliationStatus = "removed"
	ReconciliationStatusConflict         ReconciliationStatus = "conflict"
)

func IsValidReconciliationStatus(status ReconciliationStatus) bool {
	switch status {
	case ReconciliationStatusSynced,
		ReconciliationStatusQuotedNotModeled,
		ReconciliationStatusModeledNotQuoted,
		ReconciliationStatusModified,
		ReconciliationStatusRemoved,
		ReconciliationStatusConflict:
		return true
	default:
		return false
	}
}

var (
	ErrCrossProjectReconciliation = errors.New("cross-project reconciliation rejected")
	ErrInvalidRevisionID          = errors.New("invalid revision ID")
	ErrMissingProjectID           = errors.New("missing project ID")
	ErrQuoteRevisionNotFound      = errors.New("quote revision not found")
	ErrInvalidRevisionSnapshot    = errors.New("invalid revision snapshot: corrupt or malformed payload")
)

// QuoteRevision represents an immutable commercial revision snapshot entity.
type QuoteRevision struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	ProjectID      string `json:"project_id"`
	RevisionNumber int    `json:"revision_number"`
	Status         string `json:"status"`
	SourceType     string `json:"source_type"`
	Notes          string `json:"notes,omitempty"`
	CreatedBy      string `json:"created_by,omitempty"`
}

// StructuredDifference captures a specific property difference between quote and design.
type StructuredDifference struct {
	Path        string `json:"path"`
	QuoteValue  any    `json:"quoteValue,omitempty"`
	DesignValue any    `json:"designValue,omitempty"`
}

// ReconciliationItem is the unit-level comparison result for one FurnitureInstance.
type ReconciliationItem struct {
	FurnitureInstanceID string                 `json:"furnitureInstanceId"`
	Status              ReconciliationStatus   `json:"status"`
	Differences         []StructuredDifference `json:"differences"`
	Notes               string                 `json:"notes,omitempty"`
}

// ReconciliationSummary aggregates counts strictly derived from the items list.
type ReconciliationSummary struct {
	Total            int `json:"total"`
	Synced           int `json:"synced"`
	QuotedNotModeled int `json:"quotedNotModeled"`
	ModeledNotQuoted int `json:"modeledNotQuoted"`
	Modified         int `json:"modified"`
	Removed          int `json:"removed"`
	Conflict         int `json:"conflict"`
}

// ReconciliationResult is the full deterministic comparison result.
type ReconciliationResult struct {
	ProjectID        string                `json:"projectId"`
	QuoteRevisionID  string                `json:"quoteRevisionId"`
	DesignRevisionID string                `json:"designRevisionId"`
	Summary          ReconciliationSummary `json:"summary"`
	Items            []ReconciliationItem  `json:"items"`
}

// CommercialItemSnapshot is the historical commercial representation of one physical unit in a QuoteRevision.
type CommercialItemSnapshot struct {
	FurnitureInstanceID   string            `json:"furnitureInstanceId"`
	FurnitureDefinitionID string            `json:"furnitureDefinitionId,omitempty"`
	DefinitionVersion     *int              `json:"definitionVersion,omitempty"`
	Parameters            map[string]any    `json:"parameters,omitempty"`
	MaterialChoices       map[string]string `json:"materialChoices,omitempty"`
	LifecycleStatus       string            `json:"lifecycleStatus,omitempty"`
}

// QuoteRevisionSnapshot is the exact commercial revision input.
type QuoteRevisionSnapshot struct {
	ProjectID       string                   `json:"projectId"`
	QuoteRevisionID string                   `json:"quoteRevisionId"`
	Items           []CommercialItemSnapshot `json:"items"`
}

// DesignRevisionSnapshot is the exact design revision input.
type DesignRevisionSnapshot struct {
	ProjectID        string               `json:"projectId"`
	DesignRevisionID string               `json:"designRevisionId"`
	Items            []DesignRevisionItem `json:"items"`
}

// Reconcile performs a pure, deterministic comparison between an exact QuoteRevision
// and an exact DesignRevision.
func Reconcile(quote QuoteRevisionSnapshot, design DesignRevisionSnapshot) (*ReconciliationResult, error) {
	if quote.ProjectID == "" || design.ProjectID == "" {
		return nil, ErrMissingProjectID
	}
	if quote.QuoteRevisionID == "" || design.DesignRevisionID == "" {
		return nil, ErrInvalidRevisionID
	}
	if quote.ProjectID != design.ProjectID {
		return nil, ErrCrossProjectReconciliation
	}

	quoteItemsByID := make(map[string]CommercialItemSnapshot)
	duplicateQuoteIDs := make(map[string]bool)
	malformedQuoteIDs := make(map[string]bool)

	for _, item := range quote.Items {
		trimmedID := strings.TrimSpace(item.FurnitureInstanceID)
		if trimmedID == "" {
			malformedQuoteIDs[item.FurnitureInstanceID] = true
			continue
		}
		if _, exists := quoteItemsByID[trimmedID]; exists {
			duplicateQuoteIDs[trimmedID] = true
		} else {
			quoteItemsByID[trimmedID] = item
		}
	}

	designItemsByID := make(map[string]DesignRevisionItem)
	duplicateDesignIDs := make(map[string]bool)
	malformedDesignIDs := make(map[string]bool)

	for _, item := range design.Items {
		trimmedID := strings.TrimSpace(item.FurnitureInstanceID)
		if trimmedID == "" {
			malformedDesignIDs[item.FurnitureInstanceID] = true
			continue
		}
		if _, exists := designItemsByID[trimmedID]; exists {
			duplicateDesignIDs[trimmedID] = true
		} else {
			designItemsByID[trimmedID] = item
		}
	}

	// Union of all unique furniture instance IDs
	allIDsMap := make(map[string]bool)
	for id := range quoteItemsByID {
		allIDsMap[id] = true
	}
	for id := range designItemsByID {
		allIDsMap[id] = true
	}
	for id := range duplicateQuoteIDs {
		allIDsMap[id] = true
	}
	for id := range duplicateDesignIDs {
		allIDsMap[id] = true
	}

	allIDs := make([]string, 0, len(allIDsMap))
	for id := range allIDsMap {
		allIDs = append(allIDs, id)
	}
	// Deterministic ordering by furnitureInstanceId
	sort.Strings(allIDs)

	items := make([]ReconciliationItem, 0, len(allIDs))
	summary := ReconciliationSummary{}

	// Handle malformed IDs if any
	for id := range malformedQuoteIDs {
		item := ReconciliationItem{
			FurnitureInstanceID: id,
			Status:              ReconciliationStatusConflict,
			Differences:         []StructuredDifference{},
			Notes:               "malformed furniture instance identity in quote revision snapshot",
		}
		items = append(items, item)
		summary.Conflict++
		summary.Total++
	}
	for id := range malformedDesignIDs {
		item := ReconciliationItem{
			FurnitureInstanceID: id,
			Status:              ReconciliationStatusConflict,
			Differences:         []StructuredDifference{},
			Notes:               "malformed furniture instance identity in design revision snapshot",
		}
		items = append(items, item)
		summary.Conflict++
		summary.Total++
	}

	for _, id := range allIDs {
		// Conflict check: duplicate identity in either snapshot
		if duplicateQuoteIDs[id] || duplicateDesignIDs[id] {
			var reasons []string
			if duplicateQuoteIDs[id] {
				reasons = append(reasons, "duplicate identity in quote revision snapshot")
			}
			if duplicateDesignIDs[id] {
				reasons = append(reasons, "duplicate identity in design revision snapshot")
			}
			recItem := ReconciliationItem{
				FurnitureInstanceID: id,
				Status:              ReconciliationStatusConflict,
				Differences:         []StructuredDifference{},
				Notes:               strings.Join(reasons, "; "),
			}
			items = append(items, recItem)
			summary.Conflict++
			summary.Total++
			continue
		}

		qItem, inQuote := quoteItemsByID[id]
		dItem, inDesign := designItemsByID[id]

		if inQuote && !inDesign {
			// Quoted but not modeled, unless lifecycle status indicates terminal removal
			if qItem.LifecycleStatus == "removed" || qItem.LifecycleStatus == "cancelled" {
				recItem := ReconciliationItem{
					FurnitureInstanceID: id,
					Status:              ReconciliationStatusRemoved,
					Differences:         []StructuredDifference{},
					Notes:               fmt.Sprintf("instance lifecycle is %s", qItem.LifecycleStatus),
				}
				items = append(items, recItem)
				summary.Removed++
				summary.Total++
			} else {
				recItem := ReconciliationItem{
					FurnitureInstanceID: id,
					Status:              ReconciliationStatusQuotedNotModeled,
					Differences:         []StructuredDifference{},
				}
				items = append(items, recItem)
				summary.QuotedNotModeled++
				summary.Total++
			}
			continue
		}

		if !inQuote && inDesign {
			// Modeled in design but not in quote (design-first)
			recItem := ReconciliationItem{
				FurnitureInstanceID: id,
				Status:              ReconciliationStatusModeledNotQuoted,
				Differences:         []StructuredDifference{},
			}
			items = append(items, recItem)
			summary.ModeledNotQuoted++
			summary.Total++
			continue
		}

		// Present in both: check differences
		if qItem.LifecycleStatus == "removed" || qItem.LifecycleStatus == "cancelled" {
			recItem := ReconciliationItem{
				FurnitureInstanceID: id,
				Status:              ReconciliationStatusRemoved,
				Differences:         []StructuredDifference{},
				Notes:               fmt.Sprintf("instance lifecycle is %s", qItem.LifecycleStatus),
			}
			items = append(items, recItem)
			summary.Removed++
			summary.Total++
			continue
		}

		diffs := compareItems(qItem, dItem)
		if len(diffs) > 0 {
			recItem := ReconciliationItem{
				FurnitureInstanceID: id,
				Status:              ReconciliationStatusModified,
				Differences:         diffs,
			}
			items = append(items, recItem)
			summary.Modified++
		} else {
			recItem := ReconciliationItem{
				FurnitureInstanceID: id,
				Status:              ReconciliationStatusSynced,
				Differences:         []StructuredDifference{},
			}
			items = append(items, recItem)
			summary.Synced++
		}
		summary.Total++
	}

	// Deterministic ordering of items
	sort.Slice(items, func(i, j int) bool {
		return items[i].FurnitureInstanceID < items[j].FurnitureInstanceID
	})

	return &ReconciliationResult{
		ProjectID:        quote.ProjectID,
		QuoteRevisionID:  quote.QuoteRevisionID,
		DesignRevisionID: design.DesignRevisionID,
		Summary:          summary,
		Items:            items,
	}, nil
}

func compareItems(quote CommercialItemSnapshot, design DesignRevisionItem) []StructuredDifference {
	var diffs []StructuredDifference

	// 1. Definition comparison (if specified in both)
	qDef := strings.TrimSpace(quote.FurnitureDefinitionID)
	dDef := strings.TrimSpace(design.FurnitureDefinitionID)
	if qDef != "" && dDef != "" && qDef != dDef {
		diffs = append(diffs, StructuredDifference{
			Path:        "furnitureDefinitionId",
			QuoteValue:  qDef,
			DesignValue: dDef,
		})
	}

	// 1b. Definition version comparison (if specified in both)
	if quote.DefinitionVersion != nil && design.DefinitionVersion != nil && *quote.DefinitionVersion != *design.DefinitionVersion {
		diffs = append(diffs, StructuredDifference{
			Path:        "definitionVersion",
			QuoteValue:  *quote.DefinitionVersion,
			DesignValue: *design.DefinitionVersion,
		})
	}

	// 2. Parameters comparison
	paramDiffs := compareParameters(quote.Parameters, design.Parameters)
	diffs = append(diffs, paramDiffs...)

	// 3. Material choices comparison
	matDiffs := compareMaterialChoices(quote.MaterialChoices, design.MaterialChoices)
	diffs = append(diffs, matDiffs...)

	// Note on spatial / transform:
	// Digital-thread §15 and #393 requirement §42:
	// If QuoteRevision does not contain commercial transform, absence of transform in quote
	// is NOT treated as a modification. Only if quote specifically includes transform and it differs,
	// would it be reported. Technical locators (e.g. SketchUp persistent_id) are excluded (rule §37).

	// Sort differences deterministically by path
	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].Path < diffs[j].Path
	})

	return diffs
}

func compareParameters(qParams, dParams map[string]any) []StructuredDifference {
	var diffs []StructuredDifference
	if qParams == nil && dParams == nil {
		return nil
	}

	// Collect all keys
	keysMap := make(map[string]bool)
	for k := range qParams {
		keysMap[k] = true
	}
	for k := range dParams {
		keysMap[k] = true
	}

	keys := make([]string, 0, len(keysMap))
	for k := range keysMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		qVal, qOk := qParams[k]
		dVal, dOk := dParams[k]

		if !qOk || !dOk {
			// If key only in one side, it is a difference
			diffs = append(diffs, StructuredDifference{
				Path:        fmt.Sprintf("parameters.%s", k),
				QuoteValue:  normalizeValue(qVal),
				DesignValue: normalizeValue(dVal),
			})
			continue
		}

		if !valuesEqual(qVal, dVal) {
			diffs = append(diffs, StructuredDifference{
				Path:        fmt.Sprintf("parameters.%s", k),
				QuoteValue:  normalizeValue(qVal),
				DesignValue: normalizeValue(dVal),
			})
		}
	}

	return diffs
}

func compareMaterialChoices(qMats, dMats map[string]string) []StructuredDifference {
	var diffs []StructuredDifference
	if qMats == nil && dMats == nil {
		return nil
	}

	slotsMap := make(map[string]bool)
	for s := range qMats {
		slotsMap[s] = true
	}
	for s := range dMats {
		slotsMap[s] = true
	}

	slots := make([]string, 0, len(slotsMap))
	for s := range slotsMap {
		slots = append(slots, s)
	}
	sort.Strings(slots)

	for _, s := range slots {
		qChoice, qOk := qMats[s]
		dChoice, dOk := dMats[s]

		if !qOk || !dOk || qChoice != dChoice {
			var qVal any
			if qOk {
				qVal = qChoice
			}
			var dVal any
			if dOk {
				dVal = dChoice
			}
			diffs = append(diffs, StructuredDifference{
				Path:        fmt.Sprintf("materialChoices.%s", s),
				QuoteValue:  qVal,
				DesignValue: dVal,
			})
		}
	}

	return diffs
}

func valuesEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	// Numerical normalization: compare numbers as float64 with epsilon
	aNum, aIsNum := toFloat64(a)
	bNum, bIsNum := toFloat64(b)
	if aIsNum && bIsNum {
		return math.Abs(aNum-bNum) < 1e-6
	}

	// String comparison
	aStr, aIsStr := a.(string)
	bStr, bIsStr := b.(string)
	if aIsStr && bIsStr {
		return aStr == bStr
	}

	// Bool comparison
	aBool, aIsBool := a.(bool)
	bBool, bIsBool := b.(bool)
	if aIsBool && bIsBool {
		return aBool == bBool
	}

	// Default string representations
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

func toFloat64(v any) (float64, bool) {
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
	case int16:
		return float64(n), true
	case int8:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint64:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint16:
		return float64(n), true
	case uint8:
		return float64(n), true
	default:
		return 0, false
	}
}

func normalizeValue(v any) any {
	if v == nil {
		return nil
	}
	if num, ok := toFloat64(v); ok {
		// If whole integer, return as int for cleaner JSON
		if num == math.Trunc(num) && !math.IsNaN(num) && !math.IsInf(num, 0) {
			return int64(num)
		}
		return num
	}
	return v
}
