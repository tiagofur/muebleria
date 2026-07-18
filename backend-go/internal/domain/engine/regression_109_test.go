package engine

import (
	"encoding/json"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestPickPresetByMeasureDefaults covers the Go port of the project measure
// defaults helper (#109 / H14). Mirrors packages/domain measurePresets.test.ts
// "pickPresetByMeasureDefaults" cases so TS and Go stay in parity.
func TestPickPresetByMeasureDefaults(t *testing.T) {
	inferiorMod := domain.Module{
		ID:            "mod-inf",
		Code:          "MOD-INF",
		Name:          "Inferior",
		FurnitureType: "inferior",
		Presets: []domain.DimensionPreset{
			{ID: "d560", WidthMm: 600, HeightMm: 720, DepthMm: 560},
			{ID: "d590", WidthMm: 600, HeightMm: 720, DepthMm: 590},
			{ID: "d600", WidthMm: 600, HeightMm: 720, DepthMm: 600},
		},
	}
	superiorMod := domain.Module{
		ID:            "mod-sup",
		Code:          "MOD-SUP",
		Name:          "Superior",
		FurnitureType: "superior",
		Presets: []domain.DimensionPreset{
			{ID: "s320", WidthMm: 600, HeightMm: 720, DepthMm: 320},
			{ID: "s350", WidthMm: 600, HeightMm: 720, DepthMm: 350},
		},
	}

	t.Run("returns first preset when no defaults (nil)", func(t *testing.T) {
		if got := PickPresetByMeasureDefaults(inferiorMod, nil); got != "d560" {
			t.Fatalf("got %q, want d560", got)
		}
	})
	t.Run("returns empty when module has no presets", func(t *testing.T) {
		noPresets := domain.Module{ID: "x", Code: "X", Name: "X"}
		if got := PickPresetByMeasureDefaults(noPresets, nil); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})
	t.Run("superior default does not affect inferior module", func(t *testing.T) {
		raw := json.RawMessage(`{"superior":{"depth":320}}`)
		if got := PickPresetByMeasureDefaults(inferiorMod, raw); got != "d560" {
			t.Fatalf("inferior got %q, want d560 (no inferior entry)", got)
		}
		if got := PickPresetByMeasureDefaults(superiorMod, raw); got != "s320" {
			t.Fatalf("superior got %q, want s320", got)
		}
	})
	t.Run("exact depth match", func(t *testing.T) {
		raw := json.RawMessage(`{"inferior":{"depth":590}}`)
		if got := PickPresetByMeasureDefaults(inferiorMod, raw); got != "d590" {
			t.Fatalf("got %q, want d590", got)
		}
	})
	t.Run("closest depth when no exact match", func(t *testing.T) {
		// target 580 → dist 560=20, 590=10, 600=20 → 590 wins
		raw := json.RawMessage(`{"inferior":{"depth":580}}`)
		if got := PickPresetByMeasureDefaults(inferiorMod, raw); got != "d590" {
			t.Fatalf("got %q, want d590", got)
		}
	})
	t.Run("combines depth + height distance", func(t *testing.T) {
		mod := domain.Module{
			FurnitureType: "inferior",
			Presets: []domain.DimensionPreset{
				{ID: "a", WidthMm: 600, HeightMm: 720, DepthMm: 560},
				{ID: "b", WidthMm: 600, HeightMm: 900, DepthMm: 560},
				{ID: "c", WidthMm: 600, HeightMm: 900, DepthMm: 600},
			},
		}
		// target depth 580 + height 900:
		//   a: 20 + 180 = 200; b: 20 + 0 = 20 (winner); c: 20 + 0 = 20 (tie → first, b)
		raw := json.RawMessage(`{"inferior":{"depth":580,"height":900}}`)
		if got := PickPresetByMeasureDefaults(mod, raw); got != "b" {
			t.Fatalf("got %q, want b", got)
		}
	})
	t.Run("height only", func(t *testing.T) {
		mod := domain.Module{
			FurnitureType: "alto",
			Presets: []domain.DimensionPreset{
				{ID: "h2100", WidthMm: 600, HeightMm: 2100, DepthMm: 600},
				{ID: "h1800", WidthMm: 600, HeightMm: 1800, DepthMm: 600},
			},
		}
		raw := json.RawMessage(`{"alto":{"height":2000}}`)
		if got := PickPresetByMeasureDefaults(mod, raw); got != "h2100" {
			t.Fatalf("got %q, want h2100", got)
		}
	})
	t.Run("empty furnitureType treated as inferior", func(t *testing.T) {
		mod := domain.Module{
			Presets: []domain.DimensionPreset{
				{ID: "x560", WidthMm: 600, HeightMm: 720, DepthMm: 560},
				{ID: "x600", WidthMm: 600, HeightMm: 720, DepthMm: 600},
			},
		}
		raw := json.RawMessage(`{"inferior":{"depth":600}}`)
		if got := PickPresetByMeasureDefaults(mod, raw); got != "x600" {
			t.Fatalf("got %q, want x600", got)
		}
	})
	t.Run("malformed JSON falls back to first preset", func(t *testing.T) {
		raw := json.RawMessage(`{not valid json`)
		if got := PickPresetByMeasureDefaults(inferiorMod, raw); got != "d560" {
			t.Fatalf("got %q, want d560", got)
		}
	})
	t.Run("type entry with no dims falls back to first preset", func(t *testing.T) {
		raw := json.RawMessage(`{"inferior":{}}`)
		if got := PickPresetByMeasureDefaults(inferiorMod, raw); got != "d560" {
			t.Fatalf("got %q, want d560", got)
		}
	})
}
