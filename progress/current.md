# Sesión activa

**Feature:** F116 — catalogs_critical_bugfixes
**Estado:** in_progress
**Inicio:** 2026-08-19

## Plan

1. **Bloque 1 (store TS):** C1 PBR de materiales persiste; C5 previewColor sin doble asignación; C7 toasts solo tras save resuelto; C6 migrateWorkspace en guest localStorage.
2. **Bloque 2 (unicidad C2):** validar código contra todos (activos+inactivos) en pantallas de materiales/cantos/herrajes/acabados; upsert API no traga 409 como éxito silencioso.
3. **Bloque 3 (Go/Postgres):** C3 espesor cantos INT→DOUBLE PRECISION + float64 + CHECK >= 0; C4 deleteAgregado REST real con guard; A1 PUT material 409; A2 delete módulo referenciado 409 + FE sin divergencia; A3 seeds no destructivos; A4 paridad seed (preview_shape/previewColor).
4. **Bloque 4 (trackers):** F080 → done; notas divergencia F069/F070.
5. Tests de comportamiento por fix + verificación completa (pnpm test, typecheck, go test, ./init.sh).

## Decisiones tomadas

- Unicidad: validar contra TODOS los ítems (consistente con UNIQUE(code) de SQL y con OptionGroups). Recuperar código viejo → Reactivar.
- Espesor cantos: `CHECK (thickness_mm >= 0)` para respetar seed TS existente (0 = sin canto).

## Resultados de Verificación

(pendiente)
