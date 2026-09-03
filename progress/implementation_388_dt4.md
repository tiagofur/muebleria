# Implementación #388 — DT-4: Bind SketchUp models to Project/Design identity

- **Fecha:** 2026-09-03 (America/Mexico_City)
- **Feature:** F207 · ledger `feature_list.json`
- **Autoridad:** `docs/architecture/project-design-digital-thread.md` §§11–13, 18, 26, 28, 30–31 · ADR-0003 · `docs/architecture/sketchup-interaction-model.md` · `apps/sketchup-extension/AGENTS.md`
- **Estado:** COMPLETE (pending review/merge)
- **Base:** `main` (#385 DT-1, #386 DT-2 y #387 DT-3 completados: migration 000113, Design, DesignWorkingCopy, DesignRevision, DesignRevisionItem).

---

## 1. Qué se implementó

El primer slice real del vertical **Web/Backend ↔ SketchUp**: un modelo SketchUp puede conectarse a un Project/Design exacto con validación autoritativa del backend, sin que el `.skp`, su path ni ningún ID técnico de SketchUp se conviertan en identidad de negocio. Es el prerequisite duro de #389 (place existing), #390 (catalog insertion) y del runtime de #499 (pairing handoff).

### Backend — validación autoritativa (`POST binding:validate`)

1. **OpenAPI generado (#496):** nuevo path `/projects/{projectId}/designs/{designId}/binding:validate` + schemas `ValidateModelBindingRequest`, `ModelBindingValidation` (`state`, `schema_version`, summaries de organization/project/design, `working_copy` con base autoritativa + número, `capabilities`). Tipos Go/TS regenerados, `pnpm openapi:check` sin drift.
2. **Storage `GetModelBindingContext`:** resuelve project (nombre + org dueña vía JOIN), design con match exacto `designs.project_id = path`, base del working copy y número de revisión autoritativo. Un base revision provista por el cliente debe existir y pertenecer al mismo design. RLS hace que missing/cross-org lean como `ErrDesignNotFound` (404 uniforme).
3. **Handler `HandleProjectDesignBindingValidate`:** stateless, `noStoreMiddleware`, permission `RoleCanAccessProjects`; estados servidor `valid | design_archived`; capabilities derivadas de los mismos gates que working-copy PUT y publish POST (archived ⇒ ambas false).
4. **Boundary del credential de extensión (#460 SEC-6):** grants exactos y citando #388 — POST pattern `^/api/projects/[^/]+/designs/[^/]+/binding:validate$` (stateless, sin business records), GET exacto `/api/projects` y GET pattern `^/api/projects/[^/]+/designs$` para el picker. `TestExtensionTokenDenyByDefault` actualizado con positive/negative proofs: el resto de la superficie de proyectos (furniture-instances, loading-status, working-copy, POST /projects, DELETE…) sigue 403.

### Plugin SketchUp — `Connection::ModelBinding`

1. **`Store`:** envelope JSON versionado `granete.project-binding.v1` en dictionary `com.granete.project` (`projectId`/`designId`/`baseRevisionId`/`schemaVersion`). Write en una operación undoable standalone (regla Metadata::Store de no anidar). Corrupt metadata ⇒ `read` nil + `last_error` (estado `invalid`, nunca un binding adivinado).
2. **`Contract`:** parser fail-closed espejo del DTO generado — shapes desconocidas, states/status inválidos, ids no-UUID y capabilities no-boolean raisan `ArgumentError`.
3. **`Service`:** cliente HTTP del surface (validate + listas projects/designs); errores tipados por clase (`unauthenticated`/`unauthorized`/`not_found`/`bad_response`/`unreachable`), nunca parsing de mensajes.
4. **`State`:** máquina canónica — `unbound | connected | stale_base | design_archived | invalid | incompatible | unauthenticated | unauthorized | unreachable`. `stale_base` sólo se deriva contra respuesta autoritativa; binding guardado sin respuesta ⇒ `invalid` (nunca "connected" ni "unbound" por default).
5. **`Connector`:** única writer de metadata de binding —
   - bind valida primero y escribe el base **autoritativo** devuelto (nunca input del usuario como identidad);
   - `rebind_required` explícito: conservar binding anterior hasta confirmación + validación del target;
   - `incompatible` fail-loud cuando `schema_version` del servidor > soportado;
   - `adopt_authoritative_base` = remediación explícita de drift (revalida antes de escribir);
   - retry del mismo target ⇒ mismo binding (idempotente, sin duplicados).
6. **Dialog:** card "Modelo / Diseño" en la pestaña Sesión — badge/copy por estado (español), contexto exacto (taller/proyecto/diseño/base), picker proyecto→diseño desde listas autoritativas, revisión de rebind (actual vs target) y acciones Validar/Actualizar base. Bridge `ModelBindingBridge` con 6 callbacks; el status se re-push al cambiar de documento activo.

### Contrato compartido

`contracts/sketchupModelBinding.contract.json` — golden generado desde las respuestas HTTP del handler Go (`UPDATE_MODEL_BINDING_GOLDEN=1`), con scenarios: first-bind valid, bound-base validated, design_archived, foreign-design uniform 404 y no-published-revision. Ruby lo parsea fail-closed y pinea la regla: **non-200 nunca escribe binding metadata**.

## 2. Invariantes (I1–I14) tocadas y cómo se verifican

- **I1/I2 (Project owns identity; una unidad = una identidad):** el binding no crea identidad; referencia `projectId`/`designId`/`baseRevisionId` existentes. Verificado por storage test (match exacto project) y connector tests (nunca escribe sin validación).
- **I7 (identity ≠ SketchUp technical identity):** el envelope vive en un dictionary Granete-owned; filename/path/`model.guid`/`persistent_id` jamás entran (TestUp: rename/copy conserva binding; unit test del shape del envelope).
- **I12 (published revisions immutable):** el endpoint es read-only; nothing writes revisions.
- **§12 (binding contract):** implementación exacta del dictionary `com.granete.project` con `schemaVersion`.

## 3. Pruebas

- **Go storage (PostgreSQL real + app role + RLS):** `TestDesigns_ModelBindingContext` — contexto válido con base R1 tras publish, base del cliente matching válida, base ajeno al design ⇒ `ErrDesignRevisionNotFound`, cross-project ⇒ 404 uniforme, cross-org (proyecto privado A leído por B) ⇒ 404, archived conserva contexto + status.
- **Go API:** 8 casos handler (valid/archived/roles/404s/403/400×5/405) + boundary actualizado del extension token.
- **Ruby unit:** 19 runs — store roundtrip/corrupt/undo, service typed errors, contract fail-closed, state machine completa, connector (bind tras validación, idempotencia, preservación en fallo, rebind explícito, incompatible, stale + adopt, targets no-UUID sin request).
- **JS harness (Node):** 9 casos — render por estado, picker flow completo, rebind review, fallo nunca viste success.
- **TestUp real-host:** `TC_ModelBindingSmoke` — roundtrip + save/close/reopen + copia renombrada conserva binding + corrupt ⇒ invalid (corre contra el RBZ instalado).

## 4. Ejecución diferida (no implementada aquí)

#389 placement/panel · #390 inserción conectada · #391 duplicados · #392 publish/artifacts · #393 reconciliation · #394 requote · #397 adopción SKP existente · #499 pairing grant/deep-link (este slice reusa sólo la device credential SEC-6 existente) · hardware/Blum · machining · DXF · ProductionRelease.

## 5. Verificación

```bash
go test ./internal/api/ ./internal/storage/   # verde (PostgreSQL 5445 real)
pnpm openapi:generate && pnpm openapi:check   # sin drift
cd apps/sketchup-extension && bundle exec rake verify  # syntax+rubocop+unit+boundary+RBZ
pnpm typecheck && pnpm test                   # web/TS verde
git diff --check                              # limpio
```
