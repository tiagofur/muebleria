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
