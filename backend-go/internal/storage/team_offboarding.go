package storage

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// MembershipResponsibilityInventory is the immutable, tenant-scoped preview of
// work that must be transferred or released before a membership can leave.
type MembershipResponsibilityInventory struct {
	OrganizationID              string
	MembershipID                string
	UserID                      string
	CustomerOwnershipCount      int
	SalesProjectOwnershipCount  int
	EngineerAssignmentCount     int
	OpenWarrantyAssignmentCount int
	ActiveProductionClaimCount  int
}

// TransferRequiredCount reports responsibilities that require an explicit
// reassignment. Active production claims are blockers and are intentionally
// excluded because their owning workflow must release or finish them.
func (i MembershipResponsibilityInventory) TransferRequiredCount() int {
	return i.CustomerOwnershipCount + i.SalesProjectOwnershipCount +
		i.EngineerAssignmentCount + i.OpenWarrantyAssignmentCount
}

// BlockingCount reports responsibilities that cannot be reassigned by Team.
func (i MembershipResponsibilityInventory) BlockingCount() int {
	return i.ActiveProductionClaimCount
}

// GetMembershipResponsibilityInventory loads the responsibility preview for a
// membership in the organization carried by ctx. The membership supplies the
// user identity; callers cannot substitute an arbitrary user ID.
func (s *PostgresStore) GetMembershipResponsibilityInventory(ctx context.Context, membershipID string) (*MembershipResponsibilityInventory, error) {
	organizationID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	var inventory MembershipResponsibilityInventory
	err = s.db(ctx).QueryRow(ctx, `
		WITH target AS (
			SELECT id, user_id
			FROM memberships
			WHERE id = $1 AND organization_id = $2
		)
		SELECT
			$2,
			t.id,
			t.user_id,
			(SELECT COUNT(*) FROM customers c
				WHERE c.organization_id = $2 AND c.owner_user_id = t.user_id),
			(SELECT COUNT(*) FROM projects p
				WHERE p.sales_organization_id = $2 AND p.owner_user_id = t.user_id),
			(SELECT COUNT(*) FROM projects p
				WHERE p.manufacturing_organization_id = $2 AND p.assigned_engineer_id = t.user_id),
			(SELECT COUNT(*) FROM warranty_tickets w
				WHERE w.organization_id = $2
					AND w.assigned_technician_id = t.user_id
					AND w.status IN ('open', 'visit_scheduled', 'in_progress')),
			(SELECT COUNT(*) FROM production_activities a
				WHERE a.organization_id = $2
					AND a.operator_id = t.user_id::text
					AND a.type = 'claim'
					AND a.finished_at IS NULL)
		FROM target t
	`, membershipID, organizationID).Scan(
		&inventory.OrganizationID,
		&inventory.MembershipID,
		&inventory.UserID,
		&inventory.CustomerOwnershipCount,
		&inventory.SalesProjectOwnershipCount,
		&inventory.EngineerAssignmentCount,
		&inventory.OpenWarrantyAssignmentCount,
		&inventory.ActiveProductionClaimCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMembershipNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inventory, nil
}
