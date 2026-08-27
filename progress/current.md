# Sesión

**Feature en curso:** F182 — AISLAMIENTO CROSS-ORG DE LAS FAMILIAS RESTANTES + GUARDRAILS (COMPLETADA)
**Cerrados con evidencia (ledger done):** F169–F181 (PRs #419/#424/#427/#428) + F182
**Rama:** `feat/f182-org-isolation-families` (desde origin/main post-#428)
**Contexto:** ronda de reconciliación de backlog (11 issues prioritarias + barrido
completo de abiertas). Cerradas con evidencia: #366, #418, #309, #310, #422, #423.
#421 quedó PARTIAL con alcance exacto documentado → esta feature lo cierra.

## F182: tests de aislamiento de las 11 familias + fix de PKs globales

`backend-go/internal/storage/multi_org_isolation_families_test.go` (patrón
`isolationSetup`/`scoped` de F171) cubre las familias que #421 listaba sin test:
stock, purchase orders, warranties, internal messages, project picking, project
templates, ambient materials, ambient categories + los mutadores de proyecto
(quality, part executions, installation, material planning, site survey) ahora
también en su pata de **write**: mutar la obra ajena devuelve el mismo sentinel
not-found que una obra inexistente y el mutator jamás corre; own-org llega al
mutator.

### Bug real de tenancy encontrado y corregido (migración 000091)

`material_stock` y `project_picking` conservaban PKs **globales**
(`(kind, material_id)` / `(project_id, material)`) tras el scoping multi-org.
Los `ON CONFLICT ... DO UPDATE` de `UpsertStockMin` y `UpsertProjectPicking`
resolvían el conflicto contra la row de la OTRA organización y la mutaban
(min_stock de A cambiado desde contexto de B; ídem status del picking). La
migración 000091 vuelve ambas PKs org-scoped — igual que todos los demás
uniques de negocio (verificado contra pg_constraint: eran las dos únicas
globales residuales sobre tablas scoped) — y se actualizaron los conflict
targets de los dos upserts. Tests de regresión afirman por SQL directo que el
upsert cross-org crea la row propia del caller sin tocar la de la víctima.

Explotabilidad era baja (requiere conocer el UUID material/obra ajeno, no
listable cross-org), pero violaba el contrato "un contexto scoped jamás
escribe la row de otra org" (ADR-0005).

### Guardrails de proceso (trampa de PRs apilados, 2 incidentes: #330/F142 y #420/#418)

- `docs/verification.md` §4 nuevo subsection "PRs apilados y cierre de issues":
  confirmar base del PR antes de mergear; cierre manual sólo con contenido
  verificado en main; referencia al watchdog.
- `.github/workflows/issue-reconcile.yml`: semanal (lunes 12:00 UTC) +
  workflow_dispatch. Marca con un comentario (marcador HTML, dedup) las issues
  abiertas cuyo cierre fue **declarado** (`Closes/Fixes/Resolves #N`) en un PR
  ya mergeado — a main o a rama intermedia. Filtro elegido tras dry-run contra
  el backlog real: por referencia plain `#N` marcaría 34/38 issues (ruido de
  docs/tracking); por closing keywords marca 0 hoy (correcto: las dos trampas
  conocidas ya están resueltas) y cazaría la próxima. **Nunca cierra solo** —
  deja la decisión a revisión con evidencia.

## Verificación

- `go test ./internal/storage/ -run TestIsolation -count=1 -v`: 8 tests nuevos
  (13 subtests de mutators incl.) + 6 existentes, todos PASS contra
  PostgreSQL real (docker `muebles-postgres`, base efímera por test).
- `go test ./internal/storage/ -count=1` (paquete completo, 161+ tests): ok.
- `go test ./tests/pilotreadiness/ -count=1`: ok (migraciones desde cero
  incluyen 000091).
- `go test ./... -count=1` backend completo: exit 0, 9 paquetes ok.
- `TestMigrations_NoBusinessData` verde (000091 no inserta datos).
- `feature_list.json`: F182 done; 0 in_progress; validación CI local del
  esquema implícita (mismas reglas que ci.yml).
- Watchdog: primera ejecución real (dispatch post-merge #429) falló por una
  comilla simple sin cerrar en el programa jq del body (detectado por el
  propio run, no por CI — el job no compila bash). Fix + `bash -n` + dry-run
  completo contra el repo real con `gh issue comment` neutralizado:
  "Done: 0 issue(s) flagged" (correcto: ninguna issue abierta tiene cierre
  declarado en PR mergeado). Re-dispatch tras el fix: verde.
