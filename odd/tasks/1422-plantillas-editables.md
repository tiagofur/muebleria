# ODD — #1422 slice 2: plantillas de juego editables por taller

- **Issue**: tiagofur/muebleria#1422 — `status:approved` (owner «hagamos» 10-29; slice 1 mergeado en PR #1428)
- **Lane**: Delegated Direct (multi-superficie: migración, Go storage/API, dominio TS, UI, E2E)
- **Base**: `origin/main` `848c7cd19f94ca138326357df819e99db7206603` (PR #1430 mergeado; CI 22/22)
- **Rama**: `feat/1422-plantillas-editables`
- **Escritor**: único. Sin PR previo de slice 2 (el comentario 10-29 declara slice 1 primero; ya mergeado).

## Estado al arranque (code-verified en main)

YA HECHO (no repetir): las 3 plantillas embebidas (cajón/bisagra/jaladera) son
DATO en `packages/domain/src/hardwareKit.ts` con selección en el asistente
(`HardwareKitWizardModal.tsx:348-360`), motion por plantilla en el store y
**browser proof propio** `tests/organization/hardware-kit-templates.spec.ts`
(bisagra → kit + copa body + brazo actor:door + puerta rotate).

RESTANTE de slice 2 según la issue: **«plantillas editables por taller →
cualquier herraje multi-parte futuro (levantadzas, plegables) sin código
nuevo»** + la aceptación en host (apertura de puerta con RBZ vigente) que es
verificación en vivo.

## Diseño

### Datos (migración 000172, tabla nueva org-scoped)

`hardware_kit_templates`: id UUID (identidad del CLIENTE, patrón #1398),
organization_id, code (único por org), name, agregado_label_es, motion
(vocabulario cerrado aplicado en app, no CHECK — evita migración al ampliar),
slots JSONB (forma espejo de `HardwareKitSlotTemplate`), active bool, version
bigserial (If-Match #443), timestamps. RLS tenant-owned (patrón 000131:
políticas granete_app + `rls_policy_inventory` + GRANT/REVOKE; DELETE
revocado — borrado lógico `active=false` vía endpoint DELETE, patrón
DeactivateEdgeBand).

### Validación paridad TS↔Go (fixture compartido)

`contracts/kitTemplateValidation.contract.json` — casos válidos/inválidos con
`field` esperado; lo consumen vitest y `go test`. Reglas (en
`validateHardwareKitTemplate` TS + espejo Go): id no vacío; code charset
alfanumérico `._-` sin empezar con signo; name/agregadoLabelEs no vacíos;
motion ∈ {translate, rotate_left, rotate_right, none}; slots 1..12 con
slot/memberId/suffix ÚNICOS; membership `body` | `actor:<id>`; anchorXRef ∈
{min,max,center}; offsetSign ±1; defaultOffsetMm finito acotado (±100000,
guard #1428). La paridad fija la DECISIÓN pass/fail + campo, no el texto del
mensaje (mensajes por runtime en español).

### API (patrón agregados; NO entra al spec acotado — igual que agregados)

GET/POST `/api/catalog/kit-templates`, PUT/DELETE `/api/catalog/kit-templates/{id}`.
Escritura: `requirePermission(RoleCanMutateCatalog)`; PUT/DELETE con
If-Match (412 `ErrVersionConflict`); POST con 409 código duplicado; 422
`KIT_TEMPLATE_INVALID` con field. Storage CRUD org-scoped (direct-SQL bajo
runtime role, sin BYPASSRLS).

### Dominio/consumo

`planHardwareKit` acepta `customTemplates` (3er parámetro opcional): la
resolución embedded-first, custom después; toda plantilla custom pasa
`validateHardwareKitTemplate` ANTES de planear (fail-closed). El plan sigue
materializándose contra el catálogo real en el store; server authority
intacto (los hardwares/agregado creados pasan por las validaciones existentes).

### UI

- `apiClient.ts`: métodos CRUD de kit-templates (patrón agregados).
- `HardwareCatalog` carga las plantillas del taller y las pasa al wizard.
- Wizard: select = embebidas + «del taller» (badge); opción de abrir el editor.
- `KitTemplateEditorModal.tsx` (nuevo): alta/edición (code, nombre, label de
  agregado, motion, tabla de slots con alta/baja) y eliminar (confirm). Copy
  español, una primary action, estados loading/error explícitos.

### E2E

Extensión de `hardware-kit-templates.spec.ts`: crear plantilla custom por el
EDITOR (browser real), usarla en el asistente, readback exacto del agregado
(label + motion). La plantilla bisagra embebida ya está probada.

## Ronda de corrección (review dual ciego, 10-31)

- **Ronda 1** (2 jueces A/B sobre a609ce7d, CI 22/22): ledger consolidado —
  2 CRITICAL de juez único (verificados por el padre en código antes de
  corregir) + 5 WARNINGs (2 coincidentes). Owner había pre-autorizado la
  ronda de fixes.
- **C1 crash de render**: el lookup de plantilla del wizard tiraba si el id
  seleccionado desaparecía de la lista del taller (modal siempre montado) →
  lookup seguro con fallback a la embebida + efecto que re-clampa la
  selección.
- **C2 edición/baja inalcanzables**: sólo existía el alta — ahora la
  plantilla del taller seleccionada muestra «Editar …» que abre el editor
  precargado (PUT con If-Match por camino del store). E2E nuevo lo prueba
  end-to-end con readback.
- **W**: 404-only degrada la carga (errores reales → aviso visible, lista
  stale se conserva); métodos muertos del repository eliminados (la capa del
  store es la única); guard UUID (422 field=id; path no-UUID → 404, nunca
  500 de PostgreSQL); gemelo TS sin coerción "undefined" (typeof guards,
  espejo del zero-value Go); mensaje de error del editor en español (el
  texto del gemelo ya no llega a la UI); newline pegado en saveCatalog.
- Revalidación V1: typecheck raíz 0, dominio 24/24 (+1 coerción), api Go
  (+2 UUID), web 610/610, builds+vet limpios. Nuevo HEAD → CI + 
  re-juzgamiento scoped (ledger congelado + delta).

## Fuera de alcance (partial)

- Apertura de puerta en host SketchUp (aceptación de la issue) → verificación
  en vivo con el owner; `Delivery: partial`.
- Levantadzas/plegables como plantillas embebidas → el punto es que ahora son
  dato del taller, sin código.
- Compartir plantillas entre talleres (librería) → no autorizado aquí.

## Verificación plan

V0 tsc/go vet/drift; V1 suites dominio+api+storage+UI y fixture compartida en
ambos runtimes; V2 browser real (E2E nuevo) en CI; host NOT_RUN honesto.

## Evidencia observada

- **Dominio TS**: `validateHardwareKitTemplate` + `planHardwareKit(…, customTemplates)`
  (embedded-first, validación de la custom ANTES de planear). Suite dominio
  2070/2070 (6 tests nuevos: fixture compartida + plan custom + fail-closed).
- **Go**: `domain.KitTemplate.Validate` gemelo byte-idéntico sobre la fixture
  compartida (2 tests), storage CRUD con prueba real contra PostgreSQL
  (pg-1209/granete_test: round-trip de slots, conflicto If-Match tipado, baja
  lógica fuera de la lista activa), API con tests de permisos/422/412/409.
  `go build ./...` + vet limpio; domain+api suites ok.
- **Web**: repository (lista tolerante a backend viejo, If-Match en
  PUT/DELETE), slice `kitTemplates` en catalogStore, wizard consume customs
  (select «Del taller» + plan con customTemplates), `KitTemplateEditorModal`
  (alta/edición/baja con validación de dominio en cliente), ShellView/
  AppContent wiring. El store re-deriva el plan CON las plantillas del taller
  (hallazgo propio: sin eso, la re-derivación del guardado rechazaría toda
  plantilla custom). typecheck raíz 0; web 610/610; ui 2376/2376.
- **E2E**: `hardware-kit-templates.spec.ts` +2 tests (editor → persistencia
  → asistente → readback exacto; negativo de validación en el editor). Se
  ejecutan en los shards browser de CI sobre este PR (V2 ahí).
- **V2 local**: NOT_RUN (exige el gate del entorno de organización; corre en
  CI). Host SketchUp (apertura de puerta con plantilla bisagra): NOT_RUN —
  verificación en vivo con el owner; alcance partial.
