package domain

import (
	"errors"
	"time"
)

// Compras (Fase 3c): supplier directory + purchase orders with items. The
// reception of a PO records stock entradas and advances received_quantity.

// Supplier is a vendor in the Compras/Almacén directory.
type Supplier struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContactName string    `json:"contact_name,omitempty"`
	Email       string    `json:"email,omitempty"`
	Phone       string    `json:"phone,omitempty"`
	Notes       string    `json:"notes,omitempty"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PurchaseOrderStatus string

const (
	POBorrador  PurchaseOrderStatus = "borrador"
	POEmitida   PurchaseOrderStatus = "emitida"
	PORecibida  PurchaseOrderStatus = "recibida"
	POCancelada PurchaseOrderStatus = "cancelada"
)

// PurchaseOrderItem is one material line of a PO. ReceivedQuantity advances
// with each reception until it reaches Quantity (fully received).
type PurchaseOrderItem struct {
	Kind             StockMaterialKind `json:"kind"`
	MaterialID       string            `json:"material_id"`
	Quantity         float64           `json:"quantity"`
	ReceivedQuantity float64           `json:"received_quantity"`
}

// PurchaseOrder is an order to a supplier; CreatedBy is the JWT actor.
type PurchaseOrder struct {
	ID         string              `json:"id"`
	Number     string              `json:"number"`
	SupplierID string              `json:"supplier_id"`
	Status     PurchaseOrderStatus `json:"status"`
	Items      []PurchaseOrderItem `json:"items"`
	Notes      string              `json:"notes,omitempty"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`
	ReceivedAt *time.Time          `json:"received_at,omitempty"`
	CreatedBy  *string             `json:"created_by,omitempty"`
}

// Sentinel error for reception on a PO that is not receivable.
var ErrPurchaseOrderNotReceivable = errors.New("la orden debe estar emitida para recibir")

// ValidPurchaseOrderStatus reports whether s is a known PO status.
func ValidPurchaseOrderStatus(s string) bool {
	switch PurchaseOrderStatus(s) {
	case POBorrador, POEmitida, PORecibida, POCancelada:
		return true
	default:
		return false
	}
}

// PurchaseOrderCanEmit — borrador → emitida (items frozen).
func PurchaseOrderCanEmit(status PurchaseOrderStatus) bool {
	return status == POBorrador
}

// PurchaseOrderCanCancel — borrador or emitida → cancelada.
func PurchaseOrderCanCancel(status PurchaseOrderStatus) bool {
	return status == POBorrador || status == POEmitida
}

// PurchaseOrderCanReceive — only emitted orders receive goods.
func PurchaseOrderCanReceive(status PurchaseOrderStatus) bool {
	return status == POEmitida
}

// PurchaseOrderFullyReceived reports whether every item reached its quantity.
func PurchaseOrderFullyReceived(items []PurchaseOrderItem) bool {
	for _, it := range items {
		if it.ReceivedQuantity < it.Quantity {
			return false
		}
	}
	return len(items) > 0
}

// SupplierCanBeEdited — suppliers are always editable (active toggle only on
// deactivate).
func SupplierCanBeEdited(supplier *Supplier) bool {
	return supplier != nil && supplier.ID != ""
}
