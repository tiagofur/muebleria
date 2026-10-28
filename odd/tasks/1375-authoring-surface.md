# ODD — #1375 Superficie de autoría por proyecto: SketchUp o Proyectar

Issue: #1375 (`status:approved`, P2, `type:feature`).
Lane: Delegated Direct — este artifact es la memoria de ejecución.
Base: `main fb6b6ca4`. Rama: `feat/1375-authoring-surface`. Writer único.

## Decisión de producto del propietario (2026-10-20)

Cada proyecto declara **UNA superficie de autoría** — `sketchup` o `proyectar` —
y la otra herramienta queda como **visor read-only** del mismo diseño canónico.
El diseño vive en el backend (hilo Quote ↔ Design ↔ Release). La regla elimina
por diseño el problema de co-edición bidireccional entre dos editores 3D.

Default para todo proyecto nuevo: `'sketchup'`.

## Arquitectura y autorizaciones

1. **Persistencia**: Columna `authoring_surface TEXT NOT NULL DEFAULT 'sketchup'`
   en tabla `projects` con constraint `CHECK (authoring_surface IN ('sketchup', 'proyectar'))`.
2. **Server Authority (Fail-Closed)**:
   - Para clientes con token de extensión (`claims.Client == auth.ExtensionClient`):
     - `GetModelBindingContext`: expone `p.authoring_surface`.
     - `modelBindingValidationDTO`: si `authoring_surface == 'proyectar'`,
       `can_edit_working_copy = false` y `can_publish_revision = false`.
     - Endpoints de mutación de diseño (`PUT /api/designs/{id}/working-copy`,
       `POST /api/designs/{id}/working-copy:reset`, `PUT /api/designs/{id}/opening`,
       `POST /api/designs/{id}/publish:prepare`, `POST /api/designs/{id}/revisions`):
       Rechazan con 403 Forbidden si el llamador es SketchUp y la superficie es `proyectar`.
   - Para clientes Web / Proyectar:
     - `ProjectSpatialStudioProps.canEdit` pasa a ser `false` si
       `project.authoringSurface === 'sketchup'`.
     - En modo visor, Proyectar deshabilita inserción, movimiento de muros y
       edición de muebles, mostrando banner explicativo.
3. **SketchUp Extension**:
   - `model_binding.rb` y `granete-model-binding.js`: consumen `can_edit_working_copy`.
     Si es `false`, muestran badge/banner "Modo visor (autoría en Proyectar)" y
     deshabilitan inserción/publicación.
4. **Web UI**:
   - Modal de nuevo proyecto: campo de selección `authoring_surface` (default: SketchUp).
   - Cabecera de proyecto: badge informativo de superficie de autoría.

## Slices de ejecución

- **Slice 1**: Contrato, DB y Modelos (Migración 000169, Go domain/storage/api, TS domain, OpenAPI).
- **Slice 2**: Server authority & Gating fail-closed (Capabilities binding + rechazo 403 en handlers + tests Go PG real).
- **Slice 3**: Cliente SketchUp (Modo visor en HTML/JS/Ruby cuando `can_edit_working_copy == false` + tests).
- **Slice 4**: Web UI & Proyectar (Selector al crear proyecto, badge de superficie, modo visor en Proyectar + browser tests).

## No-Goals

- Co-edición simultánea entre SketchUp y Proyectar (descartada por decisión de producto).
- Migración forzada de proyectos existentes (la migración SQL les asigna default 'sketchup' de forma retrocompatible).
- Fusión geométrica automática entre herramientas.
