# Informe de Implementación — Issue #642 Entrega 2A: Lista de Cotizaciones con autoridad comercial exacta (ronda de corrección)

> **Estado:** `IMPLEMENTED_PENDING_REVIEW`
> **Rama:** `feat/642-quote-list-authority` (PR #664, misma rama y PR; sin merge ni cierre)
> **Base:** `origin/main@6495085be8024a558bba35a47c0c5985e1465bdc` (contiene el merge de PR #663)
> **HEAD revisado por la review:** `9112dde8b47502f18c3568746a38f50015e05b25`
> **HEAD de esta corrección:** ver sección de evidencia exacta
> **Fecha:** 2026-09-11
> **Autoridad:** Issue #642, §16A de `docs/architecture/project-design-digital-thread.md`, `docs/demo/quote-authority-continuation-2026-09-11.md` y el prompt de corrección del propietario.

---

## 1. Resumen ejecutivo

Esta ronda completa la Entrega 2A de #642 sobre el PR #664 existente. La entrega previa
(`b4ce24bc` + `9112dde8`) introdujo el endpoint batch `GET /api/projects/commercial-summaries`,
el contrato OpenAPI generado, los componentes de UI y el retiro del lifecycle legacy, pero
dejaró el endpoint sin consumidor productivo y arrastraba seis bloqueos identificados en la
revisión. Esta corrección:

1. **BLOCKER 1 — Wiring real**: `ShellView` alimenta `ProjectsScreen` → `ProjectsListView`
   con un batch `useProjectsCommercialSummaries` (una sola request por scope de
   sesión/organización, cliente generado, key canónica tenant/session-scoped). Ya no existe
   el estado "endpoint existe pero nadie lo consume".
2. **BLOCKER 2 — Identidad comercial congelada**: un snapshot v1 válido pasa a ser dueño de
   `projectName`, `customerId`, `customerName` y `currency` del summary; el Project mutable
   ya no re-etiqueta la historia. La UI consume esa identidad congelada por tarjeta.
3. **BLOCKER 3 — Cantidad activa sin fallback**: `FurnitureQuantity = SUM(snapshot.lines.quantity)`
   sin fallback a `len(snapshot.Units)` ni a `quote_revision_items`. Un snapshot con
   `line.quantity = 0` y una unidad `removed` responde **0** (el historial no reviva demanda).
   Para revisiones legacy (sin snapshot) se cuenta sólo el item con `lifecycle_status='active'`.
4. **BLOCKER 4 — `commercialActivityAt` real**: ahora es nullable en el contrato
   (`string | null`); con revisión usa `acceptedAt → publishedAt → revision.createdAt`
   según lifecycle; sin revisión es `null`. `Project.updatedAt` jamás lo sustituye.
5. **BLOCKER 5 — Error ≠ Sin cotización**: el dataset de summaries se modela explícito
   (`loading | ready | error`) separado del `quoteStatus` por proyecto. En loading/error la
   tarjeta no muestra veredicto comercial ni precio legacy; los chips de filtro comercial se
   deshabilitan y el filtro no se aplica; sólo el `ready + quoteStatus:'none'` del servidor
   significa "Sin cotización".
6. **BLOCKER 6 — `saleTotal` cross-org fail-closed**: la organización que accede al proyecto
   sólo como `manufacturing_organization_id` recibe el summary con `saleTotal = null`; el
   owner y la sales organization lo ven. Decisión documentada en §4 (no se inventó una
   política mayorista nueva; se aplica el "ejemplo seguro" del prompt).

Además: invalidación de summaries en todo comando comercial (create/publish/accept/requote),
prueba negativa de que aceptar una revisión no escribe `Project.status`, regresiones backend
A–J en PostgreSQL real, E2E de browser real (Chromium + Go + PostgreSQL) con el escenario
central `Project.status=draft` + `Q2 accepted → LISTA y DETALLE muestran Q2 · Aceptada`,
evidencia anti-N+1, viewports 390/768/1280 y actualización de §16A.

---

## 2. Inventario de consumidores (#642) — clasificación final de esta entrega

| Consumidor | Clase | Tratamiento en esta entrega |
|---|---|---|
| Lista Cotizaciones (tarjetas, badges, filtros, totales, identidad, cantidad) | **MIGRATE_NOW** | Migrado al batch `commercial-summaries` con identidad congelada |
| Detalle Cotizaciones (cabecera, totales, líneas) | MIGRADO (PRs #649/#653/#663) | Sin cambios; verificado paridad lista↔detalle en E2E |
| Comandos comerciales (create/publish/accept/requote en Reconciliación) | **MIGRATE_NOW** | Invalidan el dataset de summaries en el mismo pass |
| `projectEstimates` (estimateLabel) en la lista | **REMOVE (de la lista)** | `estimateLabel` eliminado de `ProjectsListView`; `projectEstimates` sigue existiendo para el detalle (costing/version history) |
| Enviar/Aceptar clásico/Reabrir basados en `Project.status` | **REMOVE (superficie comercial)** | Retiro conservado de la entrega previa; verificado que `Abrir en Producción`/acciones operativas no se tocó |
| Dashboard Inicio/Ventas (`dashboardStats`, `dashboardRecent`, funnel) | **LATER_642 (2B)** | Fuera de alcance; siguen dependencias legacy |
| Operaciones/Producción (`Project.status` operacional) | **LEGITIMATE_OPERATIONAL** | No tocado; la entrega sólo retira `Project.status` como autoridad comercial |
| PDF/XLSX y export handlers | **LATER_642 (Entrega 3)** | No tocados |
| `priceSnapshot` (`quote_snapshots`) | **COMPATIBILITY_ONLY** | Sin cambio; sigue sin ser autoridad histórica |

---

## 3. Arquitectura final del batch read model

```text
ShellView (apps/web)
  └─ useProjectsCommercialSummaries  ← NUEVO (apps/web/src/projectsCommercialSummaries.ts)
       · useQuery({ queryKey: ['project-commercial-summaries', ...sessionScopeKey(scope)] })
       · GraneteApiClient.listProjectCommercialSummaries(token, signal)
       · enabled sólo con token; retry: false (política #663)
       · devuelve { idle | loading | error(message, retry) | ready(map, staleMessage, retry) }
       · la key incluye generation/userId/membershipId/organizationId/mode/… ⇒ cambio de
         organización o de sesión abre raíz de caché nueva (sin contaminación cross-tenant)
  └─ <ProjectsScreen commercialSummaries={} commercialSummariesStatus={} …/>
       └─ useProjectsScreenState (filtro comercial sólo con dataset ready)
       └─ ProjectsListView (tarjetas: badge, identidad, cantidad, actividad, precio)
            └─ CommercialStatusBadge (Cargando… / No disponible / Q{n} · Estado)

Backend
  GET /api/projects/commercial-summaries  (batch, sin N+1)
  ├─ storage.ListProjectCommercialSummaries: un query con LATERAL por proyecto
  │    · selección: accepted primero, si no newest exact (la invariancia de
  │      aceptación única 000121 garantiza a lo sumo una accepted)
  │    · activeDraftRevisionNumber sólo si la autoridad vigente es accepted
  │    · snapshot v1 → identidad/moneda/total congelados, qty = SUM(lines.quantity)
  │    · snapshot NULL → isLegacy=true, saleTotal=nil, qty = items activos
  │    · snapshot corrupto → error tipado (409 del batch completo, decisión §5.4)
  │    · commercialActivityAt = acceptedAt ?? publishedAt ?? createdAt ?? null
  │    · saleTotal visible sólo para organization_id / sales_organization_id
  └─ handler: RoleCanAccessProjects + RolesSeesAllOwners owner-filter (F034) + DTO
```

### 3.1 Selección de revisión (policy conservada y documentada)

- `accepted` gana; en ausencia, la revisión exacta más nueva (que puede ser `published`,
  `draft` o — caso alcanzable y por tanto conservado — `superseded`, porque la transición
  `published → superseded` es legal sin reemplazo). No se elimina el estado `superseded`.
- La detección de draft activa (`Q2 accepted + Q3 draft → activeDraftRevisionNumber: 3`)
  se conserva: Q3 nunca se convierte en autoridad vigente antes de aceptarse.

### 3.2 Invalidación

`ProjectReconciliationScreen.invalidateQuoteRevisionReads` (create, publish, accept,
requote) añadió `queryClient.invalidateQueries({ queryKey: queryKeys.commercialSummaries })`.
La key (`['project-commercial-summaries', ...scopeKey]`) se define en
`projectReconciliationQueryKeys` — la misma fuente que construye la key del hook. No hay
cascadas manuales de `setState`. Tras aceptar Q2 desde la UI, la lista muestra
`Q2 · Aceptada` sin refresh manual (probado en E2E).

### 3.3 Orden del endpoint y de la pantalla

El SQL mantiene `ORDER BY p.updated_at DESC` **como orden determinista del batch**, no como
"actividad comercial": la pantalla Cotizaciones conserva el orden del workspace de proyectos
y hace join por `projectId`. El contrato documenta que el orden no es por actividad comercial.

---

## 4. Decisión y evidencia de `saleTotal` cross-org

**Decisión: fail-closed para manufacturing-only.** El read model selecciona en SQL
`organization_id` y `sales_organization_id` y expone `saleTotal` sólo si el caller es owner o
sales org; si llega al proyecto únicamente como `manufacturing_organization_id`, el summary
se devuelve con `saleTotal = null` (el proyecto sigue visible; sólo se redacta el importe).

- Autoridad textual: `docs/multi-organization-distribution-model.md` §14 — "Retail
  price/margin: Sales org `yes by role` / Manufacturing org `not by default`" — y
  `docs/architecture/organization-foundation-v2.md` §11 ("no unless contract says so").
  No existe permiso RBAC ni contrato que autorice explícitamente a la fábrica el importe
  retail de una tienda, así que se aplica el ejemplo seguro del prompt (`SaleTotal = null`).
- No se derivan precios mayoristas, márgenes ni costos nuevos; el endpoint sigue sin exponer
  ningún campo de costo (protección #649 intacta).
- **Gap documentado para producto**: armonizar el read model existente de proyectos (hoy la
  fábrica ve `priceSnapshot.salePrice` vía `GET /projects`) con esta política exige una
  redacción server-side uniforme en TODAS las rutas de lectura de proyectos; queda
  registrado como decisión pendiente para la Entrega 3 (proyección comercial), no se cambió
  RBAC global para hacer pasar este endpoint.
- Evidencia: `TestListProjectCommercialSummaries_SaleTotalCrossOrgFailClosed` (PostgreSQL
  real: owner ve el importe, manufacturing-only recibe `null` con el summary visible).

---

## 5. Estados loading / error / none y decisiones conscientes

- `CommercialSummariesStatus = 'loading' | 'ready' | 'error'` llega desde el hook hasta la
  lista; `formatCommercialSummaryBadge` sólo se invoca con dataset ready.
- **Loading**: badge `Cargando…`; la tarjeta conserva identidad mínima de navegación
  (nombre del proyecto) y oculta cliente, cantidad, actividad y precio. Nunca muestra
  `Cargando + precio legacy + cantidad mutable`.
- **Error**: banner `No se pudo cargar la información comercial. [Reintentar]`; badge
  `No disponible` por tarjeta; sin "Sin cotización"; sin `estimateLabel`, `project.items.length`,
  `Project.status`, `Project.updatedAt`, `priceSnapshot` ni `calcProjectBreakdown` como
  verdad comercial; los chips comerciales se deshabilitan y el filtro no se aplica
  (`error → status none` es imposible por construcción y por test).
- **Ready + `quoteStatus:'none'`** (respuesta 200 del servidor): badge `Sin cotización`,
  identidad actual del Project (no existe baseline congelado), `0 muebles`.
- **Legacy** (`isLegacy`): badge `Cotización anterior`, sin `saleTotal` calculado
  (fail-closed), cantidad = items activos de esa revisión; la UI ofrece el camino existente
  "Crear nueva revisión para continuar". No se conserva una segunda UX comercial legacy.
- **Snapshot corrupto (§22)**: se mantiene el 409 del batch completo — comportamiento
  aprobado de esta entrega: una revisión corrupta no puede degradarse silenciosamente a
  "sin demanda" ni contaminar parcialmente la lista; el error tipado obliga a la reparación.
  Documentado en el contrato del endpoint.

---

## 6. Regresiones y pruebas nuevas

### 6.1 Backend Go — PostgreSQL real (`backend-go/internal/storage`)

| Caso | Test |
|---|---|
| A — Identidad snapshot vs Project mutable (mutación posterior de nombre/cliente/moneda) | `TestListProjectCommercialSummaries_FrozenIdentityFromSnapshot` |
| B — Cantidad 0 con unidad histórica removed | `TestListProjectCommercialSummaries_TerminalUnitsAreNotDemand` |
| C — `commercialActivityAt` null sin revisión; = `published_at` con revisión | `TestListProjectCommercialSummaries_CommercialActivityAtIsARealEvent` |
| D — Accepted + newer draft | `TestListProjectCommercialSummaries_AuthoritativeRevisionAndActiveDraft` (existente) |
| E — Q1 superseded + Q2 accepted; y published→superseded alcanzable | `TestListProjectCommercialSummaries_SupersededSelection` |
| F — Legacy sin snapshot fail-closed | `TestListProjectCommercialSummaries_LegacyRevisionFailClosed` (existente) |
| G — Snapshot corrupto → batch falla cerrado | `TestListProjectCommercialSummaries_CorruptSnapshotFailsClosed` |
| H — Política cross-org de `saleTotal` | `TestListProjectCommercialSummaries_SaleTotalCrossOrgFailClosed` |
| I — Owner filtering de vendedor | `TestHandleProjectCommercialSummaries_OwnerFiltering` (existente) |
| J — Organización no relacionada no ve el proyecto | `TestListProjectCommercialSummaries_MultiOrgIsolation` (existente) |
| §27 — Aceptar revisión NO escribe `Project.status='accepted'` | `TestAcceptQuoteRevision_DoesNotWriteProjectStatus` |
| — `commercialActivityAt` nullable en el wire contract | `TestHandleProjectCommercialSummaries_ActivityAtNullable` |

### 6.2 UI (`@granete/ui`)

- `ProjectsScreen.test.tsx` — 7 tests nuevos del bloque `#642 / 2A commercial summaries
  dataset states`: error≠none (banner + chips deshabilitados + sin precio legacy), loading
  (identidad mínima, badge pendiente), ready+none (identidad actual honesta), identidad
  congelada en tarjeta, `0 muebles` con unidad removida, legacy sin precio fabricado y
  `Q3 en borrador` secundario.
- `quoteRevisionPresentation.test.ts` — filtro comercial no aplicado con dataset
  loading/error; `none` sólo con dataset ready.
- El dataset del fixture de tests declara `commercialSummariesStatus: 'ready'`.

### 6.3 Web (`apps/web`)

- `projectsCommercialSummaries.wiring.test.ts` — contrato de wiring contra re-fusión:
  ShellView llama el hook con la key canónica y pasa las cuatro props de dataset; el hook
  usa el cliente generado con la política de query estándar; los comandos comerciales
  invalidan `commercialSummaries`; la lista no puede volver a caer a
  `estimateLabel`/`project.items.length`/`project.updatedAt`.

---

## 7. Evidencia de verificación (HEAD exacto de esta ronda)

Ver sección 9 (resultados por paquete, completados al final de la ronda).

---

## 8. Browser E2E

`tests/organization/quote-list-authority.spec.ts` — 3 pruebas en serie bajo el gate real
(`scripts/organization-browser-gate.sh`, Chromium + Go + PostgreSQL efímero, sin mocks para
los criterios de aprobación):

1. **Autoridad tras aceptar por UI**: Q1 create→publish→accept en el workspace de
   Reconciliación; navegación SPA a la lista muestra `Q1 · Aceptada`, identidad congelada y
   precio, sin refresh manual. Readback: `Project.status = 'draft'` (negativa §27).
2. **Q2 accepted gana + identidad congelada + viewports**: Q2 (requote con provenance de
   diseño R1) publicada y aceptada por API; mutación deliberada de `Project.name` y
   `Customer.name` después de Q2; la lista sigue mostrando identidad congelada, badge
   `Q2 · Aceptada` con `Q3 en borrador` secundaria; abrir la tarjeta mantiene la MISMA
   Q2 en detalle; viewports 390/768/1280 sin overflow horizontal.
3. **Error ≠ Sin cotización + recuperación**: interrupción de `/commercial-summaries`
   (intercepción sólo para inyectar el fallo) → banner + badge `No disponible` + chips
   deshabilitados + sin "Sin cotización" ni precio legacy; al retirar la intercepción el
   retry real recupera `Q2 · Aceptada`.

Anti-N+1 (§35): en una carga fresca de la lista se cuenta exactamente **1** request a
`/projects/commercial-summaries` y **0** requests a `/projects/{id}/quote-revisions`.

---

## 9. Resultados completos (por paquete)

Completados al final de la ronda; ver el cuerpo del PR para el readback final.

---

## 10. Limitaciones

- **saleTotal cross-org**: la fábrica ve el summary con importe redactado; el resto del
  sistema (`GET /projects`) todavía expone el importe a la fábrica — armonización pendiente
  como decisión de producto (Entrega 3). Este PR no cambia RBAC global.
- **Orden de la lista**: el orden visible sigue siendo el del workspace de proyectos
  (deliberado); el endpoint ordena determinista y el contrato lo documenta.
- **Snapshot corrupto**: un snapshot corrupto sigue fallando el batch completo (409) por
  decisión consciente de esta entrega; un future read model por-proyecto con error
  individual requeriría decisión de producto.
- **Quantities legacy**: para revisiones sin snapshot la cantidad es el conteo de items
  activos de la revisión (no hay contract de líneas); la UI lo presenta con el badge
  "Cotización anterior".
- El botón "Cotizaciones" de navegación y la identidad mínima de loading provienen del
  Project mutable por diseño (navegación, no verdad comercial).

## 11. Trabajo restante de #642 (no declarado terminado)

- **Entrega 2B**: Dashboard Inicio/Ventas, funnel, forecasting, `dashboardStats`,
  `dashboardRecent`.
- **Entrega 3**: PDF/XLSX/export handlers desde la revisión exacta; proyección comercial
  sin costos; armonización cross-org del importe retail.
- Operaciones/Producción: separar aceptación comercial de etapa operativa.
- #644: retiro de la escritura auxiliar legacy del golden cuando el recorrido lo permita
  (fuera de este PR).
