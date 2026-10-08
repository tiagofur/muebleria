package storage

import (
	"context"
)

// OpeningGripOverrideHit is one design override selecting a legacy gola
// handle option (#1136): the manual-review queue of the grip migration.
type OpeningGripOverrideHit struct {
	ModuleID   string `json:"moduleId"`
	ModuleCode string `json:"moduleCode"`
	AgregadoID string `json:"agregadoId"`
	OptionRole string `json:"optionRole"`
	Value      string `json:"value"`
}

// ScanModuleAgregadoOverrides finds every module agregado option override
// whose VALUE matches the prefix (case-insensitive), for the org in
// context. Read-only: the migration reports these, it never rewrites them —
// converting a persisted override into an opening intent is a design
// decision, never a data migration.
func (s *PostgresStore) ScanModuleAgregadoOverrides(ctx context.Context, valuePrefix string) ([]OpeningGripOverrideHit, error) {
	query := `
		SELECT m.id::text, m.code, inst->>'id', kv.role, kv.value
		FROM modules m
		CROSS JOIN LATERAL jsonb_array_elements(m.agregados) AS inst
		CROSS JOIN LATERAL jsonb_each_text(inst->'option_overrides') AS kv(role, value)
		WHERE m.organization_id = $1
		  AND jsonb_typeof(m.agregados) = 'array'
		  AND lower(kv.value) LIKE lower($2)
		ORDER BY m.code, inst->>'id', kv.role
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx), valuePrefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := []OpeningGripOverrideHit{}
	for rows.Next() {
		var hit OpeningGripOverrideHit
		if err := rows.Scan(&hit.ModuleID, &hit.ModuleCode, &hit.AgregadoID, &hit.OptionRole, &hit.Value); err != nil {
			return nil, err
		}
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}
