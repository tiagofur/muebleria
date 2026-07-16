package domain

// RedactMaterialCosts clears sensitive cost fields for non-cost roles (F039).
func RedactMaterialCosts(m *MaterialBoard) {
	if m == nil {
		return
	}
	m.BoardPrice = 0
	m.CostPerM2 = 0
}

// RedactEdgeCosts clears edge unit cost.
func RedactEdgeCosts(e *EdgeBand) {
	if e == nil {
		return
	}
	e.CostPerMl = 0
}

// RedactHardwareCosts clears hardware unit cost.
func RedactHardwareCosts(h *Hardware) {
	if h == nil {
		return
	}
	h.CostPerUnit = 0
}

// RedactQuoteBreakdown keeps sale price; zeros cost stack for vendedor payloads.
func RedactQuoteBreakdown(b *QuoteBreakdown) {
	if b == nil {
		return
	}
	b.MaterialsCost = 0
	b.EdgeTotal = 0
	b.HardwareTotal = 0
	b.DirectCost = 0
	b.LaborModular = 0
	b.LaborFixedCost = 0
	b.MarginFactor = 0
	// SalePrice retained
}

// RedactProjectCosts strips margin/labor and snapshot unit maps for vendedor.
func RedactProjectCosts(p *Project) {
	if p == nil {
		return
	}
	p.MarginFactor = 0
	p.LaborFixedCost = 0
	if p.PriceSnapshot != nil {
		RedactQuoteBreakdown(&p.PriceSnapshot.Breakdown)
		p.PriceSnapshot.MaterialCostPerM2 = nil
		p.PriceSnapshot.EdgeCostPerMl = nil
		p.PriceSnapshot.HardwareCostPerUnit = nil
	}
}

// RedactMaterialsList applies RedactMaterialCosts to each row.
func RedactMaterialsList(list []MaterialBoard) {
	for i := range list {
		RedactMaterialCosts(&list[i])
	}
}

// RedactEdgesList applies RedactEdgeCosts to each row.
func RedactEdgesList(list []EdgeBand) {
	for i := range list {
		RedactEdgeCosts(&list[i])
	}
}

// RedactHardwareList applies RedactHardwareCosts to each row.
func RedactHardwareList(list []Hardware) {
	for i := range list {
		RedactHardwareCosts(&list[i])
	}
}

// RedactProjectsList applies RedactProjectCosts to each row.
func RedactProjectsList(list []Project) {
	for i := range list {
		RedactProjectCosts(&list[i])
	}
}
