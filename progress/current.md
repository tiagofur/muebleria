# Sesión

**Feature en curso:** F183 — ESPESOR EFECTIVO DESDE MATERIAL SELECCIONADO EN GO BOM + LAYOUT (#402 / MT-1) (COMPLETADA)
**Cerrados con evidencia (ledger done):** F169–F182 (PRs #419/#424/#427/#428) + F183
**Rama:** `fix/402-go-effective-thickness` (desde origin/main post-#430)
**Contexto:** programa #401 (material-aware furniture resolution). Prerequisite
#409 (contrato canónico) mergeado en PR #411. Este slice corrige el drift de
verdad manufacturera entre TS y los resolvers Go. TS ya era correcto
(`getComponentThickness` en `packages/domain/src/engine/bom.ts`) y NO se tocó.

## F183: una sola ruta canónica de espesor efectivo en Go

El bug: con material seleccionado de 16 mm, el layout Go dibujaba laterales a
15 mm y piso/techo a 18 mm (espesres nominales del componente), porque
`resolve.go` expandía el BOM con `T = comp.ThicknessMm` antes de resolver
materiales y `layout.go` hacía lo mismo para fórmulas/poses/AABB, adjuntando el
material después sólo como identidad visual.

La corrección (`backend-go/internal/domain/engine/effective_thickness.go`):

- `resolveSelectedBoard(role, choices, materials)`: choice vacía → nil (fallback
  determinista); unknown/inactive → error loud con el rol en el mensaje.
- `effectiveThicknessMm(role, nominal, choices, materials)`: precedencia
  canónica `selected active MaterialBoard.thicknessMm > nominal > legacy sin
  binding`; además exige `thicknessMm > 0` (el CHECK de la DB lo garantiza para
  datos reales; runtime defiende contra catálogos hand-crafted).

Consumidores (ambos usan el MISMO helper — no hay lógica duplicada):

- `resolve.go` `expandComponentInstances`: T efectivo entra en `evalDims`
  antes de las fórmulas length/width. `ResolvedBoardPart` ahora emite
  `thickness_mm` desde el material (paridad con TS `thicknessMm`).
- `layout.go` `expandLayoutInstances`: mismo T en `geomDims`, `spatialDims`
  (H y T), `defaultPoseForPlacement`, board local dims y AABB.
  `LayoutComponent.ThicknessMm` y el eje de espesor de `DimensionsMm` salen del
  mismo T. El loop de identidad visual reusa `resolveSelectedBoard`.

Auditoría de hardcodes 18:

- `expandLayoutAgregado` `parentDims.T: 18` — SE CONSERVA documentado: es el
  contexto del box del sub-espacio (sin binding de material propio), paridad
  exacta con TS `resolveComposedModule`. Los componentes INTERNOS del agregado
  sí resuelven su propio rol (era la fuga real).
- `legacyBoardStack` — 18 mm sólo cuando el rol no tiene elección; con
  material seleccionado usa su espesor (board + stacking).

Tests (`regression_402_test.go`, 11 tests): fixture con nominales
deliberadamente ≠ materiales (lateral 15 / base-top 18 / frente 18 / fondo 15 /
frente cajón 15; materiales 16/18/6). Caso obligatorio del issue: BODY→16
resuelve TODO el cuerpo a 16 (`PW-2*T` con T=16, `PD-T` con T=16, lateral
derecho x=PW−T=584). Mixed BODY=16/FRONT=18/BACK=6 en el mismo mueble.
Herraje anclado a FRONT sigue la cara recalculada. Agregado 3 frentes.
ThicknessMm == eje de espesor del AABB por placement. Unknown/inactive/espesor
0 fallan loud. Sin elección: nominal determinista.

**Verificación rojo→verde:** los 11 tests se corrieron contra el código pre-fix
y fallaron con el drift exacto (lateral 15/piso 18 pese a material 16;
`PW-2*T` del frente cajón con T nominal 15 → 570 en vez de 564; herraje sobre
cara de 18 pese a FRONT 16; legacy siempre 18). Tras el fix: verde.

Fix colateral de fixture: `internal/api/furniture_layout_test.go` — su material
stub no declaraba `ThicknessMm` (imposible en DB: `CHECK (thickness_mm > 0)`);
con el fallo loud ahora 422eaba. Se le dio el espesor realista 18.

Docs: `docs/architecture/material-aware-furniture-resolution.md` §16 actualizado
(Go BOM + layout [CURRENT desde #402]; el T:18 del box de agregado documentado
como fallback legacy con paridad TS). Ledger: F183 en `feature_list.json`.

## Verificación

- `go build ./...` + `go vet ./...`: ok.
- `go test ./internal/domain/engine/ -run 'EffectiveThickness' -count=1`:
  11/11 PASS (pre-fix: 11 FAIL con drift numérico).
- `go test ./... -count=1` backend completo: exit 0 — 9 paquetes ok
  (api, auth, config, domain, engine, storage contra PostgreSQL real,
  pilotreadiness, db, cmd/admin).
- `pnpm --filter @granete/domain test`: 89 archivos / 1134 tests PASS (TS sin
  cambios, sin regresión).

## Fuera de alcance (explícito del issue)

- #403 (binding por rol/aliases), #404 (SketchUp re-resolve/rebuild),
  #405 (fixtures de paridad TS↔Go↔SketchUp), renderer SketchUp, Digital Thread.
