# Sesión

**Feature cerrada:** F145 — proyectar_design_bom_price_contracts (#313 P3D-7, meta #308)
**Inicio:** 2026-08-22 · **Cierre:** 2026-08-22
**Subplan (SDD):** https://github.com/tiagofur/muebleria/issues/313#issuecomment-5383259129

## Resultado

Contract tests diseño→BOM→precio→producción con **fixture compartido**
`contracts/designBomPrice.json` (patrón projectEventTypes): catálogo canónico
(estructura paramétrica con fórmulas W/H/D, 2 materiales, agregado con hardware)
+ 4 escenarios con expected congelados (preset 600, **customDims 900×800×500** —
la deuda F144 congelada en paridad —, cambio de material, agregado ×3) + caso
stale-fingerprint (TS; release/stale completo espera O1/#300) + anti-leak
ambiental. **TS (6 tests) y Go (4 subtests) consumen el mismo JSON y producen
los mismos números** — piezas por firma, hardwareTotals, materiales/hardware/
directo/venta (tol 0.01).

**Deuda F144 cerrada como bug real**: el backend Go persiste `project_items`
con DELETE+INSERT y no conocía `customDims` → guardar desde web BORRARÍA la
medida a medida. Ahora: `domain.ItemCustomDims` + `ProjectItem.CustomDims`,
migración **000078** (JSONB nullable; 000077 chocaba con la rama
f142-materials-dock), load/replace en storage, `ResolveBomWithDims` en el
engine (override gana al preset; no-paramétrico rechaza; preset id stale sigue
fallando) y `CalcProjectBreakdown` pasa `item.CustomDims`. Round-trip
create→update→clear probado contra Postgres real.

**Gate "React no duplica lógica"**: `domainBoundaryGuard.test.ts` prohíbe
aritmética de costo/merma y evaluación de fórmulas paramétricas en packages/ui
(imports de domain permitidos); detectó deuda preexistente en purchasing
(Fase 3c) → allowlist documentada, registrada, no tocada (otro contexto).

## Verificación (evidencia)

- `go test ./...` — 8 paquetes ok (incluye storage contra Postgres real:
  migración 78 aplicada + round-trip customDims).
- `pnpm test` — 2.924 tests (domain 1.001 · storage 153 · excel 89 · ui 1.318 ·
  mobile 45 · desktop 17 · web 301); `pnpm typecheck` exit 0.
- Paridad numérica TS↔Go contra el mismo fixture al primer intento (los
  expected calculados a mano coincidieron en ambos motores).
- Review: **APPROVED** con 3 hallazgos corregidos durante la review (colisión
  de migración 77, aliasing de slices en test Go, patrón del gate demasiado
  amplio) — `progress/review_F145.md`.

## Siguiente etapa

#311 (P3D-4) — Environment authoring + multi-space 5★. Después #312 → #314.
Deuda menor registrada: fórmulas dentro de agregados divergen TS/Go
(documentada en el fixture), purchasing UI math (allowlist del gate).
