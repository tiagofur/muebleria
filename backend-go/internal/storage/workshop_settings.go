package storage

import (
	"context"
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// GetWorkshopSettings returns the taller settings row for the current
// organization (creates defaults if missing).
func (s *PostgresStore) GetWorkshopSettings(ctx context.Context) (domain.WorkshopSettings, error) {
	var ws domain.WorkshopSettings
	// default_cut_strategy / nav_mode are nullable TEXT (000064/000076): scan
	// through pointers so NULL rows resolve to the normalize fallbacks instead
	// of failing the read.
	var cutStrategy, navMode *string
	err := s.Pool.QueryRow(ctx, `
		SELECT default_margin_factor, default_labor_fixed_cost, default_currency, vendedor_can_view_costs, default_cut_strategy, nav_mode
		FROM workshop_settings
		WHERE organization_id = $1
	`, OrgFromCtx(ctx)).Scan(
		&ws.DefaultMarginFactor,
		&ws.DefaultLaborFixedCost,
		&ws.DefaultCurrency,
		&ws.VendedorCanViewCosts,
		&cutStrategy,
		&navMode,
	)
	if err != nil {
		// Table empty or not migrated yet — safe defaults (COST-01: hide costs).
		return domain.DefaultWorkshopSettings(), nil
	}
	if cutStrategy != nil {
		ws.DefaultCutStrategy = *cutStrategy
	}
	if navMode != nil {
		ws.NavMode = *navMode
	}
	return normalizeWorkshopSettings(ws), nil
}

// UpsertWorkshopSettings writes the taller settings row for the current
// organization (id comes from the sequence default).
func (s *PostgresStore) UpsertWorkshopSettings(ctx context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	ws = normalizeWorkshopSettings(ws)
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO workshop_settings (
			organization_id, default_margin_factor, default_labor_fixed_cost, default_currency, vendedor_can_view_costs, default_cut_strategy, nav_mode, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (organization_id) DO UPDATE SET
			default_margin_factor = EXCLUDED.default_margin_factor,
			default_labor_fixed_cost = EXCLUDED.default_labor_fixed_cost,
			default_currency = EXCLUDED.default_currency,
			vendedor_can_view_costs = EXCLUDED.vendedor_can_view_costs,
			default_cut_strategy = EXCLUDED.default_cut_strategy,
			nav_mode = EXCLUDED.nav_mode,
			updated_at = NOW()
	`,
		OrgFromCtx(ctx),
		ws.DefaultMarginFactor,
		ws.DefaultLaborFixedCost,
		ws.DefaultCurrency,
		ws.VendedorCanViewCosts,
		ws.DefaultCutStrategy,
		ws.NavMode,
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
	// F133: only the two known strategies persist; anything else falls back
	// to sierra (matches TS resolveWorkshopSettings).
	strategy := strings.TrimSpace(ws.DefaultCutStrategy)
	if strategy != "cnc-nesting" && strategy != "saw-guillotine" {
		strategy = def.DefaultCutStrategy
	}
	ws.DefaultCutStrategy = strategy
	// OC-092: only the two known nav modes persist (matches TS
	// resolveWorkshopSettings).
	if ws.NavMode != "simplified" && ws.NavMode != "departmental" {
		ws.NavMode = def.NavMode
	}
	return ws
}
