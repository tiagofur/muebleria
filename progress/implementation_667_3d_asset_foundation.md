# Issue #667 — M1: base de recursos 3D versionados (contrato, persistencia, carga segura, binding y pins)

- Estado: `IMPLEMENTED_PENDING_REVIEW` + **ronda de corrección R1–R5** (revisión del
  propietario sobre HEAD `c97b85c4`, base `dee5e7a8`). Base de la corrección:
  `origin/main@a453cd00` (merge de #673) + merge `721a74ca`; worktree dedicado
  `muebles-667-wt` (el compartido se devolvió a `main`; sin repetir el incidente).
  Sin merge, cierre, labels protegidas ni re-ejecución del gate de publicación.

## Cierre residual R5 (2026-09-12, segunda revisión sobre `2e9641a3`)

Hallazgo: la limpieza de la clave reemplazada en `HandleHardwareAssetUploadBytes`
corría DENTRO de la transacción de `AuthMiddleware` — que el UPDATE hubiera
funcionado no implica commit; un fallo al confirmar dejaba la fila staged
referenciando bytes ya borrados. El mismo patrón afectaba a cancelación y al
sweep perezoso de expiración de la familia.

Corrección (mecanismo mínimo, sin nuevo servicio de GC ni cambios al middleware):

- `storage.OnCommit(ctx, fn)`: registro de callbacks que `WithinTenantTx`
  ejecuta SÓLO tras un COMMIT ganador; en rollback el registro muere con el
  scope; fuera de todo scope el registro es no-op (retención conservadora,
  nunca limpieza prematura).
- `storage.CollectHardwareAssetStagedFile`: decide bajo `FOR UPDATE` de la
  sesión si la clave sigue necesaria (staged de una sesión PREPARED, o
  referenciada por cualquier revisión inmutable) y ejecuta el unlink CON el
  lock retenido — un re-staging concurrente de la misma clave
  content-addressed jamás observa un archivo faltante. Si el unlink falla, la
  transacción de decisión hace rollback (el archivo queda para reintento).
- Los tres sitios (re-upload con clave reemplazada, cancelación, sweep de
  expiración) registran la recolección como hook post-commit; los huérfanos
  (IO fallido o sin scope de commit) quedan identificados por log con su
  storage_key para una futura pasada de limpieza documentada.

Pruebas RED→GREEN (router real + PG desechable + filesystem real; fallo de
commit inyectado con trigger de constraint DIFERIDO local al fixture, sin
matar conexiones ni reiniciar el clúster):

- Re-upload B sobre A staged con fallo al confirmar → 500; RED: archivo A
  borrado con la fila aún en A; GREEN: A preservado byte a byte; tras retirar
  el trigger, el re-upload B tiene éxito y A se recolecta post-commit.
- Cancelación con fallo al confirmar → 500; RED: bytes perdidos con sesión
  preparada; GREEN: sesión sigue prepared con sus bytes; cancelación exitosa
  posterior recolecta post-commit.
- Dos re-uploads concurrentes con barreras (ambos estancados mid-body tras
  pasar el gate, luego liberados): ambos 200; la clave elegida final existe
  con su contenido exacto (sha mapeado a contenido) y la clave reemplazada A
  se recolecta; nunca se destruyen los bytes de la elección vigente.
- Las regresiones de upload tardío idéntico/distinto frente a finalize y la
  numeración concurrente sobre el mismo asset se conservan sin cambios.

Verificación: `internal/api` completa ok (50.2s), `internal/storage` completa
ok (986s, secuencial, 0 fallos/0 skips), `go vet ./...` limpio, `git diff
--check` limpio, `pnpm openapi:check` PASS (contrato sin cambios).

## Plan de corrección R1–R5 (registrado antes de editar código)

- **R1 — forma canónica única**: la forma canónica es la del contrato generado
  (`/hardware-assets/{assetId}`, `:retire`, `/revisions/{revisionId}:authorize`),
  ya documentada en OpenAPI/cliente TS. El router se alinea: se elimina el segmento
  `/asset/`; un único `POST /api/hardware-assets/{assetCommand...}` despacha
  `{assetId}:retire` y `{assetId}/revisions/{revisionId}:authorize` (patrón
  `{sessionCommand...}` de design publish; `uploads/{cmd...}` es subconjunto
  estricto → sin conflicto ServeMux). `finalize` y `retire` quedan envueltos en
  `RequireIdempotency` por-handler (el cliente generado declara claves para ambos;
  `cancel` no declara clave y queda sin wrapper). Prueba: walkthrough por
  `RegisterRoutes` + PostgreSQL desechable + JWT real, usando las URLs EXACTAS del
  cliente generado, incluyendo bytes; matriz de idempotencia (clave ausente 400,
  replay, reúso incompatible 409).
- **R2 — listado con revisiones**: `ListHardwareAssets` indexa por posición del
  slice (no punteros a copias desconectadas); listado y detalle exponen ids,
  números, digests, representación y estado de validación idénticos. Prueba con 2
  recursos y 2 revisiones, por storage y por API.
- **R3 — representación autoritativa de la sesión**: `HandleHardwareAssetUploadBytes`
  exige igualdad entre el segmento de URL y `session.Representation` ANTES de
  inspeccionar/limitar/escribir; defensa adicional en la frontera de storage
  (coherencia representación↔content-type al finalizar). Estado anterior
  conservado ante error. Pruebas cruzadas SKP/GLB/thumbnail + re-upload válido.
- **R4 — pins semánticos**: el conjunto de referencias se obtiene del contexto
  semántico exacto (overrides de placements de componentes de structure/module/
  agregados + hardware_lines del módulo y del agregado), NO de `layout.Hardware`
  (filtrado por previewShape). Contrato de errores: defID vacío o módulo
  inexistente → ausencia legítima (precedente legacy de #639); composición rota
  (estructura/agregado referenciado y ausente, JSON inválido) → error tipado, nunca
  `continue` silencioso. INSERT del pin en una sola sentencia (JOIN hardwares×
  revisions) → digest/representación siempre coherentes con la revisión insertada.
  Serialización por asset y pruebas de rebind/publicación concurrente. La selección
  alternativa por ítem no existe en el contrato M1 (documentado).
- **R5 — ownership de carga y serialización**: la compensación de upload NUNCA
  elimina el archivo cuando el record falla (puede ser el blob de la revisión
  finalizada; sólo se borran claves reemplazadas con el row ya confirmado o staged
  de sesiones canceladas por su propio camino). `FinalizeHardwareAssetUpload` toma
  `FOR UPDATE` la fila del asset objetivo → serializa numeración `MAX+1` y coordina
  retiro concurrente; violación única de numeración → conflicto tipado con reintento
  seguro. Pruebas con barreras reales (blocking reader), dos sesiones sobre el mismo
  asset y retiro vs nueva revisión.

## Resultado de la corrección (evidencia RED/GREEN real)

RED ejecutado sobre HEAD `721a74ca` (antes de tocar producto), PostgreSQL real:

- R1: `TestHardwareAssets_RouterCanonicalClientWalkthrough` → `detail (client URL) = 404`
  (el cliente generado no puede alcanzar las rutas `/asset/…` del router).
- R1-idempotencia: `finalize without key = 201 … (want 400)` (el contrato declarado
  no estaba conectado al mecanismo real).
- R3: `cross-representation upload = 200 …content_type":"image/png"… (want 400)`
  (PNG aceptado en sesión SKP; en el HEAD revisado esa combinación produce una
  revisión etiquetada SKP con bytes de imagen).
- R2: `list 'Recurso uno' revisions = … Revisions:[]` (el listado devuelve copias
  sin revisiones; el detalle sí).
- R4: `R1 debe congelar el pin del herraje …a3 (contexto semántico, no preview): pins=[a1]`
  (herraje con recurso SKP y sin previewShape pierde su pin);
  `la publicación con composición rota debe fallar (nunca pins silenciosamente ausentes)`
  (agregado referenciado inexistente → publicación seguía sin error y sin pins).
- R5: `racing upload destroyed the finalized blob: … skp-8fa192a8a29e.skp: no such
  file or directory` — interleave real con barreras (upload en vuelo mientras
  finalize confirma; la compensación del tardío borra el blob de la revisión
  finalizada); `detail = 404` tras dos finalizaciones sobre el mismo asset
  (numeración `MAX+1` sin serializar por asset).

GREEN (tras las correcciones, mismos tests):

- `internal/api` completa: **ok** (incluye 6 tests de router sobre `RegisterRoutes`
  + PostgreSQL desechable + JWT/sesión/membership reales: walkthrough por las URLs
  exactas del cliente generado —detail/list/retire/authorize/bytes—, contrato de
  idempotencia (clave ausente 400, replay mismo asset, reúso incompatible 409),
  mismatch de representación (400 sin staged ni archivos, re-upload válido
  posterior), late upload con contenido igual y distinto (blob intacto, digest
  verificado por authorize/grant), barrera de interleave upload/finalize y dos
  sesiones sobre el mismo asset (3 revisiones, números únicos, sin 500).
- `internal/storage` enfocado: TestHardwareAssets_* + TestDesignPublish* +
  TestDesigns_* ok (listado=detalle con 2 recursos/2 revisiones, pins semánticos
  sin previewShape + hardware_lines, composición rota falla la publicación,
  ausencia legítima sin definición, rebind concurrente con coherencia de pin,
  regresión original R1→R2).
- R1 forma canónica elegida y documentada en `routes.go`: la del contrato generado
  (`/hardware-assets/{assetId}`, `{assetId}:retire`,
  `{assetId}/revisions/{revisionId}:authorize`); el router ahora usa un único
  despachador de comandos (sin segmento `/asset/`), OpenAPI/cliente sin cambios
  (`pnpm openapi:check` PASS) y sin parches en React.
- Idempotencia real: `finalize` y `retire` ahora bajo `RequireIdempotency`
  (operaciones `hardware-assets.finalize-upload` / `hardware-assets.retire`);
  `cancel` no declara clave en el cliente y queda directa.
- R4 elección documentada: pins desde el walk del contexto semántico (overrides de
  placements en structure/module/agregados + hardware_lines), INSERT único
  hardwares×revisions (digest/representación de la misma lectura), error tipado
  `ErrCompositionUnresolvable` para composición rota, ausencia legítima para ítem
  sin definición/módulo inexistente. La selección alternativa por ítem no existe en
  el contrato M1 (no hay estado que la sustente; queda para el contrato de #667
  posterior, documentado).
- R5: compensación de upload nunca elimina la clave cuando el record falla (puede
  ser el blob finalizado; huérfanos quedan para limpieza con log);
  `FinalizeHardwareAssetUpload` toma `FOR UPDATE` del asset objetivo (serializa
  numeración y retiro concurrente); violación de numeración → 409 tipado con
  reintento seguro; guard de frontera coherencia representación↔content-type.

Verificación de cierre: suites completas `internal/api` ok + `internal/storage` +
domain ok (secuencial, PostgreSQL real), `pnpm openapi:check` PASS, `git diff
--check` limpio (typecheck monorepo al cierre). CI remota del HEAD final: se
registra en el PR.

Nota de diagnóstico (no es un defecto de esta rama): durante la verificación, una
serie de fallos `57P01 terminating connection` en tests de auth (ajenos al cambio)
se trazó a un proceso `go test ./...` HUÉRFANO de una ejecución anterior que
seguía vivo y competía por la BD desechable compartida `muebles_multiorg_test`
(4097 `terminating connection` en los logs de Postgres; "CREATE DATABASE … already
exists" seguido de FORCE-drop). Tras terminar ese proceso de prueba, los tests de
auth pasan aislados y la suite completa corre limpia. El test de barrera R5
también detectó y corrigió un defecto del propio test: el gate de sesión corre
ANTES de leer el body, así que el interleave correcto exige que el upload pase el
gate con la sesión aún prepared y se bloquee después (barrera), no al revés.

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

## Ronda residual R5 — cierre y verificación independiente (2026-09-12)

El hueco residual (borrado de archivos antes del commit externo) fue corregido
en `ba021657` (mismo PR): `storage.OnCommit` registra callbacks que
`WithinTenantTx` ejecuta sólo tras un commit ganador (descartados en rollback;
no-op fuera de un scope de commit → retención conservadora);
`CollectHardwareAssetStagedFile` decide bajo `FOR UPDATE` de la fila de sesión
si la clave sigue necesaria (staged de sesión prepared o blob de revisión
inmutable) y desvincula CON el lock tomado; un unlink fallido revierte la
decisión y retiene el archivo. Los tres puntos de limpieza (re-upload, cancel,
sweep de expiración) registran el recolector post-commit. Sin cambios al
middleware de autenticación, sin servicio de GC; huérfanos retenidos quedan
logueados con su storage key para el clean-media documentado.

Verificación independiente de esta sesión (worktree dedicado):

- GREEN en HEAD `761e17c2`: las 5 regresiones residuales existentes pasan
  (re-upload con commit fallido, cancel con rollback, barrera de re-uploads
  concurrentes, late-upload vs finalize, numeración por asset).
- RED reproducido de forma aislada contra la base revisada `2e9641a3`
  (worktree temporal detached con sólo el archivo de tests del HEAD): ambas
  regresiones de rollback fallan exactamente con el hallazgo
  (`staged file …: no such file or directory` tras el commit fallido).
- **Gap cubierto**: la regresión de EXPIRACIÓN con rollback faltaba (el
  encargo exige cancelación/expiración). Nueva
  `TestHardwareAssets_RouterExpirySweepCommitFailurePreservesBytes`:
  RED en `2e9641a3` (`old session staged bytes destroyed by rolled-back
  sweep`), GREEN en HEAD. Cubre además la recolección post-commit del archivo
  abandonado cuando el mismo start commitea sin el trigger.
- Suites: `internal/api` completa ok (27.0s); `go vet ./...` limpio;
  `git diff --check` limpio; `pnpm openapi:check` PASS (sin cambios de
  contrato). Storage sin cambios en esta ronda (verificado por el commit
  residual y la CI del PR).

## Ronda R5-concurrencia: promoción y recolección bajo el mismo protocolo (2026-09-12)

Hallazgo sobre `db295bc0`: el handler promueve el temporal con `os.Rename`
ANTES de `RecordHardwareAssetSessionBytes`; el recolector decide y elimina bajo
`FOR UPDATE` de la fila de sesión. El rename no participa de ese lock: un
re-upload con EXACTAMENTE el contenido A (misma clave content-addressed) sobre
una sesión `prepared` con staged=B renombra sobre la clave A, su UPDATE espera
el lock del recolector, el recolector elimina A y confirma, y el UPDATE
confirma staged=A con el archivo ausente (200 válido aparente; finalize luego
falla en verificación).

Plan (mínimo, sin arquitectura paralela):

- El registro de bytes pasa a ser `PromoteHardwareAssetSessionBytes`: dentro
  de la transacción toma `FOR UPDATE` de la fila de sesión, re-valida
  autoritativamente estado/expiración/representación, invoca el callback de
  promoción (el rename) CON el lock tomado, aplica el UPDATE y devuelve la
  clave staged previa. El recolector ya usa el mismo lock → exclusión mutua
  real entre promoción y recolección.
- Recepción/verificación del archivo (temporal + hashing) permanece FUERA del
  lock; el lock sólo cubre validar+rename+update (rápido). Sin lock durante la
  transferencia.
- El handler conserva la lectura temprana como fast-fail; la validación
  autoritativa es la de la sección crítica. La clave reemplazada que se
  registra para recolección post-commit pasa a ser la devuelta por la sección
  crítica (no la lectura temprana, posiblemente stale — aunque el recolector
  revalida bajo lock en cualquier caso).
- Fallo tras promover pero antes de confirmar → rollback del estado; el
  archivo en la clave queda como huérfano logueado (nunca se borra; política
  conservadora ya vigente).
- Regresión RED→GREEN con barreras: hook de unlink bloqueante (seam de prueba
  documentado en Server) detiene al recolector tras tomar el lock y antes de
  eliminar; el re-upload concurrente de exactamente A se detecta esperando el
  lock vía `pg_stat_activity` (deadline acotado, polling no como
  sincronización primaria); al liberar, el upload debe terminar 200 con
  archivo existente, tamaño y SHA correctos, y finalize+authorize leen esos
  mismos bytes. En el código revisado el rename ocurre antes de esperar → el
  recolector borra el archivo recién promovido → RED determinista.

### Ronda R5-concurrencia — resultado (2026-09-12)

- RED: `TestHardwareAssets_RouterReUploadSameKeyDuringCollection` sobre el
  código revisado → `key A file missing after successful re-upload` (el
  recolector borró el archivo promovido; el upload respondió 200). Barreras
  reales: seam de unlink bloqueante detiene al recolector tras el lock y antes
  de eliminar; la espera del lock del re-upload se observa en
  `pg_stat_activity` (deadline acotado; sin sleeps como sincronización).
- Corrección: `PromoteHardwareAssetSessionBytes` mueve la promoción del
  temporal DENTRO de la sección crítica de la sesión (FOR UPDATE de la fila,
  mismo lock del recolector), re-valida autoritativamente
  estado/expiración/representación desde la fila bloqueada, aplica el rename y
  el UPDATE, y devuelve la clave staged previa real (la recolección
  post-commit se registra con ella). Recepción/verificación (temporal +
  hashing) permanecen fuera del lock; sin lock durante la transferencia. El
  registro metadata-only de los tests usa Promote=nil. El seam de unlink
  (`Server.hardwareAssetUnlink`, nil en producción) documenta el punto de
  prueba.
- GREEN: la regresión de concurrencia pasa (archivo existente con tamaño y
  SHA exactos, finalize+authorize leen los mismos bytes); las 11 pruebas de
  router y la suite completa de `internal/api` pasan.
- Nota de entorno: durante la verificación local, otra lane (shell de sesión
  ajena, checkout compartido main) ejecutaba `go test ./...` sobre la misma BD
  desechable compartida; la suite completa de storage se re-ejecuta al quedar
  libre (el flake 57P01 ya documentado no se reatribuye sin evidencia).
