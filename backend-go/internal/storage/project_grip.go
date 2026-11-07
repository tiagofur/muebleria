package storage

// Project grip persistence (#1532, ADR-0009 Amendment 1 A2.3/A7): the
// project's frozen snapshot, per-furniture overrides and the explicit
// refresh. Every write takes the project's grip_version with If-Match and
// commits its audit event in the same transaction. The frozen copies are
// self-sufficient (A7): a deleted or re-edited style never changes them.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ErrProjectGripNotFound separates a missing project from other failures on
// the grip surfaces (the API answers 404).
var ErrProjectGripNotFound = errors.New("project not found")

// ProjectGrip is the project's grip state: the chosen style, the frozen
// snapshot and the If-Match version.
type ProjectGrip struct {
	ProjectID string               `json:"projectId"`
	StyleID   string               `json:"styleId"`
	Snapshot  *domain.GripSnapshot `json:"snapshot,omitempty"`
	Version   int64                `json:"version"`
	// Overrides mirrors the furniture instances that carry an override
	// snapshot (read-only convenience for the API surface).
	Overrides []FurnitureGripOverride `json:"overrides,omitempty"`
}

// FurnitureGripOverride is one furniture's override.
type FurnitureGripOverride struct {
	FurnitureInstanceID string               `json:"furnitureInstanceId"`
	Snapshot            *domain.GripSnapshot `json:"snapshot,omitempty"`
}

// ProjectGripWriteMeta carries the audit context of one grip write.
type ProjectGripWriteMeta struct {
	RequestID string
	IP        string
}

// FurnitureGripOverrideCommand is one entry of a batch override write:
// StyleID nil clears the override (the furniture inherits the project), a
// non-empty id freezes the override from that style right now.
type FurnitureGripOverrideCommand struct {
	FurnitureInstanceID string
	StyleID             *string
}

// scanProjectGrip reads the projects row's grip columns.
func scanProjectGrip(row pgx.Row) (*ProjectGrip, error) {
	var (
		grip     ProjectGrip
		styleID  *string
		snapshot []byte
	)
	if err := row.Scan(&grip.ProjectID, &styleID, &snapshot, &grip.Version); err != nil {
		return nil, err
	}
	if styleID != nil {
		grip.StyleID = *styleID
	}
	if len(snapshot) > 0 && string(snapshot) != "null" {
		snap := &domain.GripSnapshot{}
		if err := json.Unmarshal(snapshot, snap); err != nil {
			return nil, fmt.Errorf("project grip snapshot: %w", err)
		}
		grip.Snapshot = snap
	}
	return &grip, nil
}

const projectGripColumns = `id::text, grip_style_id, grip_snapshot, grip_version`

// GetProjectGrip reads the project's grip state and its furniture overrides.
func (s *PostgresStore) GetProjectGrip(ctx context.Context, projectID string) (*ProjectGrip, error) {
	grip, err := scanProjectGrip(s.db(ctx).QueryRow(ctx,
		`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1`, projectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProjectGripNotFound
		}
		return nil, err
	}
	rows, err := s.db(ctx).Query(ctx,
		`SELECT id::text, grip_snapshot FROM furniture_instances
		  WHERE project_id::text = $1 AND grip_snapshot IS NOT NULL
		  ORDER BY id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id       string
			snapshot []byte
		)
		if err := rows.Scan(&id, &snapshot); err != nil {
			return nil, err
		}
		snap := &domain.GripSnapshot{}
		if len(snapshot) > 0 && string(snapshot) != "null" {
			if err := json.Unmarshal(snapshot, snap); err != nil {
				return nil, fmt.Errorf("furniture grip snapshot %s: %w", id, err)
			}
		}
		grip.Overrides = append(grip.Overrides, FurnitureGripOverride{
			FurnitureInstanceID: id, Snapshot: snap,
		})
	}
	return grip, rows.Err()
}

// projectGripProfileLookup resolves a profile for freezing under the caller's
// tenant scope (nil = unknown in this organization).
func (s *PostgresStore) projectGripProfileLookup(ctx context.Context) func(id string) (*domain.OpeningProfile, error) {
	return func(id string) (*domain.OpeningProfile, error) {
		profile, err := scanOpeningProfile(s.db(ctx).QueryRow(ctx,
			`SELECT `+openingProfileColumns+` FROM opening_profiles WHERE id = $1 AND organization_id = $2`,
			id, OrgFromCtx(ctx)))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, nil
			}
			return nil, err
		}
		return profile, nil
	}
}

// freezeStyleSnapshot loads the org's style and freezes its complete copy.
// requireOffered gates NEW choices only (§14.8: disabling «Ofrecer» hides
// the style for new selections, never for the explicit refresh of a project
// already using it — available ≠ valid).
func (s *PostgresStore) freezeStyleSnapshot(ctx context.Context, styleID string, requireOffered bool) (*domain.GripSnapshot, error) {
	style, err := s.GetGripStyle(ctx, styleID)
	if err != nil {
		if errors.Is(err, ErrGripStyleNotFound) {
			return nil, &domain.GripSnapshotValidationError{
				Code: "GRIP_STYLE_UNKNOWN", Message: "el estilo de agarre no existe en el catálogo del taller"}
		}
		return nil, err
	}
	if requireOffered && !style.Offered {
		return nil, &domain.GripSnapshotValidationError{
			Code: "GRIP_STYLE_NOT_OFFERED", Message: "el estilo de agarre «" + style.Name + "» no está ofrecido para nuevas elecciones"}
	}
	return domain.FreezeGripSnapshot(*style, s.projectGripProfileLookup(ctx), time.Now())
}

// SetProjectGrip applies a style to the project: ONE complete frozen snapshot
// (A7), the If-Match version bumped, the audit committed with the mutation.
func (s *PostgresStore) SetProjectGrip(ctx context.Context, projectID, styleID string, expectedVersion int64, meta ProjectGripWriteMeta) (*ProjectGrip, error) {
	var result *ProjectGrip
	err := s.withinProjectGripTx(ctx, func(txCtx context.Context) error {
		if _, err := scanProjectGrip(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1 FOR UPDATE`, projectID)); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProjectGripNotFound
			}
			return err
		}
		snapshot, err := s.freezeStyleSnapshot(txCtx, styleID, true)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		updated, err := scanProjectGrip(s.db(txCtx).QueryRow(txCtx, `UPDATE projects SET
			grip_style_id = $2, grip_snapshot = $3, grip_version = grip_version + 1
			WHERE id::text = $1 AND grip_version = $4
			RETURNING `+projectGripColumns,
			projectID, styleID, encoded, expectedVersion))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		if err != nil {
			return err
		}
		result = updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:      "project_grip_updated",
			ActorUserID:    tenantActorUserID(txCtx),
			OrganizationID: OrgFromCtx(txCtx),
			RequestID:      meta.RequestID,
			IP:             meta.IP,
			Details: map[string]any{
				"project_id":       projectID,
				"grip_style_id":    styleID,
				"grip_style_name":  snapshot.StyleName,
				"grip_version":     updated.Version,
				"previous_version": expectedVersion,
			},
		})
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// SetFurnitureGripOverrides sets or clears one or several furniture
// overrides in ONE operation: every entry freezes (or clears) atomically
// under the same If-Match version bump and one audit event.
func (s *PostgresStore) SetFurnitureGripOverrides(ctx context.Context, projectID string, overrides []FurnitureGripOverrideCommand, expectedVersion int64, meta ProjectGripWriteMeta) error {
	if len(overrides) == 0 {
		return &domain.GripSnapshotValidationError{
			Code: "GRIP_OVERRIDES_EMPTY", Message: "la operación necesita al menos un mueble con su excepción"}
	}
	return s.withinProjectGripTx(ctx, func(txCtx context.Context) error {
		if _, err := scanProjectGrip(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1 FOR UPDATE`, projectID)); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProjectGripNotFound
			}
			return err
		}
		for _, override := range overrides {
			if override.StyleID == nil {
				// Clear: the furniture inherits the project again.
				tag, err := s.db(txCtx).Exec(txCtx,
					`UPDATE furniture_instances SET grip_snapshot = NULL
					  WHERE id::text = $1 AND project_id::text = $2`,
					override.FurnitureInstanceID, projectID)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return &domain.GripSnapshotValidationError{
						Code:    "FURNITURE_INSTANCE_UNKNOWN",
						Message: fmt.Sprintf("el mueble %s no existe en este proyecto", override.FurnitureInstanceID)}
				}
				continue
			}
			snapshot, err := s.freezeStyleSnapshot(txCtx, *override.StyleID, true)
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(snapshot)
			if err != nil {
				return err
			}
			tag, err := s.db(txCtx).Exec(txCtx,
				`UPDATE furniture_instances SET grip_snapshot = $3
				  WHERE id::text = $1 AND project_id::text = $2`,
				override.FurnitureInstanceID, projectID, encoded)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return &domain.GripSnapshotValidationError{
					Code:    "FURNITURE_INSTANCE_UNKNOWN",
					Message: fmt.Sprintf("el mueble %s no existe en este proyecto", override.FurnitureInstanceID)}
			}
		}
		tag, err := s.db(txCtx).Exec(txCtx,
			`UPDATE projects SET grip_version = grip_version + 1
			  WHERE id::text = $1 AND grip_version = $2`,
			projectID, expectedVersion)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrVersionConflict
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:      "project_furniture_grip_updated",
			ActorUserID:    tenantActorUserID(txCtx),
			OrganizationID: OrgFromCtx(txCtx),
			RequestID:      meta.RequestID,
			IP:             meta.IP,
			Details: map[string]any{
				"project_id":       projectID,
				"grip_version":     expectedVersion + 1,
				"previous_version": expectedVersion,
				"overrides":        furnitureGripOverrideDetails(overrides),
			},
		})
	})
}

// RefreshProjectGrip re-freezes the project's snapshot from ITS style's
// current values — the explicit «Actualizar a los valores actuales del
// taller» (A7). Never automatic. includeOverrides also re-freezes every
// override whose snapshot came from a style (migrated custom copies have no
// style to re-freeze from and stay).
func (s *PostgresStore) RefreshProjectGrip(ctx context.Context, projectID string, includeOverrides bool, expectedVersion int64, meta ProjectGripWriteMeta) error {
	return s.withinProjectGripTx(ctx, func(txCtx context.Context) error {
		grip, err := scanProjectGrip(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1 FOR UPDATE`, projectID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProjectGripNotFound
			}
			return err
		}
		if grip.StyleID == "" {
			return &domain.GripSnapshotValidationError{
				Code: "GRIP_STYLE_NONE", Message: "el proyecto no tiene un estilo de agarre que actualizar"}
		}
		snapshot, err := s.freezeStyleSnapshot(txCtx, grip.StyleID, false)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		tag, err := s.db(txCtx).Exec(txCtx, `UPDATE projects SET
			grip_snapshot = $2, grip_version = grip_version + 1
			WHERE id::text = $1 AND grip_version = $3`,
			projectID, encoded, expectedVersion)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrVersionConflict
		}
		refreshed := 0
		if includeOverrides {
			rows, err := s.db(txCtx).Query(txCtx,
				`SELECT id::text, grip_snapshot FROM furniture_instances
				  WHERE project_id::text = $1 AND grip_snapshot IS NOT NULL`, projectID)
			if err != nil {
				return err
			}
			type overrideRow struct {
				id       string
				snapshot *domain.GripSnapshot
			}
			var overrides []overrideRow
			for rows.Next() {
				var row overrideRow
				var raw []byte
				if err := rows.Scan(&row.id, &raw); err != nil {
					rows.Close()
					return err
				}
				snap := &domain.GripSnapshot{}
				if len(raw) > 0 && string(raw) != "null" {
					if err := json.Unmarshal(raw, snap); err != nil {
						rows.Close()
						return fmt.Errorf("furniture grip snapshot %s: %w", row.id, err)
					}
				}
				row.snapshot = snap
				overrides = append(overrides, row)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
			for _, override := range overrides {
				if override.snapshot == nil || override.snapshot.StyleID == "" {
					continue
				}
				fresh, err := s.freezeStyleSnapshot(txCtx, override.snapshot.StyleID, false)
				if err != nil {
					return err
				}
				encoded, err := json.Marshal(fresh)
				if err != nil {
					return err
				}
				if _, err := s.db(txCtx).Exec(txCtx,
					`UPDATE furniture_instances SET grip_snapshot = $2 WHERE id::text = $1`,
					override.id, encoded); err != nil {
					return err
				}
				refreshed++
			}
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:      "project_grip_refreshed",
			ActorUserID:    tenantActorUserID(txCtx),
			OrganizationID: OrgFromCtx(txCtx),
			RequestID:      meta.RequestID,
			IP:             meta.IP,
			Details: map[string]any{
				"project_id":          projectID,
				"grip_style_id":       grip.StyleID,
				"grip_version":        expectedVersion + 1,
				"previous_version":    expectedVersion,
				"include_overrides":   includeOverrides,
				"overrides_refreshed": refreshed,
			},
		})
	})
}

// GetFurnitureEffectiveGrip resolves the inheritance for ONE furniture: its
// override when it has one, the project's snapshot otherwise. nil snapshot =
// no grip at all.
func (s *PostgresStore) GetFurnitureEffectiveGrip(ctx context.Context, projectID, furnitureInstanceID string) (*domain.GripSnapshot, error) {
	project, err := scanProjectGrip(s.db(ctx).QueryRow(ctx,
		`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1`, projectID))
	if err != nil {
		return nil, err
	}
	override, err := s.GetFurnitureGripOverride(ctx, projectID, furnitureInstanceID)
	if err != nil {
		return nil, err
	}
	return domain.EffectiveGripSnapshot(override, project.Snapshot), nil
}

// GetFurnitureGripOverride reads one furniture's override snapshot.
func (s *PostgresStore) GetFurnitureGripOverride(ctx context.Context, projectID, furnitureInstanceID string) (*domain.GripSnapshot, error) {
	var raw []byte
	err := s.db(ctx).QueryRow(ctx,
		`SELECT grip_snapshot FROM furniture_instances
		  WHERE id::text = $1 AND project_id::text = $2`,
		furnitureInstanceID, projectID).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &domain.GripSnapshotValidationError{
				Code:    "FURNITURE_INSTANCE_UNKNOWN",
				Message: fmt.Sprintf("el mueble %s no existe en este proyecto", furnitureInstanceID)}
		}
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	snap := &domain.GripSnapshot{}
	if err := json.Unmarshal(raw, snap); err != nil {
		return nil, fmt.Errorf("furniture grip snapshot %s: %w", furnitureInstanceID, err)
	}
	return snap, nil
}

// FurnitureTypeForInstance returns the furniture type a furniture instance
// resolves its grip recipe with (the module's furniture_type; ” = inferior).
func (s *PostgresStore) FurnitureTypeForInstance(ctx context.Context, furnitureInstanceID string) (string, error) {
	var ftype string
	err := s.db(ctx).QueryRow(ctx,
		`SELECT COALESCE(NULLIF(m.furniture_type, ''), 'inferior')
		   FROM furniture_instances fi
		   LEFT JOIN modules m ON m.id = fi.furniture_definition_id
		  WHERE fi.id::text = $1`, furnitureInstanceID).Scan(&ftype)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "inferior", nil
		}
		return "", err
	}
	return ftype, nil
}

// withinProjectGripTx reuses the caller's tenant transaction (the API's) or
// opens one for direct store callers, so mutation and audit commit together.
func (s *PostgresStore) withinProjectGripTx(ctx context.Context, run func(context.Context) error) error {
	if transactionFromContext(ctx) != nil {
		return run(ctx)
	}
	return s.WithinTenantTx(ctx, TenantActor{OrganizationID: OrgFromCtx(ctx), UserID: tenantActorUserID(ctx)}, run)
}

func furnitureGripOverrideDetails(overrides []FurnitureGripOverrideCommand) []map[string]any {
	details := make([]map[string]any, 0, len(overrides))
	for _, override := range overrides {
		entry := map[string]any{"furniture_instance_id": override.FurnitureInstanceID}
		if override.StyleID != nil {
			entry["grip_style_id"] = *override.StyleID
			entry["action"] = "set"
		} else {
			entry["action"] = "clear"
		}
		details = append(details, entry)
	}
	return details
}

// OverrideFor returns the override snapshot of one furniture instance
// (nil = inherits the project).
func (g *ProjectGrip) OverrideFor(furnitureInstanceID string) *domain.GripSnapshot {
	for _, override := range g.Overrides {
		if override.FurnitureInstanceID == furnitureInstanceID {
			return override.Snapshot
		}
	}
	return nil
}
