# ODD 1412 — Autoría de receta de agregado (miembros rígidos, sets de variantes, kit)

Issue: https://github.com/tiagofur/muebleria/issues/1412 (status:approved 2026-10-28, owner
«aprobado, hagamos muy bien porque es parte de la demo que quiero hacer en 2 dias»).
Base: main `accae39b` (incluye #1376 actorMembership mergeado y #1375 superficie de autoría).
Topología: Delegated Direct (multi-file: domain TS+Go, backend api, storage, ui, e2e).
Writer: sesión ZCode 2026-10-28 (única; sin PR/rama previos verificados).

## Outcome observable

El owner autor desde CATÁLOGOS → Agregados la receta de su cajón (miembros anclados
min/max, sets de variantes por fondo, kit comercial, membresía fijo/móvil), guarda
(revisión versionada con readback exacto), y el cajón se ve en la web con las
correderas en su lugar; cambiar el ancho del módulo mueve el miembro anclado a max
sin escalar. Sin tocar código ni seeds.

## Alcance autorizado (de la issue)

1. Editor de Agregados: crear/editar receta generando revisión nueva vía el PUT
   existente (ya acepta receta completa snake_case → `UpdateAgregadoWithRevision`).
   Campos: memberId, role, source fijo/variante, anclaje x/y/z {ref,offsetMm} +
   rotationDeg, bomRole; variantSets + compatibilityRules; commercialKitHardwareId;
   actorMembership (#1376 mergeado — la autoría del campo aterriza aquí: la issue lo
   delega y la issue 1376 cerró sin editor).
2. Validación server-side autoritativa en el PUT (hoy persiste sin validar):
   `ValidateAgregadoAssemblyDefinition` fail-closed → 422 tipado. No duplicar
   autoridad en React (los validadores de @granete/domain SÍ se reusan como UX).
3. Bug implícito bloqueante que la issue exige cerrar: `draftToAgregado` no lleva
   receta → guardar desde el form general escribiría una revisión SIN receta
   (la borraría). El draft pasa a conocer la receta guardada.
4. E2E browser del flujo completo (gate organization).

## Fuera de alcance (no-goals de la issue)

Perforaciones del agregado a CNC (#1413), consumo cinemático del actor en SketchUp
(#1376 ya cerrado con runtime), simulación #1369 (sigue intacta sobre la revisión
guardada), modelado de SKPs individuales izq/der (tarea de datos del owner), OpenAPI
de /catalog/agregados (superficie entera sin documentar hoy — follow-up propio).

## Tareas

1. [x] Dominio TS+Go: validación de formato actorMembership (`` | body | actor:<id> ``)
       en el validador de miembro, tests ambos lados. — a18bf8d5 (74/74 TS; Go engine ok;
       gofmt alineado en archivo tocado).
2. [x] Backend: PUT/POST validan la receta fail-closed (422 `AGREGADO_RECIPE_INVALID`),
       tests API (inválida sin tocar la store, válida y legacy pasan). — 1f1e7b63
       (suite internal/api completa ok 7.7s; identidad desde el path).
3. [x] UI: draft con receta (carga desde saved, save no la pierde), pestaña Receta
       pasa de read-only a autoría editable (miembros, sets + regla 1:1, kit,
       membresía fijo/móvil), validación client-side con validadores de dominio en el
       submit (bloquea + abre Receta). — commit UI (agregados 84/84; typecheck ws ok).
4. [x] Preview 3D del editor refleja la receta del borrador (cae a la guardada sin
       miembros) — agregado3dPreview.ts + 3 tests nuevos (18/18).
5. [x] E2E browser: autoría → save → readback exacto → F5 persiste; bloqueo cliente
       sin PUT; 422 server sin revisión. — tests/organization/agregado-recipe-authoring.spec.ts
       **3 passed, GATE_EXIT=0** (run2 /tmp/gate-1412-run2.log). Corrección de la ronda:
       cancelar con borrador sucio abre «Descartar cambios» — el spec lo confirma.
       Regresión del spec #1369 (aplica recetas por el mismo PUT): EN CURSO.

## Verificación (V0/V1/V2) — evidencia congelada

- V0: typecheck workspace OK · gofmt limpio en archivos tocados (ruido preexistente
  ajeno intocado) · check_openapi_drift OK (sin cambios de contratos generados).
- V1: vitest monorepo completo exit 0 (ui agregados 84/84; domain; storage; web 610)
  · go test ./internal/domain/... ./internal/api/... ok (GO_EXIT=0) ·
  TestH2 actorMembership + TestAgregado_PutValidatesRecipeFailClosed incluidos.
- V2: gate organization browser — agregado-recipe-authoring.spec.ts 3 passed
  (GATE_EXIT=0, PostgreSQL real desechable + Chromium). Regresión
  agregado-recipe-change.spec.ts: 8 passed (la validación del PUT no rompe el
  apply de recetas). Gate visual proyectar-webgl: 12 passed (la ruta del modal
  Agregado preserva la receta guardada). Host SketchUp: NOT_RUN (cero cambios
  de extensión; render de assemblies y membresía ya en main) — verificación
  owner en vivo queda para la demo.
- N/A: foundation-gate-a (sin migraciones), sketchup rake verify (sin RBZ),
  visual proyectar-webgl (ruta del modal Agregado usa la receta GUARDADA,
  comportamiento preservado; si da presupuesto se corre local).

## Entrega

Commits work-unit Conventional; PR `Refs #1412` + `Delivery: partial|complete` según
evidencia congelada; revisor fresco distinto; merge humano. Demo 2026-10-30: tras el
merge, owner necesita (datos, no código) SKPs individuales izq/der de la corredera
subidos como herrajes/variantes — recordarlo en el handoff.
