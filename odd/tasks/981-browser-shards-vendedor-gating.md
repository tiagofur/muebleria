# ODD — #981 shards del browser gate + #972 gating de acciones de fila

## Contexto y causa raíz

Desde el merge de #971 (#964, provisioning per-org de perfiles) el job
`Foundation real browser proofs` está rojo determinísticamente en main y en
todos los PRs (~22 corridas). Único fallo recurrente: `hardware-3d-catalog.spec.ts`
paso 8 (`:396`), strict mode violation con 12 botones `Editar HER-*`.

Causa raíz (corrige la hipótesis de #972): NO hay roles cliente stale — la
línea 394 (`Nuevo herraje` no visible) PASA, o sea `canMutate=false` y los
roles refrescan bien. El bug es que `getRowActions` de `HardwareCatalog.tsx`
renderiza Editar/Desactivar/Reactivar **sin consultar `canMutate`** (el botón
"Nuevo" y el modal sí lo consultan). Antes de #964 la org B (vendedor) tenía
catálogo vacío y la aserción pasaba en vacío; el seed per-org la expuso.
Mismo patrón en Edges, Materials, HardwareProfiles, OptionGroups;
AmbientMaterials ya gateaba correctamente (precedente interno).

## Cambios

1. **#972 fix (producto)**: gate `getRowActions` con `canMutate` en 5 pantallas
   (HardwareCatalog, EdgesCatalog, MaterialsCatalog, HardwareProfilesCatalog,
   OptionGroupsScreen) → `undefined` cuando read-only (la columna de acciones
   desaparece; `CatalogTable` soporta prop opcional).
   - Unit: caso nuevo read-only en `HardwareCatalog.test.tsx`; el test de
     `HardwareProfilesCatalog.test.tsx` que codificaba el bug como contrato
     ("row actions stay") se corrige al contrato de #972.
2. **#981 sharding**: `organization-browser` se divide en 3 shards tipo
   storage-shards:
   - `scripts/organization_browser_shard.py`: split determinista por ARCHIVOS
     (describe.serial nunca se parte), LPT con baseline
     `tests/organization/testdata/browser-shard-timings.json` (medida real del
     run verde 37052922890; archivos nuevos → default 20s), modos
     plan/files/verify; partición exacta fail-closed.
   - `scripts/foundation-gate-a.sh --stage browser -- <args>` reenvía args al
     gate (expansión guardiada para bash 3.2 del host).
   - `ci.yml`: job plan (verify) + matrix 3 shards (cada uno su stack
     desechable completo vía el gate, invariante #823 intacto) + agregador que
     conserva id `organization-browser` / nombre "Foundation real browser
     proofs" (identidad de branch protection) vía
     `scripts/ci_organization_browser_result.py` (espejo de
     `ci_backend_go_result.py`).
   - Tests: `scripts/test_ci_organization_browser_shard.py` (11 casos,
     descubiertos por el job validate-catalog).

## Exclusiones

- No se cambia `organization-browser-gate.sh` (rama #976 activa sobre él).
- No se cambia workers/fullyParallel dentro de cada shard.
- CustomersScreen (sin prop canMutate) queda documentada como deuda.
- No se toca matriz de roles ni autoridad server-side (ya correcta).

## Auditoría cross-spec (lo que el sharding destapó)

Bisección empírica (4 rondas, pares mínimos en stacks desechables):
`fabrication-flow-visibility` reescribía el módulo semilla GATE-MOD-A
in-place (estructura propia, `components: []`) y lo dejaba así; cualquier
residente posterior que cotizara el semilla con `optionChoices: {}`
fallaba con "El estado comercial de la obra no produce una revisión
válida". La suite completa sólo sobrevivía porque otro vecino
alfabético reescribía el módulo de nuevo antes. El patrón estaba
copiado en 5 specs: fabrication, engineering-cutting-demand,
engineering-physical-gate, engineering-state y
production-release-continuity. Los 5 ahora siembran módulo propio
(id + código comercial únicos), como demo-golden-path y
production-release-discovery ya hacían.

## Verificación

- Unit: 24/24 vitest en las 3 pantallas con test + 72 unittest de scripts.
- Typecheck del workspace completo.
- E2E local por shard (stack desechable real, igual que CI): ver PR.
