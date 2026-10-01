package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Component side assignment persistence (#915 backend): which hardware
// profile applies to one canonical board face of a component DEFINITION.
// Tenant-scoped like every catalog entity; the (component, side) pair is
// unique — setting a side replaces that side's assignment, removing it
// restores inheritance. Reference integrity (component and profile must
// exist in the caller's organization) is enforced here, fail-closed.

// --- COMPONENT SIDE ASSIGNMENTS ---

func (s *PostgresStore) ListComponentSideAssignments(ctx context.Context, componentID string) ([]domain.ComponentSideAssignment, error) {
	query := `
		SELECT id, component_id, side, profile_id, created_at, updated_at
		FROM component_side_assignments
		WHERE organization_id = $1 AND component_id = $2
		ORDER BY side ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx), componentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []domain.ComponentSideAssignment{}
	for rows.Next() {
		assignment, err := scanComponentSideAssignment(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *assignment)
	}
	return list, nil
}

// SetComponentSideAssignment upserts the assignment of one (component, side)
// pair. Both references are validated within the caller's organization
// first: a broken reference is a structured failure, never a dangling row.
func (s *PostgresStore) SetComponentSideAssignment(ctx context.Context, assignment *domain.ComponentSideAssignment) error {
	if err := s.validateAssignmentReferences(ctx, assignment); err != nil {
		return err
	}
	query := `
		INSERT INTO component_side_assignments (organization_id, component_id, side, profile_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (component_id, side)
		DO UPDATE SET profile_id = EXCLUDED.profile_id, updated_at = CURRENT_TIMESTAMP
		RETURNING id, created_at, updated_at;
	`
	err := s.db(ctx).QueryRow(ctx, query, OrgFromCtx(ctx), assignment.ComponentID, assignment.Side, assignment.ProfileID).
		Scan(&assignment.ID, &assignment.CreatedAt, &assignment.UpdatedAt)
	if err != nil {
		return fmt.Errorf("set component side assignment: %w", err)
	}
	return nil
}

// RemoveComponentSideAssignment deletes the assignment of one (component,
// side) pair. RowsAffected 0 → not found (indistinguishable from another
// org's row, per the isolation contract).
func (s *PostgresStore) RemoveComponentSideAssignment(ctx context.Context, componentID, side string) error {
	query := `
		DELETE FROM component_side_assignments
		WHERE organization_id = $1 AND component_id = $2 AND side = $3;
	`
	tag, err := s.db(ctx).Exec(ctx, query, OrgFromCtx(ctx), componentID, side)
	if err != nil {
		return fmt.Errorf("remove component side assignment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("component side assignment not found")
	}
	return nil
}

// validateAssignmentReferences proves both references exist in the caller's
// organization: the component (definition owner) and the profile (active).
// Cross-org references are indistinguishable from missing ones — the
// rejection never leaks the other tenant's catalog.
func (s *PostgresStore) validateAssignmentReferences(ctx context.Context, assignment *domain.ComponentSideAssignment) error {
	var componentExists bool
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM components WHERE id = $1 AND organization_id = $2)`,
		assignment.ComponentID, OrgFromCtx(ctx)).Scan(&componentExists); err != nil {
		return fmt.Errorf("check component reference: %w", err)
	}
	if !componentExists {
		return fmt.Errorf("%w: component %s does not exist in this organization", ErrAssignmentReferenceInvalid, assignment.ComponentID)
	}
	var profileExists bool
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM hardware_profiles WHERE id = $1 AND organization_id = $2 AND active = TRUE)`,
		assignment.ProfileID, OrgFromCtx(ctx)).Scan(&profileExists); err != nil {
		return fmt.Errorf("check profile reference: %w", err)
	}
	if !profileExists {
		return fmt.Errorf("%w: hardware profile %s does not exist in this organization", ErrAssignmentReferenceInvalid, assignment.ProfileID)
	}
	return nil
}

// ErrAssignmentReferenceInvalid marks a set/replace whose component or
// profile reference is missing or cross-org (#915: assignment inválido
// falla explícitamente).
var ErrAssignmentReferenceInvalid = errors.New("component side assignment reference invalid")

func scanComponentSideAssignment(row pgx.Row) (*domain.ComponentSideAssignment, error) {
	var a domain.ComponentSideAssignment
	if err := row.Scan(&a.ID, &a.ComponentID, &a.Side, &a.ProfileID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("component side assignment not found")
		}
		return nil, err
	}
	return &a, nil
}
