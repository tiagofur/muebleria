package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Material binding role contract (#403 / MT-2). Mirrors
// packages/domain/src/materialRole.ts — keep both in sync;
// contracts/materialRoleBinding.contract.json is the shared alias fixture both
// stacks test against.
//
// Canonical rule (docs/architecture/material-aware-furniture-resolution.md
// §3.5, §5): for a rectangular board participating in material selection,
// OptionRoles[0] is the single persisted material-binding key. Placement
// answers the physical question (what piece is this); the binding role
// answers which material selection the piece follows. Never infer the binding
// from component name, material name, color, texture or manufacturer.
//
// A board declaring multiple competing roles is ambiguous: the engine consumes
// only the first entry, so any extra role would appear configurable without
// ever governing resolution. Such definitions fail loudly instead of being
// silently half-honored.

const (
	// zocloBoardRole mirrors TS ZOCLO_BOARD_ROLE (plinth.ts).
	zocloBoardRole = "ZOCLO"
	// frontRole mirrors TS ZOCLO_BOARD_FALLBACK_ROLE — the front finish role.
	frontRole = "FRENTE"
)

// distinctOptionRoles normalizes a component's OptionRoles: trims entries,
// drops empty ones and exact duplicates (first-seen order preserved).
// Identical repeated entries are not competing roles; distinct ones are.
func distinctOptionRoles(optionRoles []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(optionRoles))
	for _, raw := range optionRoles {
		role := strings.TrimSpace(raw)
		if role == "" || seen[role] {
			continue
		}
		seen[role] = true
		out = append(out, role)
	}
	return out
}

// materialBindingRole returns the single material binding role a board
// component follows. It errors when the component declares no usable role or
// several distinct ones — callers must never fall back to "just take [0]" on
// ambiguity, because the discarded roles would look configurable while
// controlling nothing.
func materialBindingRole(comp domain.Component) (string, error) {
	roles := distinctOptionRoles(comp.OptionRoles)
	label := comp.Code
	if label == "" {
		label = comp.ID
	}
	if len(roles) == 0 {
		return "", fmt.Errorf(
			"component %s has no material binding role (optionRoles is empty)", label,
		)
	}
	if len(roles) > 1 {
		return "", fmt.Errorf(
			"component %s declares multiple material binding roles [%s]; only one role per board is supported — remove the extra roles",
			label, strings.Join(roles, ", "),
		)
	}
	return roles[0], nil
}

// legacyFrontAliasTargets mirrors TS legacyFrontAliasTargets: the explicit
// legacy alias table. Direct role choice wins; otherwise ZOCLO, PUERTA,
// PUERTA_* and FRENTE_CAJON may inherit the FRENTE choice. This is the ONLY
// alias behavior allowed — never extend it by name/color/texture matching.
func legacyFrontAliasTargets(role string) []string {
	upper := strings.ToUpper(strings.TrimSpace(role))
	switch {
	case upper == zocloBoardRole:
		return []string{frontRole}
	case upper == "PUERTA" || strings.HasPrefix(upper, "PUERTA_") || upper == "FRENTE_CAJON":
		return []string{frontRole}
	default:
		return nil
	}
}

// resolveBoardOptionChoiceID mirrors TS resolveBoardOptionChoiceId
// (plinth.ts): resolves a material binding role through the option choices
// (role == option group code, value == material id) applying the explicit
// legacy alias precedence. Empty string means "no choice for this role".
func resolveBoardOptionChoiceID(optionRole string, optionChoices map[string]string) string {
	if direct := strings.TrimSpace(optionChoices[optionRole]); direct != "" {
		return direct
	}
	for _, alias := range legacyFrontAliasTargets(optionRole) {
		if inherited := strings.TrimSpace(optionChoices[alias]); inherited != "" {
			return inherited
		}
	}
	return ""
}
