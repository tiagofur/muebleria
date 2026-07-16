# Sesión actual

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
