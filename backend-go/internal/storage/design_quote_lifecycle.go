package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// CreateInitialDesignQuoteRevisionCommand pins one canonical working copy.
type CreateInitialDesignQuoteRevisionCommand struct {
	ProjectID          string
	DesignID           string
	WorkingVersion     string
	WorkingFingerprint string
	Notes              string
	ActorUserID        string
	IP                 string
	RequestID          string
}

// CreateInitialDesignQuoteRevision creates design-first Q1 through #642/#393.
func (s *PostgresStore) CreateInitialDesignQuoteRevision(ctx context.Context, cmd CreateInitialDesignQuoteRevisionCommand) (*CreateInitialQuoteRevisionResult, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.DesignID) || strings.TrimSpace(cmd.WorkingVersion) == "" || strings.TrimSpace(cmd.WorkingFingerprint) == "" {
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
			var err error
			result, err = s.CreateInitialDesignQuoteRevision(txCtx, cmd)
			return err
		})
		return result, err
	}

	var ownerOrg, projectStatus string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id::text, status FROM projects /* design-first-q1-lock */
		WHERE id=$1 AND (organization_id=$2 OR sales_organization_id=$2 OR manufacturing_organization_id=$2)
		FOR UPDATE
	`, cmd.ProjectID, OrgFromCtx(ctx)).Scan(&ownerOrg, &projectStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDesignNotFound
	}
	if err != nil {
		return nil, err
	}
	if ownerOrg != OrgFromCtx(ctx) {
		return nil, domain.ErrFurnitureInstanceProjectNotWritable
	}
	if projectStatus != "draft" && projectStatus != "quoted" {
		return nil, domain.ErrQuoteRevisionAccepted
	}

	var existingRevision bool
	err = s.db(ctx).QueryRow(ctx, `SELECT true FROM quote_revisions WHERE project_id=$1 LIMIT 1`, cmd.ProjectID).Scan(&existingRevision)
	if err == nil {
		return nil, domain.ErrQuoteRevisionConflict
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	var designOrg, designProject string
	err = s.db(ctx).QueryRow(ctx, `SELECT organization_id::text, project_id::text FROM designs WHERE id=$1 AND project_id=$2 FOR UPDATE`, cmd.DesignID, cmd.ProjectID).Scan(&designOrg, &designProject)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrDesignNotFound
	}
	if err != nil {
		return nil, err
	}
	if designOrg != ownerOrg || designProject != cmd.ProjectID {
		return nil, domain.ErrDesignNotFound
	}

	wc, err := s.GetDesignWorkingCopy(ctx, cmd.DesignID)
	if err != nil || wc.ProjectID != cmd.ProjectID {
		if err == nil {
			err = domain.ErrDesignNotFound
		}
		return nil, err
	}
	workingFingerprint, err := hashJSON(struct {
		BaseRevisionID *string                    `json:"baseRevisionId"`
		Items          []domain.DesignWorkingItem `json:"items"`
	}{wc.BaseRevisionID, wc.Items})
	if err != nil {
		return nil, err
	}
	workingVersion := wc.UpdatedAt.UTC().Format(time.RFC3339Nano)
	if wc.UpdatedAt.IsZero() {
		workingVersion = workingFingerprint
	}
	if cmd.WorkingVersion != workingVersion || cmd.WorkingFingerprint != workingFingerprint {
		return nil, domain.ErrDesignRevisionConflict
	}
	if len(wc.Items) == 0 {
		return nil, fmt.Errorf("%w: el working copy del diseño está vacío", domain.ErrInvalidRevisionSnapshot)
	}

	sort.Slice(wc.Items, func(i, j int) bool { return wc.Items[i].FurnitureInstanceID < wc.Items[j].FurnitureInstanceID })
	items := make([]CreateQuoteRevisionItemCommand, 0, len(wc.Items))
	usedLines := map[string]bool{}
	createdLines := []string{}
	for _, working := range wc.Items {
		if working.FurnitureDefinitionID == "" || !commercialProjectionParametersPriceable(working.Parameters) {
			return nil, fmt.Errorf("%w: configuración no cotizable para la unidad %s", domain.ErrInvalidRevisionSnapshot, working.FurnitureInstanceID)
		}
		var lifecycle, lineID, moduleID string
		var quantity int
		var dimsRaw []byte
		err = s.db(ctx).QueryRow(ctx, `
			SELECT fi.lifecycle_status, COALESCE(pi.id::text,''), COALESCE(pi.module_id::text,''), COALESCE(pi.quantity,0), COALESCE(pi.custom_dims,'null'::jsonb)
			FROM furniture_instances fi
			LEFT JOIN quote_line_furniture_instances qli ON qli.furniture_instance_id=fi.id AND qli.project_id=fi.project_id AND qli.state='current'
			LEFT JOIN project_items pi ON pi.id=qli.quote_line_id AND pi.project_id=qli.project_id
			WHERE fi.id=$1 AND fi.project_id=$2
			FOR UPDATE OF fi
		`, working.FurnitureInstanceID, cmd.ProjectID).Scan(&lifecycle, &lineID, &moduleID, &quantity, &dimsRaw)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		if err != nil {
			return nil, err
		}
		if lifecycle != "active" {
			return nil, domain.ErrFurnitureInstanceLifecycleConflict
		}
		dims := domain.CommercialDimsFromParameters(working.Parameters)
		if lineID == "" {
			var dimsArg any
			if dims != nil {
				dimsArg, err = json.Marshal(dims)
				if err != nil {
					return nil, err
				}
			}
			err = s.db(ctx).QueryRow(ctx, `INSERT INTO project_items (project_id,module_id,quantity,custom_dims,organization_id) VALUES ($1,$2,1,$3,$4) RETURNING id::text`, cmd.ProjectID, working.FurnitureDefinitionID, dimsArg, ownerOrg).Scan(&lineID)
			if err != nil {
				return nil, err
			}
			_, err = s.db(ctx).Exec(ctx, `INSERT INTO quote_line_furniture_instances (organization_id,project_id,quote_line_id,furniture_instance_id) VALUES ($1,$2,$3,$4)`, ownerOrg, cmd.ProjectID, lineID, working.FurnitureInstanceID)
			if err != nil {
				return nil, err
			}
			for role, choiceID := range working.MaterialChoices {
				if _, err = s.db(ctx).Exec(ctx, `INSERT INTO project_item_choices (project_item_id,option_group_code,choice_entity_id,organization_id) VALUES ($1,$2,$3,$4)`, lineID, role, choiceID, ownerOrg); err != nil {
					return nil, err
				}
			}
			createdLines = append(createdLines, lineID)
		} else {
			if quantity != 1 || moduleID != working.FurnitureDefinitionID || usedLines[lineID] {
				return nil, fmt.Errorf("%w: la línea existente no representa exactamente una unidad del diseño", domain.ErrInvalidRevisionSnapshot)
			}
			var storedDims *domain.ItemCustomDims
			if string(dimsRaw) != "null" {
				var value domain.ItemCustomDims
				if err := json.Unmarshal(dimsRaw, &value); err != nil {
					return nil, err
				}
				storedDims = &value
			}
			if !reflect.DeepEqual(storedDims, dims) {
				return nil, fmt.Errorf("%w: dimensiones de línea y diseño divergen", domain.ErrInvalidRevisionSnapshot)
			}
			choices := map[string]string{}
			rows, qErr := s.db(ctx).Query(ctx, `SELECT option_group_code,choice_entity_id::text FROM project_item_choices WHERE project_item_id=$1`, lineID)
			if qErr != nil {
				return nil, qErr
			}
			for rows.Next() {
				var role, id string
				if qErr = rows.Scan(&role, &id); qErr != nil {
					rows.Close()
					return nil, qErr
				}
				choices[role] = id
			}
			rows.Close()
			if qErr = rows.Err(); qErr != nil {
				return nil, qErr
			}
			if len(choices) != len(working.MaterialChoices) || (len(choices) > 0 && !reflect.DeepEqual(choices, working.MaterialChoices)) {
				return nil, fmt.Errorf("%w: materiales de línea y diseño divergen", domain.ErrInvalidRevisionSnapshot)
			}
		}
		usedLines[lineID] = true
		items = append(items, CreateQuoteRevisionItemCommand{QuoteLineID: lineID, FurnitureInstanceID: working.FurnitureInstanceID, FurnitureDefinitionID: working.FurnitureDefinitionID, DefinitionVersion: working.DefinitionVersion, Parameters: working.Parameters, MaterialChoices: working.MaterialChoices, LifecycleStatus: lifecycle})
	}
	var liveLineCount int
	if err := s.db(ctx).QueryRow(ctx, `SELECT count(*) FROM project_items WHERE project_id=$1`, cmd.ProjectID).Scan(&liveLineCount); err != nil {
		return nil, err
	}
	if liveLineCount != len(usedLines) {
		return nil, fmt.Errorf("%w: existen líneas comerciales ajenas al working copy exacto", domain.ErrInvalidRevisionSnapshot)
	}

	snapshot, err := s.buildInitialQuoteCommercialSnapshot(ctx, cmd.ProjectID, items)
	if err != nil {
		return nil, err
	}
	snapshot.DesignSource = &domain.QuoteCommercialDesignSource{DesignID: cmd.DesignID, WorkingVersion: workingVersion, WorkingFingerprint: workingFingerprint}
	revision, err := s.CreateQuoteRevision(ctx, CreateQuoteRevisionCommand{ProjectID: cmd.ProjectID, OrganizationID: ownerOrg, Status: "draft", SourceType: "manual", Notes: nonEmptyOrDefault(cmd.Notes, "Revisión inicial creada desde el working copy exacto del diseño."), CreatedBy: nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)), Items: items, CommercialSnapshot: snapshot})
	if err != nil {
		return nil, err
	}
	if err = s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: "quote_revision_created", ActorUserID: nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)), OrganizationID: ownerOrg, IP: cmd.IP, RequestID: cmd.RequestID, Details: map[string]any{"project_id": cmd.ProjectID, "quote_revision_id": revision.ID, "revision_number": revision.RevisionNumber, "source": "design_working_copy", "design_id": cmd.DesignID, "working_version": workingVersion, "working_fingerprint": workingFingerprint, "created_quote_line_ids": createdLines}}); err != nil {
		return nil, fmt.Errorf("audit quote_revision_created: %w", err)
	}
	return &CreateInitialQuoteRevisionResult{Revision: revision}, nil
}
