package engine

import (
	"encoding/json"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// MeasureDefaultDims is one entry of Project.MeasureDefaults (#109).
// Pointers distinguish unset (nil) from an explicit zero.
type MeasureDefaultDims struct {
	Depth  *float64 `json:"depth,omitempty"`
	Height *float64 `json:"height,omitempty"`
}

// PickPresetByMeasureDefaults picks the module preset whose depth/height best
// match the project defaults for the module's furniture type (#109 / H14).
//
//   - Resolves the module type (Module.FurnitureType, "" → "inferior").
//   - Reads the matching entry from defaults. If none, or no depth/height set,
//     returns the first preset (== default preset).
//   - Otherwise picks the preset with the smallest absolute-mm distance summed
//     over the dimensions present in the project default.
//   - Returns "" when the module has no presets.
//
// defaultsRaw is the raw JSON of Project.MeasureDefaults
// ({"inferior":{"depth":560,"height":720}, ...}). nil/empty → no defaults.
func PickPresetByMeasureDefaults(mod domain.Module, defaultsRaw json.RawMessage) string {
	presets := mod.Presets
	if len(presets) == 0 {
		return ""
	}
	ft := mod.FurnitureType
	if ft == "" {
		ft = "inferior"
	}
	target, ok := parseMeasureDefaultForType(defaultsRaw, ft)
	if !ok || (target.Depth == nil && target.Height == nil) {
		return presets[0].ID
	}

	bestIdx := 0
	bestDist := distanceFor(presets[0], target)
	for i := 1; i < len(presets); i++ {
		d := distanceFor(presets[i], target)
		if d < bestDist {
			bestIdx = i
			bestDist = d
		}
	}
	return presets[bestIdx].ID
}

func distanceFor(preset domain.DimensionPreset, target MeasureDefaultDims) float64 {
	var dist float64
	if target.Depth != nil {
		dist += absFloat(float64(preset.DepthMm) - *target.Depth)
	}
	if target.Height != nil {
		dist += absFloat(float64(preset.HeightMm) - *target.Height)
	}
	return dist
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// parseMeasureDefaultForType extracts the dims for a single furnitureType from
// the raw measure_defaults JSON. Returns ok=false when absent or invalid.
func parseMeasureDefaultForType(raw json.RawMessage, ft string) (MeasureDefaultDims, bool) {
	if len(raw) == 0 {
		return MeasureDefaultDims{}, false
	}
	var all map[string]MeasureDefaultDims
	if err := json.Unmarshal(raw, &all); err != nil {
		return MeasureDefaultDims{}, false
	}
	entry, ok := all[ft]
	if !ok {
		return MeasureDefaultDims{}, false
	}
	return entry, true
}
