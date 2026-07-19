# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/media-persistent-store` (basada en `main`)
- **Otras ramas con trabajo pendiente de merge:** `wip/ui-fase-0-tokens-botones`
  (Fase 0/1/2 UI, ya pusheada, no tocada en esta sesión).

## Hecho en esta pasada (2026-07-19) — media store persistente + lifecycle cleanup

**Síntoma reportado:** al subir una imagen a un material, se guarda y se ve,
pero "en algún momento se pierde y ya no aparecen". Mismo riesgo para hardware
y modules (todos comparten `/api/media/<hash>`).

### Diagnóstico (probado, no especulativo)

- Las imágenes se guardaban en `backend-go/data/media/` (relativo al CWD),
  **carpeta bajo `.gitignore`** (`data/media/`) y **no respaldada**.
- La DB **sí** persiste las URLs (`material_boards.image_url`,
  `material_boards.preview_texture_url`, `hardwares.image_url`,
  `modules.image_url`).
- Probé end-to-end: subida → guardado → reinicio del backend → la imagen
  **sigue accesible**. El reinicio NO pierde imágenes.
- La pérdida ocurre cuando se borra el directorio `backend-go/data/media/`
  (git clean, re-clone, cambio de máquina, etc.): el FS pierde el archivo
  pero la DB sigue apuntando → 404 silencioso → "ya no aparecen".
- Confirmé 2 materiales con `image_url` apuntando a archivos inexistentes.

### Fix — rama `wip/media-persistent-store`

1. **Store persistente (causa raíz)** — `internal/config/config.go`:
   cuando `MEDIA_DIR` no está seteada, ahora defaultea a
   `~/.muebles-media` (absoluta, fuera del repo, sobrevive a clean/clone).
   Override vía `MEDIA_DIR` sigue funcionando (back-compat).
   `cmd/server/main.go` loguea la ruta efectiva al arranque.
2. **Lifecycle cleanup** — `internal/api/media.go` + `handlers.go`:
   - Helper `mediaFilenameFromURL` (extrae `<name>`, rechaza path-escape) y
     `deleteMediaFileByURL` (best-effort, idempotente).
   - PUT material: snapshot previo de `image_url` + `preview_texture_url`;
     tras commit exitoso, si cambiaron, borra los archivos viejos.
   - PUT hardware y PUT module: igual para `image_url`.
   - DELETE module (físico): borra `image_url` antes/después del delete.
   - Soft delete (DeactivateMaterialBoard/Hardware): **no** toca el FS
     (la fila puede reactivarse).
3. **CLI `admin clean-media [--apply]`** — `cmd/admin/main.go`: escanea las
   4 columnas, detecta URLs cuyo archivo no existe en `MediaDir`. Sin
   `--apply` es dry-run (solo reporta). Con `--apply` setea a `''`.
   Resuelve las URLs huérfanas históricas.
4. `.env.example`: documentación de `MEDIA_DIR` y cómo correr `clean-media`.

### Tests (van con la feature)

- `internal/config/config_test.go`: default `~/.muebles-media`, override,
  whitespace fallback.
- `internal/api/media_test.go`: 11 casos de `mediaFilenameFromURL` + 6 casos
  de `deleteMediaFileByURL`.
- `internal/api/handlers_test.go`: 6 tests de cleanup (PUT material
  cambia/conserva imagen, PUT hardware, PUT module, DELETE module, soft
  delete no toca FS).
- `cmd/admin/admin_test.go`: `resolveMediaDir`, `mediaFilenameFromURL`.

### Verificación ejecutada

- `go test ./...` ✓ (todos los paquetes, incluyendo storage con Postgres).
- `pnpm typecheck` ✓ (6 workspaces).
- `pnpm test` ✓ (311 + 9 + 87 = 407 tests TS).
- E2E con server real: subida a `MEDIA_DIR` override, cleanup en PUT,
  cleanup en DELETE module, `clean-media` dry-run reportó 2 huérfanos,
  `--apply` los limpió (DB quedó en 0 huérfanos).
- Aplicado `clean-media --apply` sobre la DB local del usuario: 2 URLs
  huérfanas limpiadas. Esos materiales ahora muestran "Sin foto".

### Archivos modificados / creados

- `backend-go/internal/config/config.go` — MediaDir default persistente.
- `backend-go/internal/config/config_test.go` — tests del default.
- `backend-go/internal/api/media.go` — helpers de cleanup.
- `backend-go/internal/api/media_test.go` — tests de helpers.
- `backend-go/internal/api/handlers.go` — lifecycle cleanup.
- `backend-go/internal/api/handlers_test.go` — stub extendido + 6 tests.
- `backend-go/cmd/admin/main.go` — subcomando `clean-media`.
- `backend-go/cmd/admin/admin_test.go` — tests del CLI.
- `backend-go/cmd/server/main.go` — log de `Media store`.
- `.env.example` — documentación `MEDIA_DIR` + `clean-media`.

---

# Sesión anterior (2026-07-18) — F056 Plantillas de proyecto (#110)

> La sección de abajo describe la sesión anterior para contexto histórico.
> Esa feature está mergueada a main; este archivo se mantiene como bitácora.

- **Branch (sesión anterior):** `feat/project-templates-110` (basada en `main`)
- **No usar:** `muebles-orig` para features nuevas

## Hecho en esta pasada (2026-07-18) — F056 Plantillas de proyecto (#110)

**Feature:** `F056 — project_templates` (issue #110, [BAJO] → feature grande)
**Branch:** `feat/project-templates-110`

Plantillas de proyecto reutilizables. Colección separada `Workspace.projectTemplates`
+ tipo `ProjectTemplate` (entidad distinta de Project: sin customer/status/
snapshot/owner). Flujo: "Guardar como plantilla" desde un proyecto → "Crear desde
plantilla" clona a proyecto nuevo editable → borrar plantilla. Clone completo
incluyendo kitchenLayout (con remap de `placements.itemId`).

**Cambios por capa:**
- **Dominio TS:** tipo `ProjectTemplate` + `Workspace.projectTemplates` (opcional,
  no requiere migración). Helpers `projectToTemplate` (extrae receta, sin pin) y
  `createProjectFromTemplate` (reminta ids, remapea kitchenLayout placements vía
  idMap posicional, status 'draft'). 8 tests.
- **Storage TS:** mappers `projectTemplateToApi/FromApi` (reusando kitchenLayout,
  measureDefaults, items mappers). 4 métodos en `WorkspaceRepository` + 3
  adapters (jsonFileStorage, apiWorkspaceRepository, localStorageWorkspaceRepository).
  3 tests.
- **Seed:** plantilla demo "Cocina estándar 3 m" (2 gabinetes + 1 cajonera + 2
  alacenas; measureDefaults inferiores/superiores). Test seed incluye plantilla +
  crear proyecto desde ella produce items válidos.
- **UI:** props (projectTemplates + 3 callbacks). Toolbar "Desde plantilla" +
  "Plantillas" (gestión). Chrome "Guardar como plantilla". Empty state con 2da
  acción. 3 modales: picker (lista + form nombre/cliente), save (input nombre),
  management (lista + borrar). CSS nuevo (.template-picker-list/.item,
  .template-management-row). 5 tests.
- **Backend Go (paridad completa):** `ProjectTemplate` struct + tabla
  `project_templates` (JSONB para blobs anidados + items) en migración 000029
  aditiva. Storage CRUD + handlers HTTP + routes `/api/project-templates`.
  RBAC: lectura = `RoleCanAccessProjects`, mutación = `RoleCanMutateModules`.
  Seed "Cocina estándar 3 m". 4 tests HTTP (list, createForbiddenForVendedor,
  createEngineerOK, delete).

**Verificación:** typecheck 6/6 verde · TS tests 699 (domain 216 · storage 51 ·
excel 25 · ui 311 · desktop 9 · web 87) · Go tests ok · `./init.sh` verde.

**Decisiones clave (aprobadas por usuario):**
- Modelo A: colección separada `Workspace.projectTemplates` + tipo
  `ProjectTemplate` (entidad distinta, sin customer/status/snapshot/owner).
  No contamina filtros/dashboard/queries.
- Clone completo including kitchenLayout (con remap de placements.itemId).
- ABM mínimo: guardar desde proyecto + crear desde plantilla + borrar.
- Go incluido con paridad completa.

**Notas técnicas / fuera de alcance:**
- Items de plantilla NO llevan `structureRevisionPin` (la cotización nueva
  cotiza contra la revisión viva; el pin es de cierre).
- Go almacena items como JSONB en `project_templates` (sin tabla separada de
  template_items) para simplicidad y consistencia con los otros blobs.
- No hay editor rico de plantillas (no se editan items in-place); el flujo es
  guardar desde un proyecto real. ABM rico queda como follow-up.
- No se siembran módulos superiores/altos en Go seed (solo MOD-GAB-01/MOD-CAJ-01);
  la plantilla seed Go usa esos 2.

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
