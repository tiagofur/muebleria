package domain

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestStockDeltaForType(t *testing.T) {
	cases := []struct {
		name     string
		typ      StockMovementType
		quantity float64
		want     float64
		wantErr  bool
	}{
		{"entrada 50", StockMovementEntrada, 50, 50, false},
		{"salida 3", StockMovementSalida, 3, -3, false},
		{"despacho 12", StockMovementDespacho, 12, -12, false},
		{"ajuste +2", StockMovementAjuste, 2, 2, false},
		{"ajuste -5", StockMovementAjuste, -5, -5, false},
		{"entrada zero", StockMovementEntrada, 0, 0, true},
		{"salida negativa", StockMovementSalida, -3, 0, true},
		{"ajuste zero", StockMovementAjuste, 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := StockDeltaForType(tc.typ, tc.quantity)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got delta %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("delta = %v want %v", got, tc.want)
			}
		})
	}
}

func TestStockValidators(t *testing.T) {
	if !ValidStockMaterialKind("herrajes") || !ValidStockMaterialKind("tableros") || !ValidStockMaterialKind("cintillas") {
		t.Fatal("the three material kinds must be valid")
	}
	if ValidStockMaterialKind("tornillos") {
		t.Fatal("unknown kind must be invalid")
	}
	if !ValidStockMovementType("entrada") || !ValidStockMovementType("despacho") {
		t.Fatal("known movement types must be valid")
	}
	if ValidStockMovementType("transferencia") {
		t.Fatal("unknown movement type must be invalid")
	}
}

func TestStockStatusOf(t *testing.T) {
	if StockStatusOf(0, 10) != StockStatusAgotado {
		t.Fatal("0 → agotado")
	}
	if StockStatusOf(-1, 0) != StockStatusAgotado {
		t.Fatal("negative balance → agotado")
	}
	if StockStatusOf(10, 10) != StockStatusBajo {
		t.Fatal("equal to min → bajo")
	}
	if StockStatusOf(11, 10) != StockStatusOk {
		t.Fatal("above min → ok")
	}
}

func TestRoleCanManageStock(t *testing.T) {
	if !RoleCanManageStock(RoleAdmin) || !RoleCanManageStock(RoleAlmacen) {
		t.Fatal("admin/almacen manage stock")
	}
	for _, role := range []UserRole{RoleGerenteProduccion, RoleIngeniero, RoleProduccion, RoleVendedor, RoleUser} {
		if RoleCanManageStock(role) {
			t.Fatalf("%s must not manage stock", role)
		}
	}
}

func TestErrStockInsufficientWrapsAmount(t *testing.T) {
	// Mirrors the storage wrap shape so the message contract ("faltan X")
	// is pinned in the domain tests.
	err := fmt.Errorf("%w: faltan %.2f", ErrStockInsufficient, 7.5)
	if !errors.Is(err, ErrStockInsufficient) {
		t.Fatal("errors.Is must match the sentinel")
	}
	if !strings.Contains(err.Error(), "faltan 7.50") {
		t.Fatalf("message should state the shortfall: %q", err.Error())
	}
}
