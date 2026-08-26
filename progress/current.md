# Sesión

**Feature en curso:** F168 — #347 manufacturing preflight, Definition of Done completo — implementado y verificado 2026-08-26 (ver `progress/implementation_F168.md`)
**Siguiente activa:** #348 — validación PTX con import/readback (requiere field evidence #306)
**Rama:** `main`

## Notas de sesión

- Auditoría arquitectónica completada y documentada en `docs/architecture/parametric-furniture-library.md` y `docs/adr/0002-parametric-furniture-library-architecture.md`.
- 7 entidades desacopladas modeladas en `smartFurnitureDomain.ts`.
- Motor de instanciación `instantiateFurniture` en `furnitureCompositionEngine.ts`.
- Sincronización y aislamiento de herrajes en `sketchupHardwareSync.ts`.
- 85 test files y 1087 tests en domain pasando al 100%, typecheck 7/7 workspaces limpio.

## Corrección pipeline de inserción (2026-08-25)

**Problema:** al insertar un mueble real del taller sólo se generaban los
laterales y el contador decía "2 piezas" — la extensión no recibía la
composición del mueble (el contrato de definiciones sólo proyectaba
identidad/parámetros) y el builder caía al fallback genérico
(`shelfCount`/`doorCount` ausentes en módulos reales).

**Solución (resolución server-side, invariante intacta — Ruby nunca compone):**

- `backend-go/internal/domain/engine/layout.go`: `ResolveFurnitureLayout`
  resuelve estructura + componentes del módulo + agregados (unidades
  verticales/horizontales con gap) + herrajes visibles → cajas AABB
  pre-horneadas (min-corner, marco taller) + herrajes en world-space con
  shape/size/projection/color. Espejo de `bom.ts`/`spatialPlacement.ts`/
  `spatialAnchor.ts`/`agregados.ts`/`hardwarePlacement.ts`. Fórmulas ganan
  variables `B` (zoclo) y `HW`.
- `GET /api/furniture/definitions/{id}/layout?widthMm=&heightMm=&depthMm=`:
  auth + licencia; overrides de cotas; 404/400/422/403 explícitos.
- `GET /api/furniture/definitions`: cada definición lleva
  `estimatedPartCount`/`estimatedHardwareCount` (contador de piezas real).
- Ruby: `RemoteCatalogProvider#resolved_layout` (nil ⇒ fallback genérico,
  nunca guess local), `DialogController` (FurnitureBridge) pasa
  `resolved_layout:` al builder, `FurnitureBuilder` renderiza tableros +
  herrajes y reporta `board_count`/`hardware_count`/`component_count`;
  pushpull ahora +dz (min-corner). dialog.html usa `estimatedPartsLabel`.
- Módulos legados: piezas apiladas por índice (completitud sin inventar).

**Verificación:** `go test ./...` (backend completo) y `bundle exec rake`
(lint + 93 unit + boundary) en verde.

## Elección de materiales por rol en SketchUp (2026-08-25)

**Modelo:** idéntico a la app web — `OptionChoices = { [optionGroupCode]:
materialId }`; el `optionRole` del componente es el código del grupo
(`findOptionGroup(catalog, role)`). Grupos `kind: 'board'` curan los tableros
permitidos por rol (`optionIds`).

- Engine: `ResolveFurnitureLayout` acepta `optionChoices`; tablero con elección
  válida lleva `materialId/Code/Name/ColorHex` reales (previewColor
  normalizado); elección desconocida/inactiva → error explícito (422 en el
  endpoint); rol sin elección → paleta por rol (tolerante).
- `GET /api/furniture/definitions`: envelope `materials` (tableros activos) +
  `materialRoles: [{role, label, optionIds}]` por definición (grupo curado o
  todos los activos como fallback). ETag/revisionId ahora cubre materials.
- `GET .../layout?choice.ROL=<id>`: elecciones viajan en query porque el token
  de extensión es read-only (GET + refresh).
- Ruby: `resolved_layout(id, params, choices)` reenvía `choice.ROLE=id`;
  `all_materials` en el contrato del provider; controller reenvía
  `materialChoices` del payload; builder pinta grupos con
  `Model::MaterialApplier` (materiales namespaced `Granete · <nombre>`, color
  de `materialColorHex`/herrajes `colorHex`).
- dialog.html: sección "Materiales del Taller" (configurator + inspector), un
  select por rol con default = primera opción, payload `materialChoices`.

**Verificación:** `go test ./...` y `bundle exec rake` (lint + 97 unit +
boundary) en verde.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.

## Critique + fixes UI/UX plugin SketchUp (2026-08-25, impeccable)

**Critique** (`$impeccable critique`, snapshot `.impeccable/critique/2026-08-26T03-00-49Z__apps-sketchup-extension.md`): 22/40 aceptable, 3 P1. Nota: P1-1 (selector sin filtro por rol) ya estaba resuelto en el working tree por la sesión anterior — la review leyó HEAD.

**Fixes aplicados sobre el working tree:**

- **P1-3 placement**: `FurnitureBuilder#prepare_placement` tras commit — selecciona el grupo nuevo y activa `selectMoveTool:`; toast de inserción guía "movelo a su lugar (tecla M)". Test nuevo + `send_action` recorder en stub.
- **P1-2 unificación visual**: `material_selector.html` re-tematizado al sistema Granete claro (mismos tokens que dialog.html: brand 245, Inter-first, rem, radius 6/8/12, shadow-sm). Label del scope unificado a "Valor por defecto de la obra" en ambas superficies (el "A todos los muebles" mentía). Micro-glass badges eliminados.
- **P2-4 a11y/prevención**: delete con confirmación two-step (armar → confirmar en 4s); toast `role="status" aria-live="polite"` + timer no pisado + errores persisten 8s; tabs con `aria-selected` + flechas; ítems del modal embebido focusables; contraste `--text-muted` 3.68:1→5.27:1 (hsl 230 12% 45%); piso tipográfico 12px (`--text-xs` 11→12px, tags/codes ≥12px).
- **P2-5 honestidad**: pill inicial "Comprobando…" (antes "Conectado" falso); espesor ausente muestra "—" (antes inventaba 18 mm); fabricante ausente "Sin fabricante" (antes "Taller"); fuera "#347", copy "Invariante" → "Cómo funciona…"; instance ID fuera del inspector; empty states diferenciados (rol sin materiales ≠ sin resultados); `cat.name` del modal embebido ahora por DOM APIs (sin innerHTML).
- **Iconografía**: emojis de chrome reemplazados por set SVG inline 16px stroke currentColor (tabs, búsqueda, botones, empty states, veta, licencia, medidas).
- `user-select: text` en códigos/nombres copiables.

**Verificación**: `bundle exec rake` completo en verde (rubocop + 115 unit +910 assertions + boundary/smoke 763 + verify .rbz) + browser check DOM/screenshots (pill, tabs, selector claro, apply deshabilitado).

## Selector visual de acabados en Proyectar web (2026-08-26)

**Qué:** la sección "Acabados y herrajes" del inspector del studio ya no usa
`<select>` para grupos kind 'board': cada rol (INTERIORES/FRENTES…) es un
bloque resumido (swatch + nombre + meta + botón "Catálogo") que abre el mismo
diálogo visual del plugin de SketchUp — Miller Columns con conteos por rama,
breadcrumbs, grid de swatches, ficha técnica, scope (mueble / default de obra)
y "Heredar default de la obra" cuando hay override.

- Nuevo: `packages/ui/src/projects/components/optionSelector/MaterialOptionSelectorDialog.tsx` (+css+16 tests). Lista elegible = `optionsForGroup` (curada por optionIds, regla anti-ComboBox del doc canónico). Esc/Enter/doble-click, auto-locate de la rama del material actual, empty states diferenciados, datos honestos (espesor "—", "Sin fabricante").
- Studio: filas de rol + dialog wire-up con `setItemOptionChoice` / `onUpdateProjectLevelChoice` según scope; derivaciones sin useMemo (viven tras un early-return del studio — orden de hooks).
- Grupos hardware/edge y acabado del zócalo mantienen `<select>` (sin swatches/categorías; follow-up).
- Gates F111 respetados: tokens `--z-modal-dialog`, `--surface-overlay`, `--text-inverse`, `--surface-overlay-chrome` (0 literales de color).

**Verificación:** ui 146 archivos/1433 tests + web 24/306 + typecheck 4/4 workspaces. Browser E2E manual en dev server (modo invitado, cotización borrador): colocar mueble → bloques por rol → Catálogo → seleccionar → Aplicar → fila actualizada. Nota: cotización "Aceptado" deshabilita edición (correcto).

## Housekeeping GitHub + #379 + registro milestone #347 (2026-08-26)

**Issues cerrados:** #375–#378 (entradas accidentales de la sesión de docs, con
comentario de motivo), #371–#374 (docs creados y alineados) y #379 (alineación
completada con evidencia).

**#379 (commit 54ec806):** naming normalizado a Granete en
`smart-furniture-engine.md`, `3d-asset-library.md`, `manufacturing-feature-model.md`
y `domain-model.md`; secciones "Canonical references" en cada doc umbrella hacia
los specs autoritativos (`parametric-furniture-library.md`, ADR 0001/0002,
`production-flow-v2.md`, `catalog-option-selector.md`) y referencia inversa desde
el spec; AGENTS.md registra los 4 docs en fuentes canónicas; #347 (Referencias) y
#290 (Autoridades) citan la docs canónica. Verificado: grep sin "Muebleria" en
los 4 docs; Ruby del plugin sin cálculo de BOM/drilling/nesting/kerf/preflight.
`multi-organization-distribution-model.md` queda para el rename #366.

**#347 milestone:** el `minimum authoritative preflight` existía como evidencia
(`progress/implementation_F163.md`, tests 6/6 re-ejecutados hoy en verde; campos de
correlación `inReplyToMessageId`/`idempotencyKey` en `sketchupAuthoringExchange.ts`)
pero nunca se había registrado en el issue. Registrado como comentario en #347 con
la cobertura completa, la prueba negativa y la re-verificación de los fixtures de
#349/#350 (`progress/implementation_F164.md`).

**Siguiente:** implementar el DoD completo de #347 (machine capability checks,
severity/remediation hacia contexto SketchUp, stale post-release, override
auditable server-authoritative) — #348/#351 siguen bloqueadas hasta ese cierre.

## #347 Definition of Done completo — F168 (2026-08-26)

**Qué:** `runManufacturingPreflight` ganó su 4º parámetro opcional
`PreflightPolicyContext {release?, machineProfile?, overrides?}` — contexto
server-side que nunca viaja en el envelope (sin bypass desde SketchUp):

- **Capability negotiation (§10):** `requiredCapabilities` derivadas de la verdad
  resuelta (`granete.drilling` desde agujeros, `granete.panel-geometry` desde
  geometría de catálogo) + `machineNegotiation` que bloquea con
  `MACHINE_CAPABILITY_UNSUPPORTED` ante capability ausente, versión distinta,
  constraint omitido o límite insuficiente. Capabilities nunca se infieren.
- **Stale (§8):** `policy.release` con fingerprint distinto → `REVISION_STALE`
  bloqueante con ambos fingerprints en details.
- **Override auditable:** degrada sólo stale/capability a warning con registro
  who/when/why en `issue.details.override`; colisiones y ambigüedad crítica
  siempre bloquean (test con override forjado en runtime).
- **Error model (§9) completo:** todos los errores llevan code, message,
  entityId, path, severity y remediation (también en validación y machining).
- Tipos §10 (`MachineProfileRef`, `MachineCapability`, `CapabilityNegotiation`)
  en el schema del contrato; §11 del contract doc documenta los policy inputs.
- Ledger: **F163 registrado retroactivamente** (la evidencia existía pero faltaba
  la entrada) + **F168** nuevo.

**Verificación:** preflight 19/19 (6 milestone + 13 DoD), domain 87 files/1106
tests, typecheck 7/7, `go test ./...` ok. Evidence: `progress/implementation_F168.md`.

## #351 discovery + plantilla de dossier (2026-08-26)

Sin dossiers de máquina disponibles (field evidence de #306 pendiente por
parte del taller), #348 y la cadena dependiente quedan bloqueadas. Adelantado
lo permitido por la regla del programa (sólo discovery/planificación):

- `docs/architecture/machine-profiles-and-adapters.md` (#351): diseño de
  MachineProfile/PostprocessorAdapter/evidence packs, registro de capabilities
  canónicas (semilla: `granete.drilling`/`granete.panel-geometry` del preflight
  F168) y flujo export→manifest. Implementación sigue hard-blocked hasta #348.
- `docs/templates/machine-dossier-template.md`: checklist de recolección por
  visita (identidad, software+versión exacta, formatos con sample real,
  capacidades verificadas, readback, sign-off) + reglas de sanitización.
- Issues #351/#348 actualizados con referencias; AGENTS.md registra el doc
  nuevo en fuentes canónicas.

**Siguiente:** cuando lleguen dossiers → #348 (congelar fixture PTX + readback).
Alternativa mientras tanto: work del plugin no bloqueado o carril Proyectar.

## #366 Parte 1 — Rename docs Muebles→Granete (2026-08-26)

Auditoría + plan de 4 partes registrado en
[#366 (comentario)](https://github.com/tiagofur/muebleria/issues/366#issuecomment-5426847636).
Decisiones: scope JS `@muebles/*` se renombra (P3); localStorage con migración
leer-viejo→escribir-nuevo (P2); **ambos app IDs cambian a `com.granete.app`** (no
hay builds distribuidas); Go module path y DB quedan como IDs técnicos.

**Parte 1 (este PR, docs):** renames de archivo `sketchup-muebles-strategy.md` →
`sketchup-granete-strategy.md` y ADR-0001 → `...granete-manufacturing-truth.md`
con stubs redirect en las rutas viejas; referencias actualizadas en 12 docs
(PRODUCT, architecture, prd-v2, adr/0002, roadmap-comercial, contract, etc.);
marca corregida: "Muebleria" ×2 en `multi-organization-distribution-model.md`,
"ECOSISTEMA MUEBLES" → GRANETE en `roadmap_RN.md` (mismo largo, diagrama
alineado), y ejemplo `"client": "muebles-for-sketchup"` del contract corregido a
`"sketchup-extension"` (valor real de `EXTENSION_CLIENT` en
`session_provider.rb`; el backend no valida ese campo).

**No tocado (regla del issue + sustantivo de dominio):** "Muebles" como sección
UI/mueble en copy español, `docs/history/`, `feature_list.json`, `progress/`
previo, URLs del repo `tiagofur/muebleria`. `@muebles/*` en docs queda para la
Parte 3.
