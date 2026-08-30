package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type OrganizationReadiness struct {
	ActiveAdminReady  bool
	TeamStateReady    bool
	SettingsReady     bool
	EntitlementsReady bool
	CatalogReady      bool
	MediaReady        bool
}

func (r OrganizationReadiness) Ready() bool {
	return r.ActiveAdminReady && r.TeamStateReady && r.SettingsReady &&
		r.EntitlementsReady && r.CatalogReady && r.MediaReady
}

func (s *PostgresStore) GetOrganizationReadiness(ctx context.Context, organizationID string) (*OrganizationReadiness, error) {
	out := &OrganizationReadiness{CatalogReady: true, MediaReady: true}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT
			state.active_admin_count > 0,
			NOT state.admin_bootstrap_pending,
			EXISTS (SELECT 1 FROM workshop_settings settings WHERE settings.organization_id=$1),
			entitlement.organization_id IS NOT NULL
				AND entitlement.max_sales_partners >= 0
				AND entitlement.sketchup_seats >= 0
				AND nullif(btrim(entitlement.defaults_revision), '') IS NOT NULL
		FROM organization_team_state state
		JOIN organization_entitlements entitlement ON entitlement.organization_id=state.organization_id
		WHERE state.organization_id=$1`, organizationID).
		Scan(&out.ActiveAdminReady, &out.TeamStateReady, &out.SettingsReady, &out.EntitlementsReady)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	return out, err
}

type OrganizationOffboardingPreview struct {
	OpenProjectCount                int
	ActiveProductionClaimCount      int
	ActivePartOperationCount        int
	ActiveModuleUnitCount           int
	ActiveInstallationVisitCount    int
	OpenInstallationFieldIssueCount int
	OpenInstallationPunchItemCount  int
	OpenPurchaseOrderCount          int
	OpenWarrantyTicketCount         int
	ActiveChildOrganizationCount    int
}

func (p OrganizationOffboardingPreview) BlockingCount() int {
	return p.OpenProjectCount + p.ActiveProductionClaimCount +
		p.ActivePartOperationCount + p.ActiveModuleUnitCount +
		p.ActiveInstallationVisitCount + p.OpenInstallationFieldIssueCount +
		p.OpenInstallationPunchItemCount +
		p.OpenPurchaseOrderCount + p.OpenWarrantyTicketCount +
		p.ActiveChildOrganizationCount
}

func (s *PostgresStore) GetOrganizationOffboardingPreview(ctx context.Context, organizationID string) (*OrganizationOffboardingPreview, error) {
	for _, lock := range []struct {
		name  string
		query string
	}{
		{"organization", `SELECT command_lock_organization($1)::text`},
		{"projects", `SELECT id::text FROM projects WHERE organization_id=$1 OR sales_organization_id=$1 OR manufacturing_organization_id=$1 ORDER BY id FOR UPDATE`},
		{"production activities", `SELECT id::text FROM production_activities WHERE organization_id=$1 AND type='claim' AND finished_at IS NULL ORDER BY id FOR UPDATE`},
		{"purchase orders", `SELECT id::text FROM purchase_orders WHERE organization_id=$1 AND status IN ('borrador','emitida') ORDER BY id FOR UPDATE`},
		{"warranty tickets", `SELECT id::text FROM warranty_tickets WHERE organization_id=$1 AND status NOT IN ('resolved','closed','cancelled') ORDER BY id FOR UPDATE`},
		{"child organizations", `SELECT command_lock_child_organizations($1)::text`},
	} {
		rows, err := s.db(ctx).Query(ctx, lock.query, organizationID)
		if err != nil {
			return nil, fmt.Errorf("lock offboarding %s: %w", lock.name, err)
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	out := &OrganizationOffboardingPreview{}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM projects
			  WHERE (organization_id=$1 OR sales_organization_id=$1 OR manufacturing_organization_id=$1)
			    AND status IN ('draft','quoted','accepted')),
			(SELECT count(*) FROM production_activities WHERE organization_id=$1 AND type='claim' AND finished_at IS NULL),
			(SELECT count(*)
			   FROM projects project
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(project.part_instances, '[]'::jsonb)) part
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(part->'required_operations', '[]'::jsonb)) operation
			  WHERE project.manufacturing_organization_id=$1
			    AND operation->>'status' NOT IN ('completed','skipped')),
			(SELECT count(*)
			   FROM projects project
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(project.module_units, '[]'::jsonb)) unit
			  WHERE project.manufacturing_organization_id=$1
			    AND unit->>'status' <> 'installed'),
			(SELECT count(*)
			   FROM projects project
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(project.installation->'visits', '[]'::jsonb)) visit
			  WHERE project.manufacturing_organization_id=$1
			    AND visit->>'status' IN ('scheduled','in_progress')),
			(SELECT count(*)
			   FROM projects project
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(project.installation->'field_issues', '[]'::jsonb)) issue
			  WHERE project.manufacturing_organization_id=$1
			    AND issue->>'status' IN ('open','action_required','blocked')),
			(SELECT count(*)
			   FROM projects project
			   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(project.installation->'punch_items', '[]'::jsonb)) punch
			  WHERE project.manufacturing_organization_id=$1
			    AND punch->>'status' = 'open'),
			(SELECT count(*) FROM purchase_orders WHERE organization_id=$1 AND status IN ('borrador','emitida')),
			(SELECT count(*) FROM warranty_tickets WHERE organization_id=$1 AND status NOT IN ('resolved','closed','cancelled')),
			(SELECT count(*) FROM organizations WHERE parent_organization_id=$1 AND status <> 'terminated')`, organizationID).
		Scan(&out.OpenProjectCount, &out.ActiveProductionClaimCount,
			&out.ActivePartOperationCount, &out.ActiveModuleUnitCount,
			&out.ActiveInstallationVisitCount, &out.OpenInstallationFieldIssueCount,
			&out.OpenInstallationPunchItemCount,
			&out.OpenPurchaseOrderCount, &out.OpenWarrantyTicketCount,
			&out.ActiveChildOrganizationCount)
	return out, err
}
