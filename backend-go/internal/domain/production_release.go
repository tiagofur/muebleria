package domain

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"
)

// #395 / DT-11: ProductionRelease pinned to the exact approved DesignRevision
// and the authoritative manufacturing fingerprint validated at release time
// (ADR-0003, digital-thread §§17, 21–23, 25.6, invariant I6).
//
// Production never executes "the latest design": a release is an immutable
// historical pin. Publishing newer revisions afterwards neither mutates nor
// retargets it (§25.6, §26-7); new production requires approving the new
// revision and creating a NEW release through the same gates.

// ProductionReleaseStatus is the release lifecycle. V1 has a single state:
// a release exists and is authoritative history forever (revocation is not
// part of this slice and would be a new transition, never a mutation).
type ProductionReleaseStatus string

const (
	ProductionReleaseStatusActive ProductionReleaseStatus = "active"
)

// ProductionRelease is the canonical Digital Thread release record (#395 / I6).
// The legacy client-authored blob on projects (LegacyProductionRelease, OC-022)
// is untouched legacy state; this is the server-authoritative aggregate.
type ProductionRelease struct {
	ID                       string                  `json:"id"`
	ProjectID                string                  `json:"project_id"`
	DesignRevisionID         string                  `json:"design_revision_id"`
	QuoteRevisionID          string                  `json:"quote_revision_id,omitempty"`
	ReleaseNumber            int                     `json:"release_number"`
	DesignRevisionNumber     int                     `json:"design_revision_number"`
	ManufacturingFingerprint string                  `json:"manufacturing_fingerprint"`
	Status                   ProductionReleaseStatus `json:"status"`
	ReleasedBy               string                  `json:"released_by"`
	ReleasedAt               time.Time               `json:"released_at"`

	OrganizationID string `json:"-"`
}

var (
	// ErrDesignRevisionNotApproved: production may only be released against an
	// explicitly approved revision — published alone never authorizes it (§17).
	ErrDesignRevisionNotApproved = errors.New("design revision is not approved for production release")
	// ErrReleaseQuoteNotAccepted: a commercial baseline that was never accepted
	// cannot ground production.
	ErrReleaseQuoteNotAccepted = errors.New("quote revision is not accepted")
	// ErrReleaseNotFound and ErrCrossProjectRelease keep release reads uniform
	// with the digital-thread 404 policy (missing and foreign are the same).
	ErrReleaseNotFound       = errors.New("production release not found")
	ErrCrossProjectRelease   = errors.New("production release does not belong to the project")
	ErrInvalidReleaseCommand = errors.New("invalid production release command")
)

// ---------------------------------------------------------------------------
// Manufacturing fingerprint
// ---------------------------------------------------------------------------

// ManufacturingFingerprintSchemaID versions the canonical payload so a future
// extension can never collide with a v1 fingerprint.
const ManufacturingFingerprintSchemaID = "granete.production-manufacturing-fingerprint.v1"

// manufacturingFingerprintBody is the canonical manufacturing-affecting content
// of one revision item. It deliberately mirrors the #394 manufacturing impact
// group (definition, version, parameters, material choices) and deliberately
// EXCLUDES transform/room: a spatial-only change fabricates the same product
// and must not imply manufacturing staleness (digital-thread §25 / #394).
type manufacturingFingerprintBody struct {
	FurnitureInstanceID   string            `json:"furnitureInstanceId"`
	FurnitureDefinitionID string            `json:"furnitureDefinitionId"`
	DefinitionVersion     *int              `json:"definitionVersion"`
	Parameters            map[string]any    `json:"parameters"`
	MaterialChoices       map[string]string `json:"materialChoices"`
}

// ManufacturingFingerprint derives the deterministic, server-authoritative
// fingerprint of the exact manufacturing inputs of a DesignRevision
// ("sha256-<64hex>", same representation family as the engine fingerprints).
//
// AUTHORITY NOTE (PR #551 review, #395 §18): this IS the canonical
// manufacturing baseline a ProductionRelease pins, at revision granularity.
// No revision-level fingerprint existed before #395 — the engine's
// authoringManufacturingFingerprint (#477) covers a single furniture RESOLVE
// envelope (occurrences/relationships never persisted per revision item), the
// #347 relationshipBomFingerprint is TS-only over resolved placements, and
// the legacy bomFingerprint is a client token, not a hash. #394 reserved
// exactly this contract for the release slice (reconciliation_impact.go).
// The payload is schema-versioned so the resolved manufacturing state those
// outputs consume (per-item #477 fingerprints, industrial rules revision,
// machining/features) EXTENDS this baseline in later slices instead of
// forking a parallel hash namespace.
//
// Pure: identical items always produce the identical fingerprint, independent
// of item order, transform/room placement and timestamps.
func ManufacturingFingerprint(items []DesignRevisionItem) (string, error) {
	bodies := make([]manufacturingFingerprintBody, 0, len(items))
	for _, item := range items {
		parameters := item.Parameters
		if parameters == nil {
			parameters = map[string]any{}
		}
		materials := item.MaterialChoices
		if materials == nil {
			materials = map[string]string{}
		}
		bodies = append(bodies, manufacturingFingerprintBody{
			FurnitureInstanceID:   item.FurnitureInstanceID,
			FurnitureDefinitionID: item.FurnitureDefinitionID,
			DefinitionVersion:     item.DefinitionVersion,
			Parameters:            parameters,
			MaterialChoices:       materials,
		})
	}
	// Sort by the stable business identity so snapshot row order never matters.
	sort.SliceStable(bodies, func(i, j int) bool {
		return bodies[i].FurnitureInstanceID < bodies[j].FurnitureInstanceID
	})

	raw, err := json.Marshal(map[string]any{
		"schema": ManufacturingFingerprintSchemaID,
		"items":  bodies,
	})
	if err != nil {
		return "", fmt.Errorf("%w: manufacturing fingerprint: %v", ErrSerializationFailed, err)
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("sha256-%x", sum), nil
}

// ---------------------------------------------------------------------------
// Authoritative manufacturing preflight
// ---------------------------------------------------------------------------

// ManufacturingPreflightScope names this release-scoped validation. It reuses
// the single authoritative per-item contracts (catalog definition existence +
// EvaluateFurnitureParameters) — it is deliberately NOT a parallel preflight
// engine (§16: no PreflightV2).
const ManufacturingPreflightScope = "production-release-v1"

type ManufacturingPreflightStatus string

const (
	ManufacturingPreflightReady   ManufacturingPreflightStatus = "ready"
	ManufacturingPreflightBlocked ManufacturingPreflightStatus = "blocked"
)

type ManufacturingPreflightItemStatus string

const (
	ManufacturingPreflightItemOK      ManufacturingPreflightItemStatus = "ok"
	ManufacturingPreflightItemBlocked ManufacturingPreflightItemStatus = "blocked"
)

// Preflight issue codes — exactly the blockers the current contracts expose;
// no invented gates (#395 §17).
type ManufacturingPreflightIssueCode string

const (
	PreflightIssueEmptyRevision      ManufacturingPreflightIssueCode = "empty_revision"
	PreflightIssueDuplicateInstance  ManufacturingPreflightIssueCode = "duplicate_instance"
	PreflightIssueMissingDefinition  ManufacturingPreflightIssueCode = "missing_definition"
	PreflightIssueInvalidParameters  ManufacturingPreflightIssueCode = "invalid_parameters"
	PreflightIssueInvalidMaterialUse ManufacturingPreflightIssueCode = "invalid_material_choice"
)

type ManufacturingPreflightIssue struct {
	Code                  ManufacturingPreflightIssueCode `json:"code"`
	FurnitureInstanceID   string                          `json:"furnitureInstanceId,omitempty"`
	FurnitureDefinitionID string                          `json:"furnitureDefinitionId,omitempty"`
	Parameter             string                          `json:"parameter,omitempty"`
	Message               string                          `json:"message"`
}

type ManufacturingPreflightItem struct {
	FurnitureInstanceID   string                           `json:"furnitureInstanceId"`
	FurnitureDefinitionID string                           `json:"furnitureDefinitionId"`
	Status                ManufacturingPreflightItemStatus `json:"status"`
	Issues                []ManufacturingPreflightIssue    `json:"issues,omitempty"`
}

type ManufacturingPreflightResult struct {
	DesignRevisionID string                        `json:"designRevisionId"`
	Scope            string                        `json:"scope"`
	Status           ManufacturingPreflightStatus  `json:"status"`
	Items            []ManufacturingPreflightItem  `json:"items"`
	Issues           []ManufacturingPreflightIssue `json:"issues,omitempty"`
}

// FurnitureDefinitionParameters is the authoritative per-definition parameter
// contract the preflight validates against (loaded from the organization
// catalog by the storage layer; the domain stays pure). ContractInvalid marks
// a definition whose persisted parameter contract fails to decode: the
// preflight fail-closes the items referencing it instead of guessing.
type FurnitureDefinitionParameters struct {
	ParameterDefinitions []FurnitureParameterDefinition
	ContractInvalid      bool
}

// ProjectFurnitureDimensionParameters returns the dimension-column parameter
// contract the catalog adapter projects onto every module (#483): persisted
// modules never store width/height/depth (IsReservedFurnitureDimensionName);
// the published contract a consumer validates against is the persisted
// definitions PLUS this projection. The release preflight validates against
// exactly that combined contract — never against the persisted list alone,
// which would fail-close every legacy module's dimensions.
func ProjectFurnitureDimensionParameters() []FurnitureParameterDefinition {
	dimension := func(name, label string) FurnitureParameterDefinition {
		return FurnitureParameterDefinition{
			Name:     name,
			Label:    label,
			Type:     FurnitureParameterTypeNumber,
			Unit:     FurnitureParameterUnitMM,
			Integer:  true,
			Category: FurnitureParameterCategoryDimension,
			Binding: &FurnitureParameterBinding{
				Version:   FurnitureParameterBindingVersion,
				Kind:      FurnitureParameterBindingDimensionColumn,
				Dimension: name,
			},
		}
	}
	return []FurnitureParameterDefinition{
		dimension("widthMm", "Ancho"),
		dimension("heightMm", "Alto"),
		dimension("depthMm", "Profundidad"),
	}
}

// RunManufacturingPreflight validates the exact DesignRevision items against
// the organization catalog: every unit must reference an existing furniture
// definition and satisfy its authoritative parameter contract. Deterministic
// and fail-closed: any issue blocks the whole release (§17: a blocked preflight
// means zero fabricable output, not a partial release).
//
// AUTHORITY NOTE (PR #551 review, #395 §16): this is the ONE server-side
// manufacturing preflight for the release gate — it does NOT re-implement
// existing rules: parameter semantics delegate entirely to
// EvaluateFurnitureParameters (the single #483 parameter authority) and
// definition existence to the organization catalog. The #347 full preflight
// owns fabrication-readiness of RESOLVED machining envelopes (capabilities,
// drilling, machine negotiation; TS, not yet wired server-side) and the
// authoring-resolve subset owns authoring envelopes — different inputs, no
// overlapping blocker semantics. When resolved machining state becomes
// persistable per revision (#397/#398/#503 path), it extends THIS gate; no
// second release preflight may appear beside it.
func RunManufacturingPreflight(revisionID string, items []DesignRevisionItem, definitions map[string]FurnitureDefinitionParameters) *ManufacturingPreflightResult {
	result := &ManufacturingPreflightResult{
		DesignRevisionID: revisionID,
		Scope:            ManufacturingPreflightScope,
		Status:           ManufacturingPreflightReady,
		Items:            make([]ManufacturingPreflightItem, 0, len(items)),
	}

	if len(items) == 0 {
		result.Status = ManufacturingPreflightBlocked
		result.Issues = append(result.Issues, ManufacturingPreflightIssue{
			Code:    PreflightIssueEmptyRevision,
			Message: "the design revision carries no furniture to manufacture",
		})
		return result
	}

	seen := make(map[string]bool, len(items))
	for _, item := range items {
		preflightItem := ManufacturingPreflightItem{
			FurnitureInstanceID:   item.FurnitureInstanceID,
			FurnitureDefinitionID: item.FurnitureDefinitionID,
			Status:                ManufacturingPreflightItemOK,
		}
		block := func(issue ManufacturingPreflightIssue) {
			preflightItem.Status = ManufacturingPreflightItemBlocked
			preflightItem.Issues = append(preflightItem.Issues, issue)
			result.Issues = append(result.Issues, issue)
		}

		if item.FurnitureInstanceID == "" {
			block(ManufacturingPreflightIssue{
				Code:    PreflightIssueDuplicateInstance,
				Message: "revision item carries no furniture instance identity",
			})
		} else if seen[item.FurnitureInstanceID] {
			block(ManufacturingPreflightIssue{
				Code:                PreflightIssueDuplicateInstance,
				FurnitureInstanceID: item.FurnitureInstanceID,
				Message:             "furniture instance appears more than once in the revision",
			})
		}
		seen[item.FurnitureInstanceID] = true

		definition, found := definitions[item.FurnitureDefinitionID]
		if !found {
			block(ManufacturingPreflightIssue{
				Code:                  PreflightIssueMissingDefinition,
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Message:               "furniture definition does not exist in the organization catalog",
			})
		} else if definition.ContractInvalid {
			block(ManufacturingPreflightIssue{
				Code:                  PreflightIssueInvalidParameters,
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Message:               "furniture definition parameter contract is invalid",
			})
		} else {
			provided := item.Parameters
			if provided == nil {
				provided = map[string]any{}
			}
			// Published contract = persisted definitions + the dimension
			// projection (#483): legacy modules validate their width/height/
			// depth overrides, and unknown parameter names still fail closed.
			contract := make([]FurnitureParameterDefinition, 0, len(definition.ParameterDefinitions)+3)
			contract = append(contract, definition.ParameterDefinitions...)
			contract = append(contract, ProjectFurnitureDimensionParameters()...)
			_, issues, err := EvaluateFurnitureParameters(contract, provided)
			if err != nil {
				block(ManufacturingPreflightIssue{
					Code:                  PreflightIssueInvalidParameters,
					FurnitureInstanceID:   item.FurnitureInstanceID,
					FurnitureDefinitionID: item.FurnitureDefinitionID,
					Message:               fmt.Sprintf("furniture definition parameter contract is invalid: %v", err),
				})
			} else {
				for _, issue := range issues {
					block(ManufacturingPreflightIssue{
						Code:                  PreflightIssueInvalidParameters,
						FurnitureInstanceID:   item.FurnitureInstanceID,
						FurnitureDefinitionID: item.FurnitureDefinitionID,
						Parameter:             issue.Parameter,
						Message:               string(issue.Code) + ": " + issue.Message,
					})
				}
			}
		}

		for slot, material := range item.MaterialChoices {
			if slot == "" || material == "" {
				block(ManufacturingPreflightIssue{
					Code:                  PreflightIssueInvalidMaterialUse,
					FurnitureInstanceID:   item.FurnitureInstanceID,
					FurnitureDefinitionID: item.FurnitureDefinitionID,
					Parameter:             slot,
					Message:               "material choice carries an empty slot or value",
				})
			}
		}

		result.Items = append(result.Items, preflightItem)
	}

	if len(result.Issues) > 0 {
		result.Status = ManufacturingPreflightBlocked
	}
	return result
}

// ---------------------------------------------------------------------------
// Release gates
// ---------------------------------------------------------------------------

// ReleaseBlockerCode names why a release gate rejected the command. These are
// derived server-side inside the release transaction — client claims are
// never input (#395 §§13–15, 33).
type ReleaseBlockerCode string

const (
	ReleaseBlockerReconciliationConflict ReleaseBlockerCode = "reconciliation_conflict"
	ReleaseBlockerCommercialOutdated     ReleaseBlockerCode = "commercial_baseline_outdated"
	ReleaseBlockerPreflight              ReleaseBlockerCode = "manufacturing_preflight_blocked"
)

// ReleasePreflightBlockedError carries the authoritative preflight result so
// the API can answer with the exact blockers, not a generic refusal.
type ReleasePreflightBlockedError struct {
	Result *ManufacturingPreflightResult
}

func (e *ReleasePreflightBlockedError) Error() string {
	return fmt.Sprintf("manufacturing preflight blocked the release with %d issue(s)", len(e.Result.Issues))
}

// ReleaseCommercialGateError carries the #394 classification that blocked the
// release: either conflicts (no reliable truth) or commercial changes still
// pending their explicit requote (the chosen baseline no longer reflects the
// revision being released).
type ReleaseCommercialGateError struct {
	Classification *ImpactClassificationResult
	Cause          ReleaseBlockerCode
}

func (e *ReleaseCommercialGateError) Error() string {
	if e.Cause == ReleaseBlockerReconciliationConflict {
		return "reconciliation conflicts block the production release"
	}
	return "the commercial baseline is outdated for this design revision: incorporate the design changes through an explicit re-quote first"
}

// EvaluateReleaseCommercialGate applies the §17 reconciliation gate over the
// exact #393/#394 classification: conflicts block always (no reliable truth),
// and commercial impacts block while the baseline does not reflect the design
// revision being released (§15: no demo exception skips the gate). A clean or
// spatial-only classification releases: a pure move never reopens commerce.
func EvaluateReleaseCommercialGate(classification *ImpactClassificationResult) error {
	if classification == nil {
		return nil // design-first release without commercial baseline
	}
	if classification.Summary.RequiresResolution {
		return &ReleaseCommercialGateError{Classification: classification, Cause: ReleaseBlockerReconciliationConflict}
	}
	if classification.Summary.RequiresRequote {
		return &ReleaseCommercialGateError{Classification: classification, Cause: ReleaseBlockerCommercialOutdated}
	}
	return nil
}

// ResolvedProductionRelease is the ONE release-authority shape the productive
// subsystems consume (material planning, job costing, quality and the part
// execution guards). The canonical #395 ProductionRelease maps onto it
// directly — its ManufacturingFingerprint travels under its own name, never
// through a legacy BOMFingerprint field. The pre-DT OC-022 blob maps onto it
// ONLY inside ResolveLegacyProductionRelease, the single adapter where the
// old BOMFingerprint token is accepted as the compatibility
// ManufacturingFingerprint. Productive code beyond that adapter never reads
// BOMFingerprint.
type ResolvedProductionRelease struct {
	ReleaseID                string
	DesignRevisionID         string
	ManufacturingFingerprint string
	ReleasedBy               string
	ReleasedAt               time.Time
	// ProjectVersion survives only as a legacy-origin attribute so pre-DT
	// costing baselines keep freezing it; the canonical authority pins
	// identity by ReleaseID + ManufacturingFingerprint and carries 0.
	ProjectVersion int
}

// ResolvedFromCanonicalRelease maps the canonical release onto the consumer
// authority shape. Exact pins, exact fingerprint, no intermediate legacy
// field.
func ResolvedFromCanonicalRelease(canonical *ProductionRelease) *ResolvedProductionRelease {
	return &ResolvedProductionRelease{
		ReleaseID:                canonical.ID,
		DesignRevisionID:         canonical.DesignRevisionID,
		ManufacturingFingerprint: canonical.ManufacturingFingerprint,
		ReleasedBy:               canonical.ReleasedBy,
		ReleasedAt:               canonical.ReleasedAt,
	}
}

// ResolveLegacyProductionRelease is the ONLY adapter in productive code that
// reads the legacy OC-022 BOMFingerprint: for pre-DT projects (no canonical
// release) the old client token rides the ManufacturingFingerprint slot as
// compatibility state. The equivalence lives here and nowhere else.
func ResolveLegacyProductionRelease(legacy *LegacyProductionRelease) *ResolvedProductionRelease {
	if legacy == nil {
		return nil
	}
	return &ResolvedProductionRelease{
		ReleaseID:                legacy.ID,
		DesignRevisionID:         legacy.DesignRevisionID,
		ManufacturingFingerprint: legacy.BOMFingerprint,
		ReleasedBy:               legacy.ReleasedBy,
		ReleasedAt:               legacy.ReleasedAt,
		ProjectVersion:           legacy.ProjectVersion,
	}
}

// ProductionReleaseStaleness is the derived, read-only projection of a release
// against current authoring state (§24): stale is information, never a
// mutation — the release keeps pointing at its exact revisions/fingerprint.
// ManufacturingStale compares fingerprints, not revision numbers, so a
// spatial-only newer revision does not flag the release stale (§25).
type ProductionReleaseStaleness struct {
	ManufacturingStale          bool   `json:"manufacturingStale"`
	CurrentDesignRevisionID     string `json:"currentDesignRevisionId,omitempty"`
	CurrentDesignRevisionNumber int    `json:"currentDesignRevisionNumber,omitempty"`
}
