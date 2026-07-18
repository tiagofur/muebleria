package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) loadStructureComponents(ctx context.Context, structureID string) ([]domain.ComponentInstance, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT component_id, quantity, placement_override
		FROM structure_components
		WHERE structure_id = $1
		ORDER BY created_at ASC;
	`, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ComponentInstance
	for rows.Next() {
		var ci domain.ComponentInstance
		var placementOverride *string
		if err := rows.Scan(&ci.ComponentID, &ci.Quantity, &placementOverride); err != nil {
			return nil, err
		}
		if placementOverride != nil && *placementOverride != "" {
			p := domain.ComponentPlacement(*placementOverride)
			ci.PlacementOverride = &p
		}
		out = append(out, ci)
	}
	if out == nil {
		out = []domain.ComponentInstance{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) loadStructurePresets(ctx context.Context, structureID string) ([]domain.DimensionPreset, error) {
	presetsQuery := `
		SELECT id, name, width_mm, height_mm, depth_mm
		FROM structure_presets
		WHERE structure_id = $1
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
	`
	rows, err := s.Pool.Query(ctx, presetsQuery, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var presets []domain.DimensionPreset
	for rows.Next() {
		var pr domain.DimensionPreset
		var name *string
		if err := rows.Scan(&pr.ID, &name, &pr.WidthMm, &pr.HeightMm, &pr.DepthMm); err != nil {
			return nil, err
		}
		if name != nil {
			pr.Name = *name
		}
		presets = append(presets, pr)
	}
	if presets == nil {
		presets = []domain.DimensionPreset{}
	}
	return presets, rows.Err()
}

// loadStructureHistory loads the immutable revision snapshots for a structure
// (#108). Returns newest-first (created_at DESC) to mirror the TS history
// field ordering. Empty (non-nil) slice when there are no historical revisions.
func (s *PostgresStore) loadStructureHistory(ctx context.Context, structureID string) ([]domain.StructureRevision, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT revision, snapshot
		FROM structure_revisions
		WHERE structure_id = $1
		ORDER BY revision DESC;
	`, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.StructureRevision{}
	for rows.Next() {
		var rev int
		var raw []byte
		if err := rows.Scan(&rev, &raw); err != nil {
			return nil, err
		}
		var snap domain.StructureRevision
		if err := json.Unmarshal(raw, &snap); err != nil {
			return nil, fmt.Errorf("decoding structure revision %d snapshot: %w", rev, err)
		}
		// Trust the row's revision column over whatever is in the JSON payload.
		snap.Revision = rev
		out = append(out, snap)
	}
	return out, rows.Err()
}

// structureRevisionSnapshot serialises the BOM-relevant fields of st into the
// JSON shape stored in structure_revisions.snapshot. Mirrors the TS
// StructureRevision shape (revision/code/name/dims/components/presets).
func structureRevisionSnapshot(revision int, st domain.Structure) ([]byte, error) {
	snap := domain.StructureRevision{
		Revision:   revision,
		Code:       st.Code,
		Name:       st.Name,
		WidthMm:    st.WidthMm,
		HeightMm:   st.HeightMm,
		DepthMm:    st.DepthMm,
		Components: st.Components,
		Presets:    st.Presets,
	}
	return json.Marshal(snap)
}

// loadStructureComponentsTx is the transaction-scoped variant of
// loadStructureComponents, used by UpdateStructure to read the previous
// component set inside the same tx before mutating it (#108 snapshot).
func loadStructureComponentsTx(ctx context.Context, tx pgx.Tx, structureID string) ([]domain.ComponentInstance, error) {
	rows, err := tx.Query(ctx, `
		SELECT component_id, quantity, placement_override
		FROM structure_components
		WHERE structure_id = $1
		ORDER BY created_at ASC;
	`, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ComponentInstance
	for rows.Next() {
		var ci domain.ComponentInstance
		var placementOverride *string
		if err := rows.Scan(&ci.ComponentID, &ci.Quantity, &placementOverride); err != nil {
			return nil, err
		}
		if placementOverride != nil && *placementOverride != "" {
			p := domain.ComponentPlacement(*placementOverride)
			ci.PlacementOverride = &p
		}
		out = append(out, ci)
	}
	if out == nil {
		out = []domain.ComponentInstance{}
	}
	return out, rows.Err()
}

// loadStructurePresetsTx is the transaction-scoped variant of
// loadStructurePresets (see loadStructureComponentsTx).
func loadStructurePresetsTx(ctx context.Context, tx pgx.Tx, structureID string) ([]domain.DimensionPreset, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, name, width_mm, height_mm, depth_mm
		FROM structure_presets
		WHERE structure_id = $1
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
	`, structureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var presets []domain.DimensionPreset
	for rows.Next() {
		var pr domain.DimensionPreset
		var name *string
		if err := rows.Scan(&pr.ID, &name, &pr.WidthMm, &pr.HeightMm, &pr.DepthMm); err != nil {
			return nil, err
		}
		if name != nil {
			pr.Name = *name
		}
		presets = append(presets, pr)
	}
	if presets == nil {
		presets = []domain.DimensionPreset{}
	}
	return presets, rows.Err()
}

// ListStructures returns all engineering structures with their component
// instances and measure presets (F049/F053). Since F053 structures compose
// reusable Component instances instead of carrying their own board parts.
func (s *PostgresStore) ListStructures(ctx context.Context) ([]domain.Structure, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, active, revision, created_at, updated_at
		FROM structures
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("error query structures: %w", err)
	}
	defer rows.Close()

	var out []domain.Structure
	for rows.Next() {
		var st domain.Structure
		var w, h, d *int
		var notes *string
		if err := rows.Scan(&st.ID, &st.Code, &st.Name, &w, &h, &d, &notes, &st.Active, &st.Revision, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, err
		}
		if w != nil {
			st.WidthMm = *w
		}
		if h != nil {
			st.HeightMm = *h
		}
		if d != nil {
			st.DepthMm = *d
		}
		if notes != nil {
			st.Notes = *notes
		}
		components, err := s.loadStructureComponents(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.Components = components

		presets, err := s.loadStructurePresets(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.Presets = presets

		history, err := s.loadStructureHistory(ctx, st.ID)
		if err != nil {
			return nil, err
		}
		st.History = history

		out = append(out, st)
	}
	if out == nil {
		out = []domain.Structure{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetStructureByID(ctx context.Context, id string) (*domain.Structure, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, active, revision, created_at, updated_at
		FROM structures WHERE id = $1;
	`
	var st domain.Structure
	var w, h, d *int
	var notes *string
	err := s.Pool.QueryRow(ctx, query, id).Scan(
		&st.ID, &st.Code, &st.Name, &w, &h, &d, &notes, &st.Active, &st.Revision, &st.CreatedAt, &st.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("structure not found: %w", err)
	}
	if w != nil {
		st.WidthMm = *w
	}
	if h != nil {
		st.HeightMm = *h
	}
	if d != nil {
		st.DepthMm = *d
	}
	if notes != nil {
		st.Notes = *notes
	}
	components, err := s.loadStructureComponents(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.Components = components

	presets, err := s.loadStructurePresets(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.Presets = presets

	history, err := s.loadStructureHistory(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	st.History = history

	return &st, nil
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func placementOverrideArg(p *domain.ComponentPlacement) interface{} {
	if p == nil {
		return nil
	}
	return string(*p)
}

func (s *PostgresStore) CreateStructure(ctx context.Context, st *domain.Structure) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var w, h, d interface{}
	if st.WidthMm > 0 {
		w = st.WidthMm
	}
	if st.HeightMm > 0 {
		h = st.HeightMm
	}
	if st.DepthMm > 0 {
		d = st.DepthMm
	}
	// New structures are always created active — consistent with every other
	// catalog entity (handlers POST create as active; deactivation is via PUT).
	active := true

	if st.ID != "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO structures (id, code, name, width_mm, height_mm, depth_mm, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING created_at, updated_at;
		`, st.ID, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), active).Scan(&st.CreatedAt, &st.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO structures (code, name, width_mm, height_mm, depth_mm, notes, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			RETURNING id, created_at, updated_at;
		`, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), active).Scan(&st.ID, &st.CreatedAt, &st.UpdatedAt)
	}
	if err != nil {
		return fmt.Errorf("error inserting structure: %w", err)
	}
	st.Active = active

	for _, c := range st.Components {
		_, err = tx.Exec(ctx, `
			INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
			VALUES ($1,$2,$3,$4);
		`, st.ID, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride))
		if err != nil {
			return fmt.Errorf("error inserting structure component: %w", err)
		}
	}

	for _, pr := range st.Presets {
		presetID := pr.ID
		if !isValidUUID(presetID) {
			presetID = ""
		}
		if presetID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, presetID, st.ID, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5);
			`, st.ID, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		}
		if err != nil {
			return fmt.Errorf("error inserting structure preset: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// UpdateStructure applies an edit to a published structure (#108 Slice 2):
// before mutating the row we snapshot the previous BOM-relevant fields into
// structure_revisions and bump structures.revision by one. Components/presets
// are then replaced as before. The bumped revision is written back onto st.
func (s *PostgresStore) UpdateStructure(ctx context.Context, id string, st *domain.Structure) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// --- #108: capture previous state for the immutable snapshot -------------
	var prev domain.Structure
	var pw, ph, pd *int
	err = tx.QueryRow(ctx, `
		SELECT id, code, name, width_mm, height_mm, depth_mm, revision
		FROM structures WHERE id = $1;
	`, id).Scan(&prev.ID, &prev.Code, &prev.Name, &pw, &ph, &pd, &prev.Revision)
	if err != nil {
		return fmt.Errorf("structure not found: %w", err)
	}
	if pw != nil {
		prev.WidthMm = *pw
	}
	if ph != nil {
		prev.HeightMm = *ph
	}
	if pd != nil {
		prev.DepthMm = *pd
	}
	prevComponents, err := loadStructureComponentsTx(ctx, tx, id)
	if err != nil {
		return fmt.Errorf("loading previous components for snapshot: %w", err)
	}
	prev.Components = prevComponents
	prevPresets, err := loadStructurePresetsTx(ctx, tx, id)
	if err != nil {
		return fmt.Errorf("loading previous presets for snapshot: %w", err)
	}
	prev.Presets = prevPresets

	prevRevision := prev.Revision
	if prevRevision <= 0 {
		prevRevision = 1
	}
	newRevision := prevRevision + 1

	snapshotJSON, err := structureRevisionSnapshot(prevRevision, prev)
	if err != nil {
		return fmt.Errorf("encoding structure revision snapshot: %w", err)
	}
	// INSERT ... ON CONFLICT DO NOTHING keeps the snapshot idempotent if a
	// retry of the same edit ever lands (defensive; should not happen since
	// revision always increments).
	if _, err := tx.Exec(ctx, `
		INSERT INTO structure_revisions (structure_id, revision, snapshot)
		VALUES ($1, $2, $3)
		ON CONFLICT (structure_id, revision) DO NOTHING;
	`, id, prevRevision, snapshotJSON); err != nil {
		return fmt.Errorf("error inserting structure revision snapshot: %w", err)
	}

	// --- existing row mutation (now with bumped revision) --------------------
	var w, h, d interface{}
	if st.WidthMm > 0 {
		w = st.WidthMm
	}
	if st.HeightMm > 0 {
		h = st.HeightMm
	}
	if st.DepthMm > 0 {
		d = st.DepthMm
	}

	tag, err := tx.Exec(ctx, `
		UPDATE structures
		SET code = $1, name = $2, width_mm = $3, height_mm = $4, depth_mm = $5, notes = $6, active = $7, revision = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $9;
	`, st.Code, st.Name, w, h, d, nullIfEmpty(st.Notes), st.Active, newRevision, id)
	if err != nil {
		return fmt.Errorf("error updating structure: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("structure not found")
	}

	if _, err := tx.Exec(ctx, `DELETE FROM structure_presets WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM structure_components WHERE structure_id = $1;`, id); err != nil {
		return err
	}

	for _, c := range st.Components {
		_, err = tx.Exec(ctx, `
			INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
			VALUES ($1,$2,$3,$4);
		`, id, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride))
		if err != nil {
			return fmt.Errorf("error replacing structure component: %w", err)
		}
	}

	for _, pr := range st.Presets {
		presetID := pr.ID
		if !isValidUUID(presetID) {
			presetID = ""
		}
		if presetID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5,$6);
			`, presetID, id, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO structure_presets (structure_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1,$2,$3,$4,$5);
			`, id, nullIfEmpty(pr.Name), pr.WidthMm, pr.HeightMm, pr.DepthMm)
		}
		if err != nil {
			return fmt.Errorf("error replacing structure presets: %w", err)
		}
	}

	st.ID = id
	st.Revision = newRevision
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteStructure(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM structures WHERE id = $1;`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("structure not found")
	}
	return nil
}

func isValidUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	return id[8] == '-' && id[13] == '-' && id[18] == '-' && id[23] == '-'
}
