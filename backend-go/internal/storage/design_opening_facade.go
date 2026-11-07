package storage

// Design-opening facade storage (#1532): GET/PUT /api/designs/{id}/opening
// stay alive until #1535 migrates the SketchUp consumers, but they no longer
// read or write the legacy selection in authoring_defaults. GET derives the
// v1-shaped state from the effective grip (the design's first furniture); PUT
// maps the legacy selection payload onto per-furniture override snapshots
// over the design's instances — ONE operation under the working-copy version
// the plugin already sends, with the project grip version bumped and audited.

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// DesignOpeningFacadeState is the derived state the facade GET renders.
type DesignOpeningFacadeState struct {
	ProjectID      string
	WorkingVersion string
	// InstanceID is the design's first working item's furniture instance —
	// the v1 scope of the design-opening card (#1274: the opening belongs to
	// the design's first module).
	InstanceID string
	// FurnitureType is that instance's type (the recipe lookup key).
	FurnitureType string
	// Snapshot is the instance's effective grip (override ?? project).
	Snapshot *domain.GripSnapshot
}

// GetDesignOpeningFacadeState reads what the facade GET derives from.
func (s *PostgresStore) GetDesignOpeningFacadeState(ctx context.Context, designID string) (*DesignOpeningFacadeState, error) {
	var (
		projectID      string
		workingVersion time.Time
	)
	err := s.db(ctx).QueryRow(ctx,
		`SELECT project_id, updated_at FROM design_working_copies WHERE design_id = $1`,
		designID).Scan(&projectID, &workingVersion)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	state := &DesignOpeningFacadeState{ProjectID: projectID, WorkingVersion: workingVersion.UTC().Format(time.RFC3339Nano)}
	err = s.db(ctx).QueryRow(ctx,
		`SELECT dwi.furniture_instance_id::text,
		        COALESCE(NULLIF(m.furniture_type, ''), 'inferior')
		   FROM design_working_items dwi
		   JOIN furniture_instances fi ON fi.id = dwi.furniture_instance_id
		   LEFT JOIN modules m ON m.id = fi.furniture_definition_id
		  WHERE dwi.design_id = $1
		  ORDER BY dwi.furniture_instance_id LIMIT 1`,
		designID).Scan(&state.InstanceID, &state.FurnitureType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// A design without items has no furniture to grip: no snapshot.
			return state, nil
		}
		return nil, err
	}
	snapshot, err := s.GetFurnitureEffectiveGrip(ctx, projectID, state.InstanceID)
	if err != nil {
		return nil, err
	}
	state.Snapshot = snapshot
	return state, nil
}

// ApplyDesignOpeningFacade maps the legacy selection payload onto per-
// furniture overrides over the design's instances: ONE operation, the
// working-copy version as the concurrency token (the plugin's), the project
// grip version bumped and the audit committed with the mutation. The v1
// bottom gola freezes with its honest marker (the resolve blocks — never a
// silent reinterpretation as top).
func (s *PostgresStore) ApplyDesignOpeningFacade(ctx context.Context, designID string, selection domain.DesignOpeningSelection, expectedWorkingVersion string, meta ProjectGripWriteMeta) error {
	return s.withinProjectGripTx(ctx, func(txCtx context.Context) error {
		var (
			projectID string
			updatedAt time.Time
		)
		err := s.db(txCtx).QueryRow(txCtx,
			`SELECT project_id, updated_at FROM design_working_copies
			  WHERE design_id = $1
			  FOR UPDATE`, designID).Scan(&projectID, &updatedAt)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrDesignNotFound
			}
			return err
		}
		sent, err := time.Parse(time.RFC3339Nano, expectedWorkingVersion)
		if err != nil || !sent.Equal(updatedAt) {
			return ErrWorkingCopyVersionConflict
		}
		if _, err := scanProjectGrip(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+projectGripColumns+` FROM projects WHERE id::text = $1 FOR UPDATE`, projectID)); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProjectGripNotFound
			}
			return err
		}

		recipe, err := s.facadeRecipe(txCtx, selection)
		if err != nil {
			return err
		}
		recipes := map[string]domain.GripSnapshotRecipe{
			"inferior": *recipe, "superior": *recipe, "alto": *recipe,
		}
		snapshot := &domain.GripSnapshot{
			StyleName: "Apertura del diseño",
			Recipes:   recipes,
			FrozenAt:  time.Now().UTC(),
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		tag, err := s.db(txCtx).Exec(txCtx,
			`UPDATE furniture_instances fi
			    SET grip_snapshot = $2
			   FROM design_working_items dwi
			  WHERE dwi.design_id = $1 AND fi.id = dwi.furniture_instance_id`,
			designID, encoded)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return &domain.GripSnapshotValidationError{
				Code:    "DESIGN_HAS_NO_FURNITURE",
				Message: "el diseño no tiene muebles: no hay excepciones que escribir"}
		}
		var gripVersion int64
		if err := s.db(txCtx).QueryRow(txCtx,
			`UPDATE projects SET grip_version = grip_version + 1 WHERE id::text = $1 RETURNING grip_version`,
			projectID).Scan(&gripVersion); err != nil {
			return err
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:      "project_furniture_grip_updated",
			ActorUserID:    tenantActorUserID(txCtx),
			OrganizationID: OrgFromCtx(txCtx),
			RequestID:      meta.RequestID,
			IP:             meta.IP,
			Details: map[string]any{
				"project_id":      projectID,
				"design_id":       designID,
				"source":          "design_opening_facade",
				"system":          selection.System,
				"profile_id":      selection.ProfileID,
				"placements":      selection.Placements,
				"grip_version":    gripVersion,
				"furniture_count": tag.RowsAffected(),
			},
		})
	})
}

// facadeRecipe builds the custom snapshot recipe a legacy selection maps
// onto: the profile freezes from the LIVE catalog at apply time (the same
// values FreezeGripSnapshot writes for a style).
func (s *PostgresStore) facadeRecipe(ctx context.Context, selection domain.DesignOpeningSelection) (*domain.GripSnapshotRecipe, error) {
	switch selection.System {
	case domain.OpeningGripSystemHandle:
		return &domain.GripSnapshotRecipe{Mode: domain.GripModeHandle}, nil
	case domain.OpeningGripSystemBottomOverhang:
		rule, err := s.GetOpeningOverhangRule(ctx)
		if err != nil {
			return nil, err
		}
		overhang := float64(rule.OverhangMm)
		return &domain.GripSnapshotRecipe{Mode: domain.GripModeBottomOverhang, OverhangMm: &overhang}, nil
	case domain.OpeningGripSystemGola:
		profile, err := s.projectGripProfileLookup(ctx)(selection.ProfileID)
		if err != nil {
			return nil, err
		}
		if profile == nil {
			return nil, &domain.GripSnapshotValidationError{
				Code: "GRIP_PROFILE_UNKNOWN", Message: "el perfil de gola no existe en el catálogo"}
		}
		if usage := profile.UsageAt(domain.GolaPositionTop); !usage.Usable {
			return nil, &domain.GripSnapshotValidationError{
				Code: "GRIP_PROFILE_UNUSABLE", Message: "el perfil " + profile.Code + " no se puede usar: " + usage.Message}
		}
		frozen := &domain.FrozenGripProfile{
			ProfileID:              profile.ID,
			Code:                   profile.Code,
			Name:                   profile.Name,
			Material:               profile.Material,
			Positions:              append([]string{}, profile.Positions...),
			ProfileHeightMm:        profile.ProfileHeightMm,
			ProfileDepthMm:         profile.ProfileDepthMm,
			FrontDiscountTopMm:     profile.FrontDiscountTopMm,
			FrontDiscountBetweenMm: profile.FrontDiscountBetweenMm,
			CompatiblePlacements:   append([]string{}, profile.CompatiblePlacements...),
			BodyModifiers:          append([]domain.OpeningBodyModifier{}, profile.BodyModifiers...),
			BOMVersion:             profile.Version,
		}
		if len(profile.BOMMembers) > 0 {
			frozen.BOMMembers = make(map[string]domain.OpeningBOMMember, len(profile.BOMMembers))
			for key, member := range profile.BOMMembers {
				frozen.BOMMembers[key] = member
			}
		}
		return &domain.GripSnapshotRecipe{
			Mode:             domain.GripModeGola,
			TopProfile:       frozen,
			LegacyBottomGola: selectionHasBottomPlacement(selection),
		}, nil
	default:
		return nil, &domain.GripSnapshotValidationError{
			Code: "GRIP_MODE_UNKNOWN", Message: "el sistema de apertura " + selection.System + " no existe"}
	}
}

// selectionHasBottomPlacement reports the v1 bottom-gola placements.
func selectionHasBottomPlacement(selection domain.DesignOpeningSelection) bool {
	for _, placement := range selection.Placements {
		if placement == "bottom" {
			return true
		}
	}
	return false
}
