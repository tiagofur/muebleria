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

(a completar por tarea con resultados observados)

## Entrega

Un PR contra main. Completo si toda la aceptación corre; parcial si queda alcance explícito.
