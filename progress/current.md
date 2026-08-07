# Sesión — #257 Ciclo de vida cotización (reglas de taller)

- **Issue:** [#257](https://github.com/tiagofur/muebleria/issues/257)
- **Branch:** `feat/257-quote-lifecycle-freeze`
- **Inicio:** 2026-08-07

## Plan

1. Domain `projectAllowsContentMutation` (solo draft)
2. Status readonly en meta modal (sin select)
3. Confirm en Enviar / Aceptar / Reabrir
4. Freeze UI content: items, kitchen, edit button
5. Store no-op mutations if closed
6. Copy En planta → En producción
7. Tests + PR

## Hecho

- Domain + store gates + UI chrome confirm + freeze content
- Mark produced preferido en hub Producción (no quote cuando hub wired)
- Tests domain/ui/web verdes
