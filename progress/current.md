# Sesión actual

- **Branch:** `feat/ux-responsive-34`
- **Issue:** [#34](https://github.com/tiagofur/muebleria/issues/34) — UX responsive tablet/taller
- **Estado:** in_progress

## Hecho
- Breakpoints canónicos en `tokens.css` + `docs/design.md` §3.8
- Cards Muebles/Cotizaciones: 1 → 2 → 3 columnas (640 / 1100)
- Tablas catálogo/usuarios: scroll-x + fade + min-width phone
- Touch targets ≥40px en ≤767px (btn/small/acciones)
- Shell phone padding + topbar touch
- Tests de contrato design-system

## Siguiente
- PR Closes #34
- Luego #38 Electron

## Nota
- Etapa 3 multi-usuario (F034+) en pausa a pedido del usuario; PR #76 queda abierto aparte
- **Branch:** `feat/ownership-isolation-66`
- **Feature:** F034 — ownership isolation (#66)
- **Estado:** in_progress

## Etapa 3 (producto)

Issues abiertos de Etapa 3 en GitHub: F034–F041 (#66–#73).
F029 (#35) mergeado. Arrancamos por F034 (base de carteras).

## Plan F034

1. Domain `ownerUserId` + ownership helpers TS/Go
2. Migration 000009 + storage customers/projects
3. API filter/enforce for vendedor; admin assign/reassign
4. UI picker responsable (admin) + labels
5. Tests + PR Closes #66

## Backfill (migración)

- `projects.owner_user_id` ← `created_by` si existe
- resto y customers ← primer admin activo

## Notas

- Hasta F035, “gerente” = `admin` para asignar owners
- Solo `vendedor` está scoped
