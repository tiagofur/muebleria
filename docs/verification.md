# Verificación — Cómo demostrar que el trabajo funciona

> Regla de oro: **el agente no dice “funciona”, lo demuestra**.
> Toda feature termina con evidencia ejecutable y, cuando aplique, remota.

---

## 1. Principios

1. Un test verde local es evidencia, no permiso para ignorar CI.
2. `./init.sh` debe fallar de verdad si el entorno o los tests obligatorios fallan.
3. Si una métrica, workflow o permiso cambió, probar el comportamiento, no sólo tipos.
4. Exports físicos requieren fixture/golden/round-trip apropiado.
5. TS↔Go duplicado requiere fixtures de contrato, no fe manual.
6. Ninguna feature se marca `done` si falta evidencia exigida por su aceptación.

---

## 2. Gate local base

```bash
./init.sh
```

**Contrato:**

- Node >= 20 y pnpm requeridos presentes;
- instalación de dependencias estricta sin fallbacks permisivos (`|| true`);
- typecheck estricto (`pnpm typecheck`);
- suite de tests obligatorios de TypeScript verdes;
- suite de tests de backend Go (`go test ./...`) ejecutada y verde;
- ningún error silenciado.

> **Implementado (OC-001 + OC-002):** `./init.sh` valida harness, monorepo TS completo y backend Go. CI remoto corre en GitHub Actions (`.github/workflows/ci.yml`).

---

## 3. Tests por capa

### Domain

```bash
pnpm --filter @granete/domain test
```

Cubre BOM, cálculos, routing, lifecycle puro, validaciones, optimizer/machining y helpers
sin DOM.

### UI

```bash
pnpm --filter @granete/ui test
```

Probar comportamiento, accesibilidad y wiring; no usar grep de source como sustituto de
interacción cuando el feature sea interactivo.

### Storage

```bash
pnpm --filter @granete/storage test
```

Round-trip, migrations/adapters, compatibilidad legacy y errores.

### Excel/exports

```bash
pnpm --filter @granete/excel test
```

Golden/estructura de XLSX/PDF/DXF/ZPL/CSV según output.

### Todo TS

```bash
pnpm test
pnpm typecheck
```

### Backend Go

Ejecutar `go test` sobre el paquete afectado y, antes de cierre de feature server-side,
la suite backend razonablemente completa definida por el repo.

### Granete for SketchUp — reconciliación del host

```bash
cd apps/sketchup-extension
bundle exec rake syntax
bundle exec ruby -Itest test/unit/project_furniture_test.rb
bundle exec ruby -Itest test/unit/dialog_controller_test.rb
bundle exec ruby -Itest test/unit/publication_preflight_gate_test.rb
bundle exec ruby -Itest test/unit/design_publish_test.rb
bundle exec rake verify
```

La matriz mínima separa Project membership, item exacto del Working Copy y raíz
local: `unplaced`, `pending_confirmation`, `present_synced`, `missing_local`,
duplicado y autoridad incompatible/desconocida. Debe probar que Q1 no llama al
servicio de cotización y publish no sincroniza/exporta cuando la reconciliación
no es limpia. Los harness JS de Project Furniture y Commercial Projection deben
tener wrappers Ruby para formar parte de `rake unit`; ejecutarlos sólo con
`node` no constituye evidencia de `rake verify`.

### Multi-org / Pilot Readiness

`backend-go/tests/pilotreadiness/` (F179) prueba aislamiento y operaciones
básicas de dos organizaciones contra PostgreSQL real vía las APIs HTTP — sin
mocks. **Obligatorio antes de deploy:** `scripts/pilot-gate.sh` (en modo gate
los skips están prohibidos; ver `docs/pilot-readiness.md`). Su pata de
backup/restore requiere `pg_dump`/`pg_restore` (CI los instala).

Aislamiento a nivel storage: `go test ./internal/storage/ -run TestIsolation`
(F171 + F182) cubre todas las familias de entidades — list/get/write cross-org
deben fallar igual que una row inexistente. F182 incluyó la corrección de las
PKs globales de `material_stock`/`project_picking` (migración 000091), cuyos
`ON CONFLICT ... DO UPDATE` podían mutar la row de otra organización.

---

## 4. CI remoto

Operational Core OC-002 implementa los required checks en `.github/workflows/ci.yml`:

```text
1. feature-list/schema validation
2. pnpm install + typecheck + test (pnpm según packageManager)
3. go test -v ./... con service container de Postgres (DATABASE_URL), para que
   los tests de integración de storage corran en vez de saltarse con t.Skip
   (incluye la suite de Pilot Readiness; el job instala postgresql-client
   para su pata de backup/restore)
4. proyectar-visual: gate visual WebGL de Proyectar (#444, ver su sección)
```

Fixture de paridad vivo: `contracts/roles.json` — los tests de roles en
`packages/domain/src/rbac.test.ts` y `backend-go/internal/domain/rbac_test.go`
afirman contra el mismo archivo (ver §5).

Una feature que altera workflow/seguridad/persistencia no se considera `verified` si
sólo existe una afirmación en commit message y no hay evidencia ejecutable.

### PRs apilados y cierre de issues

GitHub sólo cierra una issue (`Closes #N`) cuando el PR se mergea a la rama por
defecto. Ya ocurrieron dos veces (#330/F142 y #420/#418) que un PR apilado se
mergeó a su rama intermedia: el contenido llegó a `main` por otro PR, pero la
issue quedó abierta — o peor, el código quedó huérfano en `main` con el ledger
diciendo `done`. Reglas:

1. antes de mergear, confirmar que la base del PR es `main` (o retalear y
   verificar);
2. si un PR apilado se mergea a una rama intermedia, cerrar la issue
   manualmente sólo cuando el contenido esté verificado en `main`;
3. el workflow `.github/workflows/issue-reconcile.yml` (semanal) marca issues
   abiertas cuyo cierre fue declarado (`Closes/Fixes/Resolves #N`) en un PR ya
   mergeado — a `main` o a una rama intermedia — para revisar. Nunca cierra
   solo; las referencias plain `#N` se ignoran a propósito.

---

## 5. Contract fixtures TS ↔ Go

Cuando una regla exista en TypeScript y Go:

1. fixture JSON canónico;
2. ejecutar ambas implementaciones;
3. comparar resultado normalizado;
4. divergencia falla CI.

Candidatos prioritarios:

- settings compartidos;
- roles/status si ambos lados los duplican;
- pricing cuando siga duplicado;
- stock/workflow transitions compartidas;
- mappers de nuevos Operational Core entities.

---

## 6. Golden tests de dominio/export

Mantener los fixtures históricos de `Plantilla_Muebles.xlsx` y
`Plantilla_Optimizer.xlsx` mientras sigan siendo contratos válidos.

Para nuevas features físicas añadir goldens apropiados:

- cut plan;
- DXF layers;
- drilling;
- piece labels/QR;
- production pack revision consistency.

### Regla de revisión

Un golden no debe congelar un bug conocido. Si cambia intencionalmente, documentar el
motivo y actualizar fixture + criterio.

---

## 7. Verificación del lifecycle

Features de `ProjectEvent`, Approval, ProductionRelease o ChangeOrder deben probar:

- actor/timestamp;
- append-only;
- idempotencia donde corresponda;
- transición permitida y rechazada;
- stale detection;
- backfill no inventa timestamps;
- unauthorized bypass falla.

### Estado durable de Ingeniería por release (#740)

- `backend-go/internal/storage/production_release_engineering_test.go`
  (PostgreSQL + HTTP reales): pending → start idempotente → complete final
  (If-Match, version conflict, ya-completado como no-op honesto) → reload
  durable; P2 no hereda P1 (incluida la proyección del read model de la
  autoridad); vendedor 403; cross-org 404 sin escrituras; auditoría de
  seguridad y eventos de lifecycle en la misma transición.
- `backend-go/internal/storage/engineering_physical_gate_red_test.go`
  (**RED del PR 1 invertido por el PR 2**): part advance, floor-status y
  floor-scan ahora fallan cerrado (409 con copy accionable) dejando 0
  mutaciones físicas y 0 eventos; la generación de ejecuciones PLANIFICADAS
  sigue disponible antes de la autorización (#739).
- `backend-go/internal/storage/engineering_physical_gate_test.go`
  (PostgreSQL + HTTP reales, #740 PR 2): matriz secuencial (pendiente →
  en_proceso → completa-sin-materiales → materiales autorizados → avance
  permitido con floor event); excepción autorizada autoriza y conserva
  motivo auditable; stamp no correlacionado NO autoriza; TODOS los writers
  físicos bloqueados con cero mutaciones mientras la OBSERVACIÓN de calidad
  sigue operando (incluido finish de actividad sin mutar su propia fila);
  P2 no reutiliza evidencia de P1 (pendiente → re-preparada → mismatch de
  liberación); vendedor 403 / cross-org fail-closed sin escrituras; dos
  avances concurrentes de la misma pieza dejan exactamente un ganador; el
  cambio de autoridad BAJO el lock re-evalúa la evidencia post-commit
  (bloqueo honesto al retirar la autorización; desbloqueo honesto al
  completar Ingeniería en curso).
- `tests/organization/engineering-state.spec.ts` (Chromium + Go +
  PostgreSQL): P1 → Pendiente → Iniciar → En proceso (reload) → descargar
  PDF/PTX NO completa → Completar → Completa con actor/fecha y etapa
  siguiente honesta (reload); cero materiales/progreso físico/produced.
- `tests/organization/engineering-physical-gate.spec.ts` (Chromium + Go +
  PostgreSQL, #740 PR 2): Ingeniería en proceso → acción física en la orden
  → UI muestra el bloqueo accionable y el servidor confirma 0 progreso;
  Completa + materiales pendientes → sigue bloqueada; materiales autorizados
  (excepción auditada vía APIs soportadas) → el MISMO avance tiene éxito con
  estado y evento F092 reales.

### Continuidad P1/P2 sin retarget implícito (#741 PR 1)

- `backend-go/internal/storage/release_continuity_red_test.go`
  (**RED del PR invertido por su fix**, PostgreSQL + HTTP reales; la forma del
  escenario se conserva para comparar antes/después): P1 con progreso físico
  real (corte completado + evidencia autorizada) → P2 con diferencia real de
  fabricación (600→650 mm, requote Q4 aceptada) → advance de pieza P1,
  advance de unidad, floor-status PATCH, floor-scan, rework de pieza y
  rework de calidad devuelven 409 de continuidad con CERO mutaciones (la
  pertenencia se pregunta ANTES que la preparación; el operador nunca ve el
  estado de P2 como motivo del bloqueo de P1); `PUT part-executions`
  force=true YA NO reemplaza las ejecuciones P1 (ids, corte completado y
  pinning de release intactos — hoy previo al fix devolvía 200 y destruía el
  trabajo).
- Mismo archivo, política de regeneración: sin progreso pero materiales P1
  autorizados → 409 «materiales comprometidos» sin tocar planning/ejecuciones
  (el compromiso no queda huérfano); discontinuidad limpia (vírgenes y sin
  compromiso) → regeneración P2 permitida y el trabajo pasa a ser P2 con el
  copy honesto de preparación de P2; histórico P1 legible (lista de releases,
  cutting-demand) con 0 mutaciones.
- Carreras (§13): advance P1 vs creación concurrente de P2 (gana como P1
  completo o pierde 409 de continuidad; jamás empieza P1 y aterriza P2) y
  force-regenerate vs creación de P2 (corre como regeneración dentro de P1 o
  bloquea; las ejecuciones nunca quedan estampadas P2 sobre progreso P1) —
  ambos sobre el lock de fila de projects, estables en repeticiones.
- `TestPhysicalWorkGate_P2DoesNotReuseP1Evidence` actualizado al refinamiento
  #741: con P2 pendiente, avanzar pieza P1 ahora responde el bloqueo de
  continuidad (la pregunta de pertenencia precede a la preparación) en vez
  del «Ingeniería pendiente» de P2.
- Corrección de revisión P0 (procedencia ambigua cierra, mismo PR):
  `TestReleaseContinuity_MixedProvenanceBlocksItemWriters` (mixto P1/P2 →
  floor-status y floor-scan 409 con 0 F092, activity-finish bloqueado con
  finished_at NULL, advance y regeneración bloqueados),
  `TestReleaseContinuity_UnpinnedExecutionsBlockItemWriters` (ejecuciones
  canónicas sin pin de release → ítems bloqueados) y
  `TestReleaseContinuity_MalformedExecutionPayloadFailsClosed` (payload
  presente pero indecodificable → writer físico cerrado, 0 mutaciones, nada
  se repara).
- Dominio/UI TS: `releaseAuthority.test.ts` (señal de continuidad: single
  ownership, normal, mixta, legacy, progreso) y `ProductionOrderHub.test.tsx`
  (banner «Nueva revisión disponible» con copy §16, detalle Liberación #N sin
  ids técnicos, sin acciones de reemplazo, silencio sin progreso/discontinuidad).
- `tests/organization/production-release-continuity.spec.ts` (Chromium + Go +
  PostgreSQL): fixture por API soportada (P1 completa con avance físico, P2
  con 650 mm vía requote) → Producción informa la nueva revisión con el
  trabajo P1 visible y sin acción automática → la acción física bloqueada
  explica la discontinuidad (toast con copy del servidor) con poststate
  idéntico al prestate → recargar conserva exactamente el mismo estado.

---

## 8. Verificación producción pieza→mueble

### Corte/CNC/Enchape

Tests deben demostrar:

- una pieza puede avanzar sin mover todas las piezas del mueble;
- routing omite estaciones no requeridas;
- QR/scan resuelve pieza y revisión correcta;
- stale revision bloquea o advierte según regla;
- rework/scrap no destruye historial.

### Armado+

- cantidad de línea produce unidades físicas distinguibles;
- armado conoce piezas faltantes;
- QC puede bloquear packaging;
- load completeness funciona por unidad/bulto;
- installed no cierra punch automáticamente.

---

## 9. Data Truth tests

Dashboards/KPIs deben probar la semántica:

```text
actual
estimated
forecast
proxy
missing
```

Prohibido testear como correcto un número fabricado por fallback sin etiqueta visible.

Ejemplos a migrar:

- piezas `moduleCount * 8`;
- m² `moduleCount * 2.8`;
- canto `moduleCount * 14`;
- hardware `moduleCount * 4`;
- fecha depósito/almacén basada sólo en `createdAt`.

---

## 10. Seguridad

Para auth/RBAC:

- respuestas login/refresh no contienen hash/password/secret;
- role changes se aplican con autoridad server;
- unauthorized station advance devuelve error;
- CORS allowlist tiene tests;
- query-token/media strategy se revisa cuando cambie;
- logs no exponen secretos.

---

## 11. Persistencia y migraciones

- migraciones aditivas y backward-compatible cuando sea posible;
- no SQL destructivo sin aprobación explícita del usuario;
- round-trip legacy → nuevo schema;
- backfill conservador;
- ningún default inventa hechos históricos;
- rollback/compat strategy documentada para entidades críticas;
- **migraciones y arranque jamás insertan datos de negocio** (catálogo, CRM,
  cotizaciones) — pineado por `TestMigrations_NoBusinessData`; el seed demo es
  un comando explícito (`cmd/admin seed` / `POST /api/seed`,
  `docs/deployment.md` §4.5).

---

## 12. UI/UX operacional

Además de `docs/design.md`, revisar `docs/operational-ux.md`.

Smoke por screen operativa:

- unidad de trabajo correcta;
- gate explica blocker;
- revisión visible cuando importa;
- acción física deja feedback persistente;
- estimate vs actual distinguible;
- responsive/touch según contexto;
- a11y básica.

---

## 13. Desktop/Mobile

### Electron

```bash
pnpm --filter @granete/desktop test
pnpm --filter @granete/desktop dev:app
```

Smoke de dialogs/exports/update según feature.

### Mobile

Cuando una feature móvil cambia ejecución física/offline:

- test queue offline;
- reconexión;
- conflicto de revisión;
- scan;
- no mostrar “sincronizado” si no llegó al server.

---

## 14. Anti-patrones

- ❌ “debería funcionar”.
- ❌ test que sólo comprueba que no lanza.
- ❌ grep del source como único test de UI.
- ❌ `|| true` alrededor de un gate obligatorio.
- ❌ métrica proxy presentada como actual.
- ❌ marcar `done` con tests locales rojos/omitidos.
- ❌ duplicar regla TS/Go sin contract fixture cuando la divergencia es peligrosa.
- ❌ cerrar sesión con trabajo no pushed.
- ❌ `git stash` como almacenamiento de trabajo.
- ❌ mezclar features no relacionadas en el mismo commit.

## PTX CADmatic 4 r4 — dialecto de campo (#781)

Verificación proporcional del segundo candidato tras el primer rechazo real de
CADLink (`OnlineConvertedFailedMsg`, 2026-09-17; causa única NO demostrada):

```sh
pnpm --filter @granete/domain test      # autoridad de códigos + copias -Cn
pnpm --filter @granete/excel test       # r4 core + golden + adapter + rutas
pnpm --filter @granete/web test         # descarga/manifest/filename industrial
GOFLAGS='-p=1' go test ./internal/domain/ ./internal/api/ -run MachineOutput
scripts/organization-browser-gate.sh tests/organization/machine-output-selection.spec.ts
```

Cobertura contractual exigida por #781 (además de la cadena serialize → parse →
validate → verifier independiente === []):

- códigos: `part_code_too_long` / `part_code_duplicate` fallan cerrado; copias
  `-Cn` distintas; sin truncado; r2/r3 byte-exact (goldens intactos);
- OFFCUTS: `OFC_QTY=1` presente y validado; declaración ANTES de PATTERNS/CUTS
  (sin forward Xn — invariante del verifier); `Xn` sólo en FUNCTION 92;
- identidad: profile `r4` + adapter `1.3.0` con digests verificados contra el
  contrato industrial y el catálogo compartido TS/JSON/Go (paridad);
- filename: `G<hex12>.ptx` / `G<hex12>-<n>.ptx` deterministas (hash de
  cutPlan id+versión), manifest con SHA exacto y provenance descriptiva
  intacta;
- revisión del PR (Codex): asignación canónica compartida de códigos
  (reorden de unidades/piezas/ítems no cambia códigos — tests en ambos
  flujos), `part_code_missing` fail-closed (sin fallback al partCode de
  plantilla; el optimizador ya no rellena labelRef con el id de colocación) y
  OFFCUTS emitido SÓLO para el pareado demostrado con FUNCTION 92
  (remanentes no-92 sin declarar — nada clasificado UNKNOWN se emite);
- field: la aceptación real por CADLink es el próximo gate externo (runbook en
  `docs/machines/ptx-cadmatic4/05_contrato_r4_field_dialect.md` §6); nada de
  esto promueve `NOT_TESTED/notClaimed`.

---

## PTX CADmatic 4 — strict spec preflight r5 (#788)

Validador estricto de especificación Pattern Exchange ANTES de serializar
(r5-A de #787, tras el segundo rechazo). Base: defecto objetivo confirmado
`HEADER.TITLE` 43 chars > 25 documentado (causa del rechazo NO demostrada).
Autoridad documental: diccionario §20 (pp. 166–178) de la Interface Guide V11
(S03), citas verbatim por límite en
`docs/machines/ptx-cadmatic4/08_spec_preflight_r5.md` §2.

```sh
pnpm --filter @granete/excel test    # specPreflight + externalDialect + suite
pnpm typecheck
```

Cobertura contractual exigida por #788:

- fail-closed sin truncado: `ptx_spec.header_title_too_long` con longitud
  observada/máximo/locator (regresión 43 industrial y 33 lab); TITLE de 25
  PASA;
- independencia writer/validator: `ptxSpecPreflightBytes` parsea con el lector
  independiente y detecta mutaciones de bytes post-serialización (título,
  enums, fila borrada, salto de índice, referencia colgante, código de 60,
  DIM 10000, QTY 100000); `serializePtxDocumentBytesSpecChecked` no entrega
  bytes rechazados y `compileCutPlanToPtxDocument({ strictSpecPreflight })`
  bloquea con `ptx_compile.spec_preflight_failed` (opción inerte para
  r2/r3/r4);
- índices consecutivos/únicos/desde 1 y referencias por job (PART/BOARD/
  MATERIAL/PATTERN/Xn/JOBS) re-derivadas sin compartir código con validate.ts;
- rangos DIM/QTY del diccionario (revisión): DIM 9999.9 mm /
  999.9 in PASS y 10000 / 1000 BLOCK según HEADER.UNITS, DIM negativo BLOCK,
  QTY 99999 PASS / 100000 BLOCK / QTY decimal 1.5 BLOCK (LONG INTEGER
  documentado), cobertura de todos los campos DIM/QTY modelados, también
  sobre bytes mutados;
- enums/ranges documentados como SPEC (revisión): RULE1 1..9, RULE2/3/4 {0,1},
  GRAIN {0,1,2}, PATTERNS.TYPE 0..8, CUTS.FUNCTION 0..9 ∪ 90..99,
  JOBS.STATUS/CUT_TIME/CUTS.SEQUENCE como forma INT (STATUS con 0/1/2
  conocidos NO exhaustivos: otros enteros no son spec-invalid por valor;
  sólo decimales bloquean) — con la taxonomía tipada SPEC_INVALID /
  SPEC_VALID_BUT_PRODUCT_UNSUPPORTED / PRODUCT_SUPPORTED
  (`classifyPtxDocumentedEnumSupport`) sin habilitar capacidad nueva Y
  VIGENTE EN BYTES: el lector representa TYPE 0..8
  (`PtxDocumentedPatternType`) para que bytes con TYPE=6 queden sin spec
  issue (clasificación SPEC_VALID_BUT_PRODUCT_UNSUPPORTED; producto
  fail-closed vía validate/serialize) y bytes con TYPE=9 sean spec-error
  con el rango documentado;
- JOBS opcional bajo la especificación (§5 p.120): sin filas JOBS y un único
  job implícito es SPEC-válido; dos JOB_INDEX sin JOBS →
  `job_scope_ambiguous` fail-closed; el compiler de Granete sigue emitiendo
  su fila JOBS explícita (política de producto intacta);
- VERSION: sólo la forma (positivo finito) es spec — 1/1.06/1.08 PASAN sin
  pin arbitrario; el valor exacto queda UNKNOWN hasta receiver profile;
- shapes externos: R2201/R7301 saneados se leen estructuralmente (lector
  tolerante: espacios, líneas en blanco, trailing documentado, familias
  PARTS_INF/PARTS_UDI/NOTES opacas; fixtures sin modificar), distinguiendo
  celda vacía de trailing omitido;
- inmutabilidad: goldens r2/r3/r4 se RECOMPILAN de verdad (optimizeCutPlan →
  compile → serialize, incluido r3 con GOLDEN_R3_*) a bytes byte-exact con
  sus sha256 del contrato industrial y el descriptor del adapter conserva su
  digest; los bytes históricos se reportan honestamente como violadores del
  límite TITLE;
- sin máquina, sin CADLink, sin nuevo candidato al cliente:
  `NOT_TESTED/notClaimed` permanece; etiquetas/CNC/receiver/CUTS/RLT/profile
  r5 siguen en #789–#793 (la semántica FUNCTION 92 no se toca: #791 es su
  dueño).

---

## 15. Definition of Verified

Antes de declarar una feature verificada:

1. acceptance criteria revisados uno por uno;
2. tests de capa correspondientes verdes;
3. typecheck si cambió TS;
4. Go tests si cambió backend;
5. migrations probadas si cambió storage;
6. smoke visual/operacional cuando aplique;
7. CI remoto verde cuando exista el check;
8. documentación canónica actualizada si cambió contrato;
9. commit/push en rama correcta.

Si un check está bloqueado por entorno, se registra como **blocked/environment**; nunca se
inventa aprobación.

## Performance de Proyectar (F147 / #312)

Toda feature que toca el hot path del editor 3D (escena, drag, selección,
materiales, layout) verifica además contra el budget:

- `pnpm smoke:perf` con el baseline de `docs/proyectar-3d-performance.md`
  (antes/después; empeoramiento > 20% exige tradeoff explícito);
- gate CI determinista: cache de BOM (layout-change ⇒ 0 re-resoluciones) y
  conteo del fixture de referencia;
- el humo WebGL completo (`pnpm smoke`) sigue siendo local + evidencia.

## Benchmark de usabilidad de Proyectar (F148 / #314)

El script canónico de 11 tareas es una **regresión permanente**:
`pnpm smoke:usability` (incluido en `pnpm smoke`) corre el script completo con
la UI real contra el seed demo y falla si un paso deja de ser completable o el
kit de medición deja de capturar los eventos (detalle en
`docs/proyectar-3d-usability-benchmark.md`). Los tiempos de esa corrida son
`proxy` y no cuentan como evidencia de usuario.

## Gate visual WebGL de Proyectar (#444)

Complemento de corrección visual (no de performance): demuestra que el editor
renderiza el mobiliario, materiales, selección y feedback de colocación
esperados contra el canvas WebGL real (R3F/three `FurnitureScene3D`), no un
mock. Suite: `tests/visual/proyectar-webgl.spec.ts` (proyecto Playwright
`proyectar-webgl`), con baselines versionadas de: sala vacía, módulo
insertado, módulo seleccionado, cambio de material y ghost de
arrastro/colocación.

```sh
# Requisitos: pnpm install previo; Chromium de Playwright instalado
# (pnpm exec playwright install chromium). No requiere backend: modo guest.
# (Invocación directa: el script `pnpm visual` reenvía `--` literal y rompe
# el filtro de archivo en pnpm actual.)
pnpm exec playwright test --config=playwright.config.ts tests/visual/proyectar-webgl.spec.ts
```

- **Baselines**: `tests/visual/proyectar-webgl.spec.ts-snapshots/*.png`.
  Una sola serie sin sufijo de plataforma.
- **Actualizar baselines tras un cambio visual intencional** (exige revisión
  visual del diff en el PR, nunca automático):
  `pnpm exec playwright test --config=playwright.config.ts tests/visual/proyectar-webgl.spec.ts --update-snapshots`
- **Determinismo**: el proyecto fija `--use-angle=swiftshader-webgl`
  (raster WebGL por CPU), viewport 1280×800, `deviceScaleFactor` 1,
  `reducedMotion`, pose de cámara por botón "Ajustar" y el seed
  "Demo plantilla" en modo guest. El DOM sobre el viewport se oculta con CSS
  inyectado por el test antes de capturar (sólo píxeles del canvas; sin
  máscaras). Los artefactos de fallo quedan en `test-results/` (actual,
  esperado, diff, trace).
- **Paridad CI/local**: mismo Chromium fijado por `@playwright/test` +
  SwiftShader en local (macOS) y en CI (Linux `ubuntu-latest`, job
  `proyectar-visual`), mismas baselines sin sufijo de plataforma. Paridad
  verificada entre macOS y contenedor Linux oficial de Playwright
  (`mcr.microsoft.com/playwright:v1.61.1-noble`) antes de publicar. Al subir
  la versión de `@playwright/test` hay que regenerar baselines si el
  renderer cambia.
- **Entrada externa conocida**: el modo de luz "presentación" (default del
  producto) carga un HDR de el CDN de assets de drei; ese contenido está
  "horneado" en las baselines y su cambio se manifestará como diff
  intencional a revisar.
- **Separación con #312**: los flags de software GL viven sólo en el proyecto
  `proyectar-webgl`; los smokes de performance (`pnpm smoke:perf`) siguen
  midiendo con GL real y no comparten baseline con este gate.

## PR publication metadata (partial #573 delivery)

`PR Publication / Publication metadata` checks the current PR and issue through
read-only GitHub API calls. Run its unit tests locally with:

```sh
python3 -m unittest discover -s scripts -p test_check_pr_metadata.py -v
# Live check: requires GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GITHUB_TOKEN.
python3 scripts/check_pr_metadata.py
```

Start the body with exactly one standalone `Closes #N`, `Fixes #N`, `Resolves #N`
or `Refs #N` line (case-insensitive; leading blank lines allowed). Foreign, malformed or multiple targets
are rejected. The issue must be open, not a PR, and have only `status:approved`
among status labels. Exactly one supported PR type is required: `type:bug`,
`type:feature`, `type:docs`, `type:refactor`, `type:chore`, `type:breaking-change`.
Issue submission never approves work; agents must not self-approve.

This candidate-code workflow is self-validating/advisory, not tamper-proof approval.
It changes no branch protections, existing product CI jobs, or merge permissions.
PR metadata edits rerun only this workflow; issue approval changes do not trigger it.
A human must reread the open approved issue, intended base, exact current head,
all required CI/reviews and unmet scope immediately before any separately authorized
merge. API errors or relevant PR metadata drift fail closed; head/base SHAs are pinned
to the event. Reads are not atomic; unrelated volatile API fields are ignored.

#573 remains incomplete; the autonomous product implementer remains disabled.
Partial delivery uses non-closing `Refs #N`, with nonempty `## Delivered scope` and
`## Remaining scope` sections, leaving the approved parent open. Section completeness
and evidence are human acceptance criteria, not parsed by the metadata checker.
Complete delivery uses a closing keyword only when all linked-issue criteria are met.
This explicit partial-link policy permits separately authorized, verified partial PRs
to merge without closing unfinished issues; passing this check never grants that authority.
Queue ownership, bounded retries, independent validation, trusted enforcement and canary
rollout remain pending.


## Exact-PR evidence handoff (partial #573 delivery)

The existing leader can prepare a stateless, read-only handoff for a separately
authorized validator. Pin the intended issue and PR plus their exact head/base;
do not silently refresh these pins when resuming a task.

```sh
python3 -m unittest discover -s scripts -p test_factory_handoff.py -v
# Supply GITHUB_TOKEN through the environment, never a command argument.
python3 scripts/factory_handoff.py --issue 573 --pr "$PR_NUMBER" \
  --head "$EXPECTED_HEAD_SHA" --base "$EXPECTED_MAIN_BASE_SHA"
```

Success emits one JSON manifest; failures emit redacted stderr and exit nonzero.
The helper reads PR/issue twice, requires an open same-repository PR targeting main
and the caller's open approved issue, and rejects observed identity or scope drift.
Title/body/labels are hashed, not emitted or executed; volatile comments and label
ordering are ignored. The manifest records no approval, receipt or model dispatch.

Before accepting independently produced evidence, run the helper again with the
original pins and compare repository, PR, issue, head/base/ref and both scope hashes
with the initial manifest. `observed_at` is informational, not a freshness proof.
Finite API reads cannot be atomic: a later change still invalidates the handoff.
Recheck actual CI, applicable human authorization and intended scope at acceptance
and immediately before any separately authorized merge. Candidate-controlled code
is advisory and does not establish trusted enforcement or inspect RDD mode.

For the human-start role workflow and delivery gate, read
[the current execution contract](demo/software-factory-human-start.md). The helper
remains advisory; its tests do not demonstrate agent execution.

This unit adds no coordinator, lease store, GitHub writes, candidate execution or
unattended validation. Discovery reports/claims stay unchanged; product execution
remains disabled. Durable ownership, dispatch/cost accounting, persisted exact-head
evidence, trusted enforcement and canary/rollback remain open under #573.

## Hardening assemblies — tenant reads + MountFrame host (Refs #668, Refs #670)

Corrección acotada de los hallazgos F1/F2 de la auditoría independiente de
herrajes 3D/assemblies/MERIVOBOX (sin cambios de schema, resolver, BOM ni PTX):

```sh
# F1: tenant boundary bajo FORCE RLS (rol real granete_app_test, NOBYPASSRLS)
docker run -d -e POSTGRES_PASSWORD=postgres -p 5466:5432 postgres:16
DATABASE_URL='postgres://postgres:postgres@localhost:5466/muebles?sslmode=disable' \
  go test ./internal/storage/ -run 'TestAgregadoFamily_TenantBoundary' -v

# F2: smoke host real con geometría asimétrica + MountFrame rotado
cd apps/sketchup-extension && bundle exec rake verify
"/Applications/SketchUp 2026/SketchUp.app/Contents/MacOS/SketchUp" \
  -RubyStartupArg "TestUp:CI:Config:$PWD/testup-ci-670e.yml"
```

- **F1 (reads tenant-scoped fuera del boundary)**: los 12 métodos de
  `agregado_revisions.go` corren dentro de `runInTenantTx` — la tenant
  transaction del request (AuthMiddleware) o el self-wrap canónico
  `WithinTenantTx` (idiom `design_publish.go`) cuando el caller está fuera.
  Org ausente → `ErrNoOrgScope` tipado. La matriz F1-A..F1-F (tests
  `agregado_revisions_tenant_boundary_test.go`) exige: lectura exacta en tx;
  org presente sin tx ENCUENTRA el dato existente (antes: falso
  `ErrAgregadoRevisionNotFound` bajo FORCE RLS); cross-tenant fail-closed;
  ruta histórica R1→S1→pin; pool de una conexión reutilizada entre tenants sin
  leak del GUC; org vacío jamás degrada a not-found de negocio.
- **F2 (host smoke con geometría real)**: los .skp scratch llevan un bracket
  asimétrico (70×54×18 mm, sin espejo) y el MountFrame por defecto está
  rotado (det=+1). E9/E10 mide vértices reales de la definición cargada por el
  pipeline productivo y los compara contra
  `T_furniture × T_assembly × T_member × inverse(T_mountFrame) × Pᵢ` desde
  constantes (error ≤ 1e-3 mm, distancias preservadas, scale [1,1,1],
  det +1, sin shear). Guardas de sensibilidad prueban que T_norm omitido
  (32 mm), doble (32 mm), transpuesto (21 mm) o doble conversión mm/inches
  (35156 mm) romperían el test. E11 verifica tras save/close/reopen la
  identidad de revisión exacta y la geometría normalizada. Evidencia medida:
  `progress/host_smoke_668_mount_frame_geometry_evidence.json` (fixture
  documentado para la paridad SKP/GLB de #669).
- F3 (`DEFAULT_THICKNESS_MM` del renderer genérico offline) queda
  expresamente fuera de este hardening.

## #669 — GLB y representación 3D coherente (paridad SKP↔GLB↔WebGL)

- **Gate P0 (paridad numérica)**: fixture canónico `contracts/fixtures/glb-parity-canonical.json` (bracket sólido cerrado 70×54×18 mm, MountFrame no-identidad, constantes world derivadas a mano) + GLB producido por el host real (`glb-parity-bracket.glb`, escritor `granete-sketchup-glb-exporter 1.0.0` determinista). Host smoke `TC_GlbParitySmoke` (36 aserciones PASS, SketchUp 2026.2.242): delta SKP↔GLB ≤ 2.5e-6 mm, dimensiones/pairwise preservadas, scale [1,1,1], det +1, mutantes de unidades/normalización ≥ 21 mm detectables. Evidencia `progress/host_smoke_669_glb_parity_evidence.json` (head = commit final).
- **Lectores paralelos**: TS `glbParityCanonical` (17 tests) y Go `TestGlbParity*` (3 tests) consumen los MISMOS bytes GLB del host y las mismas constantes; contrato de validación compartido `glb-validation-cases.json` (17 casos) ejecutado por Go (upload) y TS (consumo).
- **Frontera fail-closed**: finalize GLB valida estructura/self-containment (`ValidateGlbContainerStructure`) y registra evidencia `granete-glb-structure-validator`; una revisión GLB sin validación no puede existir (storage test). Upload con derivación exige source SKP del MISMO asset; pins de publicación congelan el GLB exacto (R1 queda en G1 aunque exista G2 — test).
- **Render Web**: `GlbSceneCache` (clave digest, normalización ÚNICA horneada a mm asset Z-up, det>0), `HardwareGlbMesh` (estados loading/ready/corrupt/inaccessible/unsupported con fallback procedural explícito; primitive de identidad estable — el reconciler de R3F desprende hijos imperativos si el objeto churn), grupo de swap S constante (det −1 manejado por flipSided del renderer).
- **WebGL real (Point 12, suite 9/9)**: extents [70,54,18] mm, distancias world IGUALES a la evidencia host (70 / 77.79460135510689 / 55.78530272392541), escala uniforme 1, det −1 (único mirror = swap), 0 errores de consola.
- **Verificación**: domain 1582 (5 nuevos #669 + paridad), ui 1955, Go domain/storage/api focalizados PASS (PG 16 desechable), rake verify PASS (RuboCop 0, unit, boundary, RBZ), typecheck 7/7, openapi 0 drift. Pendiente: suites completas serializadas + CI del HEAD exacto (post-push), casos browser tenant/stale, comando host asistido interactivo, previews Agregado/herraje.
