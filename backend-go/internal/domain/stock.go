package domain

import (
	"errors"
	"fmt"
	"time"
)

// Compras/Almacén stock (Fase 3b): real inventory per catalog material with an
// immutable movement ledger. Mirrors the floor-event audit pattern (F092):
// material_stock holds the live balance + minimum, stock_movements is the truth.

type StockMaterialKind string

const (
	StockKindHerrajes  StockMaterialKind = "herrajes"
	StockKindTableros  StockMaterialKind = "tableros"
	StockKindCintillas StockMaterialKind = "cintillas"
)

type StockMovementType string

const (
	StockMovementEntrada  StockMovementType = "entrada"  // recepción de compra / stock-in
	StockMovementSalida   StockMovementType = "salida"   // consumo manual fuera de obra
	StockMovementAjuste   StockMovementType = "ajuste"   // corrección por conteo físico (firmado)
	StockMovementDespacho StockMovementType = "despacho" // auto-descuento al despachar picking
)

// StockStatus is the derived alert state: ok / bajo / agotado.
type StockStatus string

const (
	StockStatusOk      StockStatus = "ok"
	StockStatusBajo    StockStatus = "bajo"
	StockStatusAgotado StockStatus = "agotado"
)

// MaterialStock is the live balance + alert threshold of one catalog material.
type MaterialStock struct {
	Kind       StockMaterialKind `json:"kind"`
	MaterialID string            `json:"material_id"`
	Quantity   float64           `json:"quantity"`
	MinStock   float64           `json:"min_stock"`
	UpdatedAt  time.Time         `json:"updated_at"`
}

// StockMovement is one immutable ledger row (who/when/why, balance snapshot).
type StockMovement struct {
	ID           string            `json:"id"`
	Kind         StockMaterialKind `json:"kind"`
	MaterialID   string            `json:"material_id"`
	Type         StockMovementType `json:"type"`
	Delta        float64           `json:"delta"`
	BalanceAfter float64           `json:"balance_after"`
	ProjectID    *string           `json:"project_id,omitempty"`
	Note         *string           `json:"note,omitempty"`
	RevertsID    *string           `json:"reverts_id,omitempty"`
	ByUserID     *string           `json:"by_user_id,omitempty"`
	ByName       *string           `json:"by_name,omitempty"`
	At           time.Time         `json:"at"`
}

// Sentinel errors the storage layer returns for the two stock invariants.
var (
	// ErrStockNotTracked — movement on a material with no stock row (only
	// `entrada` may create the row).
	ErrStockNotTracked = errors.New("material sin stock cargado")
	// ErrStockInsufficient — a salida/despacho/ajuste would leave a negative
	// balance; the wrapped message states how much is missing.
	ErrStockInsufficient = errors.New("stock insuficiente")
)

// ValidStockMaterialKind reports whether kind is one of the three material types.
func ValidStockMaterialKind(kind string) bool {
	switch StockMaterialKind(kind) {
	case StockKindHerrajes, StockKindTableros, StockKindCintillas:
		return true
	default:
		return false
	}
}

// ValidStockMovementType reports whether t is a supported movement type.
func ValidStockMovementType(t string) bool {
	switch StockMovementType(t) {
	case StockMovementEntrada, StockMovementSalida, StockMovementAjuste, StockMovementDespacho:
		return true
	default:
		return false
	}
}

// StockDeltaForType returns the signed delta for a movement. `quantity` is the
// absolute amount the caller reports: positive for entrada, salida and
// despacho (the sign is the type's), while ajuste is signed by the caller
// (positive adds, negative removes). Returns an error for non-positive
// entrada/salida/despacho or a zero ajuste.
func StockDeltaForType(t StockMovementType, quantity float64) (float64, error) {
	switch t {
	case StockMovementEntrada:
		if quantity <= 0 {
			return 0, errors.New("la entrada debe ser mayor a cero")
		}
		return quantity, nil
	case StockMovementSalida, StockMovementDespacho:
		if quantity <= 0 {
			return 0, errors.New("la cantidad debe ser mayor a cero")
		}
		return -quantity, nil
	case StockMovementAjuste:
		if quantity == 0 {
			return 0, errors.New("el ajuste no puede ser cero")
		}
		return quantity, nil // signed by the caller
	default:
		return 0, fmt.Errorf("tipo de movimiento inválido: %s", t)
	}
}

// StockStatusOf derives the alert state from balance vs minimum (6.4).
func StockStatusOf(quantity, minStock float64) StockStatus {
	if quantity <= 0 {
		return StockStatusAgotado
	}
	if quantity <= minStock {
		return StockStatusBajo
	}
	return StockStatusOk
}
