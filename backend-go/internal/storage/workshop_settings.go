package storage

import (
	"context"
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// GetWorkshopSettings returns the single taller settings row (creates defaults if missing).
func (s *PostgresStore) GetWorkshopSettings(ctx context.Context) (domain.WorkshopSettings, error) {
	var ws domain.WorkshopSettings
	err := s.Pool.QueryRow(ctx, `
		SELECT default_margin_factor, default_labor_fixed_cost, default_currency, vendedor_can_view_costs
		FROM workshop_settings
		WHERE id = 1
	`).Scan(
		&ws.DefaultMarginFactor,
		&ws.DefaultLaborFixedCost,
		&ws.DefaultCurrency,
		&ws.VendedorCanViewCosts,
	)
	if err != nil {
		// Table empty or not migrated yet — safe defaults (COST-01: hide costs).
		return domain.DefaultWorkshopSettings(), nil
	}
	return normalizeWorkshopSettings(ws), nil
}

// UpsertWorkshopSettings writes the single taller settings row.
func (s *PostgresStore) UpsertWorkshopSettings(ctx context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	ws = normalizeWorkshopSettings(ws)
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO workshop_settings (
			id, default_margin_factor, default_labor_fixed_cost, default_currency, vendedor_can_view_costs, updated_at
		) VALUES (1, $1, $2, $3, $4, NOW())
		ON CONFLICT (id) DO UPDATE SET
			default_margin_factor = EXCLUDED.default_margin_factor,
			default_labor_fixed_cost = EXCLUDED.default_labor_fixed_cost,
			default_currency = EXCLUDED.default_currency,
			vendedor_can_view_costs = EXCLUDED.vendedor_can_view_costs,
			updated_at = NOW()
	`,
		ws.DefaultMarginFactor,
		ws.DefaultLaborFixedCost,
		ws.DefaultCurrency,
		ws.VendedorCanViewCosts,
	)
	if err != nil {
		return domain.WorkshopSettings{}, fmt.Errorf("upsert workshop_settings: %w", err)
	}
	return ws, nil
}

func normalizeWorkshopSettings(ws domain.WorkshopSettings) domain.WorkshopSettings {
	def := domain.DefaultWorkshopSettings()
	if ws.DefaultMarginFactor <= 0 {
		ws.DefaultMarginFactor = def.DefaultMarginFactor
	}
	if ws.DefaultLaborFixedCost < 0 {
		ws.DefaultLaborFixedCost = def.DefaultLaborFixedCost
	}
	cur := strings.TrimSpace(ws.DefaultCurrency)
	if cur == "" {
		ws.DefaultCurrency = def.DefaultCurrency
	} else {
		ws.DefaultCurrency = strings.ToUpper(cur)
	}
	return ws
}
