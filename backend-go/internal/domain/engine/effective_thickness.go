package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Canonical effective-thickness path shared by the Go BOM resolver and the Go
// layout resolver (#402 / MT-1). Mirrors TS getComponentThickness +
// requireMaterialChoice semantics from packages/domain/src/engine/bom.ts.
//
// Canonical precedence
// (docs/architecture/material-aware-furniture-resolution.md §3.3, §6):
//
//	selected active MaterialBoard.thicknessMm
//	  > component authoring/default thickness (no choice yet: preview/authoring)
//
// The material must be resolved BEFORE evaluating any formula, pose, dimension,
// AABB or hardware anchor that consumes T — resolving it after geometry is the
// bug this rule eliminates.

// resolveSelectedBoard resolves a material binding role through the option
// choices (role == option group code, value == material id), applying the
// explicit legacy alias precedence (#403 / MT-2 — identical table to TS
// resolveBoardOptionChoiceId; see material_role.go).
//
// nil, nil means "no choice for this role": callers keep the deterministic
// nominal/palette fallback. An explicit choice pointing at an unknown or
// inactive material fails loudly — a selection must never silently degrade.
func resolveSelectedBoard(optionRole string, optionChoices map[string]string, materials []domain.MaterialBoard) (*domain.MaterialBoard, error) {
	choiceID := resolveBoardOptionChoiceID(optionRole, optionChoices)
	if choiceID == "" {
		return nil, nil
	}
	for i := range materials {
		m := &materials[i]
		if m.ID != choiceID {
			continue
		}
		if !m.Active {
			return nil, fmt.Errorf("el material elegido para %s está inactivo: %s", optionRole, m.Code)
		}
		return m, nil
	}
	return nil, fmt.Errorf("material no encontrado para la elección de %s: %s", optionRole, choiceID)
}

// effectiveThicknessMm returns the effective board thickness for a component
// whose material binding role is optionRole and whose authored nominal
// thickness is nominalMm. It fails loudly when an explicit choice selects an
// unknown/inactive material or a board without a usable thickness, so no
// downstream geometry is ever produced from a bogus T.
func effectiveThicknessMm(optionRole string, nominalMm int, optionChoices map[string]string, materials []domain.MaterialBoard) (int, error) {
	material, err := resolveSelectedBoard(optionRole, optionChoices, materials)
	if err != nil {
		return 0, err
	}
	if material == nil {
		// No material binding resolved yet: deterministic authoring fallback
		// (contract §15 — preview/authoring without a choice).
		return nominalMm, nil
	}
	if material.ThicknessMm <= 0 {
		return 0, fmt.Errorf("el material elegido para %s no tiene un espesor válido: %s (%d mm)", optionRole, material.Code, material.ThicknessMm)
	}
	return material.ThicknessMm, nil
}
