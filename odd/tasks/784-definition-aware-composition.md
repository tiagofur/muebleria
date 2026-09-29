# ODD — #784 Follow-up Backend: Composición definition-aware de materiales

- Issue: #784 (`[P1][SU-UX-4] Design defaults, inheritance and contextual Inspector`), slice follow-up backend.
- Autorización: prompt del owner 2026-09-29 ("si vamos" / "de acuerdo").
- Lane: ODD. Estado: COMPLETE.
- Base: `origin/main` @ `786f46ef32439d6509d84d4122fb5677641435ff`.
- Branch: `feat/784-definition-aware-composition`.

## Objetivo

Implementar en el backend (Go) la composición autoritativa *definition-aware* de elecciones de material y modos de linaje (`override || Design default || FurnitureDefinition compatibility → effective intent`).
Este endpoint/función de dominio es el requisito previo bloqueante de **R4** (nueva inserción hereda defaults del Design) para garantizar que el cliente nunca improvise en JS la compatibilidad de catálogo o la asignación de modos.

## Auditoría y Contrato

### 1. Regla de composición pura (dominio)

Dado un `FurnitureDefinition` (o sus roles soportados con opciones permitidas), los `authoring_defaults` del `Design`, y opcionalmente `overrides` de material:

Por cada rol soportado por la definición:
1. **Override manual:** si `overrides[role]` está presente y no vacío:
   - `choice = overrides[role]`
   - `mode = "override"`
2. **Herencia de Design default:** si no hay override para ese rol y `authoringDefaults.materialChoices[role]` existe:
   - Si la opción es compatible con el rol en la definición (pertenece a los `optionIds` permitidos o el rol acepta todo el catálogo activo):
     - `choice = authoringDefaults.materialChoices[role]`
     - `mode = "design"`
   - Si la opción NO es compatible con la definición:
     - `choice = defaultDeLaDefinición` (primera opción curada permitida)
     - `mode = "override"`
3. **Sin default en Design:**
   - `choice = defaultDeLaDefinición` (primera opción curada permitida)
   - `mode = "override"`

Invariante estricto: $\text{keys}(\text{materialChoices}) == \text{keys}(\text{materialChoiceModes})$.

### 2. Superficie API

- Endpoint: `POST /api/designs/{designId}/effective-materials`
- Permisos: allowlist de extensión SketchUp en `middleware.go` (`extensionTokenMayPostPatterns`).
- Request:
  ```json
  {
    "furnitureDefinitionId": "uuid-or-code",
    "materialChoices": { "FRENTES": "mat-1" }
  }
  ```
- Response (200 OK):
  ```json
  {
    "furnitureDefinitionId": "uuid-or-code",
    "materialChoices": {
      "BODY": "mat-blanco",
      "FRENTES": "mat-1"
    },
    "materialChoiceModes": {
      "BODY": "design",
      "FRENTES": "override"
    }
  }
  ```

## Tareas

- [x] 1. Dominio Go: implementar `ComposeEffectiveDefinitionMaterials` en `internal/domain/design_composition.go` con tests unitarios TDD (`internal/domain/design_composition_test.go`).
- [x] 2. API Handler y Rutas: implementar `HandleDesignEffectiveMaterials` en `internal/api/design_effective_materials.go` y registrar la ruta en `routes.go`.
- [x] 3. Middleware allowlist: autorizar `POST /api/designs/[^/]+/effective-materials` en `extensionTokenMayPostPatterns` y `GET /api/designs/[^/]+/working-copy/material-provenance` en `extensionClientGetPatterns` de `middleware.go` + tests en `middleware_test.go`.
- [x] 4. Contrato OpenAPI: registrar el endpoint y schemas en `contracts/openapi/granete-api.v1.yaml` y regenerar con `scripts/generate_openapi.py`.
- [x] 5. Verificación: tests unitarios de dominio, tests de API HTTP, check_openapi_drift y runner canónico.

## Verificación Backend

- `internal/domain`: PASS (`go test ./internal/domain/...`)
- `internal/api`: PASS (`go test -v ./internal/api -run TestHandleDesignEffectiveMaterials`)
- `middleware allowlist`: PASS (`go test -v ./internal/api -run TestExtensionClientBoundaryProjectFurniture`)
- `check_openapi_drift.py`: PASS (OpenAPI generated files are current; operation drift negative proofs passed)
- `./scripts/backend-test.sh ./internal/domain/... ./internal/api`: PASS (23s, clean isolation db)

## Extensión SketchUp — Slice R4: Inserción con herencia de Design defaults

### Tareas Extensión
- [x] 1. Contrato Ruby: `EffectiveMaterialsContract.parse!` con validación fail-closed y paridad estricta de claves (`keys(materialChoices) == keys(materialChoiceModes)`).
- [x] 2. Servicio `ProjectFurniture::Service`: llamada autoritativa a `POST /api/designs/{designId}/effective-materials` en `create_and_place` y `prepare_catalog_preview`.
- [x] 3. Persistencia de metadatos: escritura de `material_choice_modes` en `MetadataWriter.write_furniture` y `FurnitureBuilder#place_existing_furniture`.
- [x] 4. Bridges Ruby: propagación de `materialOverrides` y `materialChoiceModes` en `PlacementPreviewBridge` y `ProjectFurnitureBridge`.
- [x] 5. UI JavaScript (`granete-design-inspector.js`): exposición de `getDesignDefaults()`.
- [x] 6. UI JavaScript (`granete-material-roles.js`): inicialización de defaults desde Design y badges contextuales ("Diseño" / "Personalizado") en el configurador.
- [x] 7. UI JavaScript (`granete-configurator.js`): tracking de roles customizados (`libUserCustomizedRoles`), envío de `materialOverrides` exclusivo para roles modificados y refresco de herencia tras inserción exitosa.
- [x] 8. UI HTML (`dialog.html`): inyección de dependencias (`getDesignDefaults`, `refreshDesignInheritance`).
- [x] 9. Tests unitarios Ruby: tests de contrato y flujo en `project_furniture_test.rb` (1270 tests, 9404 assertions, 0 failures).
- [x] 10. Tests unitarios JS: suites completas en Node.js (`granete_configurator_test.js`, `granete_material_roles_test.js`, `granete_design_inspector_test.js`).

### Verificación Extensión
- `bundle exec rake unit`: PASS (1270 runs, 9404 assertions, 0 failures, 0 errors, 0 skips)
- `node test/js/granete_configurator_test.js`: PASS (35 tests)
- `node test/js/granete_material_roles_test.js`: PASS (34 tests)
- `node test/js/granete_design_inspector_test.js`: PASS (34 tests)
- `python3 scripts/factory_preflight.py`: PASS (PREFLIGHT_OK_NOT_VERIFIED, no errors)


