package storage

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

type revisionDefinitionDescriptor struct {
	Code       string
	Name       string
	Parameters []domain.FurnitureParameterDefinition
	Roles      []string
}

type revisionMaterialDescriptor struct {
	Code        string
	Name        string
	ThicknessMM float64
}

func actorDisplayName(ctx context.Context, s *PostgresStore, actorID, fallback string) string {
	if !isValidUUID(actorID) {
		return fallback
	}
	var name string
	if err := s.db(ctx).QueryRow(ctx, `SELECT btrim(name) FROM users WHERE id = $1`, actorID).Scan(&name); err != nil || name == "" {
		return fallback
	}
	return name
}

func (s *PostgresStore) buildDesignRevisionPresentation(ctx context.Context, organizationID, projectID string, items []PublishDesignRevisionItemCommand) error {
	definitions := map[string]revisionDefinitionDescriptor{}
	definitionIDs := make([]string, 0, len(items))
	for _, item := range items {
		if isValidUUID(item.FurnitureDefinitionID) {
			definitionIDs = append(definitionIDs, item.FurnitureDefinitionID)
		}
	}
	if len(definitionIDs) > 0 {
		rows, err := s.db(ctx).Query(ctx, `
			SELECT m.id::text, m.code, m.name, m.parameter_definitions,
			       COALESCE(array_agg(DISTINCT bp.option_role) FILTER (WHERE bp.option_role <> ''), '{}')
			FROM modules m LEFT JOIN board_parts bp ON bp.module_id = m.id
			WHERE m.organization_id = $1 AND m.id = ANY($2::uuid[])
			GROUP BY m.id, m.code, m.name, m.parameter_definitions
		`, organizationID, definitionIDs)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, code, name string
			var raw []byte
			var roles []string
			if err := rows.Scan(&id, &code, &name, &raw, &roles); err != nil {
				rows.Close()
				return err
			}
			defs, err := domain.DecodeFurnitureParameterDefinitions(raw, domain.FurnitureParameterDefinitionBoundaryPersisted)
			if err != nil {
				rows.Close()
				return err
			}
			definitions[id] = revisionDefinitionDescriptor{Code: code, Name: name, Parameters: defs, Roles: roles}
		}
		rows.Close()
	}

	materialIDs := []string{}
	for _, item := range items {
		for _, id := range item.MaterialChoices {
			if isValidUUID(id) {
				materialIDs = append(materialIDs, id)
			}
		}
	}
	materials := map[string]revisionMaterialDescriptor{}
	if len(materialIDs) > 0 {
		rows, err := s.db(ctx).Query(ctx, `SELECT id::text, code, name, thickness_mm FROM material_boards WHERE organization_id = $1 AND id = ANY($2::uuid[])`, organizationID, materialIDs)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			var value revisionMaterialDescriptor
			if err := rows.Scan(&id, &value.Code, &value.Name, &value.ThicknessMM); err != nil {
				rows.Close()
				return err
			}
			materials[id] = value
		}
		rows.Close()
	}

	roomLabels := map[string]string{}
	var surveyRaw []byte
	if err := s.db(ctx).QueryRow(ctx, `SELECT site_survey FROM projects WHERE id = $1`, projectID).Scan(&surveyRaw); err == nil && len(surveyRaw) > 0 && string(surveyRaw) != "null" {
		var survey domain.SiteSurvey
		if json.Unmarshal(surveyRaw, &survey) == nil {
			for _, space := range survey.Spaces {
				if strings.TrimSpace(space.ID) != "" && strings.TrimSpace(space.Name) != "" {
					roomLabels[space.ID] = strings.TrimSpace(space.Name)
				}
			}
		}
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	totals := map[string]int{}
	for _, item := range items {
		totals[item.FurnitureDefinitionID]++
	}
	ordinals := map[string]int{}
	for index := range items {
		item := &items[index]
		def := definitions[item.FurnitureDefinitionID]
		ordinals[item.FurnitureDefinitionID]++
		ordinal, total := ordinals[item.FurnitureDefinitionID], totals[item.FurnitureDefinitionID]
		baseLabel := strings.TrimSpace(def.Name)
		if baseLabel == "" {
			baseLabel = "Unidad"
		}
		unitLabel := baseLabel
		if total > 1 {
			unitLabel += " " + itoa(ordinal) + " de " + itoa(total)
		}

		parameterDefs := def.Parameters
		if len(parameterDefs) == 0 {
			parameterDefs = legacyDimensionDefinitions()
		}
		byKey := map[string]domain.FurnitureParameterDefinition{}
		for _, parameter := range parameterDefs {
			byKey[parameter.Name] = parameter
		}
		keys := sortedAnyKeys(item.Parameters)
		parameters := make([]domain.DesignRevisionParameter, 0, len(keys))
		for _, key := range keys {
			definition, known := byKey[key]
			entry := domain.DesignRevisionParameter{Key: key, Value: item.Parameters[key], State: "unavailable"}
			if known {
				entry.Label, entry.Type, entry.Unit, entry.State = definition.Label, string(definition.Type), string(definition.Unit), "available"
			}
			parameters = append(parameters, entry)
		}

		roleSet := map[string]struct{}{}
		for _, role := range def.Roles {
			roleSet[role] = struct{}{}
		}
		for role := range item.MaterialChoices {
			roleSet[role] = struct{}{}
		}
		roles := make([]string, 0, len(roleSet))
		for role := range roleSet {
			roles = append(roles, role)
		}
		sort.Strings(roles)
		presentationMaterials := make([]domain.DesignRevisionMaterial, 0, len(roles))
		for _, role := range roles {
			materialID, inherited := engine.ResolveBoardChoiceForPresentation(role, item.MaterialChoices)
			material, resolved := materials[materialID]
			entry := domain.DesignRevisionMaterial{
				Role:       role,
				RoleLabel:  humanizeRole(role),
				MaterialID: materialID,
				Provenance: presentationMaterialProvenance(item.MaterialChoiceSources[role], inherited, resolved),
			}
			if resolved {
				thickness := material.ThicknessMM
				entry.Code, entry.Name, entry.EffectiveThicknessMM = material.Code, material.Name, &thickness
			}
			presentationMaterials = append(presentationMaterials, entry)
		}

		room := domain.DesignRevisionRoomDescriptor{State: "unavailable"}
		if label := roomLabels[item.RoomID]; label != "" {
			room = domain.DesignRevisionRoomDescriptor{Label: label, State: "available"}
		}
		item.PresentationSnapshot = &domain.DesignRevisionPresentationSnapshot{
			SchemaVersion: 1,
			Unit:          domain.DesignRevisionUnitDescriptor{Label: unitLabel, Index: ordinal, Total: total},
			Definition:    domain.DesignRevisionDefinition{Code: def.Code, Name: def.Name},
			Parameters:    parameters,
			Materials:     presentationMaterials,
			Room:          room,
		}
	}
	return nil
}

func presentationMaterialProvenance(source domain.DesignMaterialProvenance, inherited, resolved bool) domain.DesignMaterialProvenance {
	if !resolved {
		return domain.DesignMaterialProvenanceUnresolved
	}
	if inherited {
		return domain.DesignMaterialProvenanceInheritedDefault
	}
	if source == domain.DesignMaterialProvenanceAuthored || source == domain.DesignMaterialProvenanceQuoted {
		return source
	}
	return domain.DesignMaterialProvenanceUnresolved
}

func sortedAnyKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func humanizeRole(role string) string {
	value := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(role), "_", " "))
	if value == "" {
		return "Material"
	}
	runes := []rune(value)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func legacyDimensionDefinitions() []domain.FurnitureParameterDefinition {
	return []domain.FurnitureParameterDefinition{
		{Name: "widthMm", Label: "Ancho", Type: domain.FurnitureParameterTypeNumber, Unit: domain.FurnitureParameterUnitMM},
		{Name: "heightMm", Label: "Alto", Type: domain.FurnitureParameterTypeNumber, Unit: domain.FurnitureParameterUnitMM},
		{Name: "depthMm", Label: "Profundidad", Type: domain.FurnitureParameterTypeNumber, Unit: domain.FurnitureParameterUnitMM},
	}
}

func itoa(value int) string {
	const digits = "0123456789"
	if value < 10 {
		return string(digits[value])
	}
	return itoa(value/10) + string(digits[value%10])
}
