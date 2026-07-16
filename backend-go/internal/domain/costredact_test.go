package domain

import "testing"

func TestRoleCanViewCosts(t *testing.T) {
	t.Parallel()
	if RoleCanViewCosts(RoleVendedor) || RoleCanViewCosts(RoleUser) {
		t.Fatal("vendedor/user must not view costs")
	}
	if !RoleCanViewCosts(RoleAdmin) || !RoleCanViewCosts(RoleIngeniero) {
		t.Fatal("admin/ingeniero view costs")
	}
}

func TestRedactMaterialAndBreakdown(t *testing.T) {
	t.Parallel()
	m := MaterialBoard{BoardPrice: 100, CostPerM2: 25}
	RedactMaterialCosts(&m)
	if m.BoardPrice != 0 || m.CostPerM2 != 0 {
		t.Fatalf("material costs not cleared: %#v", m)
	}
	b := QuoteBreakdown{
		MaterialsCost: 10, EdgeTotal: 2, HardwareTotal: 3,
		DirectCost: 15, MarginFactor: 1.35, SalePrice: 20.25,
	}
	RedactQuoteBreakdown(&b)
	if b.SalePrice != 20.25 {
		t.Fatal("sale price must remain")
	}
	if b.DirectCost != 0 || b.MaterialsCost != 0 || b.MarginFactor != 0 {
		t.Fatalf("cost stack not cleared: %#v", b)
	}
}
