package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestEffectiveOptionChoices(t *testing.T) {
	t.Parallel()

	t.Run("project only", func(t *testing.T) {
		t.Parallel()
		got := EffectiveOptionChoices(nil, map[string]string{
			"INTERIOR": "mat-a",
			"BISAGRA":  "hw-a",
		})
		if got["INTERIOR"] != "mat-a" || got["BISAGRA"] != "hw-a" {
			t.Fatalf("unexpected merge: %#v", got)
		}
	})

	t.Run("item overrides project", func(t *testing.T) {
		t.Parallel()
		got := EffectiveOptionChoices(
			map[string]string{"INTERIOR": "mat-b"},
			map[string]string{"INTERIOR": "mat-a", "FRENTE": "mat-c"},
		)
		if got["INTERIOR"] != "mat-b" {
			t.Fatalf("override lost: %#v", got)
		}
		if got["FRENTE"] != "mat-c" {
			t.Fatalf("project default lost: %#v", got)
		}
	})

	t.Run("empty item value inherits", func(t *testing.T) {
		t.Parallel()
		got := EffectiveOptionChoices(
			map[string]string{"INTERIOR": "  "},
			map[string]string{"INTERIOR": "mat-a"},
		)
		if got["INTERIOR"] != "mat-a" {
			t.Fatalf("empty should inherit: %#v", got)
		}
	})
}

func TestChoicesForItem(t *testing.T) {
	t.Parallel()
	project := domain.Project{
		ProjectLevelChoices: map[string]string{"INTERIOR": "mat-a"},
	}
	item := domain.ProjectItem{
		OptionChoices: map[string]string{"FRENTE": "mat-c"},
	}
	got := choicesForItem(project, item)
	if got["INTERIOR"] != "mat-a" || got["FRENTE"] != "mat-c" {
		t.Fatalf("choicesForItem: %#v", got)
	}
}
