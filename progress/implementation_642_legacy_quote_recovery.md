# Informe de Implementación — Issue #642: Legacy Quote Recovery para presupuestos existentes

> **Estado:** `IMPLEMENTED_PENDING_REVIEW`
> **Rama:** `feat/642-legacy-quote-recovery`
> **Base:** `origin/main@a453cd000a89bc490b8282aab66fec26db77d6dd` (post-merge PR #673)
> **Fecha:** 2026-09-11
> **Autoridad:** Issue #642 (`status:approved`, OPEN), §16A/§16B de
> `docs/architecture/project-design-digital-thread.md`, prompt del propietario.

---

## 1. Causa exacta del bug de presupuestos antiguos

Las QuoteRevisions pre-#642 persisten `quote_revision_items` completos
(instancia, definición, versión, parámetros, materiales, lifecycle) pero no
tienen `commercialSnapshot`. El backend ya devuelve esos items en
`ListQuoteRevisionsByProject`; el frontend los DESCARTABA: `kind === 'legacy'`
renderizaba sólo un warning técnico, identidad "no disponible" y ningún
mueble — el usuario percibía su presupuesto anterior como roto. Además no
existía ningún comando soportado para crear la siguiente revisión cuando la
última era legacy (`CreateInitialQuoteRevision` exige ser la primera;
`RequoteProjectQuote` exige snapshot en la base).

## 2. Datos legacy recuperados (mostrados read-only)

`quote_revision_items`: FurnitureInstanceID, FurnitureDefinitionID,
definitionVersion, parameters (+ dimensiones derivadas de esos parámetros),
materialChoices (ids estables), lifecycleStatus. De la revisión: número,
status, timestamps reales created/published/accepted. En la lista: cantidad
de ítems activos e `isLegacy` (ya existía). Labels actuales de catálogo pueden
asistir como "etiqueta actual" explícitamente marcados — nunca como historia
congelada.

## 3. Datos históricos deliberadamente unavailable

Moneda congelada, identidad comercial congelada (nombre obra/cliente del
snapshot), breakdown y montos por línea, precio histórico total,
descriptores customer-facing congelados. El total se muestra "— No disponible
con precisión": nunca `0`, nunca recálculo desde `Project`/catálogo/
`priceSnapshot`.

## 4. UX final

- Lista: tarjeta con badge de estado real + chip "Cotización anterior" +
  "N muebles" + precio "No disponible".
- Detalle: header "Q1 · Cotización anterior" + meta (muebles conservados,
  timestamps reales); sección Muebles con las unidades persistidas read-only
  (dimensiones, Definición: `<id>`, Material GRUPO: `<id>`, lifecycle,
  "(etiqueta actual)" marcada); totales con "Precio histórico — No disponible
  con precisión"; CTA "Crear nueva revisión actualizada".
- Reconciliación: panel "Q1 · Cotización anterior" con explicación y el
  comando de modernización.

## 5. Flujo Q1 legacy → Q2 moderna

`POST /projects/{id}/quote-revisions` con `baseQuoteRevisionId` exacto
(extensión aditiva del comando inicial; OpenAPI regenerado). El server valida:
base = última exacta y SIN snapshot (`ErrQuoteRevisionNotLegacy` → 409 si ya
es moderna: requote es ese camino); sin gate de `Project.status` (#673).
Crea Q2 draft desde el estado comercial editable actual con snapshot canónico
nuevo, pineando la legacy como base. La fila legacy queda byte-idéntica
(probado); aceptar Q2 suprime la baseline legacy aceptada atómicamente.

## 5b. Re-entry: modernizar sólo si la legacy es la EXACT latest (#642 review)

La modernización sólo se ofrece mientras la revisión legacy sea la **exact
latest** del proyecto — por `revisionNumber`, nunca por orden de array ni por
status accepted (la autoridad comercial aceptada y la latest son cosas
distintas: Q1 accepted sigue siendo autoridad visible mientras Q2 draft
existe). Si ya hay una revisión moderna más reciente, la UI NO vuelve a
ofrecer "Crear nueva revisión actualizada" sobre la base stale (el backend la
rechazaría); en su lugar:

- Detalle: CTA "Continuar QN" (+ meta "QN en borrador") — `newerRevisionNumber`
  sale de la MISMA lista de revisiones ya consultada, sin queries extra.
- Reconciliación: panel honesto "Ya existe una revisión moderna más reciente:
  QN · <estado>" con "Abrir QN", que cambia el contexto a la revisión moderna
  sin mintar nada (sin Q3). El backend stale-base guard queda intacto.

## 6. Tests

- Storage (PostgreSQL real, `quote_legacy_recovery_test.go`, 4/4):
  modernize desde legacy draft (Q2 con snapshot, base pineada, Q1
  byte-idéntica + lifecycle moderno); modernize desde legacy ACCEPTED
  (supersede atómico, Q1 sigue sin snapshot); rechazo tipado con última
  moderna; conflictos de base stale/baseless.
- UI (`ProjectsScreen.test.tsx` 68/68): Test A (3 muebles visibles,
  parámetros/materiales, sin "Sin cotización", sin empty), Test B (precio
  no disponible, ni 0 ni estimación), Test C (campos persistidos invariantes
  ante mutación de catálogo; sólo cambia la etiqueta marcada), CTA routing,
  y re-entry (con Q2 existente: sin `legacy-modernize-btn`, CTA "Continuar Q2").
  Reconciliación (`ProjectReconciliationScreen.test.tsx` 38/38): resume panel
  cuando la legacy seleccionada no es latest (nunca segundo mint) y modernize
  CTA intacto cuando sí lo es.

## 7. Browser E2E

`tests/organization/quote-legacy-recovery.spec.ts` (Chromium + Go +
PostgreSQL efímero): seed del row-shape pre-migración vía DSN admin del gate
(`ORGANIZATION_TEST_DATABASE_URL`, sólo fixture — el flujo verificado es
API/UI real): legacy Q1 accepted con 3 unidades → lista honesta → detalle con
muebles persistidos y precio no disponible → "Crear nueva revisión
actualizada" → Q2 moderna con snapshot → re-entry (volver al detalle: Q1
sigue siendo autoridad visible, SIN CTA de modernizar, "Continuar Q2" →
reconciliación muestra "Ya existe una revisión moderna más reciente" y abre
Q2 sin mintar; revisiones = 2) → publish/accept Q2 → detalle migrado a
autoridad moderna → Q1 superseded (snapshot null, 3 items, 2 revisiones).

## 8. Gates

- Go storage enfocado: `TestQuoteLegacyRecovery*` 4/4 PASS (PostgreSQL real, 4.9s).
- Go completo: `go test ./... -count=1 -p 1` exit 0 en todos los paquetes sobre PostgreSQL efímero dedicado (storage 463.2s, pilotreadiness 250.4s). Las corridas iniciales contra el `muebles-postgres` compartido (puerto 5445) fallaron por contención multi-lane (`53300 too many clients` / colisión de migraciones) — documentada como limitación del entorno local, no de esta rama.
- UI: `ProjectsScreen.test.tsx` 67/67; `digitalThread` 157/157.
- Browser E2E (`scripts/organization-browser-gate.sh tests/organization/quote-legacy-recovery.spec.ts`): 1/1 PASS (15.4s) — seed legacy accepted con 3 unidades vía DSN admin del gate, flujo íntegro por API/UI real, incluyendo el arco de re-entry completo.
- Specs vecinos afectados: `quote-list-authority` + `project-reconciliation` — PASS.
- `pnpm typecheck`: 7/7; `pnpm openapi:check`: 0 drift; `git diff --check`: limpio.

## 9. Fuera de alcance

ProductionRelease authority / #673, Project.status, PTX/CADmatic, SketchUp,
3D hardware, Proyectar, dashboards, PDF/XLSX moderno, impuestos/descuentos,
warehouse/production downstream (#577). Sin migraciones: ningún backfill, la
fila legacy permanece intacta (trigger + política).
