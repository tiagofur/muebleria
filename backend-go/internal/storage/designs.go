package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots
// (ADR-0003, digital-thread §§7-10).

// ErrDraftUnitPreparationConflict is retryable: a concurrent materializer or
// draft-line mutation owns a lock that Design preparation cannot safely wait
// for while holding the project row lock.
var ErrDraftUnitPreparationConflict = errors.New("draft unit preparation conflicts with a concurrent change")

type CreateDesignCommand struct {
	ProjectID             string
	Name                  string
	SourceQuoteRevisionID string
	Status                domain.DesignStatus
	ActorUserID           string
	IP                    string
	RequestID             string
}

// PrepareDesignDraftUnitsCommand is the explicit recovery/handoff intent for
// an existing Design whose project gained draft lines after its creation.
type PrepareDesignDraftUnitsCommand struct {
	ProjectID   string
	DesignID    string
	ActorUserID string
	IP          string
	RequestID   string
}

type PublishDesignRevisionItemCommand struct {
	FurnitureInstanceID    string
	FurnitureDefinitionID  string
	DefinitionVersion      *int
	Parameters             map[string]any
	MaterialChoices        map[string]string
	MaterialChoiceSources  map[string]domain.DesignMaterialProvenance
	MaterialChoiceModes    map[string]domain.DesignMaterialChoiceMode
	PresentationSnapshot   *domain.DesignRevisionPresentationSnapshot
	Transform              domain.Transform3D
	RoomID                 string
	TechnicalClientLocator *domain.TechnicalClientLocator
}

type PublishDesignRevisionCommand struct {
	DesignID       string
	BaseRevisionID string
	SourceType     domain.DesignRevisionSourceType
	ActorUserID    string
	IP             string
	RequestID      string
}

type UpdateDesignWorkingCopyItemCommand struct {
	FurnitureInstanceID    string
	FurnitureDefinitionID  string
	DefinitionVersion      *int
	Parameters             map[string]any
	MaterialChoices        map[string]string
	MaterialChoiceModes    map[string]domain.DesignMaterialChoiceMode
	Transform              domain.Transform3D
	RoomID                 string
	TechnicalClientLocator *domain.TechnicalClientLocator
}

// #810 — WorkingCopy optimistic-concurrency frontier. The canonical
// workingVersion token is the working-copy updated_at exactly as returned by
// the caller's last authoritative read; it is validated under the write lock
// so a stale writer can never overwrite a newer accepted state (#679). The
// SQL lock serializes writers; this precondition proves the input is current.
var (
	ErrWorkingCopyPreconditionRequired = errors.New("working copy write requires expected_working_version")
	ErrWorkingCopyVersionConflict      = errors.New("working copy version conflict")
)

type UpdateDesignWorkingCopyCommand struct {
	DesignID               string
	BaseRevisionID         *string
	ExpectedWorkingVersion *time.Time
	SourceType             domain.DesignRevisionSourceType
	// AuthoringDefaults follows the #810 caller-merge frontier: nil keeps the
	// stored Design defaults (the field is not part of this write); non-nil
	// replaces them wholesale — including an explicit empty block.
	AuthoringDefaults *domain.DesignAuthoringDefaults
	Items             []UpdateDesignWorkingCopyItemCommand
	ActorUserID       string
}

type ResetDesignWorkingCopyCommand struct {
	DesignID               string
	RevisionID             string
	ExpectedWorkingVersion *time.Time
	ActorUserID            string
}

const designColumns = `
	id, organization_id, project_id, name,
	COALESCE(source_quote_revision_id::text, ''),
	status, COALESCE(created_by::text, ''),
	created_at, updated_at`

func scanDesign(row pgx.Row) (*domain.Design, error) {
	var d domain.Design
	if err := row.Scan(
		&d.ID, &d.OrganizationID, &d.ProjectID, &d.Name,
		&d.SourceQuoteRevisionID, &d.Status, &d.CreatedBy,
		&d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	return &d, nil
}

func (s *PostgresStore) CreateDesign(ctx context.Context, cmd CreateDesignCommand) (*domain.Design, error) {
	name := strings.TrimSpace(cmd.Name)
	if name == "" || !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.Status == "" {
		cmd.Status = domain.DesignStatusActive
	} else if !domain.IsValidDesignStatus(cmd.Status) {
		return nil, domain.ErrInvalidDesignCommand
	}
	if cmd.SourceQuoteRevisionID != "" && !isValidUUID(cmd.SourceQuoteRevisionID) {
		return nil, domain.ErrInvalidDesignCommand
	}

	if transactionFromContext(ctx) == nil {
		var created *domain.Design
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			res, err := s.CreateDesign(txCtx, cmd)
			if err != nil {
				return err
			}
			created = res
			return nil
		})
		return created, err
	}

	// Lock the project before reading its draft lines. Generic project edits
	// update this row before replacing lines, so preparation observes one
	// coherent commercial draft and cannot race a normal edit into a partial
	// set of physical identities.
	var projectOrgID, projectStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, status FROM projects WHERE id = $1 FOR UPDATE
	`, cmd.ProjectID).Scan(&projectOrgID, &projectStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	actorOrg := OrgFromCtx(ctx)
	if actorOrg != "" && actorOrg != projectOrgID {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}

	// #831: the first Design intent prepares existing draft quote lines as
	// pending project units, without creating a QuoteRevision or placing items
	// in the WorkingCopy. A Design sourced from a formal quote already has its
	// own immutable commercial context and must not re-converge live lines.
	if cmd.SourceQuoteRevisionID == "" && projectStatus == "draft" {
		if err := s.prepareDraftProjectItemsTx(ctx, cmd.ProjectID, cmd.ActorUserID, cmd.IP, cmd.RequestID); err != nil {
			return nil, err
		}
	}

	var sourceQuoteRev *string
	if cmd.SourceQuoteRevisionID != "" {
		sourceQuoteRev = &cmd.SourceQuoteRevisionID
	}
	var createdBy *string
	if isValidUUID(cmd.ActorUserID) {
		createdBy = &cmd.ActorUserID
	}

	row := s.db(ctx).QueryRow(ctx, `
		INSERT INTO designs (organization_id, project_id, name, source_quote_revision_id, status, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+designColumns,
		projectOrgID, cmd.ProjectID, name, sourceQuoteRev, cmd.Status, createdBy,
	)
	design, err := scanDesign(row)
	if err != nil {
		return nil, err
	}

	// Initialize persistent working copy draft for the design (ADR-0003, digital-thread §8).
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, updated_at, updated_by)
		VALUES ($1, $2, $3, NULL, 'manual', NOW(), $4)
		ON CONFLICT (design_id) DO NOTHING
	`, design.ID, design.OrganizationID, design.ProjectID, nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)))
	if err != nil {
		return nil, fmt.Errorf("initialize design working copy: %w", err)
	}

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "design_created",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: design.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"design_id":                design.ID,
			"project_id":               design.ProjectID,
			"name":                     design.Name,
			"status":                   string(design.Status),
			"source_quote_revision_id": design.SourceQuoteRevisionID,
		},
	}); err != nil {
		return nil, fmt.Errorf("audit design_created: %w", err)
	}

	return design, nil
}

// PrepareDesignDraftUnits converges a previously created Design's live draft
// project units before handoff. It is a POST-side mutation; GET/list readers
// never invoke it. Both entry points use the same transactional helper.
func (s *PostgresStore) PrepareDesignDraftUnits(ctx context.Context, cmd PrepareDesignDraftUnitsCommand) error {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.DesignID) {
		return domain.ErrDesignNotFound
	}
	if transactionFromContext(ctx) == nil {
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		return s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			return s.PrepareDesignDraftUnits(txCtx, cmd)
		})
	}
	var projectOrgID, projectStatus string
	err := s.db(ctx).QueryRow(ctx,
		`SELECT organization_id, status FROM projects WHERE id = $1 FOR UPDATE`, cmd.ProjectID).
		Scan(&projectOrgID, &projectStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrDesignNotFound
	}
	if err != nil {
		return err
	}
	if projectOrgID != OrgFromCtx(ctx) {
		return domain.ErrFurnitureInstanceProjectNotWritable
	}
	var designStatus domain.DesignStatus
	err = s.db(ctx).QueryRow(ctx,
		`SELECT status FROM designs WHERE id = $1 AND project_id = $2`, cmd.DesignID, cmd.ProjectID).
		Scan(&designStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrDesignNotFound
	}
	if err != nil {
		return err
	}
	if designStatus != domain.DesignStatusActive {
		return domain.ErrDesignNotActive
	}
	if projectStatus != "draft" {
		return nil
	}
	return s.prepareDraftProjectItemsTx(ctx, cmd.ProjectID, cmd.ActorUserID, cmd.IP, cmd.RequestID)
}

// prepareDraftProjectItemsTx requires a tenant transaction and a FOR UPDATE
// lock on the owning project row. It must never wait on a line row or the
// per-line advisory key while holding that project lock: standalone line
// removal/materialization can own those locks before needing the project row.
func (s *PostgresStore) prepareDraftProjectItemsTx(ctx context.Context, projectID, actorUserID, ip, requestID string) error {
	var hasQuoteRevision bool
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM quote_revisions WHERE project_id = $1)`, projectID).
		Scan(&hasQuoteRevision); err != nil {
		return err
	}
	if hasQuoteRevision {
		return nil
	}
	rows, err := s.db(ctx).Query(ctx,
		`SELECT id::text FROM project_items WHERE project_id = $1 ORDER BY id FOR SHARE NOWAIT`, projectID)
	if err != nil {
		return draftPreparationLockError(err)
	}
	lineIDs := []string{}
	for rows.Next() {
		var lineID string
		if err := rows.Scan(&lineID); err != nil {
			rows.Close()
			return err
		}
		lineIDs = append(lineIDs, lineID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return draftPreparationLockError(err)
	}
	// MaterializeQuoteLine takes this exact key. Pre-acquiring it with try-lock
	// keeps its later reentrant acquisition nonblocking under the project lock;
	// a competing explicit materializer can finish after our tx backs out.
	for _, lineID := range lineIDs {
		var acquired bool
		if err := s.db(ctx).QueryRow(ctx,
			`SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))`, lineID).Scan(&acquired); err != nil {
			return err
		}
		if !acquired {
			return ErrDraftUnitPreparationConflict
		}
	}
	for _, lineID := range lineIDs {
		if _, err := s.MaterializeQuoteLine(ctx, MaterializeQuoteLineCommand{
			ProjectID: projectID, QuoteLineID: lineID,
			ActorUserID: actorUserID, IP: ip, RequestID: requestID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func draftPreparationLockError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "55P03" { // lock_not_available from NOWAIT
		return ErrDraftUnitPreparationConflict
	}
	return err
}

func (s *PostgresStore) GetDesignByID(ctx context.Context, designID string) (*domain.Design, error) {
	if !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	row := s.db(ctx).QueryRow(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE id = $1
	`, designID)
	return scanDesign(row)
}

func (s *PostgresStore) ListDesignsByProject(ctx context.Context, projectID string) ([]domain.Design, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrDesignNotFound
	}
	// Verify project access.
	var pOrg string
	if err := s.db(ctx).QueryRow(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).Scan(&pOrg); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE project_id = $1
		ORDER BY created_at ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var designs []domain.Design
	for rows.Next() {
		d, err := scanDesign(rows)
		if err != nil {
			return nil, err
		}
		designs = append(designs, *d)
	}
	return designs, rows.Err()
}

const designRevisionColumns = `
	id, organization_id, project_id, design_id,
	revision_number, COALESCE(parent_revision_id::text, ''),
	source_type, status, COALESCE(created_by::text, ''),
	created_at, COALESCE(approved_by::text, ''), approved_at,
	COALESCE(created_by_display_name, ''), COALESCE(approved_by_display_name, ''),
	authoring_defaults_snapshot, effective_library_release_id`

func (s *PostgresStore) GetModelBindingContext(ctx context.Context, projectID, designID string, baseRevisionID *string) (*ModelBindingContext, error) {
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	if baseRevisionID != nil && *baseRevisionID != "" && !isValidUUID(*baseRevisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}

	out := &ModelBindingContext{ProjectID: projectID}

	// 1. Project + owning organization (display summary for the plugin dialog).
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.name, p.organization_id::text, o.name, c.id::text, c.name
		FROM projects p
		JOIN organizations o ON o.id = p.organization_id
		JOIN customers c ON c.id = p.customer_id AND c.organization_id = p.organization_id
		WHERE p.id = $1 AND p.organization_id = $2
	`, projectID, OrgFromCtx(ctx)).Scan(&out.ProjectName, &out.OrganizationID, &out.OrganizationName, &out.CustomerID, &out.CustomerName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, fmt.Errorf("resolve binding project: %w", err)
	}

	// 2. Design must exist AND belong to the exact path project. A design from
	// another project (or another organization, hidden by RLS) is uniformly
	// not-found — never a partial context (#388 negative proofs).
	design, err := scanDesign(s.db(ctx).QueryRow(ctx, `
		SELECT `+designColumns+`
		FROM designs
		WHERE id = $1 AND project_id = $2
	`, designID, projectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, fmt.Errorf("resolve binding design: %w", err)
	}
	out.Design = *design

	// 3. Authoritative working-copy base (absent on a fresh design).
	var wcBase *string
	var wcUpdatedAt *time.Time
	err = s.db(ctx).QueryRow(ctx, `
		SELECT base_revision_id::text, updated_at
		FROM design_working_copies
		WHERE design_id = $1
	`, designID).Scan(&wcBase, &wcUpdatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("resolve binding working copy: %w", err)
	}
	if wcBase != nil {
		out.WorkingCopyBaseRevisionID = wcBase
	}
	if wcUpdatedAt != nil {
		out.WorkingCopyUpdatedAt = *wcUpdatedAt
	} else {
		out.WorkingCopyUpdatedAt = design.UpdatedAt
	}

	// 4. Revision number of the authoritative base, when one exists.
	if out.WorkingCopyBaseRevisionID != nil {
		var revNum int
		err = s.db(ctx).QueryRow(ctx, `
			SELECT revision_number
			FROM design_revisions
			WHERE id = $1 AND design_id = $2
		`, *out.WorkingCopyBaseRevisionID, designID).Scan(&revNum)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, fmt.Errorf("resolve binding base revision: %w", err)
		}
		out.BaseRevisionNumber = &revNum
	}

	// 5. When the client already carries a binding base, that revision must
	// exist and belong to this design. Unknown or foreign revisions are
	// rejected instead of silently re-based.
	if baseRevisionID != nil && *baseRevisionID != "" {
		var revDesignID string
		err = s.db(ctx).QueryRow(ctx, `
			SELECT design_id FROM design_revisions WHERE id = $1
		`, *baseRevisionID).Scan(&revDesignID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, fmt.Errorf("validate client binding base: %w", err)
		}
		if revDesignID != designID {
			return nil, domain.ErrDesignRevisionNotFound
		}
	}

	return out, nil
}
