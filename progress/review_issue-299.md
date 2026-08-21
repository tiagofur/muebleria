# Review — Issue #299 (Operational Core O0, OC-001 a OC-006)

**Veredicto:** CHANGES_REQUESTED

**Fecha:** 2026-08-21 · **Revisor:** reviewer skill · **Evidencia:** diff completo
inspeccionado + `./init.sh` ejecutado por el revisor (exit 0, suite TS + Go verde).

## Resumen de verificación de claims

| Claim del walkthrough | Verificado | Observación |
|---|---|---|
| `init.sh` sin `\|\| true`, Node>=20, pnpm, install, typecheck, tests TS, tests Go, exit 1 en fallo | ✅ Sí | Dif real en `init.sh`; gates estrictos confirmados línea por línea |
| CI `.github/workflows/ci.yml` con ledger + TS + Go | ⚠️ Parcial | Existe y cubre los 3 jobs, **pero NO tiene Postgres service container** como alega el walkthrough |
| Roles canónicos: `UserRole`/`ProductRole` unificados, 8 roles, `USER_ROLES` exportado | ✅ Sí | TS alineado a Go (Go ya era canónico con 8 roles en `backend-go/internal/domain/types.go:33`) |
| Paridad TS/Go "verificada 1:1" | ⚠️ Débil | Dos tests duplicados manualmente, no un contract fixture compartido (ver cambio requerido 4) |
| `PublicUserDTO` en login/refresh/admin users/staff + test anti-leak | ✅ Sí | `handlers.go`, `staff.go`, `TestPublicUserDTONeverLeaksSecrets`. Sin leak real: `PasswordHash` tiene `json:"-"` |
| `dataTruth.ts` con 5 orígenes + labels ES + tests | ✅ Sí | `DataTruthOrigin`, `DataTruthMetric`, `DATA_TRUTH_ORIGIN_LABELS_ES`, `dataTruth.test.ts` |
| Heurísticas etiquetadas `proxy` en engineering/purchasing | ✅ Sí | `cutPieceOrigin: 'proxy'` honesto (siempre `moduleCount * 8`); m²/ml/herrajes `actual\|proxy` según dato directo |
| `daysInWarehouse` con origen `actual` o `proxy` | ⚠️ Inexacto | El código sólo tiene `proxy \| missing` (`purchasing.ts:228`); no existe camino `actual` |
| UI con copy de estimación condicionado al origin del dominio | ✅ Sí | `EngineeringKpiStatsGrid.tsx`, `WarehouseDashboard.tsx` — UI presenta, no calcula |
| DS-10, DS-11, DS-17 resueltos en documentation-sync | ✅ Sí | Marcados con resolución real que coincide con el código |
| `./init.sh` global verde, 129 features, node v26.0.0, pnpm 11.1.2 | ✅ Sí | Reproducido por el revisor: exit 0, typecheck OK, tests TS OK, tests Go OK |
| "13/13 archivos verificados" | ⚠️ Inexacto | `HARNESS_FILES` tiene **12** archivos |
| "tests Go con Postgres service container" | ❌ Falso | No hay `services:` en `ci.yml` |

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0 (ejecutado por el revisor)
- C2: [x] 0 features `in_progress`; suite completa verde; `current.md` describe la sesión activa
- C3: [x] Boundaries respetados: `dataTruth.ts` es dominio puro sin imports ajenos; la UI consume `origin` calculado por el dominio (no calcula dominio en React); sin `console.log` nuevos
- C4: [x] Tests reales: `pnpm typecheck` OK, suite TS verde (123 files UI, 63 domain — coincide con el walkthrough), `go test ./...` verde (incluye `TestPublicUserDTONeverLeaksSecrets` y paridad de roles)
- C5: [ ] **Falla el cierre de sesión:**
  - trabajo **sin commitear ni push** (`git status`: 16 archivos modificados + 3 sin trackear; `git log origin/main..HEAD` vacío porque no hay commits);
  - `progress/history.md` no tiene entrada por esta sesión;
  - `progress/current.md` sigue conteniendo la sesión marcada `done` (no volvió a plantilla limpia);
  - `feature_list.json` sin entrada/nota para el trabajo OC (el título de Fase 5 dice "Reconciliación Ledger" pero el ledger no fue tocado).

## Diseño UI/UX (alcance mínimo: sólo copy condicional)

- D1: [x] Sin valores hardcodeados nuevos (sólo texto condicionado a `origin` del dominio)
- D2: [x] Sin cambio de patrón de pantalla
- D3–D6: N/A (sin modales/toasts/iconos/animaciones nuevos)
- D7: [x] Cambios de copy triviales, dentro del gate de DoD UI
- D8: [x] Copy en español, formato de datos legible; sin exponer internos de sistema

## Cambios requeridos

1. **Commit y push del trabajo** (regla dura del reviewer: no se aprueba trabajo no
   pushed; hoy ni siquiera está commiteado y `progress/current.md` ya dice "done").
2. **Cerrar la sesión correctamente:** entrada en `progress/history.md` y
   `progress/current.md` vuelto a plantilla limpia (C5).
3. **Corregir los overclaims del walkthrough/documentación de la sesión:**
   no hay Postgres service container en la CI; el harness verifica 12 archivos
   (no 13); `daysInWarehouse` no tiene origen `actual`; "Media Access" del título
   de Fase 3 no tiene implementación (sólo DTOs). Ajustar `progress/current.md`
   para que la evidencia declarada coincida con lo real.
4. **CI Go:** `ci.yml` fija `go-version: '1.22'` pero `backend-go/go.mod` declara
   `go 1.25.0`. Alinear (pin >= 1.25) para no depender del auto-toolchain y evitar
   fallos/deriva en CI.
5. **Paridad TS/Go de roles** hoy es duplicación manual en dos tests. Según
   `docs/architecture.md` §7 ("no declarar paridad sólo por inspección manual"),
   dejar documentado como deuda o migrar a contract fixture compartido.
6. (Opcional, no bloqueante) `HandleOperatorsBySector` (`productionActivity.go:593`)
   sigue devolviendo `[]domain.User` crudo; no hay leak (`json:"-"`), pero usar
   `ToPublicUserDTOs` daría consistencia con OC-005.

## Nota

La **sustancia técnica está bien hecha y verificada en verde**: guardrails reales en
`init.sh`, roles consolidados correctamente, DTOs públicos con test anti-leak, y el
contrato de Data Truth implementado de forma honesta (proxies etiquetados, agregados
degradados a `proxy`/`missing`). El rechazo es por proceso de cierre (sin commit/push,
sin history, current.md sin limpiar) y por claims del walkthrough que no coinciden con
lo implementado (Postgres en CI, 13/13, media access, daysInWarehouse `actual`).

---

# Review — Issue #299 · Ronda 2 (2026-08-21, post-correcciones)

**Veredicto:** APPROVED

## Cambios requeridos de la ronda 1 — estado

1. **Commit y push**: hecho (commit único con la implementación + correcciones
   de review; el trabajo de ronda 1 nunca llegó a commitearse por separado, así
   que el commit final representa el estado revisado completo).
2. **Cierre de sesión**: entrada en `progress/history.md` y `progress/current.md`
   vuelto a plantilla limpia. ✓
3. **Overclaims corregidos**: la entrada de history describe lo real (sin
   Postgres-tras-bambalinas, sin media access; daysInWarehouse sin camino `actual`
   queda como deuda anotada). ✓
4. **CI Go**: `go-version: 1.25.x` alineado con `go.mod`; además pnpm se toma de
   `packageManager` (el pin v9 chocaba con `pnpm@11.1.2` — habría fallado la CI) y se
   agregó **Postgres service container + DATABASE_URL**, sin el cual los tests de
   integración de storage se saltaban con `t.Skip` (verde falso en CI).
   `structures_108_test.go` ahora aplica migraciones sobre base fresca. ✓
5. **Paridad TS/Go**: contract fixture real `contracts/roles.json` afirmado desde
   `packages/domain/src/rbac.test.ts` y `backend-go/internal/domain/rbac_test.go`
   (divergencia rompe CI en algún lado). ✓
6. **Operadores por sector** serializa `PublicUserDTOs`. ✓
7. **Ledger**: F134 dada de alta en `feature_list.json` con acceptance sin overclaims. ✓

## Checkpoints (ronda 2)

- C1: [x] `./init.sh` exit 0 (re-ejecutado tras las correcciones)
- C2: [x] 0 features `in_progress`; suite verde; `current.md` en plantilla limpia
- C3: [x] `contracts/roles.json` neutral (sin importar paquete); domain sigue puro;
  la UI sigue consumiendo `origin` del dominio
- C4: [x] typecheck + suite TS + go test verdes, incluida integración de storage
  contra Postgres (`DATABASE_URL`) en vez de skips silenciosos
- C5: [x] trabajo commiteado y pusheado; history entry; current limpio; F134 done

## Nota final

El primer run de la CI remota corresponde al push de esta sesión; si fallara por
detalles de entorno de Actions (no reproducibles localmente), se corrige en follow-up
sin reabrir el veredicto de la implementación.

**Confirmación (post-push):** la CI remota falló dos veces y en ambos casos eran
falsos-verdes locales que `./init.sh` no podía detectar — exactamente el trabajo que
OC-002 debe hacer:

1. pnpm@11.1.2 requiere Node >= 22.13; el job TS corría Node 20 y crasheaba
   (`node:sqlite`). Fix: `node-version: 22` en ci.yml.
2. `apps/desktop/build/icon.png` estaba excluido por `.gitignore` (`build/`), así que
   el test F075 pasaba local (archivo presente sin trackear) y fallaba en checkout
   limpio. Fix: asset trackeado con negación puntual de gitignore.

Run final verde: `32514021227` (Validate Ledger ✓ · TypeScript ✓ · Go Backend con
Postgres service ✓). Veredicto **APPROVED** definitivo.
