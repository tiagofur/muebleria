# Issue #667 — M1: base de recursos 3D versionados (contrato, persistencia, carga segura, binding y pins)

- Estado: `IMPLEMENTED_PENDING_REVIEW`. Base exacta
  `origin/main@ab3bcdb3c1ef8a025ef92a1dc2dd435949f5fa72`; rama
  `feat/667-3d-asset-foundation`. Single writer: GLM. Sin merge ni cierre de issues.

## Resultado implementado

- Migración `000131_hardware_3d_assets` (aditiva, up/down verificados en PG
  real): `hardware_assets`, `hardware_asset_revisions` (inmutables por trigger,
  grants SELECT/INSERT), `hardware_asset_upload_sessions`,
  `hardware_asset_validations` (append-only), `design_revision_hardware_assets`
  (pins, explicitly-shared), binding `hardwares.visual_asset_*` con FKs
  compuestas (misma organización + revisión pertenece al recurso), índices e
  inventario RLS. Fixture fresh (131) + upgrade (130→131) + down probados.
- Dominio: `HardwareAsset*` (identidad, revisión, sesión, evidencia, pin,
  binding), `ValidateHardwareAssetOrigin` (unidades explícitas, ejes, anclaje
  finito/acotado), errores tipados.
- Storage: ciclo de carga (start/receive/finalize idempotente/cancel/sweep
  perezoso de expiradas), `target_asset_id` (nueva revisión sobre recurso
  activo, rev N+1), `RetireHardwareAsset` (idempotente, auditado),
  `ResolveHardwareVisualAssetBinding` (neutral ante desconocido/cross-tenant,
  rechaza retirado y miniaturas), evidencia de validación ligada a digest
  (derivación de estado en lectura — la revisión queda verdaderamente
  inmutable), `freezeDesignRevisionHardwareAssets` dentro de la transacción de
  publicación (ambos caminos: legacy y #392), lecturas con detalles resueltos
  server-side.
- API: endpoints generados (OpenAPI) + multipart fuera del contrato (misma
  convención que media/design artifacts), grants `hwasset/` con pins de
  integridad obligatorios, `GET /api/hardware-assets/files/{key}` con
  re-verificación por lectura, límites configurables
  (`HARDWARE_ASSET_MAX_{SKP,GLB,THUMBNAIL}_BYTES`), inspección real de
  contenido (SKP opaco con `.skp`, GLB exige firma `glTF`, miniatura por sniff),
  binding del herraje validado antes de persistir (el eco del cliente nunca es
  autoridad), rutas con routers de comando y namespaces literales sin
  conflictos de ServeMux.
- Contratos: OpenAPI (+ esquemas `HardwareAsset*`, `:finalize`/`:cancel`/
  `:retire`/`:authorize`) y clientes Go/TS regenerados (`pnpm openapi:check`
  PASS). TS: `HardwareVisualAssetBinding` + mappers con saneo. Sin DTO manual
  paralelo.
- Auditoría durable: `hardware_asset_finalized`, `hardware_asset_retired`,
  pins contabilizados en `design_revision_published`.

## Exclusiones respetadas

Sin UI React (M2), sin Ruby/SketchUp (#668; `FurnitureLayout` y parser Ruby
intactos), sin conversión SKP→GLB ni WebGL (#669), sin Agregado/MERIVOBOX
(#670), sin cinemática (#529), sin PTX/CNC/pricing. El validador simulado vive
sólo en pruebas con `tool='simulated:test-validator'`, sin bypass productivo.

## Pruebas y evidencia (real PostgreSQL, sin mocks para RLS/bytes)

- `internal/storage` (rol app real `granete_app_test`): 8 tests nuevos —
  ciclo feliz + binding roundtrip + catálogo completo; finalize idempotente +
  staging tras finalize rechazado; fail-closed sin bytes (0 filas creadas);
  evidencia de validación (digest equivocado rechazado; derivación
  passed/failed con validador simulado etiquetado); rechazos de referencia
  (desconocida neutral, cross-tenant, retirado, miniatura); RLS/direct-SQL
  bajo app role (0 filas cross-org, FK compuesta niega robo con id conocido,
  INSERT ajeno denegado por RLS, UPDATE/DELETE de revisión por trigger);
  revisión N+1 sobre recurso existente; pins R1 inmutables tras rebind + R2
  (con BOM-neutro: resolve idéntico antes/después del cambio visual);
  migración fresh/upgrade con esquema, inventario, grants e inmutabilidad.
- `internal/api`: guards de rol (403), inspección GLB/miniatura, límite
  configurable (413), finalize fail-closed ante archivo faltante (sin fila),
  authorize+lectura de bytes exactos (grant correcto, mispunteo 404, bearer
  401, tamper→409 ARTIFACT_INTEGRITY_MISMATCH, missing→ARTIFACT_MISSING),
  binding resuelto server-side en PUT de herraje (digest falso del cliente
  reemplazado), E2E real (PG desechable + filesystem real): start→bytes→
  finalize→consult→authorize→readback byte-a-byte, 3/3 PASS.
- Suite completa: `GOFLAGS=-p=1 go test ./...` PASS (detalle al cierre);
  `pnpm openapi:check`, `pnpm typecheck`, `pnpm test` (monorepo) PASS;
  `git diff --check` limpio.

## Pendiente (registrado, no iniciado)

- #667 M2: administración React sobre estos endpoints (formularios, selector,
  estados por cliente 390/768/1280).
- #668: validador SketchUp real (productor de `hardware_asset_validations`),
  descarga/caché/frames en host — el contrato de evidencia ya existe.
- #669: preparación GLB y consumidores web.
- #670: recetas Agregado/variantes/MERIVOBOX.

## Riesgos / notas de revisión

- `GetFullCatalog` a versión histórica 103 ya no es compatible con la lectura
  de herrajes (columnas 000131): el test de rechazo de definiciones inválidas
  por SQL directo ahora aplica hasta 131 (intención intacta: validación
  tipada, no esquema histórico). Justificado en el test.
- Carrera de catálogo PostgreSQL preexistente en 00094 (`tuple concurrently
  updated`) cuando dos paquetes aplican migraciones en paralelo: flaky
  conocido, pasa aislado; no provocada por esta entrega.
- Los bytes siguen el namespace `<MediaDir>/<org>/hardware-assets/...`; el
  sweep perezoso sólo elimina staged de sesiones no finalizadas — los archivos
  de revisiones finalizadas jamás se limpian.

## Plan de ejecución (registrado antes de editar código)

- **Encargo**: prompt del propietario (2026-09-11) — implementar exclusivamente M1 de
  #667. Base exacta `origin/main@ab3bcdb3c1ef8a025ef92a1dc2dd435949f5fa72` (post-PR #664).
  Rama `feat/667-3d-asset-foundation`. Single writer: GLM. Sin merge, cierre de issues,
  labels protegidas ni migraciones contra datos reales.
- **Revisión documental usada**: PR #672 (borrador, NO integrado) — documentos leídos
  desde la rama remota `docs/hardware-3d-assets-plan-2026-09-11`:
  `docs/architecture/hardware-3d-assets-and-assemblies.md` (§§1–10, 15–16, 18, 20),
  `docs/hardware-3d-execution-plan.md` (§§1–10) y `docs/architecture/3d-asset-library.md`.
  No se copian sus archivos a esta rama ni se fusiona el PR.
- **Coordinación**: sin reservas activas que bloqueen; único PR abierto es #672 (docs,
  draft). #573 no tiene asignación vigente sobre esta issue; el permiso viene del prompt
  del propietario. #667 no tiene `status:approved` — el comentario del propietario exige
  esa label para el gate de publicación del PR; si el check falla, se reporta el bloqueo
  exacto sin autoconceder etiquetas.

## Inventario y decisiones de reutilización (qué se reutiliza, qué se amplía)

| Pieza real | Decisión M1 |
|---|---|
| Pipeline de design artifacts (#392/#640): staging → upload streaming con SHA-256 server-side → finalize con verificación en disco → grants firmados con pins de integridad | **Patrón copiado** para los recursos de herrajes (sesiones, claves canónicas, sweep perezoso de expirados) |
| `auth.MediaAuthority` (#460) con clases de recurso `media/` y `designart/` | Se añade la tercera clase `hwasset/` (hardware-assets), con pins de integridad obligatorios como los artefactos de diseño |
| `hardwares` (tenant-owned, RLS 000094) y su CRUD `/api/catalog/hardware` (fuera del contrato generado, convención vigente) | Se amplía con `visual_asset_id`/`visual_asset_revision_id` + FKs compuestas (misma organización + revisión pertenece al recurso). No hay endpoint nuevo de binding |
| `domain.Catalog` + `engine.ResolveFurnitureLayout` (resolve autoritativo único) | Los pins de publicación se derivan resolviendo cada ítem con el MISMO motor; el binding viaja en `domain.Hardware`, no se toca `FurnitureLayout` (contrato Ruby/SketchUp queda para #668) |
| `PublishDesignRevision`/`FinalizeDesignPublish` (#387/#392) | Congelamiento de pins dentro de la misma transacción, tras `insertDesignRevisionAndItems`; fila de auditoría existente extiende detalles |
| `security_audit_events`, receipts de idempotencia (`RequireIdempotency`), migraciones RLS con inventario + fresh/upgrade/direct-SQL | Reutilizados tal cual |

## Contrato y modelo

- Tablas nuevas (migración `000131_hardware_3d_assets`):
  - `hardware_assets` (tenant-owned): identidad, display name, procedencia y licencia
    declaradas, estado `active|retired`.
  - `hardware_asset_revisions` (inmutable): revisión exacta por representación
    (`skp|glb|thumbnail`), `storage_key` canónico, `content_type` inspeccionado,
    `size_bytes`/`sha256` calculados server-side, metadatos de origen validados
    (unidades/ejes/anclaje, finitos), `integrity_verified_at`,
    `validation_state='pending'` (único estado en M1).
  - `hardware_asset_upload_sessions` (staging): iniciar/recibir/finalizar/cancelar;
    expiración perezosa; un archivo temporal jamás es un recurso finalizado.
  - `hardware_asset_validations` (append-only): contrato mínimo para que #668 registre
    evidencia autorizada ligada a revisión+digest+host+resultado. Sin productor HTTP en M1.
  - `design_revision_hardware_assets` (explicitly-shared, inmutable): pins
    `{revisión de diseño, herraje, recurso, revisión de recurso, representación, digest}`
    congelados al publicar.
- Binding del herraje: columnas `visual_asset_id`/`visual_asset_revision_id` con FK
  compuestas — una asociación no puede apuntar a otra organización ni a una revisión de
  otro recurso, ni siquiera por SQL directo. El digest/representación expuestos siempre
  se resuelven del lado del servidor (nunca se confía en el eco del cliente).
- API generada (OpenAPI + clientes Go/TS): sesión de carga
  (`POST /hardware-assets/uploads`, `GET .../uploads/{id}`, `PUT .../bytes` multipart,
  `POST .../uploads/{id}:finalize` idempotente, `.../:cancel`), consulta
  (`GET /hardware-assets`, `GET /hardware-assets/{id}`) y descarga autorizada
  (`POST /hardware-assets/{assetId}/revisions/{revisionId}:authorize`). El stream de
  bytes `GET /api/hardware-assets/files/{key...}` queda fuera del contrato generado,
  igual que `design-artifacts` y `media` (convención vigente).
- `pnpm openapi:generate`; consumidores regenerados; sin DTO manuales paralelos.

## Estados y separación carga/validación (D)

- Bytes recibidos (`size_bytes`/`sha256` verificados en disco al finalizar,
  `integrity_verified_at`) ≠ validación de compatibilidad (`validation_state='pending'`
  en M1; `validated` sólo puede registrarse vía storage command ligado a
  revisión+digest+host+resultado — productor real en #668; los tests que lo usan se
  etiquetan como validador simulado, sin bypass productivo).
- SKP: contenedor binario opaco con sufijo `.skp` (misma convención que el artefacto de
  modelo del publish; sin parser inventado). GLB: verificación de la firma binaria
  `glTF` del propio formato (no implica compatibilidad; la validación completa es #669).
  Miniatura: sniff PNG/JPEG/WebP.

## Exclusiones (sin cambios)

Sin UI React (M2), sin Ruby/SketchUp (#668), sin conversión SKP→GLB ni WebGL (#669),
sin recetas Agregado/MERIVOBOX (#670), sin cinemática (#529), sin PTX/CNC/pricing, sin
cambios en `FurnitureLayout`/contratos Ruby, sin seed comercial en migraciones.

## Pruebas obligatorias (§8 del encargo) → dónde

1–4, 6–9: `backend-go/internal/storage/hardware_assets_test.go` +
`backend-go/internal/api/hardware_assets_api_test.go` (PostgreSQL real, rol app real).
5: comando de validación simulada etiquetado. 10–12: escenarios R1/R2/no-asset/BOM
neutro en la suite de pins. Migración: fixture fresh+upgrade+down + direct-SQL.
Ejecutadas/fallidas/pendientes por capa se registran al cierre; sin claims de
navegador/WebGL/SketchUp (no aplican en M1).
