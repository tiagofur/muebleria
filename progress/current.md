# Sesión activa

**Feature:** F127 — Perfiles de maquinado en catálogo de herrajes ✅ (2026-08-20)
**Estado:** done (sesión cerrada, revisada y pusheada)

## Resumen

Primera feature de la serie de perforaciones CNC (re-escpeo de F081):

1. **Dominio**: `Hardware.machining?` con `MachiningOperation` (ciego/pasante/
   escareado/piloto; Ø, profundidad, offsets mm, cara anchor|opposite) por
   `HardwareMachiningPart` (rol) — dato de catálogo puro, el motor es F128.
   `validateMachiningProfile` + `normalizeMachiningProfile` en `hardwareMachining.ts`.
2. **Seeds paridad TS/Go** de los 4 básicos: taquete 8×30, minifix juego
   (cazuela+perno), bisagra (taza 35 + fijaciones) + placa base 32mm, tornillo.
3. **UI**: disclosure «Maquinado CNC» en el modal de herraje + resumen en fila.
4. **Persistencia**: apiMappers + store web + Go struct/storage + migración
   aditiva `000063_hardware_machining` (JSONB nullable).

## Verificación final

- `pnpm test` 2376 (domain 688, storage 129, excel 84, ui 1134, mobile 36,
  desktop 17, web 288); `pnpm typecheck` 7/7; `go test ./internal/...` verde
  con integración real Postgres (`TestHardware_PersistsMachiningProfile`).
- Review APPROVED (`progress/review_F127.md`) tras fixes: push + imports
  fusionados en `catalog/hardware.ts`.
- `git push` — HEAD local == origin (`dd16108`).

## Siguiente

F128 — Motor de resolución: placements + perfiles → agujeros por pieza
(coords desde cantos, dedupe, validaciones; reemplaza heurísticas F074).
Serie completa y decisiones de producto en `progress/history.md` (F127).
