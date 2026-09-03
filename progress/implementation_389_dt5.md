# Implementación #389 — DT-5: Project Furniture panel + Place existing en SketchUp

- **Fecha:** 2026-09-03 (America/Mexico_City)
- **Feature:** F208 · ledger `feature_list.json`
- **Autoridad:** `docs/architecture/project-design-digital-thread.md` §§5, 8, 12, 13, 21, 24–26, 28, 30–31 · ADR-0003 · `docs/architecture/sketchup-interaction-model.md` · `docs/architecture/sketchup-native-entity-model.md` (#415 prerequisite) · `apps/sketchup-extension/AGENTS.md`
- **Estado:** COMPLETE (pending review/merge)
- **Base:** `main` (#388 DT-4 mergeado via PR #541: binding `granete.project-binding.v1`, `binding:validate`, migration 000113).

---

## 1. Qué se implementó

El flujo visible del Digital Thread: QuoteLine `Base 600 ×3` → FI-001/FI-002/FI-003 → panel **Muebles del proyecto** en SketchUp (separado del Catálogo) → `Colocar FI-001` → jerarquía nativa con `furnitureInstanceId` autoritativo → DesignWorkingCopy actualizado con merge. **Place existing nunca crea otro FurnitureInstance** — la identidad ya existe y llega del servidor.

### Backend — presentación + grants mínimos

1. **`display` en la lista de FIs (#389):** `GET /api/projects/{projectId}/furniture-instances` devuelve ahora un bloque opcional `display { name, dimensions_mm }` por unidad, computado server-side en una consulta consistente (`ListFurnitureInstanceSummariesByProject`): nombre del módulo de catálogo (JOIN `modules`) y dimensiones que priorizan `custom_dims` de la quote line actual (LATERAL sobre `quote_line_furniture_instances` state=current → `project_items`) sobre los defaults del módulo. Presentación only — jamás identidad. Schemas `FurnitureInstanceDisplay`/`FurnitureInstanceDimensionsMm` generados (#496), `pnpm openapi:check` sin drift.
2. **Credential de extensión (#460 SEC-6):** grants exactos citando #389 — GET `^/api/projects/[^/]+/furniture-instances$`, GET `^/api/designs/[^/]+/working-copy$` y la **única superficie PUT** del credential: `^/api/designs/[^/]+/working-copy$` (nueva lista `extensionTokenMayPutPatterns`). `POST /api/projects/{id}/furniture-instances` (#390), `working-copy:reset` y publish quedan denegados.

### Plugin — `Connection::ProjectFurniture` (nuevos archivos)

1. **`project_furniture_contract.rb`:** parsers fail-closed de los DTOs generados (lista de instancias con display; working copy GET/PUT). Shapes desconocidas raisan — sin contrato paralelo. `WorkingItem#to_contract_h` produce el shape canónico del PUT.
2. **`project_furniture.rb`:** `Service` (lista + working copy GET/PUT, errores tipados por clase) y `Placer` en tres fases:
   - **Fase 1 contexto:** model + binding (#388) + revalidación autoritativa; `stale_base`/`design_archived`/auth fallan loud ANTES de tocar el modelo (§15).
   - **Fase 2 unidad:** la lista del proyecto es el scope autoritativo — una unidad de otro proyecto/org simplemente no está (proofs E/F); unidad terminal ⇒ `:terminal`; duplicados locales de `furnitureInstanceId` ⇒ `:duplicate_detected` (bloqueo #391, nunca tercera copia ni nueva identidad); ya colocada ⇒ `already_placed` (focus, sin duplicar).
   - **Fase 3 colocación+sync:** parámetros = defaults del catálogo sobrescritos por las dimensiones citadas (`display`); layout resuelto server-side (`LayoutResolutionError` ⇒ abortar, nunca geometría local adivinada); `place_existing_furniture` en UNA operación undoable; transform final leído del host; **GET → merge by furnitureInstanceId → PUT completo** (los demás items sobreviven, §14); fallo del backend ⇒ `rollback_placement` local + `:sync_failed` loud (§18). Fail-closed contra resolution rechazada (§9).
3. **`transform_contract.rb`:** Transform3D client-agnostic ⇄ `Geom::Transformation`. mm⇄inches sólo aquí; rotación = Euler XYZ extrínseco (R=Rz·Ry·Rx) extraído de los ejes del host con gimbal-lock pinneado; roundtrips probados (identidad, 1000 mm, 90° Z).
4. **`managed_furniture.rb`:** localización de roots gestionados por `furnitureInstanceId` (autoridad) con conteo de duplicados.
5. **`panel_state.rb`:** derivación pending/placed por `furnitureInstanceId` (intersect con working copy); qty>1 = N filas individuales con label "Unidad n de N".

### Plugin — placement + metadata

1. **`Model::ProjectPlacement` (module extraído de FurnitureBuilder):** `place_existing_furniture` renderiza la jerarquía nativa #415 (top-level ComponentInstance + partes anidadas) estampando el ID del servidor; `rollback_placement` destruye hijos → entity → purge scoped (orden de `update_furniture`). Nunca genera `inst-` local en este path.
2. **`MetadataWriter` converge identidad (§12):** con `identity: {server: true, project_id:, design_id:}` escribe `identity.furnitureInstanceId` (autoridad), `identity.instanceRef` = MISMO valor (alias/locator de compatibilidad, nunca segunda identidad), `identity.projectId`/`designId` del binding. Inserciones locales siguen con ref local hasta #390; rebuilds preservan identity existente por copia del payload. Writers de partes/hijos extraídos a `ChildMetadataWriter` (presupuesto de longitud).
3. **Dialog:** tab nueva **"Proyecto"** (separada de "Biblioteca") con estados distintos: unbound (CTA a Estado), loading, error tipado (stale_base/archived/unauth/unreachable/bad_contract), empty honesto, y lista Pendientes(n)/Colocados(n). Cada unidad = una card (nombre + dimensiones mm + ref corta secundaria + badge Unidad) con `Colocar` (guard de doble click, re-arm sincrónico en fallo) o `Seleccionar` (focus viewport). Bridge `ProjectFurnitureBridge` (3 callbacks); refresh en dialog-ready, cambio de documento, tras place y al cambiar el binding.

## 2. Invariantes (I1–I14) tocadas y cómo se verifican

- **I1/I2 (Project owns identity; una unidad = una identidad):** Place reusa el ID del servidor verbatim; el journal del fake transport prueba que NUNCA se emite `POST /furniture-instances` (proof A) y que 3 unidades idénticas mantienen 3 identidades (proofs B/C). El boundary del credential mantiene POST denegado (boundary test).
- **I5 (Granete owns manufacturing truth):** labels/dimensiones llegan del `display` server-side; composición del layout endpoint; resolución rechazada aborta (nunca renderer genérico silencioso para unidades citadas conectadas).
- **I7 (identity ≠ SketchUp technical identity):** `furnitureInstanceId` es autoridad; `persistent_id` viaja como `technical_client_locator` separado; locator ≠ identidad probado en test y smoke.
- **I9/I12:** sin publicar revisiones (#392); working copy mutable only.
- **§14 merge:** proof G — working copy con FI-002 + place FI-001 ⇒ PUT contiene ambos.
- **§18 atomicity:** proof H — PUT 409 ⇒ entity borrada, defs purgadas, `sync_failed` loud.
- **§20 copy/paste:** dos roots con el mismo ID ⇒ `duplicate_detected`, sin interpretarlos como válidos ni crear FI.

## 3. Pruebas

- **Go API:** display composition (quoted 650×720×560 wins sobre module default 600; fi sin fuentes sin display inventado); `TestExtensionClientBoundaryProjectFurniture` (tabla grants/denials incl. POST #390, reset, publish); `TestExtensionTokenDenyByDefault` actualizado (GET instances + GET/PUT working-copy abiertos; resto 403).
- **Go storage (PostgreSQL real):** `TestFurnitureInstances_ListSummariesDisplay` — quoted dims ganan, fallback a defaults del módulo, definition-less sin presentación.
- **Ruby unit (342 runs total):** `project_furniture_test.rb` 18 tests — proofs A–I completos (identity verbatim + alias, transform canónico con locator, merge, already_placed sin duplicar, cross-project/cross-org sin inserción local, rollback con purge, stale_base sin writes, unbound, terminal, duplicate_detected, reopen via store nuevo, panel por unidad, estados de error distintos, parsers fail-closed, conversiones de transform).
- **JS harness (Node):** `dialog_project_furniture_test.js` 10 casos — filas por unidad con badges, Colocar envía exactamente `furnitureInstanceId` (sin definition/name/position), doble-click guard, fallo nunca viste success y re-intenta honesto, estados distintos, empty, terminal fuera.
- **TestUp real-host:** `TC_ProjectFurnitureSmoke` — place estampa identidad en jerarquía nativa (assert `Sketchup::ComponentInstance` + partes anidadas + locator≠identidad), save/close/reopen re-resuelve identidad sin duplicados, copy/paste reporta 2 roots (invalid steady state #391), dos unidades misma definición con defs aisladas.

## 4. No implementado (explícito)

#390 catalog-inserted units (POST sigue denegado para la extensión) · #391 resolución de duplicados (sólo bloqueo loud) · #392 publish/DesignRevision · reconciliation (#393) · hardware/Blum/machining/DXF · ProductionRelease · transform re-sync tras mover el mueble (el PUT inicial lleva el transform del placement; el sync de movimientos posteriores llega con #392 publish — documentado).

## 5. Verificación

```bash
bundle exec rake verify          # syntax + rubocop (0) + unit 342 + boundary 3 + RBZ sha256
node test/js/dialog_project_furniture_test.js   # 10/10
pnpm openapi:check               # sin drift
pnpm typecheck                   # green
pnpm test                        # green (apps/web 411, packages, etc.)
go test ./...                    # green (incl. PostgreSQL real storage)
git diff --check                 # clean
```
