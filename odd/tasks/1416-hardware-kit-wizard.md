# ODD 1416 — Asistente «Juego de herraje»

Issue: https://github.com/tiagofur/muebleria/issues/1416 (status:approved 2026-10-29,
owner «empezamos en el orden, hagamos fase 1 review, PR, fase 2 review PR… dejar los
PRs rodando sus actions y corregimos si necesario al final de todo»).
Base: main `cca711ae`. Cadena: #1416 → #1417 → #1418 (PRs apilados).
Topología: Delegated Direct (multi-capa: domain, storage, store, ui, e2e).
Writer: sesión ZCode 2026-10-29 (única; sin PR/rama previos).

## Outcome observable

Desde CATÁLOGOS → Herrajes, el owner abre «Juego de herraje», completa UNA pantalla
(código, nombre, precio del juego, dims opcionales, offsets opcionales, SKPs
opcionales) y obtiene: kit comercial (1 juego, cotiza), 4 herrajes de diseño (no
cotizan, con SKP si se subió) y un agregado cajón con receta de 4 miembros
(fijo/móvil × izq/der, anclajes min/max, `actorMembership` body/actor:drawer,
kit incluido) + cinemática translate — sin hardwareLines bulk. Re-ejecutar sobre
códigos existentes reutiliza y no duplica.

## Decisiones de diseño (fijadas al arrancar)

- Plan PURO en `@granete/domain` (`hardwareKit.ts`): qué se crea vs reutiliza,
  códigos (`<CODE>`, `<CODE>-FIJ-I/D`, `<CODE>-MOV-I/D`), anclajes, membresías,
  agregado `<agregadoCode || CODE-CAJON>`, motion translate. Colisión de código
  de AGREGADO = bloqueado (fail-closed); colisión de herraje = reutilizar.
- Subida de SKP: helper `uploadHardwareAssetBinding` en `@granete/storage`
  (start→bytes→finalize→getSession→getAsset→binding, idempotency keys por intento).
  La UI lo ejecuta (el `assetService` vive en ShellView) y pasa BINDINGS al store.
- Store: acción `createHardwareKit` (apps/web/src/stores/catalog/hardwareKit.ts)
  recalcula el plan contra el estado real (no confía en el plan de la UI), genera
  ids con `ctx.newId()` y hace UN solo `saveAndToast` que agrega herrajes +
  agregado (estado y persistencia coherentes; POST lleva id de cliente).
- UI: modal `HardwareKitWizardModal` en packages/ui; botón SECUNDARIO en
  HardwareCatalog (K5: una primary action — «Nuevo herraje» sigue siendo la única
  primaria). Sin cancelación en vuelo (botones deshabilitados mientras corre).
- Sin cambios de contrato OpenAPI, sin migraciones, sin backend: orquesta
  superficies existentes (POST hardware con id, POST agregados con receta validada).

## Tareas

1. [x] domain: hardwareKit.ts (tipos + planHardwareKit) + tests. — ec108030 (11/11).
2. [x] storage: uploadHardwareAssetBinding + tests (servicio scriptado). — 573192bd (5/5).
3. [x] fix storage-go: CreateAgregado persiste la receta del POST como revisión 1
       (bug raíz preexistente: el POST la VALIDABA desde #1412 y la descartaba;
       el agregado nacía ciego). POSTs legacy sin receta byte-idénticos. — 25fca5bf.
4. [x] store: createHardwareKit (re-deriva el plan contra estado real; ids decididos
       UNA vez por código — un `?? newId()` inline dejó referencias colgantes en la
       ronda 1 del gate) + wiring catalogStore/AppContent/ShellView.
5. [x] ui: HardwareKitWizardModal (preview en vivo, badges de reutilización, bloqueo
       fail-closed por código de cajón, resumen creado/reutilizado) + botón secundario
       en PageHeader y acción secundaria en EmptyState (primer-run del taller) +
       6 tests jsdom.
6. [x] e2e: tests/organization/hardware-kit-wizard.spec.ts (sin SKP: no hay fixture
       válida; el camino con archivo lo cubren los tests del helper con servicio falso).

## Verificación (V0/V1/V2) — evidencia congelada

- V0: typecheck workspace 0 errores · gofmt limpio en tocados · sin drift de
  contratos generados (sin cambios OpenAPI) · sin migraciones.
- V1: vitest domain 85/85 (incl. hardwareKit 11) · storage 5/5 · ui hardware
  66/66 (wizard 6 + regresión HardwareCatalog 16) · go storage TestAgregado* OK
  (receta persistida al nacer + legacy sin revisión) · go api TestAgregado* OK.
- V2: gate organization browser (PG desechable + Chromium):
  hardware-kit-wizard.spec.ts **1 passed** (una pantalla → kit+4 diseños+cajón con
  receta exacta por readback API → re-ejecución marca reutilización y bloquea el
  cajón) · regresión agregado-recipe-authoring.spec.ts **3 passed** (el PUT y la
  cadena de revisión no se rompieron con el fix de create).
- Rondas del gate: 3 correcciones (espera de heading ambigua → botón; estado
  truly-empty sin asistente → EmptyState secundaria; ids por llamada → mapa único).
  Host SketchUp: N/A (sin cambios de extensión).

## Entrega

`Refs #1416` + `Delivery:` según evidencia. size:exception esperado (unidad
cohesiva multi-capa >400 líneas; el owner pidió cadena rápida con corrección
consolidada al final).
