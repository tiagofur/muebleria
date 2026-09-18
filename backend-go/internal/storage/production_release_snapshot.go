package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

var ErrReleaseSnapshotResolution = errors.New("release manufacturing resolution failed")

// Schema v1 froze BOM/material demand only; v2 additionally freezes the
// machine-neutral routing/machining program (#577). v1 snapshots stay
// readable forever and keep failing closed for physical execution.
var ErrReleaseRoutingUnavailable = errors.New("CONFLICT:" + domain.CanonicalPartExecutionRoutingBlocker)

var ErrReleaseSnapshotUnavailable = errors.New("CONFLICT:el snapshot de fabricación exacto no está disponible")

// Private frozen content; ProductionRelease remains the sole release authority.
// Version pins remain nil until the existing resolver supports historical definitions.
type ReleaseManufacturingUnit struct {
	Resolved          engine.ResolvedReleaseUnit `json:"resolved"`
	Parameters        map[string]any             `json:"parameters"`
	MaterialChoices   map[string]string          `json:"materialChoices"`
	DefinitionVersion *int                       `json:"definitionVersion"`
}

type ReleaseManufacturingSnapshot struct {
	SchemaVersion int                              `json:"schemaVersion"`
	Release       domain.ProductionRelease         `json:"productionRelease"`
	Units         []ReleaseManufacturingUnit       `json:"units"`
	Requirements  []domain.MaterialRequirementLine `json:"requirements"`
	// Routing is the frozen machine-neutral routing/machining program. nil on
	// historical schema-v1 rows — which is exactly why those releases keep
	// failing closed for physical execution.
	Routing *engine.ReleaseRoutingProgram `json:"routing,omitempty"`
}

func (s *PostgresStore) insertReleaseManufacturingSnapshot(ctx context.Context, release domain.ProductionRelease, items []domain.DesignRevisionItem, collection *engine.ResolvedReleaseCollection, catalog domain.Catalog) error {
	routing, err := engine.DeriveReleaseRoutingProgram(items, collection.Units, catalog)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrReleaseSnapshotResolution, err)
	}
	snapshot := ReleaseManufacturingSnapshot{SchemaVersion: 2, Release: release, Requirements: collection.Requirements, Routing: routing}
	for i, unit := range collection.Units {
		snapshot.Units = append(snapshot.Units, ReleaseManufacturingUnit{Resolved: unit,
			Parameters: items[i].Parameters, MaterialChoices: items[i].MaterialChoices, DefinitionVersion: items[i].DefinitionVersion})
	}
	_, err = s.db(ctx).Exec(ctx, `INSERT INTO production_release_manufacturing_snapshots
  (release_id, project_id, organization_id, schema_version, payload) VALUES ($1,$2,$3,2,$4)`,
		release.ID, release.ProjectID, release.OrganizationID, jsonbStructArg(snapshot))
	return err
}

// GetProductionReleaseManufacturingSnapshot is owner-private and exact, never latest.
// Historical rows without a snapshot are deliberately not reconstructed from mutable data.
// Schema v1 (no routing) decodes with Routing nil; schema v2 must carry a routing
// program that still validates against its own frozen units — a corrupt or
// incomplete routing section is unavailable evidence, never a no-CNC verdict.
func (s *PostgresStore) GetProductionReleaseManufacturingSnapshot(ctx context.Context, projectID, releaseID string) (*ReleaseManufacturingSnapshot, error) {
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		return nil, ErrReleaseSnapshotUnavailable
	}
	var snapshot ReleaseManufacturingSnapshot
	var version int
	var revision, quote, fingerprint, status string
	var number int
	err := s.db(ctx).QueryRow(ctx, `SELECT ms.schema_version, ms.payload,
  pr.design_revision_id::text, COALESCE(pr.quote_revision_id::text,''), pr.manufacturing_fingerprint, pr.release_number, pr.status
  FROM production_release_manufacturing_snapshots ms JOIN production_releases pr ON pr.id=ms.release_id
  WHERE ms.release_id=$1 AND ms.project_id=$2 AND ms.organization_id=$3`,
		releaseID, projectID, OrgFromCtx(ctx)).Scan(&version, &snapshot, &revision, &quote, &fingerprint, &number, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReleaseSnapshotUnavailable
	}
	if err != nil {
		return nil, fmt.Errorf("read manufacturing snapshot: %w", err)
	}
	if version != snapshot.SchemaVersion || snapshot.Release.ID != releaseID ||
		snapshot.Release.ProjectID != projectID || snapshot.Release.DesignRevisionID != revision ||
		snapshot.Release.QuoteRevisionID != quote || snapshot.Release.ManufacturingFingerprint != fingerprint ||
		snapshot.Release.ReleaseNumber != number || string(snapshot.Release.Status) != status ||
		len(snapshot.Units) == 0 || len(snapshot.Requirements) == 0 {
		return nil, ErrReleaseSnapshotUnavailable
	}
	switch version {
	case 1:
		if snapshot.Routing != nil {
			return nil, ErrReleaseSnapshotUnavailable
		}
	case 2:
		if snapshot.Routing == nil {
			return nil, ErrReleaseSnapshotUnavailable
		}
		units := make([]engine.ResolvedReleaseUnit, 0, len(snapshot.Units))
		for _, unit := range snapshot.Units {
			units = append(units, unit.Resolved)
		}
		if err := engine.ValidateReleaseRoutingProgram(snapshot.Routing, units); err != nil {
			return nil, ErrReleaseSnapshotUnavailable
		}
	default:
		return nil, ErrReleaseSnapshotUnavailable
	}
	return &snapshot, nil
}

// #739 — tenant-safe public projection of the private snapshot: WHAT must be
// manufactured (board cutting demand per exact physical unit), never the
// routing program, evaluated parameters or costs. Engineering preparation
// (blade, trims, board formats) is intentionally absent: it is an explicit
// consumer input, not frozen release content.
type ReleaseCuttingDemandView struct {
	ReleaseID                string
	ReleaseNumber            int
	DesignRevisionID         string
	DesignRevisionNumber     int
	ManufacturingFingerprint string
	SchemaVersion            int
	Units                    []ReleaseCuttingDemandUnitView
}

type ReleaseCuttingDemandUnitView struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	// WorkshopOccurrenceOrdinal (#781) is the frozen manufacturing occurrence
	// authority: the 1-based position of this unit in the release's frozen
	// unit order. Decided when the work was liberated (materialization →
	// working copy → revision → snapshot); never recomputed, never derived
	// from lexical id order. Both TS flows order workshop occurrences by it.
	WorkshopOccurrenceOrdinal int
	Pieces                    []ReleaseCuttingDemandPieceView
}

type ReleaseCuttingDemandPieceView struct {
	PartID       string
	PartCode     string
	Description  string
	Quantity     int
	LengthMm     int
	WidthMm      int
	ThicknessMm  int
	MaterialID   string
	EdgeBandID   string
	Grain        int
	L1, L2       int
	W1, W2       int
	OptionRole   string
}

// WorkshopOccurrenceAssignmentView is one frozen manufacturing occurrence:
// the physical instance, the project item (quote line) it backs, and the
// 1-based position of its unit in the release's frozen order.
type WorkshopOccurrenceAssignmentView struct {
	FurnitureInstanceID string `json:"furnitureInstanceId"`
	ProjectItemID       string `json:"projectItemId"`
	Ordinal             int    `json:"workshopOccurrenceOrdinal"`
}

// WorkshopOccurrenceProjectionView is the release-side occurrence authority
// (#781): the LATEST production release's frozen unit order projected onto
// the project's CURRENT quote-line↔instance links. coversAllCurrentInstances
// is false when the live representation drifted from the frozen release
// (e.g. a unit was added after liberating) — callers then keep the LIVE
// canonical order instead of mixing frozen and unfrozen occurrences.
type WorkshopOccurrenceProjectionView struct {
	ReleaseID                  string                             `json:"releaseId"`
	ReleaseNumber              int                                `json:"releaseNumber"`
	CoversAllCurrentInstances  bool                               `json:"coversAllCurrentInstances"`
	Assignments                []WorkshopOccurrenceAssignmentView `json:"assignments"`
}

// GetProjectWorkshopOccurrences projects the EXACT release's frozen unit
// order as the manufacturing occurrence authority. The ordinal is the
// snapshot unit position (index+1): decided when the work was liberated,
// never recomputed, and historical releases need no migration.
// #781 FIX — receives releaseId explicitly; never SELECT latest.
// #781 micro-task #2 — CoversAllCurrentInstances is a BIDIRECTIONAL exact
// set equality: {frozen instance ids} == {current linked instance ids}.
// A frozen unit without a current link (empty ProjectItemID, kept for
// traceability) and a current instance the release never covered BOTH
// force false — never a silent partial freeze.
func (s *PostgresStore) GetProjectWorkshopOccurrences(ctx context.Context, projectID, releaseID string) (*WorkshopOccurrenceProjectionView, error) {
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		return nil, ErrReleaseSnapshotUnavailable
	}
	snapshot, err := s.GetProductionReleaseManufacturingSnapshot(ctx, projectID, releaseID)
	if err != nil {
		return nil, err
	}
	// CURRENT quote-line↔instance links: the live commercial representation.
	links := map[string]string{} // furniture_instance_id -> project item (quote line) id
	rows, err := s.db(ctx).Query(ctx, `
		SELECT qli.furniture_instance_id::text, qli.quote_line_id::text
		FROM quote_line_furniture_instances qli
		WHERE qli.project_id = $1 AND qli.state = 'current'`,
		projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var instanceID, itemID string
		if err := rows.Scan(&instanceID, &itemID); err != nil {
			return nil, err
		}
		links[instanceID] = itemID
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	view := &WorkshopOccurrenceProjectionView{
		ReleaseID:                 snapshot.Release.ID,
		ReleaseNumber:             snapshot.Release.ReleaseNumber,
		CoversAllCurrentInstances: true,
		Assignments:               make([]WorkshopOccurrenceAssignmentView, 0, len(snapshot.Units)),
	}
	frozen := map[string]struct{}{}
	for index, unit := range snapshot.Units {
		instanceID := unit.Resolved.FurnitureInstanceID
		frozen[instanceID] = struct{}{}
		itemID, linked := links[instanceID]
		if !linked {
			// A frozen unit without a current link: the live representation
			// drifted; still report the occurrence (identity survives), with
			// an empty item so the drift is visible — and the freeze is NOT
			// complete (#781 micro-task #2: frozen ⊋ current ⇒ false).
			view.CoversAllCurrentInstances = false
			itemID = ""
		}
		view.Assignments = append(view.Assignments, WorkshopOccurrenceAssignmentView{
			FurnitureInstanceID: instanceID,
			ProjectItemID:       itemID,
			Ordinal:             index + 1,
		})
	}
	for instanceID := range links {
		if _, ok := frozen[instanceID]; !ok {
			// A current instance the frozen release never covered: the
			// project moved past the release — freeze is not complete.
			view.CoversAllCurrentInstances = false
			break
		}
	}
	return view, nil
}

// GetProjectProductionReleaseCuttingDemand projects the frozen snapshot's
// board parts into the engineering cutting demand. It never resolves against
// the current catalog: material identity, dimensions, effective thickness,
// grain and edges come exclusively from the frozen release content.
func (s *PostgresStore) GetProjectProductionReleaseCuttingDemand(ctx context.Context, projectID, releaseID string) (*ReleaseCuttingDemandView, error) {
	snapshot, err := s.GetProductionReleaseManufacturingSnapshot(ctx, projectID, releaseID)
	if err != nil {
		return nil, err
	}
	view := &ReleaseCuttingDemandView{
		ReleaseID:                snapshot.Release.ID,
		ReleaseNumber:            snapshot.Release.ReleaseNumber,
		DesignRevisionID:         snapshot.Release.DesignRevisionID,
		DesignRevisionNumber:     snapshot.Release.DesignRevisionNumber,
		ManufacturingFingerprint: snapshot.Release.ManufacturingFingerprint,
		SchemaVersion:            snapshot.SchemaVersion,
		Units:                    make([]ReleaseCuttingDemandUnitView, 0, len(snapshot.Units)),
	}
	for unitIndex, unit := range snapshot.Units {
		unitView := ReleaseCuttingDemandUnitView{
			FurnitureInstanceID:   unit.Resolved.FurnitureInstanceID,
			FurnitureDefinitionID: unit.Resolved.FurnitureDefinitionID,
			// #781: the frozen liberation order IS the manufacturing
			// occurrence order — the array position of the frozen snapshot.
			WorkshopOccurrenceOrdinal: unitIndex + 1,
		}
		for _, part := range unit.Resolved.BOM.BoardParts {
			if part.Quantity <= 0 {
				continue
			}
			piece := ReleaseCuttingDemandPieceView{
				PartID:       part.ID,
				PartCode:     part.Code,
				Description:  part.Description,
				Quantity:     part.Quantity,
				LengthMm:     part.LengthMm,
				WidthMm:      part.WidthMm,
				ThicknessMm:  part.ThicknessMm,
				MaterialID:   part.MaterialID,
				EdgeBandID:   part.EdgeBandID,
				Grain:        int(part.Grain),
				OptionRole:   part.OptionRole,
			}
			for _, edge := range part.Edges {
				if !edge.Enabled {
					continue
				}
				switch edge.Side {
				case "L1":
					piece.L1 = 1
				case "L2":
					piece.L2 = 1
				case "W1":
					piece.W1 = 1
				case "W2":
					piece.W2 = 1
				}
			}
			unitView.Pieces = append(unitView.Pieces, piece)
		}
		view.Units = append(view.Units, unitView)
	}
	return view, nil
}
