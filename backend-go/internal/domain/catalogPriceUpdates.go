package domain

import (
	"fmt"
	"math"
	"strings"
)

// Catalog bulk price updates (#1651). The server previews and applies every
// change; the client only reads the supplier file and shows the preview.

// PriceResourceKind names the priced catalog family.
type PriceResourceKind string

const (
	PriceResourceMaterial PriceResourceKind = "material" // material_boards.board_price
	PriceResourceEdge     PriceResourceKind = "edge"     // edge_bands.cost_per_ml
	PriceResourceHardware PriceResourceKind = "hardware" // hardwares.cost_per_unit
)

// ValidPriceResourceKind reports a known kind.
func ValidPriceResourceKind(k PriceResourceKind) bool {
	switch k {
	case PriceResourceMaterial, PriceResourceEdge, PriceResourceHardware:
		return true
	}
	return false
}

// Limits of a bulk update.
const (
	PricePercentMin     = -90.0
	PricePercentMax     = 500.0
	PriceMax            = 1e9
	PriceImportMaxRows  = 5000
	PriceUpdateMaxItems = 5000
	PriceNoteMaxLen     = 500
)

// PricedItem is the current price state of one catalog resource.
type PricedItem struct {
	ID       string
	Code     string
	Name     string
	Price    float64
	Version  int64
	Category string
	Group    string // manufacturer (materials) or brand (hardware)
	Active   bool
}

// PriceChange is one proposed change, pinned to the version it was read at.
type PriceChange struct {
	Item     PricedItem
	NewPrice float64
}

// RoundPrice rounds half away from zero to cents.
func RoundPrice(v float64) float64 {
	return math.Round(v*100) / 100
}

// ValidatePricePercent checks a percent adjustment.
func ValidatePricePercent(p float64) error {
	if math.IsNaN(p) || math.IsInf(p, 0) || p == 0 {
		return fmt.Errorf("el porcentaje debe ser distinto de cero")
	}
	if p < PricePercentMin || p > PricePercentMax {
		return fmt.Errorf("el porcentaje debe estar entre %.0f%% y %.0f%%", PricePercentMin, PricePercentMax)
	}
	return nil
}

// ApplyPricePercent proposes the adjusted price of every item; items whose
// rounded price would not change are reported as unchanged.
func ApplyPricePercent(items []PricedItem, percent float64) (changed []PriceChange, unchanged []PricedItem) {
	for _, it := range items {
		next := RoundPrice(it.Price * (1 + percent/100))
		if next < 0 {
			next = 0
		}
		if next == RoundPrice(it.Price) {
			unchanged = append(unchanged, it)
			continue
		}
		changed = append(changed, PriceChange{Item: it, NewPrice: next})
	}
	return changed, unchanged
}

// PriceImportRow is one row read from a supplier price list.
type PriceImportRow struct {
	Line  int
	Code  string
	Price *float64
}

// PriceImportIssue explains why a row was not applied.
type PriceImportIssue struct {
	Line    int
	Code    string
	Message string
}

// PriceImportPreview groups a supplier list against the catalog. Nothing is
// matched by name similarity: only an exact (trimmed) code matches.
type PriceImportPreview struct {
	Changed   []PriceChange
	Unchanged []PricedItem
	// NotFound are codes absent from the catalog (never created here).
	NotFound []PriceImportIssue
	// Invalid are rows with a missing code, a missing/invalid price or a code
	// repeated in the same file.
	Invalid []PriceImportIssue
}

// ClassifyPriceImport matches rows to catalog items by exact code.
func ClassifyPriceImport(items []PricedItem, rows []PriceImportRow) PriceImportPreview {
	byCode := make(map[string]PricedItem, len(items))
	for _, it := range items {
		byCode[it.Code] = it
	}
	seen := map[string]int{}
	out := PriceImportPreview{}
	for _, row := range rows {
		code := strings.TrimSpace(row.Code)
		if code == "" {
			out.Invalid = append(out.Invalid, PriceImportIssue{Line: row.Line, Message: "fila sin código"})
			continue
		}
		if first, dup := seen[code]; dup {
			out.Invalid = append(out.Invalid, PriceImportIssue{Line: row.Line, Code: code, Message: fmt.Sprintf("código repetido en el archivo (ya en la fila %d)", first)})
			continue
		}
		seen[code] = row.Line
		if row.Price == nil || math.IsNaN(*row.Price) || math.IsInf(*row.Price, 0) || *row.Price < 0 || *row.Price > PriceMax {
			out.Invalid = append(out.Invalid, PriceImportIssue{Line: row.Line, Code: code, Message: "precio vacío o inválido"})
			continue
		}
		item, ok := byCode[code]
		if !ok {
			out.NotFound = append(out.NotFound, PriceImportIssue{Line: row.Line, Code: code, Message: "código inexistente en el catálogo"})
			continue
		}
		next := RoundPrice(*row.Price)
		if next == RoundPrice(item.Price) {
			out.Unchanged = append(out.Unchanged, item)
			continue
		}
		out.Changed = append(out.Changed, PriceChange{Item: item, NewPrice: next})
	}
	return out
}
