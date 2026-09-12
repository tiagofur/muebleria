package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #571 / WEB-DT-4: server-authoritative commercial QuoteRevision lifecycle
// (ADR-0003, digital-thread §§15–16, 25).
//
// Three application commands close the P0 found by the 2026-09-06 rehearsal:
//
//   - CreateInitialQuoteRevision: the canonical Q1 entry. Snapshots the
//     project's current EDITABLE commercial state (quote lines + their
//     materialized physical units) into an immutable draft revision. Solves
//     the circular dependency where requote needs a base revision but nothing
//     could create the first one.
//   - PublishQuoteRevision: the explicit draft → published transition on an
//     exact revision.
//   - AcceptQuoteRevision: the explicit published → accepted transition that
//     ATOMICALLY supersedes the previously accepted revision of the project in
//     the same transaction — never two client calls, never two accepted.
//
// The per-row lifecycle remains owned by CreateQuoteRevision /
// UpdateQuoteRevisionStatus and the DB triggers (000115–000117); the partial
// unique index (000121) is the durable single-accepted backstop.

// CreateInitialQuoteRevisionCommand holds the explicit Q1 decision. The
// command carries no commercial payload: the server builds the whole snapshot
// from authoritative state (quote lines, materialized FurnitureInstances,
// design truth and catalog definitions).
//
// BaseQuoteRevisionID (#642 legacy recovery) extends the same command to
// MODERNIZE a project whose exact latest revision is a legacy row without
// commercial snapshot: the next revision is minted from the CURRENT editable
// commercial state with a fresh canonical snapshot, basing on that legacy
// revision. The legacy row is never mutated, backfilled or replaced — a modern
// revision with a snapshot already in place must go through requote instead.
type CreateInitialQuoteRevisionCommand struct {
	ProjectID   string
	Notes       string
	ActorUserID string
	IP          string
	RequestID   string
	// BaseQuoteRevisionID is required when the project already has quote
	// revisions (the #393 writer enforces exact-latest); it must reference a
	// snapshot-less legacy latest revision or the command rejects typed.
	BaseQuoteRevisionID string
}

// CreateInitialQuoteRevisionResult returns the created draft revision plus the
// physical units the command had to materialize to converge the commercial
// quantity (empty when the project was already materialized).
type CreateInitialQuoteRevisionResult struct {
	Revision           *domain.QuoteRevision
	CreatedInstanceIDs []string
}

// AcceptQuoteRevisionResult returns the accepted revision plus the previously
// accepted revisions it superseded atomically.
type AcceptQuoteRevisionResult struct {
	Revision            *domain.QuoteRevision
	SupersededRevisions []domain.QuoteRevision
}

// CreateInitialQuoteRevision converts the project's current editable
// commercial state into the FIRST QuoteRevision (draft), or — with
// BaseQuoteRevisionID — into the NEXT revision that modernizes an exactly
// latest legacy revision without commercial snapshot (#642 legacy recovery).
//
// Business atomicity: per-line materialization convergence (#386, idempotent
// and only permitted while the project is still draft/quoted), snapshot
// building, revision creation and audit all run inside ONE transaction — a
// failure leaves no partial revision. Revision creation goes through the
// single #393 writer with its fail-closed optimistic concurrency: a retry
// after success (or a concurrent create) returns ErrQuoteRevisionConflict
// instead of minting a second revision.
func (s *PostgresStore) CreateInitialQuoteRevision(ctx context.Context, cmd CreateInitialQuoteRevisionCommand) (*CreateInitialQuoteRevisionResult, error) {
	if !isValidUUID(cmd.ProjectID) {
		return nil, domain.ErrInvalidRevisionID
	}
	if cmd.BaseQuoteRevisionID != "" && !isValidUUID(cmd.BaseQuoteRevisionID) {
		return nil, domain.ErrInvalidRevisionID
	}
	if transactionFromContext(ctx) == nil {
		var result *CreateInitialQuoteRevisionResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.CreateInitialQuoteRevision(txCtx, cmd)
			return txErr
		})
		return result, err
	}

	// 1. Load the project under the caller's tenant scope. Commercial
	// revisions belong to the owning organization — a shared read
	// organization never creates them.
	var projectOrgID, projectStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id::text, status
		FROM projects
		WHERE id = $1
		  AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
	`, cmd.ProjectID, OrgFromCtx(ctx)).Scan(&projectOrgID, &projectStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	if projectOrgID != OrgFromCtx(ctx) {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	if cmd.BaseQuoteRevisionID != "" {
		// #642 legacy recovery: the next revision may be minted from the
		// current editable state ONLY over an exactly-latest legacy revision
		// without commercial snapshot. A latest revision that already carries
		// canonical commercial truth has requote as its only path — this
		// command never competes with it or bypasses its semantics.
		var latestID string
		var latestHasSnapshot bool
		err = s.db(ctx).QueryRow(ctx, `
			SELECT id::text, commercial_snapshot IS NOT NULL
			FROM quote_revisions
			WHERE project_id = $1
			ORDER BY revision_number DESC
			LIMIT 1
		`, cmd.ProjectID).Scan(&latestID, &latestHasSnapshot)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: base revision specified (%s) but project has no previous quote revisions", domain.ErrQuoteRevisionConflict, cmd.BaseQuoteRevisionID)
			}
			return nil, err
		}
		if latestID != cmd.BaseQuoteRevisionID {
			// The #393 writer would reject with the same typed conflict; fail
			// here with the precise reason before doing any work.
			return nil, fmt.Errorf("%w: base revision %s is stale; latest is %s", domain.ErrQuoteRevisionConflict, cmd.BaseQuoteRevisionID, latestID)
		}
		if latestHasSnapshot {
			return nil, domain.ErrQuoteRevisionNotLegacy
		}
		// Modernize deliberately does NOT gate on the legacy Project.status
		// pin: commercial progress from here on flows through QuoteRevision
		// lifecycle commands, and Project.status stays operational-only (#673).
	} else if projectStatus != "draft" && projectStatus != "quoted" {
		// Same authority as #386: the editable commercial state is pinned once
		// the legacy quote is accepted — later changes need a new revision.
		return nil, domain.ErrQuoteRevisionAccepted
	}

	// 2. Quote lines of the editable commercial state, deterministic order.
	lineRows, err := s.db(ctx).Query(ctx, `
		SELECT id::text, module_id::text
		FROM project_items
		WHERE project_id = $1
		ORDER BY id
	`, cmd.ProjectID)
	if err != nil {
		return nil, err
	}
	type quoteLine struct {
		ID       string
		ModuleID string
	}
	lines := []quoteLine{}
	for lineRows.Next() {
		var line quoteLine
		if err := lineRows.Scan(&line.ID, &line.ModuleID); err != nil {
			lineRows.Close()
			return nil, err
		}
		lines = append(lines, line)
	}
	lineRows.Close()
	if err := lineRows.Err(); err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("%w: el proyecto no tiene líneas de cotización para crear la revisión inicial", domain.ErrInvalidRevisionSnapshot)
	}

	// 3. Converge every line's physical units to its commercial quantity
	// (#386 reuse: idempotent, per-line advisory lock, typed failures). The
	// snapshot must represent the exact materialized units — never fewer.
	createdInstanceIDs := []string{}
	for _, line := range lines {
		materialized, err := s.MaterializeQuoteLine(ctx, MaterializeQuoteLineCommand{
			ProjectID:   cmd.ProjectID,
			QuoteLineID: line.ID,
			ActorUserID: cmd.ActorUserID,
			IP:          cmd.IP,
			RequestID:   cmd.RequestID,
		})
		if err != nil {
			return nil, err
		}
		createdInstanceIDs = append(createdInstanceIDs, materialized.CreatedInstanceIDs...)
	}

	// 4. Build the immutable per-unit snapshot from authoritative state.
	items, err := s.buildInitialQuoteItems(ctx, cmd.ProjectID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("%w: la materialización no produjo unidades físicas para la revisión inicial", domain.ErrInvalidRevisionSnapshot)
	}

	// 4b. Freeze the immutable commercial snapshot (#642) in this same
	// transaction: authoritative amounts computed once from the SAME editable
	// commercial state being snapshotted, plus the customer-facing
	// descriptors. Shares the item build's consistency boundary.
	commercialSnapshot, err := s.buildInitialQuoteCommercialSnapshot(ctx, cmd.ProjectID, items)
	if err != nil {
		return nil, err
	}

	// 5. Single #393 writer: no base revision is only legal while the project
	// has none — a retry/concurrent create fails typed instead of minting Q2.
	// With a base (legacy modernize), the writer pins the new revision to that
	// exact latest revision under the same optimistic-concurrency rules.
	notes := nonEmptyOrDefault(cmd.Notes, "Revisión inicial creada desde el estado comercial editable de la obra.")
	auditSource := "project_editable_state"
	if cmd.BaseQuoteRevisionID != "" {
		notes = nonEmptyOrDefault(cmd.Notes, "Revisión modernizada desde el estado comercial editable de la obra.")
		auditSource = "legacy_modernization"
	}
	rev, err := s.CreateQuoteRevision(ctx, CreateQuoteRevisionCommand{
		ProjectID:          cmd.ProjectID,
		OrganizationID:     projectOrgID,
		BaseRevisionID:     cmd.BaseQuoteRevisionID,
		Status:             "draft",
		SourceType:         "manual",
		Notes:              notes,
		CreatedBy:          nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		Items:              items,
		CommercialSnapshot: commercialSnapshot,
	})
	if err != nil {
		return nil, err
	}

	// 6. Durable audit in the SAME transaction.
	auditDetails := map[string]interface{}{
		"project_id":                 cmd.ProjectID,
		"quote_revision_id":          rev.ID,
		"revision_number":            rev.RevisionNumber,
		"status":                     rev.Status,
		"source":                     auditSource,
		"item_count":                 len(items),
		"created_furniture_instance": createdInstanceIDs,
	}
	if cmd.BaseQuoteRevisionID != "" {
		auditDetails["base_quote_revision_id"] = cmd.BaseQuoteRevisionID
	}
	auditErr := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "quote_revision_created",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: projectOrgID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details:        auditDetails,
	})
	if auditErr != nil {
		return nil, fmt.Errorf("audit quote_revision_created: %w", auditErr)
	}

	return &CreateInitialQuoteRevisionResult{
		Revision:           rev,
		CreatedInstanceIDs: createdInstanceIDs,
	}, nil
}

// buildInitialQuoteItems snapshots every physical unit the project's quote
// lines currently represent (state='current'), keying everything by the
// FurnitureInstance identity. Configuration precedence per unit:
//
//  1. the quote line's configured custom dimensions (custom_dims, F144
//     single-source dims) — the editable commercial state the user quoted;
//  2. catalog definition dimensions — widthMm/heightMm/depthMm from the quoted
//     module (non-null columns only), the honest quoted configuration when
//     line does not carry custom dimensions.
//
// Identity is never derived from name, position or geometry (I2).
func (s *PostgresStore) buildInitialQuoteItems(ctx context.Context, projectID string) ([]CreateQuoteRevisionItemCommand, error) {
	// 4a. Current quote-line ↔ instance links, with each line's configured
	// custom dimensions (F144 single-source: customDims → module).
	unitRows, err := s.db(ctx).Query(ctx, `
		SELECT pi.id::text, pi.module_id::text, COALESCE(pi.custom_dims, 'null'::jsonb),
			COALESCE((
				SELECT jsonb_object_agg(pic.option_group_code, pic.choice_entity_id::text)
				FROM project_item_choices pic
				WHERE pic.project_item_id = pi.id
			), 'null'::jsonb),
			fi.id::text, fi.lifecycle_status
		FROM project_items pi
		JOIN quote_line_furniture_instances qli ON qli.quote_line_id = pi.id AND qli.state = 'current'
		JOIN furniture_instances fi ON fi.id = qli.furniture_instance_id
		WHERE pi.project_id = $1
		ORDER BY pi.id, fi.created_at, fi.id
	`, projectID)
	if err != nil {
		return nil, err
	}
	type quotedUnit struct {
		LineID          string
		ModuleID        string
		LineCustomDims  map[string]any
		LineOptions     map[string]string
		InstanceID      string
		LifecycleStatus string
	}
	units := []quotedUnit{}
	for unitRows.Next() {
		var unit quotedUnit
		var dimsJSON, optionsJSON []byte
		if err := unitRows.Scan(&unit.LineID, &unit.ModuleID, &dimsJSON, &optionsJSON, &unit.InstanceID, &unit.LifecycleStatus); err != nil {
			unitRows.Close()
			return nil, err
		}
		if len(dimsJSON) > 0 && string(dimsJSON) != "null" {
			dims := map[string]any{}
			if err := json.Unmarshal(dimsJSON, &dims); err != nil {
				unitRows.Close()
				return nil, fmt.Errorf("%w: custom_dims de la línea de cotización", domain.ErrInvalidRevisionSnapshot)
			}
			unit.LineCustomDims = dims
		}
		if len(optionsJSON) > 0 && string(optionsJSON) != "null" {
			choices := map[string]string{}
			if err := json.Unmarshal(optionsJSON, &choices); err != nil {
				unitRows.Close()
				return nil, fmt.Errorf("%w: option_choices de la línea de cotización", domain.ErrInvalidRevisionSnapshot)
			}
			unit.LineOptions = choices
		}
		units = append(units, unit)
	}
	unitRows.Close()
	if err := unitRows.Err(); err != nil {
		return nil, err
	}

	// 4b. Catalog definition dimensions for every quoted module.
	moduleIDs := make([]string, 0, len(units))
	seen := map[string]bool{}
	for _, unit := range units {
		if unit.ModuleID != "" && !seen[unit.ModuleID] {
			seen[unit.ModuleID] = true
			moduleIDs = append(moduleIDs, unit.ModuleID)
		}
	}
	moduleDims, err := s.loadModuleDimensionParams(ctx, moduleIDs)
	if err != nil {
		return nil, err
	}

	items := make([]CreateQuoteRevisionItemCommand, 0, len(units))
	for _, unit := range units {
		item := CreateQuoteRevisionItemCommand{
			FurnitureInstanceID: unit.InstanceID,
			QuoteLineID:         unit.LineID,
			Parameters:          map[string]any{},
			// The quoted finish rides along: option_choices are the board
			// choices (role -> material id) the customer selected (#620).
			MaterialChoices: unit.LineOptions,
			LifecycleStatus: unit.LifecycleStatus,
		}
		if unit.ModuleID != "" {
			item.FurnitureDefinitionID = unit.ModuleID
		}
		if len(unit.LineCustomDims) > 0 {
			item.Parameters = unit.LineCustomDims
		} else if dims, ok := moduleDims[unit.ModuleID]; ok {
			item.Parameters = dims
		}
		if item.LifecycleStatus == "" {
			item.LifecycleStatus = "active"
		}
		items = append(items, item)
	}
	return items, nil
}

// loadModuleDimensionParams maps module IDs to the catalog definition's
// dimensional parameters (non-null columns only). These are the quoted
// dimensions a unit carries when no design models it yet.
func (s *PostgresStore) loadModuleDimensionParams(ctx context.Context, moduleIDs []string) (map[string]map[string]any, error) {
	dims := map[string]map[string]any{}
	if len(moduleIDs) == 0 {
		return dims, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id::text, width_mm, height_mm, depth_mm
		FROM modules
		WHERE id = ANY($1)
	`, moduleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var moduleID string
		var width, height, depth *int
		if err := rows.Scan(&moduleID, &width, &height, &depth); err != nil {
			return nil, err
		}
		params := map[string]any{}
		if width != nil {
			params["widthMm"] = *width
		}
		if height != nil {
			params["heightMm"] = *height
		}
		if depth != nil {
			params["depthMm"] = *depth
		}
		dims[moduleID] = params
	}
	return dims, rows.Err()
}

// QuoteRevisionLifecycleCommand identifies the exact revision a lifecycle
// command operates on. Project scoping is mandatory: a revision of another
// project is indistinguishable from a missing one (uniform 404).
type QuoteRevisionLifecycleCommand struct {
	ProjectID       string
	QuoteRevisionID string
	ActorUserID     string
	IP              string
	RequestID       string
}

// loadQuoteRevisionForLifecycle loads the exact revision, enforcing
// same-project ownership and the owning-organization authority, then locks
// it FOR UPDATE for the transition. The visibility read runs WITHOUT the row
// lock first: SELECT ... FOR UPDATE under RLS applies the UPDATE policy
// (owner-organization only), which would hide the row from shared-read
// organizations and collapse the 403 ownership verdict into a false 404. The
// locked re-read below re-validates under the same transaction, so nothing
// races between the two reads. The parsed commercial snapshot (#642) rides
// along fail-closed: a corrupt stored payload blocks the lifecycle command.
func (s *PostgresStore) loadQuoteRevisionForLifecycle(ctx context.Context, cmd QuoteRevisionLifecycleCommand) (*domain.QuoteRevision, *domain.QuoteCommercialSnapshot, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.QuoteRevisionID) {
		return nil, nil, domain.ErrInvalidRevisionID
	}
	rev, _, err := s.readQuoteRevision(ctx, cmd.QuoteRevisionID, cmd.ProjectID, false)
	if err != nil {
		return nil, nil, err
	}
	if rev.OrganizationID != OrgFromCtx(ctx) {
		return nil, nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	rev, snapshot, err := s.readQuoteRevision(ctx, cmd.QuoteRevisionID, cmd.ProjectID, true)
	if err != nil {
		return nil, nil, err
	}
	return rev, snapshot, nil
}

func (s *PostgresStore) readQuoteRevision(ctx context.Context, revisionID, projectID string, forUpdate bool) (*domain.QuoteRevision, *domain.QuoteCommercialSnapshot, error) {
	query := `
		SELECT id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, ''),
			COALESCE(commercial_snapshot, 'null'::jsonb), published_at, accepted_at
		FROM quote_revisions
		WHERE id = $1 AND project_id = $2`
	if forUpdate {
		query += `
		FOR UPDATE`
	}
	var rev domain.QuoteRevision
	var commercialSnapshot []byte
	err := s.db(ctx).QueryRow(ctx, query, revisionID, projectID).Scan(
		&rev.ID,
		&rev.OrganizationID,
		&rev.ProjectID,
		&rev.RevisionNumber,
		&rev.Status,
		&rev.SourceType,
		&rev.Notes,
		&rev.BaseQuoteRevisionID,
		&rev.SourceDesignRevisionID,
		&commercialSnapshot,
		&rev.PublishedAt,
		&rev.AcceptedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, nil, err
	}
	snapshot, err := parseQuoteCommercialSnapshot(commercialSnapshot)
	if err != nil {
		return nil, nil, err
	}
	rev.CommercialSnapshot = snapshot
	return &rev, snapshot, nil
}

// PublishQuoteRevision performs the explicit draft → published transition on
// the exact revision. The per-row transition stays owned by
// UpdateQuoteRevisionStatus (server-side validation + DB trigger backstop);
// this command adds project scoping, owning-organization authority and
// durable audit in the same transaction.
func (s *PostgresStore) PublishQuoteRevision(ctx context.Context, cmd QuoteRevisionLifecycleCommand) (*domain.QuoteRevision, error) {
	if transactionFromContext(ctx) == nil {
		var rev *domain.QuoteRevision
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			rev, txErr = s.PublishQuoteRevision(txCtx, cmd)
			return txErr
		})
		return rev, err
	}

	rev, snapshot, err := s.loadQuoteRevisionForLifecycle(ctx, cmd)
	if err != nil {
		return nil, err
	}
	switch rev.Status {
	case "draft":
		// #642 fail-closed: publishing freezes commercial history — a legacy
		// draft without the immutable commercial snapshot cannot publish. The
		// actionable path is creating a new revision from current state.
		if snapshot == nil {
			return nil, domain.ErrQuoteCommercialSnapshotMissing
		}
	case "published":
		return nil, fmt.Errorf("%w: la cotización ya está publicada", domain.ErrQuoteRevisionInvalidTransition)
	case "accepted":
		return nil, fmt.Errorf("%w: una cotización aceptada no puede volver a publicarse", domain.ErrQuoteRevisionInvalidTransition)
	default:
		return nil, fmt.Errorf("%w: una cotización reemplazada es histórico y no puede publicarse", domain.ErrQuoteRevisionInvalidTransition)
	}

	rev, err = s.UpdateQuoteRevisionStatus(ctx, UpdateQuoteRevisionStatusCommand{
		QuoteRevisionID: cmd.QuoteRevisionID,
		Status:          "published",
	})
	if err != nil {
		return nil, err
	}

	auditErr := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "quote_revision_published",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: rev.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"project_id":        rev.ProjectID,
			"quote_revision_id": rev.ID,
			"revision_number":   rev.RevisionNumber,
			"status":            rev.Status,
		},
	})
	if auditErr != nil {
		return nil, fmt.Errorf("audit quote_revision_published: %w", auditErr)
	}
	return rev, nil
}

// AcceptQuoteRevision performs the explicit published → accepted transition
// and ATOMICALLY supersedes every other accepted revision of the project in
// the same transaction. The acceptance invariant (at most one accepted
// revision per project) is guaranteed by the command's lock order — supersede
// first, accept second — and backed by the partial unique index (000121).
// Concurrent accepts serialize on the per-project advisory lock; the last
// committer wins and the invariant holds.
func (s *PostgresStore) AcceptQuoteRevision(ctx context.Context, cmd QuoteRevisionLifecycleCommand) (*AcceptQuoteRevisionResult, error) {
	if transactionFromContext(ctx) == nil {
		var result *AcceptQuoteRevisionResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.AcceptQuoteRevision(txCtx, cmd)
			return txErr
		})
		return result, err
	}

	// Serialize lifecycle decisions per project so two concurrent accepts can
	// never interleave their supersede/accept updates.
	if _, err := s.db(ctx).Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, cmd.ProjectID); err != nil {
		return nil, err
	}

	rev, _, err := s.loadQuoteRevisionForLifecycle(ctx, cmd)
	if err != nil {
		return nil, err
	}
	if rev.Status != "published" {
		switch rev.Status {
		case "draft":
			return nil, fmt.Errorf("%w: la cotización debe publicarse antes de aceptarse", domain.ErrQuoteRevisionInvalidTransition)
		case "accepted":
			return nil, fmt.Errorf("%w: la cotización ya está aceptada", domain.ErrQuoteRevisionInvalidTransition)
		default:
			return nil, fmt.Errorf("%w: una cotización reemplazada no puede aceptarse de nuevo", domain.ErrQuoteRevisionInvalidTransition)
		}
	}

	// Supersede the previously accepted revision(s) FIRST — the partial
	// unique index (000121) is immediate, so accepting before superseding
	// would violate it. History is preserved: superseded rows stay immutable.
	superseded := []domain.QuoteRevision{}
	supersededRows, err := s.db(ctx).Query(ctx, `
		UPDATE quote_revisions
		SET status = 'superseded'
		WHERE project_id = $1 AND status = 'accepted' AND id <> $2
		RETURNING id, organization_id, project_id, revision_number, status, source_type, COALESCE(notes, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, ''),
			published_at, accepted_at
	`, cmd.ProjectID, cmd.QuoteRevisionID)
	if err != nil {
		return nil, err
	}
	for supersededRows.Next() {
		var old domain.QuoteRevision
		if err := supersededRows.Scan(
			&old.ID,
			&old.OrganizationID,
			&old.ProjectID,
			&old.RevisionNumber,
			&old.Status,
			&old.SourceType,
			&old.Notes,
			&old.BaseQuoteRevisionID,
			&old.SourceDesignRevisionID,
			&old.PublishedAt,
			&old.AcceptedAt,
		); err != nil {
			supersededRows.Close()
			return nil, err
		}
		superseded = append(superseded, old)
	}
	supersededRows.Close()
	if err := supersededRows.Err(); err != nil {
		return nil, err
	}

	// Accept the exact target through the canonical transition owner.
	rev, err = s.UpdateQuoteRevisionStatus(ctx, UpdateQuoteRevisionStatusCommand{
		QuoteRevisionID: cmd.QuoteRevisionID,
		Status:          "accepted",
	})
	if err != nil {
		return nil, err
	}

	actorUserID := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	auditErr := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "quote_revision_accepted",
		ActorUserID:    actorUserID,
		OrganizationID: rev.OrganizationID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"project_id":                rev.ProjectID,
			"quote_revision_id":         rev.ID,
			"revision_number":           rev.RevisionNumber,
			"status":                    rev.Status,
			"superseded_quote_revision": supersededRevisionDetails(superseded),
		},
	})
	if auditErr != nil {
		return nil, fmt.Errorf("audit quote_revision_accepted: %w", auditErr)
	}
	for _, old := range superseded {
		auditErr := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
			EventType:      "quote_revision_superseded",
			ActorUserID:    actorUserID,
			OrganizationID: old.OrganizationID,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details: map[string]interface{}{
				"project_id":                 old.ProjectID,
				"quote_revision_id":          old.ID,
				"revision_number":            old.RevisionNumber,
				"status":                     old.Status,
				"superseded_by_quote_rev_id": rev.ID,
			},
		})
		if auditErr != nil {
			return nil, fmt.Errorf("audit quote_revision_superseded: %w", auditErr)
		}
	}

	return &AcceptQuoteRevisionResult{
		Revision:            rev,
		SupersededRevisions: superseded,
	}, nil
}

func supersededRevisionDetails(revisions []domain.QuoteRevision) []map[string]any {
	details := make([]map[string]any, 0, len(revisions))
	for _, rev := range revisions {
		details = append(details, map[string]any{
			"quote_revision_id": rev.ID,
			"revision_number":   rev.RevisionNumber,
		})
	}
	return details
}
