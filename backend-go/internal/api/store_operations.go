package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: operaciones — selecciones de salida de máquina (#591), sectores
// de operador, picking, stock y compras (suppliers + purchase orders).
type OperationsStore interface {
	// Machine output selections (#591 / WEB-MFG-2)
	ListMachineOutputSelections(ctx context.Context) ([]domain.MachineOutputSelectionRecord, error)
	UpsertMachineOutputSelection(ctx context.Context, sel domain.MachineOutputSelection, expectedVersion int64, updatedBy string) (domain.MachineOutputSelectionRecord, error)

	// User sector assignments (operador role)
	ListUserSectors(ctx context.Context, userID string) ([]domain.UserSector, error)
	SetUserSectors(ctx context.Context, userID string, sectors []domain.UserSector) error
	GetUsersBySector(ctx context.Context, sector string) ([]domain.User, error)

	// Compras/Almacén picking (Fase 3): project × material despacho state.
	ListAllPicking(ctx context.Context) ([]domain.ProjectPicking, error)
	UpsertProjectPicking(ctx context.Context, pick domain.ProjectPicking) error

	// Compras/Almacén stock (Fase 3b): live balances + immutable movement ledger.
	ListStock(ctx context.Context) ([]domain.MaterialStock, error)
	UpsertStockMin(ctx context.Context, kind domain.StockMaterialKind, materialID string, minStock float64) (domain.MaterialStock, error)
	RecordStockMovement(ctx context.Context, mov domain.StockMovement) (domain.StockMovement, error)
	GetStockMovementByID(ctx context.Context, id string) (*domain.StockMovement, error)
	GetStockMovementByRevertsID(ctx context.Context, revertsID string) (*domain.StockMovement, error)
	ListStockMovements(ctx context.Context, kind domain.StockMaterialKind, materialID string, projectID string, limit int) ([]domain.StockMovement, error)

	// Compras/Almacén suppliers + purchase orders (Fase 3c).
	ListSuppliers(ctx context.Context) ([]domain.Supplier, error)
	CreateSupplier(ctx context.Context, sp domain.Supplier) error
	UpdateSupplier(ctx context.Context, sp domain.Supplier) error
	DeactivateSupplier(ctx context.Context, id string) error
	ListPurchaseOrders(ctx context.Context) ([]domain.PurchaseOrder, error)
	GetPurchaseOrderByID(ctx context.Context, id string) (*domain.PurchaseOrder, error)
	CreatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error
	UpdatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error
	EmitPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error)
	CancelPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error)
	ReceivePurchaseOrder(ctx context.Context, id string, lines []domain.PurchaseOrderItem, byUserID, byName string) (domain.PurchaseOrder, error)
}
