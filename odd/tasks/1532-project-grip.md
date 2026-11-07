# #1532 — Agarre del proyecto con excepción por mueble y copia congelada; migración de las aperturas existentes

Lane: Delegated Direct (superficie grande: domain + engine + storage + API + migración + OpenAPI + TS).
Writer: esta sesión (worktree `muebles-worktrees/1532-agarre-proyecto`, rama `feat/1532-project-grip`, base `origin/main` 9adacdfc).
Owner decisions (2026-11-06, esta sesión): (1) GET/PUT `/api/designs/{id}/opening` queda como FACHADA hasta #1535;
(2) la API nueva expone el layout A3 completo por frente (filas del stack + descuentos aplicados);
(3) los herrajes BOM de la gola entre frentes ENTRAN en #1532.

## Alcance autorizado (issue #1532)

1. Agarre del proyecto: `gripStyleId` + copia congelada completa (valores del estilo y de los perfiles que usa).
2. Excepción por mueble: otro estilo con su copia congelada; sin excepción hereda el proyecto. El servidor resuelve la herencia.
3. Endpoints generados: leer/cambiar agarre del proyecto; poner/quitar excepción de uno o varios muebles en una operación; «Actualizar a los valores actuales del taller» explícito y auditado.
4. Un cambio en el taller nunca altera un proyecto hasta Actualizar (disponible ≠ válido).
5. Migración de `DesignOpeningSelection` existentes → excepción por mueble con copia congelada; proyecto = estilo predeterminado; reporte adjunto.
6. Retiro: ramas de pines pre-#1263/#1283/#1287; endpoints de apertura de diseño (quedan como fachada hasta #1535, decisión owner); la lista de posición.
7. El motor A3 (#1529) consume la copia congelada efectiva: `OpeningResolvedFront.EdgeGrips` se produce del agarre del proyecto (top, between, overhang).
8. BOM entre frentes (pendiente #1529, confirmado owner): el perfil between de la copia congelada aporta líneas a cotización/liberación.
9. Reporte por frente: layout A3 por mueble (filas del stack) expuesto por la API nueva.

No objetivos: UI web #1533, editor perfiles #1534, Inspector/host SketchUp #1535/#1536 (los consumidores del plugin migran allí), verificación #1537.

## Tareas

- [x] T1 Preflight + artefacto. `PREFLIGHT_OK_NOT_VERIFIED` en el worktree.
- [x] T2 Diseño de datos: migración 000182 `project_grip`:
  - `projects`: +`grip_style_id UUID NULL REFERENCES grip_styles(id)`, +`grip_snapshot JSONB NULL`, +`grip_version BIGINT NOT NULL DEFAULT 0` (token If-Match de TODO write de agarre del proyecto).
  - `furniture_instances`: +`grip_snapshot JSONB NULL` (NULL = hereda el proyecto).
  - `design_working_copies`: +`opening_migration JSONB NULL` (reporte por fila con la selección original para el down fiel).
  - Migración de datos: cada `authoring_defaults->'opening'` → `furniture_instances.grip_snapshot` congelado por instancia del diseño (design_working_items); receta por el tipo del mueble; handle también congela (heredar podría cambiar frentes); proyecto = estilo predeterminado de la org congelado; reporte por diseño con acción, instancia, absent fields y selección original. Sin reescribir `authoring_defaults` (revisiones inmutables).
- [x] T3 Domain `project_grip.go`: `GripSnapshot` (recipes por tipo), `GripSnapshotRecipe` (mode + frozen profiles/overhang), `FrozenGripProfile` (valores completos congelados: descuentos, envelope, body, parts, BOM members+version), `FreezeGripSnapshot` (falla cerrada con `UsageAt`), herencia `EffectiveGripSnapshot`.
- [x] T4 Motor: productor v2 `engine.ProjectGripFronts` (EdgeGrips desde la receta del tipo efectivo; handle → sin frentes), miembros desde perfiles congelados (top), BOM: top corrida como v1 + entre frentes (una corrida por arista between, reglas del perfil congelado), modificadores de cuerpo sobre el stack (notch `front_boundary` y bevel por arista between, efectos top como v1); fail-closed en efecto declarado sin consumidor.
- [x] T5 Storage `project_grip.go`: Get/Set agarre del proyecto (congela del estilo, valida offered + org, bump `grip_version`, auditoría en la misma tx), SetFurnitureGripOverrides (batch set/clear en una tx), RefreshProjectGrip (re-congela del estilo vigente, opción overrides); RLS intacto (columnas en tablas existentes); pruebas fresh+upgrade+carrera+rollback+down fiel.
- [x] T6 Quote/release v2: `deriveDesignOpeningCommercial` y `resolveReleaseOpenings` consumen la copia congelada efectiva (override ?? proyecto) por unidad (tipo del mueble desde su definición); gate de liberación por receta efectiva; BOM between incluido; provenance = copia congelada (nunca catálogo vivo).
- [x] T7 API + OpenAPI: `GET/PUT /api/projects/{projectId}/grip`, `PUT /api/projects/{projectId}/grip/furniture`, `POST /api/projects/{projectId}/grip/refresh` (If-Match `grip_version`, 422 español neutro, auditoría); reporte por frente en el GET; `furnitureInstanceId` opcional en authoring resolve; regenerar OpenAPI (scripts/generate_openapi.py) + drift.
- [x] T8 Fachada `design_opening.go`: GET deriva la selección equivalente del agarre efectivo (primera instancia) y resuelve v1 (plugin intacto); PUT escribe la excepción de las instancias del diseño (batch); If-Match working version preservado; sin audit (igual que hoy).
- [x] T9 Retiro: ramas pre-#1263/#1283/#1287 en Go (productor y fachada derivan pins completos) y espejos TS; grep limpio en el PR; `SetDesignWorkingCopyOpening` retirado (la columna queda como dato muerto).
- [x] T10 E2E navegador: spec con cotización (estilo gola en proyecto + excepción jaladera en un mueble + Actualizar + herencia), valores congelados exactos.
- [x] T11 Verificación: backend-test.sh completo (domain/api/storage con base desechable), pnpm typecheck+test, gate browser UTF-8, migración fresh+upgrade con filas tipo piloto comparando frentes antes/después fila por fila, verify_affected.

## Evidencia

- T1 preflight: `PREFLIGHT_OK_NOT_VERIFIED`, worktree limpio, base origin/main 9adacdfc.
- T3/T4 dominio+motor: go build ./... verde; fixture de paridad openingBodyModifiers actualizado (Go + TS idénticos, 2165 tests TS); tests de dominio del snapshot (freeze completo, uso vigente, herencia, tipo descubierto, shape) en verde.
- T2 migración 000182: aplicada limpia en la cadena completa (fresh y upgrade en contenedor desechable, 00182 en el log del suite); corrección de ambigüedad project_id en los helpers (SQLSTATE 42702) captada por TestMultiOrg_*.
- T5/T6/T7/T8: go vet + go test ./... (sin DB) verde en domain/api/storage tras reescribir los tests de fachada y resolve de autoría a la semántica v2 (680 = 720−40 bajo A3).
- OpenAPI: python3 scripts/generate_openapi.py + check_openapi_drift.py → «OpenAPI generated files are current; operation drift negative proofs passed».
- pnpm typecheck + pnpm test: exit 0 (8 paquetes, 2165+ tests).
- Grep de retiro: sin ramas de era de pines en código de producción (SetDesignWorkingCopyOpening pendiente de borrar al cerrar el agente de tests de storage).
- Reescritura de tests de storage v2 (quote/release/requote + helpers compartidos golaStyleForAllTypes/applyGripStyle/seedVerifiedGolaProfile): completa. Dos hallazgos corregidos: (a) fixture de release sin estructura de laterales → interior 0 → OPENING_BOM_INVALID (sembrados lateral+estructura como el v1); (b) bug real: resolveReleaseOpenings resolvía BOM para recetas bottom_overhang sin perfiles → ahora fronts-only (skip del BOM cuando Mode != gola). Segundo publish necesitaba BaseRevisionID.
- Retiro: SetDesignWorkingCopyOpening + comando + interface + stub + captura eliminados (grep limpio); openingMembersFromPin wrapper, OpeningMembersFromFrozenPin, openingEdgeGripsFromV1Front, shrinkOpeningBomParts, bomFrontsStacked, layoutFrontsStacked, OpeningReasonBOMPinSliceMissing retirados; registros de códigos (yaml schema, TS AUTHORING_RESOLVE_ISSUE_CODES, Ruby ISSUE_CODES, JS mensajes) actualizados con FURNITURE_INSTANCE_UNKNOWN/GRIP_SNAPSHOT_INVALID y sin el código retirado. EXTENSION_VERSION 0.1.105 → 0.1.106 (gate #1251).
- Tests del motor convertidos a EdgeGrips con aritmética A3 recomputada (constrain 650, overhang 738@−20, side-by-side comparten fila 680, single-row 688, release wiring 680 estable); casos v1 puros retirados con nota.
- Suite backend completa: bash scripts/backend-test.sh ./... → exit 0 (14 paquetes; storage 622 s con base desechable). Re-verificación post-default (quote/release/migración/carrera) → exit 0.
- Migración fresh+upgrade+down+re-aplicación en contenedor desechable; TestProjectGripMigrationFrontsBeforeAfter compara los frentes resueltos antes (v1, 680) y después (v2 A3, 680) fila por fila, el reporte lleva la selección original (comparación semántica; jsonb reordena claves) y el down restaura sin columnas residuales.
- E2E navegador: scripts/organization-browser-gate.sh tests/organization/project-grip-quote.spec.ts → [organization-gate] PASS exit 0 (herencia, excepción, If-Match vencido = 412, fachada 680, cotización congelada con procedencia de la copia, taller 40→60 sin mutar el proyecto, Actualizar → 660, limpieza de la excepción). Hallazgos del E2E corregidos: DEFAULT grip_version 1 (v0 no es ETag fuerte), vocabulario camelCase del cliente, puerta en la estructura para que el stack tenga fila, fachada antes de la excepción.
- pnpm typecheck + pnpm test → exit 0. OpenAPI drift → current. Extension version gate → PASS 0.1.105 → 0.1.106. factory contract tests → OK. verify_affected --plan → typescript/backend-go/sketchup-extension/proyectar-visual/foundation-postgres/organization-browser (boundary compartido).
- Review bundle: base d3599ebba41d, head a8de551ddbada1, scope 04e31675…, judgment-day dual requerido (true).
- SketchUp rake verify: NOT_RUN local (bundler Homebrew roto, conocido); lo cubre CI. SketchUp vivo: fuera de alcance (#1535).

## Entrega

Un PR contra main. Completo si toda la aceptación corre; parcial si queda alcance explícito.

## Judgment Day (ronda 1, 2026-11-07)

- Dos jueces ciegos sobre f3f4c2c1..a3e9d050: 1 confirmado (C1, MAJOR: la fachada GET inventaba doorReductionMm 0 y resolvía sin el gate de forma), 5 MAJOR suspects (S1 If-Match del cliente generado, S2 Actualizar vs offered §14.8, S3 gates de modificadores, S4 pruebas between, S5 nullability 3.1) y 12 MINOR suspects (S6–S17). Ledger: /tmp/1532-review/ledger-round1.md.
- Alcance aprobado por el owner: C1 + S1/S2/S5 + S4. Delta r1 a3e9d050..8476912c; re-juzgado r1: A limpio, B con 1 MAJOR (falta regresión de C1) + 2 MINOR.
- Ronda 2 (a6a09390): regresión de las tres ramas bloqueadas de C1, motivo honesto (GRIP_SNAPSHOT_INVALID) y contratos de los helpers de aristas; residual multi-fila declarado info.
- Re-juzgado r2: A y B limpios (0 hallazgos cada uno; B confirma sin debilitamiento de pruebas ni defectos causados por el fix; CI 22/22 en a6a09390).
- JUDGMENT: APPROVED ✅ (ronda 2). Quedan como info para issues futuras: S3 (gates de dedupe/conflicto/placement en ResolveProjectGripModifiers), S10 (cajón web en contexto revisión), S12–S17.
