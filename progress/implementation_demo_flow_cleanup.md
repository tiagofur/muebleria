# Demo Flow Audit & Cleanup — #642 happy path simplification

- Approval: prompt del propietario (2026-09-12). Refs #642 (y convivencia con #577,
  sin absorber su trabajo downstream).
- Base exacta `origin/main@009360e2`; rama `feat/642-demo-flow-happy-path`. Single
  writer GLM. Sin merge ni cierre.
- Result: `IMPLEMENTED_PENDING_REVIEW`.

## Mapa BEFORE (auditoría real, código leído — no sólo tests)

Flujo real recorrido pantalla por pantalla (Cotizaciones → Reconciliación →
Diseños → Producción), con la autoridad que gobierna cada paso:

| Paso | Pantalla | Acción | Autoridad usada | Estado BEFORE |
|---|---|---|---|---|
| Crear proyecto | `ProjectsListView` | "Nueva cotización" | Project draft | OK |
| Agregar muebles | `ProjectDetailView` | modal add-item | ítems del draft | OK |
| Crear Q1 | Reconciliación (desde chrome "Crear nueva revisión" o menú Hilo digital) | `create-initial-quote-btn` | QuoteRevision draft | OK |
| Publicar Q1 | Reconciliación `QuoteLifecyclePanel` | `publish-quote-btn` | QuoteRevision exacta | OK |
| Aceptar Q1 | Reconciliación `AcceptQuoteModal` | `accept-quote-btn`→confirm | QuoteRevision exacta; NO toca Project.status (verificado Go `quote_lifecycle.go`) | OK |
| Crear diseño | Diseños / SketchUp pairing | fuera de alcance | DesignRevision | OK |
| Publicar R1 | SketchUp contract / API | `publishDesignRevision` | DesignRevision inmutable | OK |
| Reconciliar | `ProjectReconciliationScreen` | selectores Q/R planos + tabla de 8 contadores | reconciliación server-owned | CONFUSO (ver P1) |
| Requote | header tabla unidades | "Nueva cotización desde Q1" | requote exacto | ENTERRADO (ver P1) |
| Q2 | ídem Q1 | publicar/aceptar | ídem | OK |
| Aprobar R | `ApprovalPanel` | "Aprobar revisión exacta" | gate server Q/R | SIN contexto de par (ver P1) |
| Liberar | `ReleasePanel`→`ReleaseReviewModal` | "Crear liberación"→"Liberar a producción" | ProductionRelease(QN,RN) | OK, sin salida contextual (ver P1) |
| Abrir Producción | chrome Cotizaciones `Abrir en Producción` | `releaseAuthorityOf` canónico | OK |

Backend verificado (auditoría, sin cambios necesarios):

- `AcceptQuoteRevision` (Go) NO escribe `projects.status` en la tx — sólo
  `quote_revisions` + audit (#673 documentado en el propio storage).
- `enforceProductionGates` rechaza par con `requiresResolution ||
  requiresRequote` (`EvaluateReleaseCommercialGate`) — fail-closed server-side.
- El único comando moderno de release es `POST /projects/{id}/production-releases`.
- "Aceptar Obra (Flujo Clásico)" YA no existía como texto/UI (entregas previas
  de #642); quedaban residuos de plumbing y un camino OC-022 parcialmente
  alcanzable (ver hallazgos).

## Hallazgos (clasificación P0/P1/P2)

### P0 — descubierto y corregido durante el E2E del golden flow

**El workspace de Producción (`/orders/:id`) estaba gateado por status
legacy**: `filterProductionVisible`/`isProductionReady`/
`projectAllowsProductionOrder` filtraban por `status accepted|produced`, de
modo que un proyecto DT (que conserva `status = draft` para siempre) con
ProductionRelease canónica activa NO podía abrir su orden de fábrica —
"Abrir en Producción" navigaba a "Orden no encontrada". Además, el read
model de proyectos del store web (zustand ← workspace) no se enteraba del
release creado por los comandos React Query de Reconciliación.

Corregido con la MISMA política de manufacturing authority ya establecida
(#642/#577): `projectAllowsProductionOrder` y `filterProductionVisible`
aceptan `releaseAuthorityOf(p).source === 'canonical'` (status legacy queda
como compatibilidad pre-DT), y ambos handlers `onOpenInProduction`
(chrome Cotizaciones y éxito de release en Reconciliación) refrescan el
read model del workspace antes de navegar. Regresión:
`productionOrderModel.test.ts` (draft + release canónica → orden permitida)
y el E2E golden (hub visible con status draft).

### P0 (backend) — ninguno

El backend ya cumple: accept Q no sincroniza Project.status; ProductionRelease
es la única autoridad de fabricación DT; gates exactos fail-closed. No se
encontró un camino que permita avanzar incorrectamente hoy.

### P1 — confunden el happy path de demo (implementados)

1. **Selectores Q/R planos sin linkage**: al elegir Q2 el R quedaba como
   estaba; el usuario podía armar Q2+R1 incompatible y descubrirlo por 409
   tardío. El botón de aprobar estaba habilitado aunque el par tuviera cambios
   comerciales.
2. **Reconciliación técnica primero**: 8 contadores + tabla dominaban; no
   existía la frase simple "el cambio afecta la cotización / es sólo técnico"
   con una única acción clara arriba.
3. **Sin salida contextual tras P1**: el éxito de liberación no ofrecía
   "Abrir en Producción"; había que navegar manualmente.
4. **"Marcar en producción" en el chrome de Cotizaciones** duplicaba semántica
   de release en la misma pantalla donde ya existe "Abrir en Producción"
   (condición literal `status === 'accepted'`; sólo pre-DT sin workspace).
5. **`ProjectFloorProgressStrip` gateado por `project.status` accepted/produced**:
   jamás visible para proyectos DT (status queda `draft` para siempre).
6. **Botón no-op "Evaluar 6 Gates"** en `LifecyclePanel` (ctx.onOpenReleaseModal
   nunca poblado) — botón visible que no hacía nada.
7. **Modal OC-022 alcanzable para proyectos DT** vía staleness banner (gate
   sólo miraba `source !== 'canonical'`, no distinguía DT).
8. **Plumbing muerto**: cadena completa `onChangeStatus` (draft→quoted→accepted)
   sin caller UI; cadena `onReopen`/`ProjectConfirmReopenModal` nunca
   disparable; `ConfirmDialog`/`pendingConfirm` en `ProjectDetailView` sin
   setter; copy huérfano del MetaModal ("usá Aceptar / Enviar / Reabrir en el
   detalle" — botones que ya no existen).
9. **Label de aprobación sin par**: "Aprobar revisión exacta" no decía qué
   pareja se aprueba.
10. **Sync manual tras requote**: la Q nueva creada no quedaba seleccionada;
    el usuario tenía que re-seleccionarla para publicarla.

### P2 — documentados, NO absorbidos

- "Enviar a Producción" legacy en `EngineeringWorkspace`
  (`sendProjectToProduction`, handshake pre-DT) — fuera del happy path demo.
- `exportCommercialQuote` congela por `isProjectClosed(status)+priceSnapshot`
  — coexiste con los exports exactos por QuoteRevision; no tocar aquí.
- `statusOptionsForRole` (helper deprecated "kept for tests") — inofensivo.
- Export Optimizer client-side desde Cotizaciones/Ingeniería — ya gated por
  autoridad de fabricación (`projectAllowsProductionChrome`); compatibilidad
  pre-DT documentada en el propio código.

## Caminos legacy encontrados vs eliminados

Encontrados (inventario con file:line en la auditoría):

| Camino | Disposición |
|---|---|
| `changeProjectStatus` (draft→quoted→accepted vía PUT) | ELIMINADO de UI (cadena ProjectsScreen→DetailView→context→Header + AppContent/ShellView). El endpoint PUT permanece (compatibilidad de datos; sin caller UI). |
| `onReopen` + `ProjectConfirmReopenModal` + `confirmReopen` | ELIMINADO (modal nunca disparable; store `reopenProject` permanece para otros consumers). |
| "Marcar en producción" chrome Cotizaciones | ELIMINADO del chrome. Store + `ProductionQueue`/`ProductionWorkspace` lo conservan (lifecycle operacional #577). |
| Botón no-op "Evaluar 6 Gates" (`LifecyclePanel`) + `ctx.onOpenReleaseModal` | ELIMINADO. |
| Modal release OC-022 para proyectos DT (vía staleness banner) | BLOQUEADO: el opener sólo se pasa cuando no hay quote authority DT (pre-DT). Pre-DT lo conserva (compatibilidad acotada). |
| `pendingConfirm`/`ConfirmDialog` muerto en `ProjectDetailView` | ELIMINADO. |
| Copy huérfano MetaModal | CORREGIDO ("el estado comercial se gestiona en la revisión de cotización"). |
| "Aceptar Obra (Flujo Clásico)" | Ya no existía (verificado); el E2E nuevo fija su ausencia como regresión. |

## Happy path AFTER

```text
Proyecto (draft) → agregar muebles
→ [Reconciliación] Crear Q1 → Publicar Q1 → Aceptar Q1
→ diseño R1 (SketchUp/API) → veredicto simple:
   "sincronizado" | "afecta el precio" [Crear cotización actualizada] | "conflictos"
→ cambios comerciales → Crear Q2 (queda seleccionada) → Publicar Q2 → Aceptar Q2 (supersede atómico)
→ Aprobar R2 para Q2 (bloqueado preemptivamente si el par no es compatible)
→ Liberar a producción → P1(Q2,R2)
→ [Abrir en Producción] → workspace de fábrica
```

- Primary CTA por estado en Reconciliación: draft→Publicar QN; published→Aceptar
  QN; par limpio→Aprobar R para Q; aprobado→Crear liberación; P1→Abrir en
  Producción (contextual en el éxito).
- El chrome de Cotizaciones mantiene: "Gestionar QN" (no aceptada) /
  "Abrir en Producción" (release authority) como primary único.

## Comportamiento Q1/Q2/R1/R2

- Seleccionar QN pinea R = `QN.sourceDesignRevisionId` cuando existe en el
  diseño activo (linkage exacto de datos; la elección explícita del usuario
  sigue ganando). La opción marcada "· origen de esta cotización".
- `Aprobar R para Q` deshabilitado con hint honesto cuando la clasificación
  server del par es `requiresResolution` (conflictos) o `requiresRequote`
  (cambios comerciales) — la MISMA verdad que el server enforcement usa; null
  (reconciliación no cargada) no bloquea (server sigue fail-closed).
- Tras requote, la Q nueva queda seleccionada automáticamente.

## ProductionRelease final

- Único camino moderno: `POST /projects/{id}/production-releases` con
  `design_revision_id` + `quote_revision_id` exactos (sin cambios).
- `Abrir en Producción` funciona con `Project.status = draft` (verificado por
  E2E: release canónico `source=canonical` con status draft).
- FloorStrip del detalle Cotizaciones ahora sigue `hasProductionReleaseAuthority`
  (release canónica o compatibilidad pre-DT), no el status literal.

## Archivos modificados

UI (`packages/ui`):

- `digitalThread/ProjectReconciliationScreen.tsx` — banner veredicto, linkage
  Q→R, marcador de opción, gate de par en ApprovalPanel, auto-pin tras requote,
  CTA "Abrir en Producción" en éxito de release, prop `onOpenInProduction`.
- `digitalThread/ReconciliationCommandPanels.tsx` — `ApprovalPanel`:
  `designRevisionLabel`, `pairCommercialBlocked`, hints
  `approval-pair-{conflict,commercial}-hint`, label "Aprobar R para Q",
  disabled preemptivo.
- `projects/components/detail/ProjectDetailHeader.tsx` — ChromePrimary sin
  `mark-produced`; botón eliminado; props muertas eliminadas.
- `projects/components/ProjectDetailView.tsx` — `resolveChromePrimary`
  simplificado; FloorStrip por release authority; opener OC-022 sólo pre-DT;
  `ConfirmDialog`/`pendingConfirm` muerto eliminado; cadenas
  onMarkProduced/onChangeStatus/onRequestReopen/canReopen/canMarkProduced
  eliminadas.
- `projects/components/projectDetailContext.tsx` — campos muertos eliminados
  (`onOpenReleaseModal`, status/reopen/markProduced).
- `projects/ProjectsScreen.tsx` — props legacy eliminadas.
- `projects/components/ProjectModalsContainer.tsx` — modal Reabrir eliminado.
- `projects/components/ProjectConfirmReopenModal.tsx` — ELIMINADO.
- `projects/components/LifecyclePanel.tsx` — botón no-op "Evaluar 6 Gates"
  eliminado.
- `projects/components/detail/ProjectDetailToolsContent.tsx` — pass eliminado.
- `projects/components/ProjectMetaModal.tsx` — props deprecated eliminadas;
  copy corregido.
- `projects/helpers/useProjectsScreenState.ts` — estado `confirmReopen`
  eliminado.

Web (`apps/web`):

- `ShellView.tsx` — `onOpenInProduction` en Reconciliación; wiring muerto
  eliminado (changeProjectStatus, reopenProject, canReopen,
  canForceReopenClosed, onMarkProduced/onReopen a ProjectsScreen).
- `AppContent.tsx` — callbacks muertos eliminados.

Producción (`packages/ui/src/production`):

- `productionOrderModel.ts` — `projectAllowsProductionOrder` por
  manufacturing authority (+ regresión).
- `productionHelpers.ts` — `filterProductionVisible` por manufacturing
  authority.

Además `ShellView.tsx`: la cola de Producción incluye proyectos con release
canónica y ambos `onOpenInProduction` refrescan el workspace antes de
navegar (`refreshWorkspace` del ctx).

Tests:

- `packages/ui/src/digitalThread/ProjectReconciliationScreen.test.tsx` —
  fixtures de aprobación con par limpio (la verdad server); 5 tests nuevos
  (gate commercial/conflict/spatial, linkage Q→R, CTA release→producción).
- `packages/ui/src/projects/ProjectsScreen.test.tsx` — props legacy
  retiradas de fixtures.
- `packages/ui/src/projects/components/LifecyclePanel.test.tsx` — prop
  retirada.
- `tests/organization/demo-flow-happy-path.spec.ts` — NUEVO E2E browser real.

Docs:

- `docs/architecture/project-design-digital-thread.md` — § UX del flujo
  (ver commit).
- Este reporte.

## E2E golden flow

`tests/organization/demo-flow-happy-path.spec.ts` (Chromium + Vite + Go +
PostgreSQL efímero vía `scripts/organization-browser-gate.sh`):

1. Q1 creada/publicada/aceptada por UI (`create-initial-quote-btn`,
   `publish-quote-btn`, `accept-quote-btn`+confirm).
2. Negativos UX: sin "Flujo Clásico"/"Aceptar Obra".
3. R2 con cambio comercial (API soportada): banner "afecta el precio",
   aprobación bloqueada con hint del par (nunca 409 tardío).
4. Requote por UI desde la acción única del banner; Q2 queda seleccionada;
   opción R marcada "origen de esta cotización"; selector Q = Q2.
5. Publicar/aceptar Q2 (hint de supersede atómico de Q1).
6. "Aprobar R2 para Q2" habilitado sólo con par compatible; release P1 por UI.
7. Negativos: sin "Re-evaluar Liberación", sin "Enviar a Producción", sin
   "Marcar en producción".
8. CTA "Abrir en Producción" navega a `/orders/{projectId}` con fabric card.
9. Chrome Cotizaciones: `project-open-in-production` visible,
   `project-mark-produced` ausente, FloorStrip visible, con
   `Project.status = draft` y `resolved_production_release.source = canonical`
   pineado a R2 + Q2 (readback HTTP).

## Verificación (HEAD exacto de la rama)

- `pnpm typecheck`: 7/7 PASS.
- `pnpm test` (monorepo completo): domain 1407 / storage 191 / excel 341
  (+3 skip hardware preexistentes) / desktop 17 / mobile 73 / ui 1758 /
  web 461 — exit 0.
- Browser gate completo (`scripts/organization-browser-gate.sh`):
  **52/52 PASS (2.9m)**, incluyendo el spec nuevo
  `demo-flow-happy-path.spec.ts` y todos los vecinos (reconciliation,
  golden path #644, quote-list-authority, quote-legacy-recovery, designs,
  furniture, pairing, gate-a, mfa, webauth, switch).
- `GOFLAGS=-p=1 go test ./... -count=1`: todos los paquetes OK; storage
  re-ejecutado aislado PASS (360s sobre PostgreSQL real) tras un flake de
  carga cuando corrió en paralelo con el gate browser (sin cambios Go en
  este PR).
- `pnpm openapi:check`: sin drift (cero cambios de contrato).
- `git diff --check`: limpio.

## Limitaciones restantes para la demo

- El legado "Ver/Revocar" del ciclo OC-022 ya no tiene entrada desde el tab de
  lifecycle (el botón era no-op); pre-DT conserva el banner stale → modal.
- "Enviar a Producción" de Ingeniería sigue siendo handshake pre-DT (P2
  documentado, fuera de alcance).
- La publicación de revisiones de diseño del E2E usa el contrato API
  soportado (el host SketchUp licenciado queda fuera de CI por contrato).
- El grid técnico de 8 contadores sigue visible bajo el banner (decisión
  deliberada: aditivo, sin romper las ~15 aserciones E2E vecinas que lo
  consumen).
