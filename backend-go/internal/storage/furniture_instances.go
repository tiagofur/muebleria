package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #385 / DT-1: FurnitureInstance persistence (ADR-0003). One identity per
// intended physical unit, owned by exactly one Project. Creation/removal are
// business mutations: the durable security-audit event joins the same tenant
// transaction as the row change (#461 convention).

var (
	// ErrFurnitureInstanceNotFound is returned when an identity is invisible
	// under the caller's tenant scope — a foreign-org or foreign-project row
	// is indistinguishable from a missing one.
	ErrFurnitureInstanceNotFound = errors.New("furniture instance not found")
	// ErrFurnitureDefinitionNotFound rejects a create whose catalog definition
	// is invisible under the caller's organization.
	ErrFurnitureDefinitionNotFound = errors.New("furniture definition not found")
)

// CreateFurnitureInstanceCommand creates one project-owned identity. The ID is
// allocated by the database; nothing in the command can influence it, so two
// identical commands produce two distinct instances (I2) and retry safety is
// provided by the HTTP idempotency layer, not by payload hashing.
type CreateFurnitureInstanceCommand struct {
	ProjectID string
	// FurnitureDefinitionID is optional catalog provenance. Empty keeps the
	// instance definition-less (valid before any catalog binding exists).
	FurnitureDefinitionID string
	// Origin is server-authoritative provenance; callers pick the enum value
	// that matches the flow they implement ('manual' for the project API).
	Origin domain.FurnitureInstanceOrigin
	// OriginFurnitureInstanceID is required for origin='duplicate' and must
	// reference an instance of the SAME project (cross-project linking is
	// rejected server-side).
	OriginFurnitureInstanceID string
	ActorUserID               string
	IP                        string
	RequestID                 string
}

// RemoveFurnitureInstanceCommand marks one identity removed (lifecycle
// active → removed, terminal). Optimistic concurrency via ExpectedVersion.
type RemoveFurnitureInstanceCommand struct {
	FurnitureInstanceID string
	ExpectedVersion     int64
	ActorUserID         string
	IP                  string
	RequestID           string
}

const furnitureInstanceColumns = `
	id, project_id, organization_id,
	COALESCE(furniture_definition_id::text, ''),
	origin, COALESCE(origin_furniture_instance_id::text, ''),
	lifecycle_status, version, created_at, updated_at`

func scanFurnitureInstance(row pgx.Row) (*domain.FurnitureInstance, error) {
	var instance domain.FurnitureInstance
	if err := row.Scan(
		&instance.ID, &instance.ProjectID, &instance.OrganizationID,
		&instance.FurnitureDefinitionID, &instance.Origin,
		&instance.OriginFurnitureInstanceID, &instance.LifecycleStatus,
		&instance.Version, &instance.CreatedAt, &instance.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &instance, nil
}

// CreateFurnitureInstance validates project/definition/provenance visibility
// under the caller's tenant scope and inserts the identity. The insert itself
// is additionally guarded by the furniture_instances RLS policy
// (app_shared_child_matches_project): even a repository query that forgot the
// tenant filter could not attach an instance outside the project's owning
// organization.
func (s *PostgresStore) CreateFurnitureInstance(ctx context.Context, cmd CreateFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
	if !domain.IsValidFurnitureInstanceOrigin(cmd.Origin) {
		return nil, domain.ErrInvalidFurnitureInstanceCommand
	}
	if !isValidUUID(cmd.ProjectID) {
		return nil, ErrFurnitureInstanceNotFound
	}
	if cmd.Origin == domain.FurnitureInstanceOriginDuplicate && !isValidUUID(cmd.OriginFurnitureInstanceID) {
		return nil, domain.ErrInvalidFurnitureInstanceCommand
	}
	if cmd.Origin != domain.FurnitureInstanceOriginDuplicate && cmd.OriginFurnitureInstanceID != "" {
		return nil, domain.ErrInvalidFurnitureInstanceCommand
	}
	if transactionFromContext(ctx) == nil {
		var created *domain.FurnitureInstance
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			created, txErr = s.CreateFurnitureInstance(txCtx, cmd)
			return txErr
		})
		return created, err
	}

	var projectOrganizationID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id FROM projects
		WHERE id = $1
		  AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)`,
		cmd.ProjectID, OrgFromCtx(ctx),
	).Scan(&projectOrganizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFurnitureInstanceNotFound
	}
	if err != nil {
		return nil, err
	}
	if projectOrganizationID != OrgFromCtx(ctx) {
		// The project is visible (shared read) but owned by another
		// organization: furniture identity creation stays with the owner.
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}

	if cmd.FurnitureDefinitionID != "" {
		var visible bool
		if err := s.db(ctx).QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM modules WHERE id = $1)`, cmd.FurnitureDefinitionID,
		).Scan(&visible); err != nil {
			return nil, err
		}
		if !visible {
			return nil, ErrFurnitureDefinitionNotFound
		}
	}
	if cmd.OriginFurnitureInstanceID != "" {
		// Provenance must stay inside the same project: cross-project linking
		// is rejected server-side (I1).
		var visible bool
		if err := s.db(ctx).QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM furniture_instances WHERE id = $1 AND project_id = $2)`,
			cmd.OriginFurnitureInstanceID, cmd.ProjectID,
		).Scan(&visible); err != nil {
			return nil, err
		}
		if !visible {
			return nil, ErrFurnitureInstanceNotFound
		}
	}

	instance, err := scanFurnitureInstance(s.db(ctx).QueryRow(ctx, `
		INSERT INTO furniture_instances (
			organization_id, project_id, furniture_definition_id,
			origin, origin_furniture_instance_id
		)
		VALUES ($1, $2, NULLIF($3, '')::uuid, $4, NULLIF($5, '')::uuid)
		RETURNING `+furnitureInstanceColumns,
		projectOrganizationID, cmd.ProjectID, cmd.FurnitureDefinitionID,
		cmd.Origin, cmd.OriginFurnitureInstanceID))
	if err != nil {
		return nil, err
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "furniture_instance_created",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: projectOrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"furniture_instance_id": instance.ID,
			"project_id":            instance.ProjectID,
			"origin":                string(instance.Origin),
			"version":               instance.Version,
		},
	}); err != nil {
		return nil, err
	}
	return instance, nil
}

// furnitureInstanceProjectScopeFmt mirrors the furniture_instances RLS read
// policy in plain SQL (caller's organization must be explicitly named by the
// project) so the repository stays tenant-safe even on connections where RLS
// is not the enforcement layer (tests, admin tooling). The %s placeholder is
// the org bind parameter number of the calling statement.
const furnitureInstanceProjectScopeFmt = `
	AND EXISTS (
		SELECT 1 FROM projects p
		WHERE p.id = furniture_instances.project_id
		  AND (p.organization_id = %[1]s OR p.sales_organization_id = %[1]s OR p.manufacturing_organization_id = %[1]s)
	)`

// GetFurnitureInstanceByID returns the identity when visible under the
// caller's tenant scope, or (nil, nil) when it does not exist there.
func (s *PostgresStore) GetFurnitureInstanceByID(ctx context.Context, id string) (*domain.FurnitureInstance, error) {
	if id == "" {
		return nil, nil
	}
	instance, err := scanFurnitureInstance(s.db(ctx).QueryRow(ctx,
		`SELECT `+furnitureInstanceColumns+`
		FROM furniture_instances WHERE id = $1`+fmt.Sprintf(furnitureInstanceProjectScopeFmt, "$2"),
		id, OrgFromCtx(ctx)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return instance, nil
}

// ListFurnitureInstancesByProject lists every identity of one project visible
// under the caller's tenant scope, in stable creation order. IncludeTerminal
// keeps removed/cancelled rows so callers can render history; pass false for
// the active-only view.
func (s *PostgresStore) ListFurnitureInstancesByProject(ctx context.Context, projectID string, includeTerminal bool) ([]domain.FurnitureInstance, error) {
	filter := `AND lifecycle_status = 'active'`
	if includeTerminal {
		filter = ``
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+furnitureInstanceColumns+`
		FROM furniture_instances
		WHERE project_id = $1 `+filter+fmt.Sprintf(furnitureInstanceProjectScopeFmt, "$2")+`
		ORDER BY created_at, id`, projectID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	instances := []domain.FurnitureInstance{}
	for rows.Next() {
		var instance domain.FurnitureInstance
		if err := rows.Scan(
			&instance.ID, &instance.ProjectID, &instance.OrganizationID,
			&instance.FurnitureDefinitionID, &instance.Origin,
			&instance.OriginFurnitureInstanceID, &instance.LifecycleStatus,
			&instance.Version, &instance.CreatedAt, &instance.UpdatedAt,
		); err != nil {
			return nil, err
		}
		instances = append(instances, instance)
	}
	return instances, rows.Err()
}

// RemoveFurnitureInstance applies the terminal active → removed transition
// under optimistic concurrency. Already-terminal identities never change
// again (IDs are not recycled), and the removal audit joins the transaction.
func (s *PostgresStore) RemoveFurnitureInstance(ctx context.Context, cmd RemoveFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
	if !isValidUUID(cmd.FurnitureInstanceID) {
		return nil, ErrFurnitureInstanceNotFound
	}
	if cmd.ExpectedVersion < 1 {
		return nil, ErrVersionConflict
	}
	if transactionFromContext(ctx) == nil {
		var removed *domain.FurnitureInstance
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			removed, txErr = s.RemoveFurnitureInstance(txCtx, cmd)
			return txErr
		})
		return removed, err
	}

	existing, err := s.GetFurnitureInstanceByID(ctx, cmd.FurnitureInstanceID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrFurnitureInstanceNotFound
	}
	if existing.OrganizationID != OrgFromCtx(ctx) {
		// Visible through the project's shared read scope, but lifecycle
		// mutations stay with the owning organization.
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	if domain.FurnitureInstanceLifecycleTerminal(existing.LifecycleStatus) {
		return nil, domain.ErrFurnitureInstanceLifecycleConflict
	}
	if existing.Version != cmd.ExpectedVersion {
		return nil, ErrVersionConflict
	}

	instance, err := scanFurnitureInstance(s.db(ctx).QueryRow(ctx, `
		UPDATE furniture_instances
		SET lifecycle_status = 'removed', version = version + 1, updated_at = NOW()
		WHERE id = $1 AND version = $2 AND lifecycle_status = 'active'`+fmt.Sprintf(furnitureInstanceProjectScopeFmt, "$3")+`
		RETURNING `+furnitureInstanceColumns,
		cmd.FurnitureInstanceID, cmd.ExpectedVersion, OrgFromCtx(ctx)))
	if errors.Is(err, pgx.ErrNoRows) {
		// Concurrent transition won the race inside this transaction's scope.
		return nil, ErrVersionConflict
	}
	if err != nil {
		return nil, err
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "furniture_instance_removed",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: instance.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"furniture_instance_id": instance.ID,
			"project_id":            instance.ProjectID,
			"last_version":          cmd.ExpectedVersion,
			"version":               instance.Version,
		},
	}); err != nil {
		return nil, err
	}
	return instance, nil
}

func tenantActorUserID(ctx context.Context) string {
	actor, ok := TenantActorFromCtx(ctx)
	if !ok {
		return ""
	}
	return actor.UserID
}

func nonEmptyOrDefault(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
