package storage

// #1599: permanent "made in developer mode" provenance mark on a project.

import (
	"context"
	"fmt"
)

// MarkProjectDevMode stamps dev_mode_marked_at with the real moment the
// first time a project is created or synced in library developer mode. A
// project already marked keeps its original moment (no-op). It joins the
// request's tenant transaction, so the mark commits with the create/sync that
// carried it; RLS scopes the UPDATE to the caller's organizations.
func (s *PostgresStore) MarkProjectDevMode(ctx context.Context, projectID, actorUserID, ip, requestID string) (bool, error) {
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE projects SET dev_mode_marked_at = NOW()
		 WHERE id = $1 AND dev_mode_marked_at IS NULL`, projectID)
	if err != nil {
		return false, fmt.Errorf("mark project dev mode: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType: "project_dev_mode_marked", SchemaVersion: 1, RequestID: requestID,
		ActorUserID: actorUserID, OrganizationID: OrgFromCtx(ctx), IP: ip,
		Details: map[string]interface{}{"project_id": projectID},
	}); err != nil {
		return false, fmt.Errorf("audit project dev mode mark: %w", err)
	}
	return true, nil
}
