package domain

/**
 * Shop-floor item pipeline (PROD-3.1 / F089-RN parity with TS
 * packages/domain/src/productionFloor.ts).
 */

// ItemFloorStatuses is the ordered pipeline: pending → cut → edged →
// assembled → installed.
var ItemFloorStatuses = []string{"pending", "cut", "edged", "assembled", "installed"}

// NormalizeItemFloorStatus coerces unknown/empty values to "pending".
func NormalizeItemFloorStatus(s string) string {
	for _, v := range ItemFloorStatuses {
		if v == s {
			return s
		}
	}
	return "pending"
}

// NextItemFloorStatus returns the next pipeline step, or "" when installed
// (complete).
func NextItemFloorStatus(s string) string {
	cur := NormalizeItemFloorStatus(s)
	for i, v := range ItemFloorStatuses {
		if v == cur && i+1 < len(ItemFloorStatuses) {
			return ItemFloorStatuses[i+1]
		}
	}
	return ""
}
