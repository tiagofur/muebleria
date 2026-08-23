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
pnpm --filter @muebles/domain test
```

Cubre BOM, cálculos, routing, lifecycle puro, validaciones, optimizer/machining y helpers
sin DOM.

### UI

```bash
pnpm --filter @muebles/ui test
```

Probar comportamiento, accesibilidad y wiring; no usar grep de source como sustituto de
interacción cuando el feature sea interactivo.

### Storage

```bash
pnpm --filter @muebles/storage test
```

Round-trip, migrations/adapters, compatibilidad legacy y errores.

### Excel/exports

```bash
pnpm --filter @muebles/excel test
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

---

## 4. CI remoto

Operational Core OC-002 implementa los required checks en `.github/workflows/ci.yml`:

```text
1. feature-list/schema validation
2. pnpm install + typecheck + test (pnpm según packageManager)
3. go test -v ./... con service container de Postgres (DATABASE_URL), para que
   los tests de integración de storage corran en vez de saltarse con t.Skip
```

Fixture de paridad vivo: `contracts/roles.json` — los tests de roles en
`packages/domain/src/rbac.test.ts` y `backend-go/internal/domain/rbac_test.go`
afirman contra el mismo archivo (ver §5).

Una feature que altera workflow/seguridad/persistencia no se considera `verified` si
sólo existe una afirmación en commit message y no hay evidencia ejecutable.

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
- rollback/compat strategy documentada para entidades críticas.

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
pnpm --filter @muebles/desktop test
pnpm --filter @muebles/desktop dev:app
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
