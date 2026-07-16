# Sesión actual

- **Branch:** `feat/vendedor-view-costs-flag-89`
- **Issue:** [#89](https://github.com/tiagofur/muebleria/issues/89) — F044 flag vendedor ve costos
- **Estado:** implementando

## Alcance

- `WorkshopSettings.vendedorCanViewCosts` (default false)
- `roleCanViewCosts(role, { vendedorCanViewCosts })` TS + Go
- API `GET/PUT /api/settings` + migration 000013
- UI Ajustes checkbox; `showCosts` en App
