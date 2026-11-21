package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: linaje de elecciones de un proyecto para los reportes que
// resuelven fuera de la verdad comercial (#1680). Una sola lectura alimenta
// la composición override ‖ default de diseño ‖ level choice del proyecto.

// GripLineageChoices is the design-lineage input of ONE furniture instance:
// the working item's explicit choices plus the authoring defaults of the
// design that owns its latest working item.
type GripLineageChoices struct {
	Overrides map[string]string
	Defaults  domain.DesignAuthoringDefaults
}

// ProjectGripLineageChoices reads, for every furniture instance of the
// project with a design working item, the lineage statements a resolve
// outside the commercial truth composes from: the working item's explicit
// choices and the owning design's authoring defaults (the LATEST working
// item wins when an instance appears in several designs), plus the
// project-wide option defaults (F029) shared by every unit. Instances
// without a working item are simply absent from the map.
func (s *PostgresStore) ProjectGripLineageChoices(ctx context.Context, projectID string) (map[string]GripLineageChoices, map[string]string, error) {
	lineage := map[string]GripLineageChoices{}
	levelChoices := map[string]string{}
	if !isValidUUID(projectID) {
		return lineage, levelChoices, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT DISTINCT ON (dwi.furniture_instance_id)
		       dwi.furniture_instance_id::text,
		       dwi.material_choices,
		       dwc.authoring_defaults
		FROM design_working_items dwi
		LEFT JOIN design_working_copies dwc ON dwc.design_id = dwi.design_id
		WHERE dwi.project_id = $1
		ORDER BY dwi.furniture_instance_id, dwi.updated_at DESC, dwi.design_id
	`, projectID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var instanceID string
		var rawChoices, rawDefaults []byte
		if err := rows.Scan(&instanceID, &rawChoices, &rawDefaults); err != nil {
			return nil, nil, err
		}
		entry := GripLineageChoices{Overrides: map[string]string{}}
		if len(rawChoices) > 0 && string(rawChoices) != "null" {
			if err := json.Unmarshal(rawChoices, &entry.Overrides); err != nil {
				return nil, nil, fmt.Errorf("%w: material_choices del working item %s: %v", domain.ErrSerializationFailed, instanceID, err)
			}
		}
		if entry.Overrides == nil {
			entry.Overrides = map[string]string{}
		}
		if len(rawDefaults) > 0 && string(rawDefaults) != "null" {
			var defaults domain.DesignAuthoringDefaults
			if err := json.Unmarshal(rawDefaults, &defaults); err != nil {
				return nil, nil, fmt.Errorf("%w: authoring defaults del diseño de %s: %v", domain.ErrSerializationFailed, instanceID, err)
			}
			entry.Defaults = defaults.Normalize()
		}
		lineage[instanceID] = entry
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	levelChoices, err = s.loadProjectLevelChoices(ctx, projectID)
	if err != nil {
		return nil, nil, err
	}
	return lineage, levelChoices, nil
}
