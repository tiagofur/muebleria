package engine

import (
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// EffectiveOptionChoices merges project-level defaults with item overrides (F029).
// Empty item values inherit the project default; explicit item values win.
func EffectiveOptionChoices(item map[string]string, projectLevel map[string]string) map[string]string {
	out := make(map[string]string)
	for code, id := range projectLevel {
		v := strings.TrimSpace(id)
		if v != "" {
			out[code] = v
		}
	}
	for code, id := range item {
		v := strings.TrimSpace(id)
		if v != "" {
			out[code] = v
		}
	}
	return out
}

// choicesForItem is a convenience wrapper for project item resolution.
func choicesForItem(project domain.Project, item domain.ProjectItem) map[string]string {
	return EffectiveOptionChoices(item.OptionChoices, project.ProjectLevelChoices)
}
