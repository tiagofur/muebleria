package storage

import (
	"context"
	"encoding/json"
	"fmt"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"strings"
	"time"
)

// Contrato: eventos de auditoría de seguridad (ADR-0004) — inserción,
// sanitización de detalles y listado por org.
func (s *PostgresStore) InsertSecurityAuditEvent(ctx context.Context, ev SecurityAuditEvent) error {
	if transactionFromContext(ctx) == nil {
		return s.WithinTenantTx(ctx, TenantActor{OrganizationID: ev.OrganizationID, UserID: ev.ActorUserID}, func(txCtx context.Context) error {
			return s.InsertSecurityAuditEvent(txCtx, ev)
		})
	}
	details, err := marshalDetails(ev.Details)
	if err != nil {
		return fmt.Errorf("encode security audit details: %w", err)
	}
	schemaVersion := ev.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = 1
	}
	requestID := ev.RequestID
	if requestID == "" {
		if legacyRequestID, ok := ev.Details["request_id"].(string); ok {
			requestID = legacyRequestID
		}
	}
	_, err = s.db(ctx).Exec(ctx, `
		INSERT INTO security_audit_events (
			event_type, schema_version, request_id, actor_user_id,
			target_user_id, organization_id, ip, details
		)
		VALUES (
			$1, $2, nullif($3, ''), nullif($4, '')::uuid,
			nullif($5, '')::uuid, nullif($6, '')::uuid, nullif($7, ''), $8::jsonb
		)`,
		ev.EventType, schemaVersion, requestID, ev.ActorUserID,
		ev.TargetUserID, ev.OrganizationID, ev.IP, details)
	return err
}

func marshalDetails(d map[string]interface{}) (string, error) {
	if len(d) == 0 {
		return "{}", nil
	}
	buf, err := json.Marshal(d)
	if err != nil {
		return "", err
	}
	var normalized interface{}
	if err := json.Unmarshal(buf, &normalized); err != nil {
		return "", err
	}
	if key := forbiddenAuditDetailKey(normalized); key != "" {
		return "", fmt.Errorf("security audit details contain forbidden secret field %q", key)
	}
	return string(buf), nil
}

func forbiddenAuditDetailKey(value interface{}) string {
	forbidden := map[string]struct{}{
		"authorization": {}, "cookie": {}, "password": {}, "password_hash": {},
		"access_token": {}, "refresh_token": {}, "token": {}, "secret": {},
		"totp_secret": {}, "recovery_code": {}, "pairing_code": {},
	}
	var visit func(interface{}) string
	visit = func(current interface{}) string {
		switch typed := current.(type) {
		case map[string]interface{}:
			for key, nested := range typed {
				if _, blocked := forbidden[strings.ToLower(key)]; blocked {
					return key
				}
				if found := visit(nested); found != "" {
					return found
				}
			}
		case []interface{}:
			for _, nested := range typed {
				if found := visit(nested); found != "" {
					return found
				}
			}
		}
		return ""
	}
	return visit(value)
}

// ListSecurityAuditEvents returns the newest events, optionally filtered by
// organization (empty string = platform-wide, platform console only).
func (s *PostgresStore) ListSecurityAuditEvents(ctx context.Context, organizationID string, limit int) ([]openapi.SecurityAuditEvent, error) {
	if organizationID != "" && transactionFromContext(ctx) != nil {
		if err := authorizeTenantOrganizations(ctx, organizationID); err != nil {
			return nil, err
		}
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, event_type, actor_user_id, target_user_id, organization_id, COALESCE(ip, ''), details, created_at
		FROM security_audit_events
		WHERE ($1 = '' OR organization_id = $1::uuid)
		ORDER BY created_at DESC
		LIMIT $2`, organizationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []openapi.SecurityAuditEvent{}
	for rows.Next() {
		var id, eventType, ip string
		var actor, target, org *string
		var details []byte
		var createdAt time.Time
		if err := rows.Scan(&id, &eventType, &actor, &target, &org, &ip, &details, &createdAt); err != nil {
			return nil, err
		}
		decoded := map[string]any{}
		if err := json.Unmarshal(details, &decoded); err != nil {
			return nil, err
		}
		out = append(out, openapi.SecurityAuditEvent{ID: id, EventType: eventType, ActorUserID: actor, TargetUserID: target, OrganizationID: org, IP: ip, Details: decoded, CreatedAt: createdAt.UTC().Format(time.RFC3339Nano)})
	}
	return out, rows.Err()
}

// --- Support sessions (ADR-0005 §5 / #326) ---
