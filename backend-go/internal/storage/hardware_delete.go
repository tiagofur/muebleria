package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// #1615: physical hardware delete + the unified reference guard.
//
// HardwareUsage counts every live reference that pins a hardware row. The
// relational families come from #1215; the JSONB families (component
// placements on modules and structures, agregado lines/components/current
// recipe, hardware profiles) close the gap where a hardware placed only
// through JSONB passed the guard and later broke resolve fail-closed. JSONB
// references are matched by the exact UUID text inside the document —
// UUIDs are unique, so a match is a reference regardless of the nested shape
// (hardwareId, variants, rigid members, commercial kit, profile items…).
type HardwareUsage struct {
	TemplateLines       int64
	QuoteChoices        int64
	DesignAssets        int64
	ComponentPlacements int64
	Agregados           int64
	HardwareProfiles    int64
	// OpeningProfiles (#1615 review B2): gola/opening BOM members
	// (profile/supports/endCaps) and grip styles whose handle is this
	// hardware — quotes price that demand against the live catalog.
	OpeningProfiles int64
	GripStyles      int64
	// ProjectGrips (#1615 review round 2): the frozen grip snapshot of a
	// project or of one of its furniture instances (000182) — the quote
	// prices the gola BOM demand from THAT copy, not from the live profile.
	ProjectGrips int64
	// DesignChoices (#1615 review round 3): option choices of designs — the
	// live working copy, its authoring defaults and non-superseded revisions.
	// Design resolve and the release gate check them against the live
	// catalog, so a deleted choice breaks the design for good.
	DesignChoices int64
}

// Total is the number of references across every family.
func (u HardwareUsage) Total() int64 {
	return u.TemplateLines + u.QuoteChoices + u.DesignAssets + u.ComponentPlacements + u.Agregados + u.HardwareProfiles + u.OpeningProfiles + u.GripStyles + u.ProjectGrips + u.DesignChoices
}

// Describe renders the non-zero families in Spanish.
func (u HardwareUsage) Describe() string {
	parts := []string{}
	add := func(n int64, singular, plural string) {
		if n == 1 {
			parts = append(parts, "1 "+singular)
		} else if n > 1 {
			parts = append(parts, fmt.Sprintf("%d %s", n, plural))
		}
	}
	add(u.TemplateLines, "línea de mueble plantilla", "líneas de muebles plantilla")
	add(u.QuoteChoices, "elección de cotización", "elecciones de cotización")
	add(u.DesignAssets, "activo de diseño", "activos de diseño")
	add(u.ComponentPlacements, "ubicación en componentes", "ubicaciones en componentes")
	add(u.Agregados, "agregado", "agregados")
	add(u.HardwareProfiles, "perfil de herraje", "perfiles de herraje")
	add(u.OpeningProfiles, "perfil de apertura (gola)", "perfiles de apertura (gola)")
	add(u.GripStyles, "estilo de agarre", "estilos de agarre")
	add(u.ProjectGrips, "agarre congelado de obra", "agarres congelados de obras")
	add(u.DesignChoices, "elección en diseños", "elecciones en diseños")
	return strings.Join(parts, ", ")
}

// HardwareInUseError carries the per-family counts; errors.Is matches
// ErrHardwareInUse so existing handlers keep their 409 mapping.
type HardwareInUseError struct {
	Code   string
	Usage  HardwareUsage
	Action string // "desactivarlo" | "eliminarlo"
}

func (e *HardwareInUseError) Error() string {
	subject := "el herraje"
	if e.Code != "" {
		subject = fmt.Sprintf("el herraje %s", e.Code)
	}
	return fmt.Sprintf("%s: %s está en uso en %s; quitá o reasigná esas referencias antes de %s",
		ErrHardwareInUse.Error(), subject, e.Usage.Describe(), e.Action)
}

func (e *HardwareInUseError) Is(target error) bool { return target == ErrHardwareInUse }

// ErrHardwareKitGroupsReferenced (#1615): accessory option groups point at
// this hardware as their kit — deleting them first is a manual step (#1606).
var ErrHardwareKitGroupsReferenced = errors.New("grupos de opciones usan el herraje como juego")

// HardwareKitGroupsError lists the referencing groups.
type HardwareKitGroupsError struct {
	Part   string // set when the referenced hardware is a kit part
	Groups []string
}

func (e *HardwareKitGroupsError) Error() string {
	subject := ""
	if e.Part != "" {
		subject = fmt.Sprintf(" (parte %s)", e.Part)
	}
	return fmt.Sprintf("%s%s: %s; eliminá o cambiá esos grupos antes de eliminar el herraje",
		ErrHardwareKitGroupsReferenced.Error(), subject, strings.Join(e.Groups, ", "))
}
func (e *HardwareKitGroupsError) Is(target error) bool {
	return target == ErrHardwareKitGroupsReferenced
}

// HardwareKitPartsError lists the linked design parts of a kit (#1615).
type HardwareKitPartsError struct{ Parts []string }

func (e *HardwareKitPartsError) Error() string {
	return fmt.Sprintf("%s: %s; marcá «eliminar también sus partes» o desvinculalas antes",
		ErrHardwareKitHasParts.Error(), strings.Join(e.Parts, ", "))
}
func (e *HardwareKitPartsError) Is(target error) bool { return target == ErrHardwareKitHasParts }

// canonicalHardwareID returns the lowercase canonical UUID text (#1615 review
// B1): uuid::text is always lowercase, so text/LIKE comparisons against an
// uppercase id would count zero references and let a delete through.
func canonicalHardwareID(id string) (string, bool) {
	parsed, err := uuid.Parse(strings.TrimSpace(id))
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

// HardwareUsageOf counts every live reference that pins the hardware.
func (s *PostgresStore) HardwareUsageOf(ctx context.Context, id string) (HardwareUsage, error) {
	var u HardwareUsage
	org := OrgFromCtx(ctx)
	canonical, ok := canonicalHardwareID(id)
	if !ok {
		return u, fmt.Errorf("hardware not found")
	}
	id = canonical
	// Non-superseded quote revisions freeze choices that the release applies
	// (#1627) and price refresh re-resolves (#1662): they count as quote use.
	var quoteRevisionChoices int64
	err := s.db(ctx).QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM hardware_lines hl
			 JOIN modules m ON m.id = hl.module_id
			 WHERE hl.hardware_id::text = $1 AND m.organization_id = $2),
			(SELECT COUNT(*) FROM project_item_choices pic
			 JOIN project_items pi ON pi.id = pic.project_item_id
			 JOIN projects p ON p.id = pi.project_id
			 WHERE pic.choice_entity_id::text = $1 AND p.organization_id = $2)
			+ (SELECT COUNT(*) FROM project_level_choices plc
			 JOIN projects p ON p.id = plc.project_id
			 WHERE plc.choice_entity_id = $1 AND p.organization_id = $2),
			(SELECT COUNT(*) FROM design_revision_hardware_assets
			 WHERE hardware_id::text = $1 AND organization_id = $2),
			(SELECT COUNT(*) FROM module_components mc
			 JOIN modules m ON m.id = mc.module_id
			 WHERE m.organization_id = $2 AND mc.overrides::text LIKE '%' || $1 || '%')
			+ (SELECT COUNT(*) FROM structure_components sc
			 JOIN structures st ON st.id = sc.structure_id
			 WHERE st.organization_id = $2 AND sc.overrides::text LIKE '%' || $1 || '%'),
			(SELECT COUNT(*) FROM agregados a
			 LEFT JOIN agregado_revisions ar
			   ON ar.id = a.current_revision_id AND ar.organization_id = a.organization_id
			 WHERE a.organization_id = $2
			   AND (a.hardware_lines::text LIKE '%' || $1 || '%'
			        OR a.components::text LIKE '%' || $1 || '%'
			        OR COALESCE(ar.recipe::text, '') LIKE '%' || $1 || '%')),
			(SELECT COUNT(*) FROM hardware_profiles hp
			 WHERE hp.organization_id = $2
			   AND (hp.items::text LIKE '%' || $1 || '%'
			        OR COALESCE(hp.recipe_ref::text, '') LIKE '%' || $1 || '%')),
			(SELECT COUNT(*) FROM opening_profiles op
			 WHERE op.organization_id = $2 AND op.bom_members::text LIKE '%' || $1 || '%'),
			(SELECT COUNT(*) FROM grip_styles gs
			 WHERE gs.organization_id = $2 AND gs.by_furniture_type::text LIKE '%' || $1 || '%'),
			(SELECT COUNT(*) FROM projects p
			 WHERE p.organization_id = $2 AND COALESCE(p.grip_snapshot::text, '') LIKE '%' || $1 || '%')
			+ (SELECT COUNT(*) FROM furniture_instances fi
			 JOIN projects p ON p.id = fi.project_id
			 WHERE p.organization_id = $2 AND COALESCE(fi.grip_snapshot::text, '') LIKE '%' || $1 || '%'),
			(SELECT COUNT(*) FROM design_working_items dwi
			 WHERE dwi.organization_id = $2 AND dwi.material_choices::text LIKE '%' || $1 || '%')
			+ (SELECT COUNT(*) FROM design_working_copies dwc
			 WHERE dwc.organization_id = $2 AND dwc.authoring_defaults::text LIKE '%' || $1 || '%')
			+ (SELECT COUNT(*) FROM design_revision_items dri
			 JOIN design_revisions dr ON dr.id = dri.design_revision_id
			 WHERE dri.organization_id = $2 AND dr.status <> 'superseded'
			   AND dri.material_choices::text LIKE '%' || $1 || '%'),
			(SELECT COUNT(*) FROM quote_revision_items qri
			 JOIN quote_revisions qr ON qr.id = qri.quote_revision_id
			 WHERE qri.organization_id = $2 AND qr.status <> 'superseded'
			   AND qri.material_choices::text LIKE '%' || $1 || '%')`,
		id, org,
	).Scan(&u.TemplateLines, &u.QuoteChoices, &u.DesignAssets, &u.ComponentPlacements, &u.Agregados, &u.HardwareProfiles, &u.OpeningProfiles, &u.GripStyles, &u.ProjectGrips, &u.DesignChoices, &quoteRevisionChoices)
	u.QuoteChoices += quoteRevisionChoices
	return u, err
}

// DeleteHardwareCommand is the physical delete decision (#1615).
type DeleteHardwareCommand struct {
	ID              string
	ExpectedVersion int64
	// DeleteParts cascades the kit's linked design parts (each passes its own
	// guard; any part in use aborts everything).
	DeleteParts bool
	ActorUserID string
	IP          string
	RequestID   string
}

// DeleteHardwareResult reports what the delete removed.
type DeleteHardwareResult struct {
	DeletedIDs        []string
	RemovedFromGroups int64
	UpdatedGroupIDs   []string
}

// DeleteHardware physically deletes a hardware row (and optionally its kit
// parts) in one tenant transaction: guards → membership cleanup → If-Match
// DELETE → audit. Nothing is deleted partially.
func (s *PostgresStore) DeleteHardware(ctx context.Context, cmd DeleteHardwareCommand) (*DeleteHardwareResult, error) {
	canonical, ok := canonicalHardwareID(cmd.ID)
	if !ok {
		return nil, fmt.Errorf("hardware not found")
	}
	cmd.ID = canonical
	if transactionFromContext(ctx) == nil {
		var result *DeleteHardwareResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			result, txErr = s.DeleteHardware(txCtx, cmd)
			return txErr
		})
		return result, err
	}
	org := OrgFromCtx(ctx)

	var code string
	var version int64
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT code, version FROM hardwares WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
		cmd.ID, org).Scan(&code, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("hardware not found")
		}
		return nil, err
	}
	if version != cmd.ExpectedVersion {
		return nil, ErrVersionConflict
	}

	usage, err := s.HardwareUsageOf(ctx, cmd.ID)
	if err != nil {
		return nil, err
	}
	if usage.Total() > 0 {
		return nil, &HardwareInUseError{Code: code, Usage: usage, Action: "eliminarlo"}
	}

	groups, err := s.collectCodes(ctx,
		`SELECT code FROM option_groups WHERE kit_hardware_id = $1 AND organization_id = $2 ORDER BY code`, cmd.ID, org)
	if err != nil {
		return nil, err
	}
	if len(groups) > 0 {
		return nil, &HardwareKitGroupsError{Groups: groups}
	}

	type part struct{ id, code string }
	parts := []part{}
	rows, err := s.db(ctx).Query(ctx,
		`SELECT id::text, code FROM hardwares WHERE kit_hardware_id = $1 AND organization_id = $2 ORDER BY code FOR UPDATE`,
		cmd.ID, org)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p part
		if err := rows.Scan(&p.id, &p.code); err != nil {
			rows.Close()
			return nil, err
		}
		parts = append(parts, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(parts) > 0 && !cmd.DeleteParts {
		codes := make([]string, len(parts))
		for i, p := range parts {
			codes[i] = p.code
		}
		return nil, &HardwareKitPartsError{Parts: codes}
	}

	ids := []string{cmd.ID}
	for _, p := range parts {
		partUsage, err := s.HardwareUsageOf(ctx, p.id)
		if err != nil {
			return nil, err
		}
		if partUsage.Total() > 0 {
			return nil, &HardwareInUseError{Code: p.code, Usage: partUsage, Action: "eliminar el juego"}
		}
		partGroups, err := s.collectCodes(ctx,
			`SELECT code FROM option_groups WHERE kit_hardware_id = $1 AND organization_id = $2 ORDER BY code`, p.id, org)
		if err != nil {
			return nil, err
		}
		if len(partGroups) > 0 {
			return nil, &HardwareKitGroupsError{Part: p.code, Groups: partGroups}
		}
		ids = append(ids, p.id)
	}

	// Owner rule: membership in option groups is removed automatically. The
	// groups' versions move so a client holding the old member list cannot
	// silently re-add the deleted hardware with a stale write.
	result := &DeleteHardwareResult{DeletedIDs: ids}
	groupRows, err := s.db(ctx).Query(ctx, `
		UPDATE option_groups SET version = version + 1
		WHERE organization_id = $2
		  AND id IN (SELECT option_group_id FROM option_group_members
		             WHERE entity_id = ANY($1::uuid[]) AND organization_id = $2)
		RETURNING id::text`, ids, org)
	if err != nil {
		return nil, err
	}
	for groupRows.Next() {
		var gid string
		if err := groupRows.Scan(&gid); err != nil {
			groupRows.Close()
			return nil, err
		}
		result.UpdatedGroupIDs = append(result.UpdatedGroupIDs, gid)
	}
	groupRows.Close()
	if err := groupRows.Err(); err != nil {
		return nil, err
	}
	tag, err := s.db(ctx).Exec(ctx,
		`DELETE FROM option_group_members WHERE entity_id = ANY($1::uuid[]) AND organization_id = $2`, ids, org)
	if err != nil {
		return nil, err
	}
	result.RemovedFromGroups = tag.RowsAffected()

	// Parts first (they point at the kit), then the kit under If-Match.
	if len(ids) > 1 {
		if _, err := s.db(ctx).Exec(ctx,
			`DELETE FROM hardwares WHERE id = ANY($1::uuid[]) AND organization_id = $2`, ids[1:], org); err != nil {
			return nil, fmt.Errorf("delete kit parts: %w", err)
		}
	}
	tag, err = s.db(ctx).Exec(ctx,
		`DELETE FROM hardwares WHERE id = $1 AND organization_id = $2 AND version = $3`, cmd.ID, org, cmd.ExpectedVersion)
	if err != nil {
		return nil, fmt.Errorf("delete hardware: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return nil, ErrVersionConflict
	}

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "catalog_hardware_deleted",
		ActorUserID:    nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx)),
		OrganizationID: org,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details: map[string]interface{}{
			"hardware_id":         cmd.ID,
			"code":                code,
			"deleted_ids":         ids,
			"removed_from_groups": result.RemovedFromGroups,
		},
	}); err != nil {
		return nil, fmt.Errorf("audit catalog_hardware_deleted: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) collectCodes(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := s.db(ctx).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}
