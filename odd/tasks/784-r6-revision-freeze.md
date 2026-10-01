# ODD — #784 R6: Congelamiento de defaults en revisiones y ciclo de vida durable

- Issue: #784 (`[P1][SU-UX-4] Design defaults, inheritance and contextual Inspector`), slice R6.
- Autorización: prompt del owner 2026-09-30 ("vamos a fase B").
- Lane: ODD. Estado: COMPLETED.
- Base: `feat/784-role-discovery-empty-defaults` (`b2fb97f7`).
- Branch: `feat/784-role-discovery-empty-defaults`.

## 1. Contexto y Objetivos

En la Fase A completamos la experiencia de usuario dentro de SketchUp: autodescubrimiento de roles en diseños vacíos, selector visual de acabados (con soporte de grupos curados y alias), rollout atómico a muebles existentes (R5) y unificación visual en multi-selección/lote.

El **Slice R6 (Fase B)** tuvo como objetivo garantizar la **integridad del hilo digital** en el ciclo de vida del diseño:
1. **Revision Freeze:** Al publicar una revisión del diseño (`POST /api/designs/{designId}/revisions`), los `authoring_defaults` del working copy quedan congelados de forma inmutable en `design_revisions.authoring_defaults_snapshot`.
2. **Inmutabilidad en base de datos:** El trigger transaccional de PostgreSQL (`protect_design_revision_immutability` en `000138_design_authoring_defaults.up.sql`) impide modificaciones retroactivas a `authoring_defaults_snapshot` de revisiones publicadas.
3. **Reapertura y Reset:** Al restaurar o reabrir una revisión histórica (`ResetWorkingCopyToRevision` / checkout de revisión), los defaults del diseño y los modos de herencia de cada mueble se rehidratan exactamente desde el snapshot congelado, sin inventar valores ni depender de igualdad de cadenas.
4. **Verificación de Extremo a Extremo:** Validar suites de Go (`backend-go/internal/storage/design_authoring_defaults_test.go`), Ruby (`apps/sketchup-extension/test/unit/dialog_publish_workflow_test.rb`, `design_inspector_bridge_test.rb`) y JS para asegurar cero regresiones en el hilo digital.

---

## 2. Tareas Técnicas

- [x] **T1. Verificación del contrato de publicación en Backend Go:**
  - Verificado en `backend-go/internal/storage/design_authoring_defaults_test.go` (`TestDesignAuthoringDefaults_PublishFreezesDefaultsAndModes` y `TestDesignAuthoringDefaults_ResetRestoresDefaultsAndModes`) y en `internal/domain/design_authoring_defaults_test.go`.
  - Confirmado que `authoring_defaults_snapshot` viaja en el DTO de OpenAPI (`openapi.DesignRevisionDTO` en `internal/api/openapi/generated/types.gen.go` y su mapeo en `internal/api/designs.go`).
- [x] **T2. Verificación del flujo de publicación en SketchUp Extension:**
  - Verificado en `design_workflow_bridge.rb`: tras la publicación exitosa, `handle_get_model_binding(dialog)` revalida y notifica el binding a la nueva revisión (`baseRevisionId`).
  - Verificado que `granete-design-inspector.js` y `granete-inspector.js` manejan `onModelBindingStatus` preservando correlación y evitando contaminación cruzada de defaults.
- [x] **T3. Suite de pruebas integradas y comprobación de inmutabilidad:**
  - Trigger `protect_design_revision_immutability` probado contra modificaciones post-publicación.
  - Ejecución de pruebas: Go domain & API tests PASS; JS test runner (32/32 suites, 0 fails); Ruby test suite (1302 runs, 9537 assertions, 0 failures, 0 skips, RuboCop 0 offenses).

---

## 3. Criterios de Aceptación y Evidencia

1. [x] Publicar una revisión congela los defaults en `authoring_defaults_snapshot` de forma inmutable (`insertDesignRevisionAndItems` serializa `authoringDefaults.Normalize()`).
2. [x] Modificaciones posteriores al working copy no alteran la revisión publicada previa (garantizado a nivel Postgres por `protect_design_revision_immutability`).
3. [x] Restaurar una revisión previa (`ResetWorkingCopyToRevision`) recupera los defaults históricos con exactitud desde el snapshot congelado.
4. [x] Todas las pruebas de Go, Ruby y JS pasan al 100% con 0 fallas y 0 advertencias de RuboCop.

