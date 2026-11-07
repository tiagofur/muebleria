package domain

// Grip style preview DTO (#1533, ADR-0009 Amendment 1 §14.7): one furniture
// type's resolved sentence — the computation lives in the engine (the A3
// authority); React renders it verbatim.

// GripStylePreview is one furniture type's resolved preview sentence.
type GripStylePreview struct {
	FurnitureType string `json:"furnitureType"`
	Mode          string `json:"mode"`
	// Preview is the resolved Spanish sentence the UI renders verbatim.
	Preview string `json:"preview"`
}
