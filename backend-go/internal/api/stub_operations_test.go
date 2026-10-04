package api

// Contrato: stub del stubStore espejo de store_operations (store_operations.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_operations.go
import (
	"context"
	"fmt"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"strings"
)

func (s *stubStore) ListMachineOutputSelections(context.Context) ([]domain.MachineOutputSelectionRecord, error) {
	if s.machineOutputSelections != nil {
		return s.machineOutputSelections, nil
	}
	return []domain.MachineOutputSelectionRecord{}, nil
}

func (s *stubStore) UpsertMachineOutputSelection(_ context.Context, sel domain.MachineOutputSelection, expectedVersion int64, updatedBy string) (domain.MachineOutputSelectionRecord, error) {
	if s.machineOutputSelections == nil {
		s.machineOutputSelections = []domain.MachineOutputSelectionRecord{}
	}
	for i, rec := range s.machineOutputSelections {
		if rec.Operation == sel.Operation {
			if rec.Version != expectedVersion {
				return domain.MachineOutputSelectionRecord{}, storage.ErrVersionConflict
			}
			saved := domain.MachineOutputSelectionRecord{
				MachineOutputSelection: sel, Version: rec.Version + 1, UpdatedAt: "now", UpdatedBy: updatedBy,
			}
			s.machineOutputSelections[i] = saved
			return saved, nil
		}
	}
	saved := domain.MachineOutputSelectionRecord{
		MachineOutputSelection: sel, Version: 1, UpdatedAt: "now", UpdatedBy: updatedBy,
	}
	s.machineOutputSelections = append(s.machineOutputSelections, saved)
	return saved, nil
}

// User sector stubs
func (s *stubStore) ListUserSectors(_ context.Context, _ string) ([]domain.UserSector, error) {
	return s.userSectorsList, nil
}

func (s *stubStore) SetUserSectors(_ context.Context, _ string, _ []domain.UserSector) error {
	return nil
}

func (s *stubStore) GetUsersBySector(_ context.Context, _ string) ([]domain.User, error) {
	return []domain.User{}, nil
}

// Manufacturing library stubs (#772)

// Compras/Almacén picking stubs (Fase 3)
func (s *stubStore) ListAllPicking(_ context.Context) ([]domain.ProjectPicking, error) {
	if s.pickingListErr != nil {
		return nil, s.pickingListErr
	}
	if s.pickingList != nil {
		return s.pickingList, nil
	}
	return []domain.ProjectPicking{}, nil
}

func (s *stubStore) UpsertProjectPicking(_ context.Context, pick domain.ProjectPicking) error {
	if s.pickingUpsertErr != nil {
		return s.pickingUpsertErr
	}
	s.pickingUpsertWrites = append(s.pickingUpsertWrites, pick)
	return nil
}

// Compras/Almacén stock stubs (Fase 3b) — RecordStockMovement emulates the
// transactional balance logic (lock → balance_after → insert) so handler tests
// can assert balances without a database.

// Compras/Almacén stock stubs (Fase 3b) — RecordStockMovement emulates the
// transactional balance logic (lock → balance_after → insert) so handler tests
// can assert balances without a database.
func (s *stubStore) ListStock(_ context.Context) ([]domain.MaterialStock, error) {
	if s.stockListErr != nil {
		return nil, s.stockListErr
	}
	if s.stockList != nil {
		return s.stockList, nil
	}
	return []domain.MaterialStock{}, nil
}

func (s *stubStore) UpsertStockMin(_ context.Context, kind domain.StockMaterialKind, materialID string, minStock float64) (domain.MaterialStock, error) {
	s.stockUpsertMinCalled = true
	s.stockUpsertMinReceived = domain.MaterialStock{
		Kind: kind, MaterialID: materialID, MinStock: minStock,
	}
	return s.stockUpsertMinReceived, nil
}

func (s *stubStore) GetStockMovementByID(_ context.Context, id string) (*domain.StockMovement, error) {
	for i := range s.stockMovements {
		if s.stockMovements[i].ID == id {
			m := s.stockMovements[i]
			return &m, nil
		}
	}
	return nil, nil
}

func (s *stubStore) GetStockMovementByRevertsID(_ context.Context, revertsID string) (*domain.StockMovement, error) {
	for i := range s.stockMovements {
		if s.stockMovements[i].RevertsID != nil && *s.stockMovements[i].RevertsID == revertsID {
			m := s.stockMovements[i]
			return &m, nil
		}
	}
	return nil, nil
}

func (s *stubStore) RecordStockMovement(_ context.Context, mov domain.StockMovement) (domain.StockMovement, error) {
	if s.stockBalances == nil {
		s.stockBalances = map[string]float64{}
	}
	key := string(mov.Kind) + ":" + mov.MaterialID
	current, exists := s.stockBalances[key]
	if !exists && mov.Type != domain.StockMovementEntrada {
		return mov, domain.ErrStockNotTracked
	}
	balance := current + mov.Delta
	if balance < 0 {
		return mov, fmt.Errorf("%w: faltan %.2f", domain.ErrStockInsufficient, -balance)
	}
	s.stockBalances[key] = balance
	saved := mov
	saved.BalanceAfter = balance
	saved.ID = fmt.Sprintf("sm-%d", len(s.stockMovements)+1)
	s.stockMovements = append(s.stockMovements, saved)
	return saved, nil
}

func (s *stubStore) ListStockMovements(_ context.Context, _ domain.StockMaterialKind, _ string, _ string, _ int) ([]domain.StockMovement, error) {
	if s.stockMovementsList != nil {
		return s.stockMovementsList, nil
	}
	if s.stockMovements != nil {
		return s.stockMovements, nil
	}
	return []domain.StockMovement{}, nil
}

// Compras/Almacén suppliers + purchase orders stubs (Fase 3c).

// Compras/Almacén suppliers + purchase orders stubs (Fase 3c).
func (s *stubStore) ListSuppliers(_ context.Context) ([]domain.Supplier, error) {
	if s.suppliersList != nil {
		return s.suppliersList, nil
	}
	return []domain.Supplier{}, nil
}

func (s *stubStore) CreateSupplier(_ context.Context, sp domain.Supplier) error {
	if s.createSupplierErr != nil {
		return s.createSupplierErr
	}
	s.suppliersList = append(s.suppliersList, sp)
	return nil
}

func (s *stubStore) UpdateSupplier(_ context.Context, sp domain.Supplier) error {
	if s.updateSupplierErr != nil {
		return s.updateSupplierErr
	}
	for i := range s.suppliersList {
		if s.suppliersList[i].ID == sp.ID {
			s.suppliersList[i] = sp
		}
	}
	return nil
}

func (s *stubStore) DeactivateSupplier(_ context.Context, id string) error {
	if s.deactivateSupplierErr != nil {
		return s.deactivateSupplierErr
	}
	for i := range s.suppliersList {
		if s.suppliersList[i].ID == id {
			s.suppliersList[i].Active = false
		}
	}
	return nil
}

func (s *stubStore) ListPurchaseOrders(_ context.Context) ([]domain.PurchaseOrder, error) {
	if s.posList != nil {
		return s.posList, nil
	}
	return []domain.PurchaseOrder{}, nil
}

func (s *stubStore) GetPurchaseOrderByID(_ context.Context, id string) (*domain.PurchaseOrder, error) {
	if s.poGetByIDErr != nil {
		return nil, s.poGetByIDErr
	}
	if s.poReturnedByID != nil && s.poReturnedByID.ID == id {
		po := *s.poReturnedByID
		return &po, nil
	}
	return nil, nil
}

func (s *stubStore) CreatePurchaseOrder(_ context.Context, po domain.PurchaseOrder) error {
	if s.createPOErr != nil {
		return s.createPOErr
	}
	if po.Number == "" || strings.HasPrefix(po.Number, "OC-PO-") {
		po.Number = fmt.Sprintf("OC-%04d", len(s.posList)+1)
	}
	s.posList = append(s.posList, po)
	return nil
}

func (s *stubStore) UpdatePurchaseOrder(_ context.Context, po domain.PurchaseOrder) error {
	if s.updatePOErr != nil {
		return s.updatePOErr
	}
	if s.poReturnedByID != nil && s.poReturnedByID.ID == po.ID {
		poCopy := po
		s.poReturnedByID = &poCopy
	}
	return nil
}

func (s *stubStore) EmitPurchaseOrder(_ context.Context, id string) (domain.PurchaseOrder, error) {
	s.emitPOCalled = true
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.POEmitida
	return po, nil
}

func (s *stubStore) CancelPurchaseOrder(_ context.Context, id string) (domain.PurchaseOrder, error) {
	s.cancelPOCalled = true
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.POCancelada
	return po, nil
}

func (s *stubStore) ReceivePurchaseOrder(_ context.Context, id string, lines []domain.PurchaseOrderItem, byUserID, byName string) (domain.PurchaseOrder, error) {
	s.receivePOCalled = true
	s.lastReceiveLines = lines
	s.lastReceiveByUserID = byUserID
	s.lastReceiveByName = byName
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.PORecibida
	return po, nil
}

// dupErr mimics the wrapped error the storage layer returns on a unique
// violation: fmt.Errorf("error creating X: %w", pgErr).
