# Implementation #501 / WEB-DT-2 — Designs, immutable revisions and 3D artifact history

- Fecha: 2026-09-05
- Rama: `feat/501-web-dt2-designs-revisions-artifacts` (base `main@3a8f12aa`)
- Tracker: #396 (#384). Coordinado con #387 (Design/DesignRevision), #392 (manifiesto y artefactos) y #500 (Project Furniture).
- Scope boundaries: #499 SketchUp handoff diferido explícitamente (`#499 Web↔SketchUp handoff: DEFERRED`).

## 1. Alcance y Arquitectura de la Solución

Segunda superficie visible del Digital Thread en React (`/quotes/:id/disenos`):
1. **Alternativas de diseño**:
   - Selector visual de alternativas con pestañas (`WorkspaceTabs` de `@granete/ui/common`).
   - Estado de cada alternativa (`draft`, `in_review`, `approved`, `archived`) y tipo de fuente (`manual`, `sketchup`, `proyectar_3d`, `import`).
   - Modal de creación de nuevo diseño mediante la API generada (`createProjectDesign`).
2. **Línea de tiempo inmutable ($R1 \to R2 \to R3$)**:
   - Visualización ordenada de linaje histórico con insignias de estado: `Borrador`, `Publicada`, `Reemplazada (Histórica)`, `Aprobada`, `Rechazada`, `Archivada`.
   - Información de publicación auditable: timestamp exacto, autor/publicador, referencia a `ProductionRelease` activo cuando aplica.
   - Pinned snapshot guarantee: seleccionar una revisión anterior (ej. R1) mantiene todos los datos (ítems físicos, definiciones, parámetros, materiales, artefactos y visor 3D) pineados al snapshot inmutable de R1, sin mutaciones silenciosas ni defaults automáticos a la última revisión.
3. **Inspección de snapshot de revisión**:
   - Tabla de unidades físicas contenidas en la revisión (`FurnitureInstances`), definiciones de catálogo, parámetros aplicados y materiales asignados.
   - Zero-edit guarantee: las revisiones publicadas son de sólo lectura estricta.
4. **Artefactos 3D e Integridad**:
   - Tabla de artefactos asociados a la revisión (`.skp`, `.json`, `.png`), indicando tipo, tamaño formateado y digest SHA-256 (`sha256-...`).
   - Autorización segura: descarga y visualización mediante grants firmados de corta duración (`POST /api/designs/{designId}/revisions/{revisionId}/artifacts/{kind}:authorize` → `GET /api/design-artifacts/...?...&grant=...`), sin exponer el JWT de sesión en query strings ni cabeceras inseguras.
   - El browser jamás parsea archivos `.skp` para derivar verdades geométricas o semánticas.
5. **Diferimiento de #499**:
   - Cero URIs personalizadas (`sketchup://`), cero deep links de emparejamiento, cero tokens de sesión en query strings.
   - `#499 Web↔SketchUp handoff: DEFERRED`.

## 2. Componentes Creados y Modificados

### Modelos Puros y Utilidades
- `packages/ui/src/digitalThread/designHistory.ts`:
  - `buildDesignLineage`: construcción de grafos lineales $R1 \to R2 \to R3$ con asignación de releases y cálculo de estado histórico (`replaced_historical`).
  - `selectDesignRevision`: resolución de revisión pineada con fallback seguro e inmutable.
  - `getArtifactAvailability`: mapeo de artefactos requeridos y opcionales (`model_skp`, `manifest_json`, `preview_png`).
  - `formatArtifactSize`, `formatSha256Digest`: formateadores puros.
- `packages/ui/src/digitalThread/designHistory.test.ts`:
  - 14 tests unitarios de linaje, ordenamiento, selección exacta, integridad y formateo.

### Interfaz de Usuario y Workspace React
- `packages/ui/src/digitalThread/ProjectDesignsScreen.tsx`:
  - Pantalla principal de Diseños y Revisiones.
  - Alternativas con `WorkspaceTabs`, resumen de Working Copy, línea de tiempo inmutable, vista previa 3D autorizada, tabla de artefactos con SHA-256 y descarga por grants, drawer colapsable de auditoría técnica.
  - Empty states honestos (0 diseños, 0 revisiones publicadas).
- `packages/ui/src/digitalThread/ProjectDesignsScreen.test.tsx`:
  - 9 tests de integración y negative proofs:
    - Render de alternativas y metadatos.
    - Linaje $R1 \to R2 \to R3$ con insignias de estado.
    - Pinned context en R1 (datos de R1 jamás reemplazados por R4).
    - Preview 3D autorizado con grant temporal firmado.
    - Descarga de artefactos vía grant firmado sin JWT en query strings.
    - Proof negativo de ausencia de #499 custom URI / deep links.
    - Estados vacíos honestos para 0 diseños y 0 revisiones.
    - Navegación bidireccional a la matriz de muebles (`onOpenFurnitureMatrix`).
- `packages/ui/src/digitalThread/digitalThread.css`:
  - Estilos utilizando exclusivamente tokens del sistema de diseño (`--surface-`, `--text-`, `--border-`, `--brand-`, `--danger`, etc.).

### Ruteo y Shell
- `apps/web/src/routes.ts` y `apps/web/src/routes.test.ts`:
  - Rutas `/quotes/:id/disenos`, helpers `projectDesignsPath` y `projectDesignsFromPath` con parámetros de búsqueda `?design=&rev=`.
  - 5 tests dedicados de ruteo y estabilidad round-trip.
- `apps/web/src/ShellView.tsx`:
  - Integración de `ProjectDesignsScreen` con sesión autenticada, scope de organización y navegación cruzada.
- `packages/ui/src/projects/components/ProjectDetailView.tsx` y `ProjectsScreen.tsx`:
  - Enlace al espacio de trabajo "Diseños 3D y revisiones" bajo el menú "Hilo digital".
- `packages/ui/src/digitalThread/ProjectFurnitureScreen.tsx`:
  - Enlace directo a "Diseños y revisiones" en la barra de acciones secundarias.

## 3. Evidencia de Verificación

- `pnpm typecheck`: GREEN (0 errores en los 7 proyectos del monorepo).
- `pnpm --filter @granete/ui test`: GREEN (156 archivos de test, 1552 tests aprobados).
- `pnpm --filter @granete/web test`: GREEN (33 archivos de test, 419 tests aprobados).
- `pnpm openapi:check`: GREEN (sin derivas en los contratos OpenAPI generados).
