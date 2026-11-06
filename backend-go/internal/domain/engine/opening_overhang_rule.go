package engine

import "github.com/tiagofur/muebles-backend/internal/domain"

// OpeningOverhangRuleMm projects the overhang rule onto the resolver's
// input. Since #1531 the rule comes from the grip styles and is never nil
// in production; nil stays nil (the resolver rejects it as invalid input).
func OpeningOverhangRuleMm(rule *domain.OpeningOverhangRule) *int {
	if rule == nil {
		return nil
	}
	mm := rule.OverhangMm
	return &mm
}
