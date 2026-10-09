package storage

import (
	"context"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// ConsumedHardwareOptionGroup is one hardware option group the Inspector
// card offers (#1252): members are the group's optionIds, the choice is the
// design's authoring default (empty = sin elegir — never silently defaulted,
// matching the release-BOM consumption of the same map).
type ConsumedHardwareOptionGroup struct {
	Code             string   `json:"code"`
	Name             string   `json:"name"`
	OptionIDs        []string `json:"option_ids"`
	ChosenHardwareID string   `json:"chosen_hardware_id,omitempty"`
	// ConsumedBy counts distinct definitions (design scope: working-copy
	// items; project scope: project items) whose por-grupo demand carries
	// this group.
	ConsumedBy int `json:"consumed_by"`
}

// DesignConsumedHardwareOptionGroups is the read model behind
// GET /api/designs/{designId}/hardware-option-groups. Scope=design lists
// the groups the design's own definitions consume; scope=project is the
// EXPLICIT owner-approved fallback (2026-10-09): when the design consumes
// no group, the card offers what the project's furniture models consume —
// never the whole catalog.
type DesignConsumedHardwareOptionGroups struct {
	DesignID  string                        `json:"design_id"`
	ProjectID string                        `json:"project_id"`
	Scope     string                        `json:"scope"`
	Groups    []ConsumedHardwareOptionGroup `json:"groups"`
}

// GetDesignConsumedHardwareOptionGroups walks the design's working-copy
// definitions and collects the hardware option groups their por-grupo demand
// consumes (engine.CollectModuleConsumedHardwareRoles). A working item whose
// definition no longer exists in the catalog contributes nothing — the
// projection fails closed per definition, never per request.
func (s *PostgresStore) GetDesignConsumedHardwareOptionGroups(ctx context.Context, designID string) (*DesignConsumedHardwareOptionGroups, error) {
	wc, err := s.GetDesignWorkingCopy(ctx, designID)
	if err != nil {
		return nil, err
	}

	cat, err := s.GetFullCatalog(ctx)
	if err != nil {
		return nil, err
	}

	groups := consumedHardwareGroupsForDefinitions(cat, distinctWorkingDefinitionIDs(wc.Items), wc.AuthoringDefaults.MaterialChoices)
	scope := "design"
	if len(groups) == 0 {
		scope = "project"
		moduleIDs, err := s.projectItemModuleIDs(ctx, wc.ProjectID)
		if err != nil {
			return nil, err
		}
		groups = consumedHardwareGroupsForDefinitions(cat, moduleIDs, wc.AuthoringDefaults.MaterialChoices)
	}

	return &DesignConsumedHardwareOptionGroups{
		DesignID:  wc.DesignID,
		ProjectID: wc.ProjectID,
		Scope:     scope,
		Groups:    groups,
	}, nil
}

// consumedHardwareGroupsForDefinitions joins consumed roles against the
// catalog's kind=hardware option groups. A consumed role with no matching
// group is skipped: the card can only offer groups a member can actually be
// chosen for (stale roles surface at the quote gate instead).
func consumedHardwareGroupsForDefinitions(cat domain.Catalog, definitionIDs []string, choices map[string]string) []ConsumedHardwareOptionGroup {
	roleDefs := map[string]map[string]bool{}
	for _, id := range definitionIDs {
		var module *domain.Module
		for i := range cat.Modules {
			if cat.Modules[i].ID == id {
				module = &cat.Modules[i]
				break
			}
		}
		if module == nil {
			continue
		}
		for _, role := range engine.CollectModuleConsumedHardwareRoles(*module, cat) {
			if roleDefs[role] == nil {
				roleDefs[role] = map[string]bool{}
			}
			roleDefs[role][id] = true
		}
	}

	out := []ConsumedHardwareOptionGroup{}
	for _, group := range cat.OptionGroups {
		if group.Kind != "hardware" {
			continue
		}
		defs, ok := roleDefs[group.Code]
		if !ok {
			continue
		}
		members := make([]string, len(group.OptionIDs))
		copy(members, group.OptionIDs)
		out = append(out, ConsumedHardwareOptionGroup{
			Code:             group.Code,
			Name:             group.Name,
			OptionIDs:        members,
			ChosenHardwareID: choices[group.Code],
			ConsumedBy:       len(defs),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

func distinctWorkingDefinitionIDs(items []domain.DesignWorkingItem) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		if item.FurnitureDefinitionID == "" || seen[item.FurnitureDefinitionID] {
			continue
		}
		seen[item.FurnitureDefinitionID] = true
		out = append(out, item.FurnitureDefinitionID)
	}
	sort.Strings(out)
	return out
}

// projectItemModuleIDs lists the distinct catalog modules the project's
// line items reference — the owner-approved project fallback scope. Rows
// are fully drained before the next query (one connection under the request
// tenant transaction).
func (s *PostgresStore) projectItemModuleIDs(ctx context.Context, projectID string) ([]string, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT DISTINCT module_id
		FROM project_items
		WHERE project_id = $1
		ORDER BY module_id ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []string{}
	for rows.Next() {
		var moduleID string
		if err := rows.Scan(&moduleID); err != nil {
			return nil, err
		}
		out = append(out, moduleID)
	}
	return out, rows.Err()
}
