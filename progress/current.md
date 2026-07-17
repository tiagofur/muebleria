# Sesión actual

- **Branch:** `feat/presets-measure-100`
- **Carpeta principal:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Issue:** [#104](https://github.com/tiagofur/muebleria/issues/104) — Cotización: preset de medida (H09 / F051)
- **Estado:** usable en UI; dominio + Go + seed multi-medida

## Modelo UX

| Campo | Dónde | Regla |
|-------|--------|------|
| Medida base | General | Obligatoria si hay estructura |
| Más medidas | General (abajo) | Opcional; si hay lista, vendedor elige en cotización |

## Cómo probar

1. Hard refresh en app `muebles` (`:5173`)
2. Muebles → editar → **General** → medida base + más medidas
3. Seed `MOD-COMP-001` trae presets 300/400/600
4. Cotización → agregar ese mueble → selector **Medida**

## Pendiente posible

- Commit / PR
- Migración `000021` en Postgres local (`migrate` / `./dev.sh`)
- POST `/api/seed` para repoblar con module_presets
