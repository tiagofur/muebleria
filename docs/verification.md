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
