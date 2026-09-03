package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #386 / DT-2: QuoteLine ↔ FurnitureInstance persistence (ADR-0003,
// digital-thread §6). The relation row answers "which physical unit does this
// quote line represent"; FurnitureInstance stays project-owned and the quote
// only references that identity. QuoteLine maps to today's persisted
// commercial line (project_items) and quote acceptance to projects.status
// ('accepted'/'produced'); the conceptual contract is unchanged.

var (
	// ErrQuoteLineNotFound is returned when a quote line is invisible under
	// the caller's tenant scope or does not belong to the requested project —
	// a foreign-org line is indistinguishable from a missing one.
	ErrQuoteLineNotFound = errors.New("quote line not found")
)

// MaterializeQuoteLineCommand converges one quote line's physical units to its
// commercial quantity. The command carries no instance inputs: identities are
// allocated by the database (never derived from the line id, quantity or
// definition — I2) and retry safety comes from convergence plus the HTTP
// idempotency layer.
type MaterializeQuoteLineCommand struct {
	ProjectID   string
	QuoteLineID string
	ActorUserID string
	IP          string
	RequestID   string
}

const quoteLineFurnitureColumns = `
	qli.id, qli.project_id, qli.quote_line_id, qli.furniture_instance_id, qli.created_at,
	fi.id, fi.project_id, fi.organization_id,
	COALESCE(fi.furniture_definition_id::text, ''),
	fi.origin, COALESCE(fi.origin_furniture_instance_id::text, ''),
	fi.lifecycle_status, fi.version, fi.created_at, fi.updated_at`

// quoteLineFurnitureQuery reads the LIVE commercial representation
// (state='current'). Superseded history rows — the ones revisioned quotes
// will preserve for accepted revisions — never count towards materialization
// or the public per-line answer.
const quoteLineFurnitureQuery = `
	SELECT ` + quoteLineFurnitureColumns + `
	FROM quote_line_furniture_instances qli
	JOIN furniture_instances fi ON fi.id = qli.furniture_instance_id
	WHERE qli.quote_line_id = $1
	  AND qli.state = 'current'
	  AND EXISTS (
		SELECT 1 FROM projects p
		WHERE p.id = qli.project_id
		  AND (p.organization_id = $2 OR p.sales_organization_id = $2 OR p.manufacturing_organization_id = $2)
	  )
	ORDER BY fi.created_at, fi.id`

func scanQuoteLineFurnitureInstance(row pgx.Row) (*domain.QuoteLineFurnitureInstance, error) {
	var link domain.QuoteLineFurnitureInstance
	if err := row.Scan(
		&link.ID, &link.ProjectID, &link.QuoteLineID, &link.FurnitureInstanceID, &link.CreatedAt,
		&link.FurnitureInstance.ID, &link.FurnitureInstance.ProjectID, &link.FurnitureInstance.OrganizationID,
		&link.FurnitureInstance.FurnitureDefinitionID, &link.FurnitureInstance.Origin,
		&link.FurnitureInstance.OriginFurnitureInstanceID, &link.FurnitureInstance.LifecycleStatus,
		&link.FurnitureInstance.Version, &link.FurnitureInstance.CreatedAt, &link.FurnitureInstance.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &link, nil
}

func (s *PostgresStore) listQuoteLineLinks(ctx context.Context, quoteLineID string) ([]domain.QuoteLineFurnitureInstance, error) {
	rows, err := s.db(ctx).Query(ctx, quoteLineFurnitureQuery, quoteLineID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := []domain.QuoteLineFurnitureInstance{}
	for rows.Next() {
		link, err := scanQuoteLineFurnitureInstance(rows)
		if err != nil {
			return nil, err
		}
		links = append(links, *link)
	}
	return links, rows.Err()
}

// quoteLineCommercialState loads the line (today project_items) together with
// its project's owning organization and acceptance status, under the caller's
// tenant scope.
func (s *PostgresStore) quoteLineCommercialState(ctx context.Context, projectID, quoteLineID string) (moduleID string, quantity int, projectOrganizationID, projectStatus string, err error) {
	err = s.db(ctx).QueryRow(ctx, `
		SELECT pi.module_id::text, pi.quantity, p.organization_id::text, p.status
		FROM project_items pi
		JOIN projects p ON p.id = pi.project_id
		WHERE pi.id = $1 AND pi.project_id = $2
		  AND (p.organization_id = $3 OR p.sales_organization_id = $3 OR p.manufacturing_organization_id = $3)`,
		quoteLineID, projectID, OrgFromCtx(ctx),
	).Scan(&moduleID, &quantity, &projectOrganizationID, &projectStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, "", "", ErrQuoteLineNotFound
	}
	if err != nil {
		return "", 0, "", "", err
	}
	return moduleID, quantity, projectOrganizationID, projectStatus, nil
}

// quoteLineInstanceDurableHistory reports why a linked instance may NOT be
// retired by a quantity decrease (digital-thread §6: identity with durable
// history survives; it is never recycled). Enforceable blockers:
//
//   - commercial acceptance itself (rejected before this hook runs);
//   - an instance this quote flow did not create (origin != 'quote'), e.g. a
//     design-created unit linked by a future re-quote (#388);
//   - design revision references (#387 DT-3): any unit included in a
//     published DesignRevisionItem has durable design history.
func (s *PostgresStore) quoteLineInstanceDurableHistory(ctx context.Context, instance domain.FurnitureInstance) ([]string, error) {
	var blockers []string
	if instance.Origin != domain.FurnitureInstanceOriginQuote {
		blockers = append(blockers, "origin:"+string(instance.Origin))
	}
	var hasDesign bool
	err := s.db(ctx).QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM design_revision_items WHERE furniture_instance_id = $1
		)
	`, instance.ID).Scan(&hasDesign)
	if err != nil {
		return nil, err
	}
	if hasDesign {
		blockers = append(blockers, "design_revision_item")
	}
	return blockers, nil
}

// MaterializeQuoteLine converges the line's linked ACTIVE physical units to
// its commercial quantity:
//
//   - fewer than quantity → create the missing units (origin='quote') and link
//     them; existing identities are never recreated or replaced;
//   - more than quantity (draft decrease) → retire the newest surplus units
//     with the terminal 'cancelled' lifecycle and unlink them; identities are
//     never deleted and never re-linked later;
//   - links whose instance already reached another terminal state (explicit
//     :remove) are unlinked so the line's representation stays exact.
//
// The command is idempotent (a second run with the same state is a no-op) and
// serialized per line (advisory xact lock) so concurrent commands with
// different idempotency keys still converge to exactly `quantity` units. It
// fails typed once the project's commercial truth is pinned (accepted /
// produced): accepted quote materialization is immutable (I3) — later
// commercial changes require a new quote revision.
func (s *PostgresStore) MaterializeQuoteLine(ctx context.Context, cmd MaterializeQuoteLineCommand) (*domain.QuoteLineMaterialization, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.QuoteLineID) {
		return nil, ErrQuoteLineNotFound
	}
	if transactionFromContext(ctx) == nil {
		var result *domain.QuoteLineMaterialization
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.MaterializeQuoteLine(txCtx, cmd)
			return txErr
		})
		return result, err
	}

	moduleID, quantity, projectOrganizationID, projectStatus, err := s.quoteLineCommercialState(ctx, cmd.ProjectID, cmd.QuoteLineID)
	if err != nil {
		return nil, err
	}
	if projectOrganizationID != OrgFromCtx(ctx) {
		// The project is visible (shared read) but owned by another
		// organization: materialization stays with the owner.
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	if projectStatus != "draft" && projectStatus != "quoted" {
		return nil, domain.ErrQuoteRevisionAccepted
	}

	// Serialize concurrent materializations of the same line so two commands
	// with different idempotency keys cannot both materialize the same delta.
	if _, err := s.db(ctx).Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, cmd.QuoteLineID); err != nil {
		return nil, err
	}

	links, err := s.listQuoteLineLinks(ctx, cmd.QuoteLineID)
	if err != nil {
		return nil, err
	}
	active := make([]domain.QuoteLineFurnitureInstance, 0, quantity)
	terminal := make([]domain.QuoteLineFurnitureInstance, 0)
	for _, link := range links {
		if link.FurnitureInstance.LifecycleStatus == domain.FurnitureInstanceLifecycleActive {
			active = append(active, link)
		} else {
			terminal = append(terminal, link)
		}
	}

	created := []string{}
	cancelled := []string{}
	unlinked := []string{}

	// Increase: materialize only the delta — existing identities survive.
	for i := len(active); i < quantity; i++ {
		instance, err := s.CreateFurnitureInstance(ctx, CreateFurnitureInstanceCommand{
			ProjectID:             cmd.ProjectID,
			FurnitureDefinitionID: moduleID,
			Origin:                domain.FurnitureInstanceOriginQuote,
			ActorUserID:           cmd.ActorUserID,
			IP:                    cmd.IP,
			RequestID:             cmd.RequestID,
		})
		if err != nil {
			return nil, err
		}
		if _, err := s.db(ctx).Exec(ctx, `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id, state)
			VALUES ($1, $2, $3, $4, 'current')`,
			projectOrganizationID, cmd.ProjectID, cmd.QuoteLineID, instance.ID); err != nil {
			return nil, err
		}
		created = append(created, instance.ID)
	}

	// Draft decrease: retire the NEWEST surplus units (stable order keeps the
	// earliest identities — reconciliation-friendly). Durable history blocks
	// retirement; cancelled identities are unlinked and never re-linked.
	for i := len(active) - 1; i >= quantity; i-- {
		instance := active[i].FurnitureInstance
		blockers, err := s.quoteLineInstanceDurableHistory(ctx, instance)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return nil, fmt.Errorf("%w: %s %v", domain.ErrFurnitureInstanceDurableHistory, instance.ID, blockers)
		}
		tag, err := s.db(ctx).Exec(ctx, `
			UPDATE furniture_instances
			SET lifecycle_status = 'cancelled', version = version + 1, updated_at = NOW()
			WHERE id = $1 AND lifecycle_status = 'active'`,
			instance.ID)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			// A concurrent transition won the race inside this command.
			return nil, ErrVersionConflict
		}
		if _, err := s.db(ctx).Exec(ctx,
			`DELETE FROM quote_line_furniture_instances WHERE furniture_instance_id = $1`, instance.ID); err != nil {
			return nil, err
		}
		cancelled = append(cancelled, instance.ID)
	}

	// Stale links to already-terminal instances (explicit :remove) no longer
	// represent quoted units.
	for _, link := range terminal {
		if _, err := s.db(ctx).Exec(ctx,
			`DELETE FROM quote_line_furniture_instances WHERE furniture_instance_id = $1`,
			link.FurnitureInstanceID); err != nil {
			return nil, err
		}
		unlinked = append(unlinked, link.FurnitureInstanceID)
	}

	if len(created) > 0 || len(cancelled) > 0 || len(unlinked) > 0 {
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
			EventType:      "quote_line_furniture_materialized",
			ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
			OrganizationID: projectOrganizationID,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details: map[string]interface{}{
				"project_id":                      cmd.ProjectID,
				"quote_line_id":                   cmd.QuoteLineID,
				"quantity":                        quantity,
				"created_furniture_instance_ids":  created,
				"cancelled_furniture_instance_ids": cancelled,
				"unlinked_furniture_instance_ids":  unlinked,
			},
		}); err != nil {
			return nil, err
		}
	}

	finalLinks, err := s.listQuoteLineLinks(ctx, cmd.QuoteLineID)
	if err != nil {
		return nil, err
	}
	return &domain.QuoteLineMaterialization{
		ProjectID:            cmd.ProjectID,
		QuoteLineID:          cmd.QuoteLineID,
		Quantity:             quantity,
		Instances:            finalLinks,
		CreatedInstanceIDs:   created,
		CancelledInstanceIDs: cancelled,
		UnlinkedInstanceIDs:  unlinked,
	}, nil
}

// ListQuoteLineFurnitureInstances answers which physical units a quote line
// represents, in stable creation order, visible under the caller's tenant
// scope.
func (s *PostgresStore) ListQuoteLineFurnitureInstances(ctx context.Context, projectID, quoteLineID string) ([]domain.QuoteLineFurnitureInstance, error) {
	if !isValidUUID(projectID) || !isValidUUID(quoteLineID) {
		return nil, ErrQuoteLineNotFound
	}
	if _, _, _, _, err := s.quoteLineCommercialState(ctx, projectID, quoteLineID); err != nil {
		return nil, err
	}
	return s.listQuoteLineLinks(ctx, quoteLineID)
}

// quoteLinesStillMaterializedTx returns the quote line ids of a project that
// still represent linked furniture units in the LIVE representation. The
// repository uses it to fail loud (typed) before deleting/replacing project
// items whose commercial ↔ physical linkage would otherwise dangle — the
// deferred FK is the backstop.
func quoteLinesStillMaterializedTx(ctx context.Context, tx pgx.Tx, projectID string) ([]string, error) {
	rows, err := tx.Query(ctx,
		`SELECT DISTINCT quote_line_id FROM quote_line_furniture_instances WHERE project_id = $1 AND state = 'current'`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
