package storage

// Grip styles storage (#1531): CRUD of the org-scoped `grip_styles` table
// with If-Match versions, a database-enforced single default and a durable
// audit event in the same transaction as each mutation. Also the projection
// reads that replaced the overlay blobs (GetOpeningCapabilities,
// GetOpeningOverhangRule). Consumed by internal/api grip style handlers and
// every opening read path.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ErrGripStyleNotFound separates a missing style from a version conflict.
var ErrGripStyleNotFound = errors.New("grip style not found")

// GripStyleWriteMeta carries the request facts the audit event records.
type GripStyleWriteMeta struct {
	RequestID string
	IP        string
}

const gripStyleColumns = `id::text, organization_id::text, name, offered, is_default, by_furniture_type,
	migration_report, version, created_at, updated_at`

func scanGripStyle(row pgx.Row) (*domain.GripStyle, error) {
	var style domain.GripStyle
	var recipes []byte
	var report []byte
	if err := row.Scan(&style.ID, &style.OrganizationID, &style.Name, &style.Offered, &style.IsDefault,
		&recipes, &report, &style.Version, &style.CreatedAt, &style.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(recipes, &style.ByFurnitureType); err != nil {
		return nil, fmt.Errorf("grip style %s recipes: %w", style.ID, err)
	}
	if len(report) > 0 {
		if err := json.Unmarshal(report, &style.MigrationReport); err != nil {
			return nil, fmt.Errorf("grip style %s report: %w", style.ID, err)
		}
	}
	return &style, nil
}

func (s *PostgresStore) ListGripStyles(ctx context.Context) ([]domain.GripStyle, error) {
	rows, err := s.db(ctx).Query(ctx, `SELECT `+gripStyleColumns+` FROM grip_styles
		WHERE organization_id = $1 ORDER BY is_default DESC, name ASC`, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []domain.GripStyle{}
	for rows.Next() {
		style, err := scanGripStyle(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *style)
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetGripStyle(ctx context.Context, id string) (*domain.GripStyle, error) {
	style, err := scanGripStyle(s.db(ctx).QueryRow(ctx, `SELECT `+gripStyleColumns+` FROM grip_styles
		WHERE id::text = $1 AND organization_id = $2`, id, OrgFromCtx(ctx)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrGripStyleNotFound
	}
	return style, err
}

// validateGripStyleReferences checks profiles (active, usable at their
// position) and handle hardware against the caller's catalog under RLS.
func (s *PostgresStore) validateGripStyleReferences(ctx context.Context, style domain.GripStyle) error {
	profiles, err := s.ListOpeningProfiles(ctx)
	if err != nil {
		return err
	}
	byID := map[string]*domain.OpeningProfile{}
	for i := range profiles {
		byID[profiles[i].ID] = &profiles[i]
	}
	if err := domain.ValidateGripStyleProfiles(style, func(id string) *domain.OpeningProfile { return byID[id] }); err != nil {
		return err
	}
	for _, ftype := range domain.GripStyleFurnitureTypes {
		recipe := style.ByFurnitureType[ftype]
		if recipe.HandleHardwareID == nil {
			continue
		}
		var exists bool
		if err := s.db(ctx).QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM hardwares WHERE id::text = $1 AND organization_id = $2)`,
			*recipe.HandleHardwareID, OrgFromCtx(ctx)).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return &domain.GripStyleValidationError{Message: fmt.Sprintf("la jaladera del estilo no existe en el catálogo (%s)", *recipe.HandleHardwareID)}
		}
	}
	return nil
}

func gripStyleRecipesJSON(style domain.GripStyle) ([]byte, error) {
	// Overhangs are whole millimetres by validation; store them as integers.
	clean := map[string]map[string]any{}
	for ftype, recipe := range style.ByFurnitureType {
		entry := map[string]any{"mode": recipe.Mode}
		if recipe.HandleHardwareID != nil {
			entry["handleHardwareId"] = *recipe.HandleHardwareID
		}
		if recipe.TopProfileID != "" {
			entry["topProfileId"] = recipe.TopProfileID
		}
		if recipe.BetweenProfileID != "" {
			entry["betweenProfileId"] = recipe.BetweenProfileID
		}
		if recipe.OverhangMm != nil {
			entry["overhangMm"] = int(math.Round(*recipe.OverhangMm))
		}
		clean[ftype] = entry
	}
	return json.Marshal(clean)
}

// prepareGripStyleWrite normalizes and validates a write (422 on rejection).
func (s *PostgresStore) prepareGripStyleWrite(ctx context.Context, style *domain.GripStyle) ([]byte, error) {
	if style.ByFurnitureType == nil {
		style.ByFurnitureType = map[string]domain.GripStyleRecipe{}
	}
	domain.NormalizeGripStyle(style)
	if err := domain.ValidateGripStyleShape(*style); err != nil {
		return nil, err
	}
	if err := s.validateGripStyleReferences(ctx, *style); err != nil {
		return nil, err
	}
	return gripStyleRecipesJSON(*style)
}

// lockOrganizationGripStyles serializes default switches of one
// organization: every writer that touches the default locks the org's rows
// first, so the partial unique index never sees two concurrent defaults
// from the API (and rejects any direct-SQL attempt).
func (s *PostgresStore) lockOrganizationGripStyles(ctx context.Context) error {
	_, err := s.db(ctx).Exec(ctx, `SELECT id FROM grip_styles WHERE organization_id = $1 FOR UPDATE`, OrgFromCtx(ctx))
	return err
}

func (s *PostgresStore) clearOtherGripStyleDefaults(ctx context.Context, keepID string) error {
	_, err := s.db(ctx).Exec(ctx, `UPDATE grip_styles SET is_default = FALSE, version = version + 1, updated_at = NOW()
		WHERE organization_id = $1 AND is_default AND id::text <> $2`, OrgFromCtx(ctx), keepID)
	return err
}

func (s *PostgresStore) auditGripStyle(ctx context.Context, eventType string, style *domain.GripStyle, meta GripStyleWriteMeta, extra map[string]any) error {
	details := map[string]any{
		"grip_style_id": style.ID,
		"name":          style.Name,
		"offered":       style.Offered,
		"is_default":    style.IsDefault,
		"version":       style.Version,
	}
	if recipes, err := gripStyleRecipesJSON(*style); err == nil {
		details["by_furniture_type"] = json.RawMessage(recipes)
	}
	for key, value := range extra {
		details[key] = value
	}
	return s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      eventType,
		ActorUserID:    tenantActorUserID(ctx),
		OrganizationID: OrgFromCtx(ctx),
		RequestID:      meta.RequestID,
		IP:             meta.IP,
		Details:        details,
	})
}

func translateGripStyleWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "grip_styles_org_name_unique":
			return &domain.GripStyleValidationError{Message: "ya existe un estilo con ese nombre"}
		case "grip_styles_one_default_per_org":
			return ErrVersionConflict
		}
	}
	return err
}

// CreateGripStyle inserts a style; a new default replaces the previous one
// in the same transaction.
func (s *PostgresStore) CreateGripStyle(ctx context.Context, style *domain.GripStyle, meta GripStyleWriteMeta) error {
	return s.withinGripStyleTx(ctx, func(txCtx context.Context) error {
		recipes, err := s.prepareGripStyleWrite(txCtx, style)
		if err != nil {
			return err
		}
		if style.IsDefault {
			if err := s.lockOrganizationGripStyles(txCtx); err != nil {
				return err
			}
			if err := s.clearOtherGripStyleDefaults(txCtx, ""); err != nil {
				return err
			}
		}
		created, err := scanGripStyle(s.db(txCtx).QueryRow(txCtx, `INSERT INTO grip_styles
			(organization_id, name, offered, is_default, by_furniture_type)
			VALUES ($1, $2, $3, $4, $5) RETURNING `+gripStyleColumns,
			OrgFromCtx(txCtx), style.Name, style.Offered, style.IsDefault, recipes))
		if err != nil {
			return translateGripStyleWriteError(err)
		}
		*style = *created
		return s.auditGripStyle(txCtx, "grip_style_created", style, meta, nil)
	})
}

// UpdateGripStyle is If-Match guarded. The current default can only stop
// being the default by making another style the default.
func (s *PostgresStore) UpdateGripStyle(ctx context.Context, id string, expectedVersion int64, style *domain.GripStyle, meta GripStyleWriteMeta) error {
	return s.withinGripStyleTx(ctx, func(txCtx context.Context) error {
		recipes, err := s.prepareGripStyleWrite(txCtx, style)
		if err != nil {
			return err
		}
		if err := s.lockOrganizationGripStyles(txCtx); err != nil {
			return err
		}
		existing, err := s.GetGripStyle(txCtx, id)
		if err != nil {
			return err
		}
		if existing.Version != expectedVersion {
			return ErrVersionConflict
		}
		if existing.IsDefault && !style.IsDefault {
			return &domain.GripStyleValidationError{Message: "el estilo predeterminado sigue siéndolo hasta que elijas otro como predeterminado"}
		}
		if style.IsDefault && !existing.IsDefault {
			if err := s.clearOtherGripStyleDefaults(txCtx, id); err != nil {
				return err
			}
		}
		updated, err := scanGripStyle(s.db(txCtx).QueryRow(txCtx, `UPDATE grip_styles SET
			name = $3, offered = $4, is_default = $5, by_furniture_type = $6,
			version = version + 1, updated_at = NOW()
			WHERE id::text = $1 AND organization_id = $2 AND version = $7
			RETURNING `+gripStyleColumns,
			id, OrgFromCtx(txCtx), style.Name, style.Offered, style.IsDefault, recipes, expectedVersion))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		if err != nil {
			return translateGripStyleWriteError(err)
		}
		*style = *updated
		return s.auditGripStyle(txCtx, "grip_style_updated", style, meta, map[string]any{"previous_version": existing.Version})
	})
}

// DeleteGripStyle is If-Match guarded; the default cannot be deleted.
func (s *PostgresStore) DeleteGripStyle(ctx context.Context, id string, expectedVersion int64, meta GripStyleWriteMeta) error {
	return s.withinGripStyleTx(ctx, func(txCtx context.Context) error {
		if err := s.lockOrganizationGripStyles(txCtx); err != nil {
			return err
		}
		existing, err := s.GetGripStyle(txCtx, id)
		if err != nil {
			return err
		}
		if existing.Version != expectedVersion {
			return ErrVersionConflict
		}
		if existing.IsDefault {
			return &domain.GripStyleValidationError{Message: "para borrar el estilo predeterminado primero elige otro como predeterminado"}
		}
		tag, err := s.db(txCtx).Exec(txCtx, `DELETE FROM grip_styles WHERE id::text = $1 AND organization_id = $2 AND version = $3`,
			id, OrgFromCtx(txCtx), expectedVersion)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrVersionConflict
		}
		return s.auditGripStyle(txCtx, "grip_style_deleted", existing, meta, nil)
	})
}

// withinGripStyleTx reuses the caller's tenant transaction (the API's) or
// opens one for direct store callers, so mutation and audit commit together.
func (s *PostgresStore) withinGripStyleTx(ctx context.Context, run func(context.Context) error) error {
	if transactionFromContext(ctx) != nil {
		return run(ctx)
	}
	return s.WithinTenantTx(ctx, TenantActor{OrganizationID: OrgFromCtx(ctx), UserID: tenantActorUserID(ctx)}, run)
}

// GetOpeningCapabilities projects the organization's grip styles onto the
// opening capabilities (#1531 retired the `opening.capabilities` blob).
// nil = no styles: the library ladder governs new authoring.
func (s *PostgresStore) GetOpeningCapabilities(ctx context.Context) (*domain.OpeningCapabilities, error) {
	styles, err := s.ListGripStyles(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening capabilities from grip styles: %w", err)
	}
	profiles, err := s.ListOpeningProfiles(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening capabilities profiles: %w", err)
	}
	return domain.OpeningCapabilitiesFromGripStyles(styles, profiles), nil
}

// GetOpeningOverhangRule gives the v1 bottom_overhang selections their
// millimetres from the grip styles (#1531 retired the
// `opening.bottom-overhang` blob). Never nil: 20 mm by default (A4).
func (s *PostgresStore) GetOpeningOverhangRule(ctx context.Context) (*domain.OpeningOverhangRule, error) {
	styles, err := s.ListGripStyles(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening overhang from grip styles: %w", err)
	}
	return domain.OpeningOverhangRuleFromGripStyles(styles), nil
}
