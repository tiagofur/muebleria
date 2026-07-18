# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `feat/project-measure-defaults-109` (basada en `main`)
- **No usar:** `muebles-orig` para features nuevas

## Hecho en esta pasada (2026-07-18) — F055 Parámetros de medida a nivel proyecto (#109)

**Feature:** `F055 — project_measure_defaults` (issue #109, [BAJO] → feature grande)

Defaults de medida (fondo/alto) a nivel proyecto, **keyed por tipo de mueble**
(inferior/superior/alto). Al agregar un mueble, se pre-selecciona el preset más
cercano a los defaults del tipo de ese módulo. Override por línea vía
`measurePresetId` (ya existente). Snapshot congela vía `priceSnapshot` (existe).

**Aprendizaje clave del dominio:** los 3 tipos de mueble del taller (gabinetes
~560 fondo, alacenas ~320 fondo, despensas ~2100 alto) NO estaban modelados. El
sistema de `categoryId` es un árbol libre editable por el usuario, vacío en el
seed, con UUIDs workspace-local — no servía como discriminador estable. Por eso
se introdujo `FurnitureType` enum first-class, desacoplado del árbol de
categorías. Esto desbloquea features futuras (placement 3D por tipo,
componentes default, etc.).

**Cambios por capa:**
- **Dominio TS:** `FurnitureType` enum + `Module.furnitureType` + `Project.measureDefaults`
  keyed por tipo + helper `pickPresetByMeasureDefaults` (match más cercano) + 9 tests.
- **Seed:** 3 inferiores existentes taggeados + 2 nuevos (Alacena superior
  600×720×320, Despensa alto 600×2100×600) con BOM paramétrico válido + smoke tests.
- **UI módulo:** editor de `furnitureType` en GeneralPanel + round-trip draft + test.
- **UI proyecto:** sección live "Parámetros de medida" (fila por tipo en uso,
  inputs Fondo/Alto mm con layout propio desacoplado de catalog-form__field) +
  matching en `selectModuleForAdd` + badge de tipo en cada línea de cotización
  + 8 tests.
- **Storage TS:** round-trip `furniture_type` + `measure_defaults` (snake/camel
  dual-read) + 3 tests.
- **Backend Go (paridad completa):** types + helper port + migración aditiva
  000028 + storage (8 sitios SQL) + seed + 10 subtests de regresión.

**Verificación:** typecheck 6/6 packages · TS tests 679+ verde · Go tests ok ·
`check-tokens.mjs` cero deuda · `./init.sh` verde.

**Decisiones clave (aprobadas por usuario):**
- Modelo C: default de UI (no toca `resolveBom` ni engine; preset por ítem sigue
  siendo la entrada). Override por línea ya existía. Snapshot ya existía.
- Enum `FurnitureType` first-class (no categoryId) — desacoplado del árbol editable.
- Defaults keyed por tipo: `{ [furnitureType]: { depth?, height? } }`.
- UX: sección live (como F029) + match más cercano con fallback al primer preset.
- Go incluido con paridad completa. Seed TS con 3 tipos; Go solo taggea los 3
  inferiores existentes (los 2 módulos nuevos son TS-only demo).

**Fuera de alcance:**
- No agrega módulos superior/alto al seed Go (TS demo basta).
- No toca `resolveBom`/engine de resolución (el preset resuelto por ítem sigue
  siendo la entrada al engine).
- No agrega `width` a `measureDefaults` (width varía por preset comercial — es
  decisión del vendedor por línea).

## Hecho en esta pasada (2026-07-17)

- Judgment Day Round 1 → ESCALATED; issues #125–#142
- Plan App Excellence documentado
- **Fixes JD Round 1 (confirmed):**
  - #127 App.tsx → ProjectsScreen structures/components
  - #125 apiMappers spatial round-trip component + instance
  - #126 Go formulas PH/PW/PD/T/i
  - #128 per-axis pose fallback + lateral_derecho + laterals rotX/Y
  - #129 multi-módulo WebGL msg, ghosts, DEFAULT_MODULE_FOOTPRINT_MM
  - #130 preview color validate/normalize; no pisar color al upload
- Tests: domain, storage, ui preview/materials, go engine — verdes

## Docs

| Doc | Rol |
|-----|-----|
| `docs/app-excellence.md` | Plan + issues |
| `docs/judgment-day-wip-3d-2026-07-17.md` | JD findings |
| `docs/prd.md` §6.7 | Política corte / CNC / layout |

## Siguiente

1. Commit/PR de fixes JD + docs (cuando pedís)
2. Residual opcional: migration `structure_components.overrides` + rotate NULL en components
3. Ola B: #133 layout cocina
