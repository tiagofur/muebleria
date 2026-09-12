# Informe de Implementación — Issue #642: Golden path Q2+R2 → ProductionRelease sin `Project.status = accepted`

> **Estado:** `IMPLEMENTED_PENDING_REVIEW`
> **Rama:** `feat/642-release-without-project-accepted`
> **Base:** `origin/main@dee5e7a8aea5e60b808933f3d02482853bc98ff2` (post-merge PR #672; sin cambios de producto desde el merge de PR #664)
> **Fecha:** 2026-09-11
> **Autoridad:** Issue #642 (`status:approved`, OPEN), §16A/§17 de
> `docs/architecture/project-design-digital-thread.md`, prompt del propietario.

---

## 1. Resumen ejecutivo

El golden path comercial → producción ya no depende de —ni simula—
`Project.status = accepted`. El flujo exacto:

```text
Q2 accepted + R2 approved → ProductionRelease(Q2, R2)
```

se ejecuta completo con `Project.status = draft`, y una prueba negativa
explícita demuestra que un `Project.status = accepted` legado, por sí solo,
NO autoriza un release cuando la QuoteRevision exacta no está aceptada.

## 2. Dependencia legacy encontrada (mapa)

```text
DEPENDENCIA 1 — simulación legacy activa en el golden E2E
→ tests/organization/demo-golden-path.spec.ts (stage 10)
→ test 'stage 10 — ProductionRelease pinned to exact revisions with frozen snapshot'
→ comportamiento anterior: antes de createProductionRelease escribía
  Project.status='accepted' vía el PUT legacy completo ("FOUND_DOUBLE_TRUTH",
  observado por #644 y dejado como nota).
→ autoridad real ya existente en el server: CreateProductionRelease /
  enforceProductionGates validan QuoteRevision accepted + DesignRevision
  approved + reconciliation + preflight; NUNCA leen Project.status. La
  escritura auxiliar se eliminó y el stage 10 completo (release +
  part-executions canónicos + readback) se demuestra con draft.

DEPENDENCIA 2 — guards UI del chrome de Cotizaciones
→ packages/ui/src/projects/ProjectsScreen.tsx → productionExportOk (F041)
→ packages/ui/src/projects/components/ProjectDetailView.tsx → resolveChromePrimary
→ comportamiento anterior: 'Abrir en Producción' / export de producción sólo
  con project.status accepted|produced; con Q aceptada y proyecto draft los
  CTAs de avance comercial→producción nunca aparecían.
→ autoridad nueva (tras corrección de review): releaseAuthorityOf(project)
  canónico — el ProductionRelease exacto que el server resolvió. Una
  QuoteRevision aceptada NO habilita producción por sí sola; los statuses
  accepted|produced quedan compatibility-only para obras pre-DT (sin
  revisiones del Digital Thread). 'Marcar producida' permanece ligado al
  status literal del proyecto (es una transición de ese lifecycle legacy).

DEPENDENCIA 3 — observada, deliberadamente FUERA de alcance
→ tests/organization/project-reconciliation.spec.ts:755–761: tras P1, para
  continuar a Almacén se estampa Project.status='accepted' como comando
  operativo distinto (canReleaseMaterials / processStage).
→ packages/domain/src/processStage.ts / engineering.ts y filtros de
  ProductionWorkspace/PlantBoard: etapa operativa (#577 downstream).
```

El backend Go NO requirió cambios de producto: la autoridad ya era correcta
(`enforceProductionGates` en `backend-go/internal/storage/production_releases.go`).
Lo que faltaba eran las aserciones que la fijan y el retiro de la simulación.

## 3. Cambios

1. `backend-go/internal/storage/production_releases_test.go` — nuevo
   `TestProductionRelease_AuthorityIsQuoteRevisionNotProjectStatus`:
   golden (project draft en fixture → release OK con pines exactos Q3/R3 →
   project sigue draft) + negative (stamp SQL `accepted` + quote published →
   `ErrReleaseQuoteNotAccepted`; count de releases = 1).
2. `tests/organization/demo-golden-path.spec.ts` — stage 10 sin escritura
   auxiliar de `Project.status`; aserción draft antes y después del release;
   negative proof HTTP (409 'la cotización base no está aceptada' con proyecto
   estampado accepted + Q3 published); restore a draft y verificación de que
   P1 sigue siendo el único release.
3. `packages/ui/src/projects/ProjectsScreen.tsx` — `productionExportOk`
   gobernado por `releaseAuthorityOf(project)?.source === 'canonical'`.
4. `packages/ui/src/projects/components/ProjectDetailView.tsx` —
   `resolveChromePrimary` recibe `hasProductionReleaseAuthority`.
5. `packages/ui/src/projects/components/detail/ProjectDetailHeader.tsx` —
   copy del title de export alineada a la autoridad de fabricación.
6. `packages/ui/src/projects/ProjectsScreen.test.tsx` — tests #642.
7. `docs/architecture/project-design-digital-thread.md` — §16A regla 2 con
   `QuoteRevision.accepted ≠ Project.status accepted` + cadena de autoridad;
   §17 'Autoridad del release: par exacto, nunca Project.status'; fila nueva
   en el inventario de consumidores.

## 3b. Corrección de review (mismo PR #673)

La primera iteración equiparó, en la UI, `QuoteRevision accepted` con
plant-ready (`commerciallyAccepted`). La revisión independiente lo rechazó:
aceptación comercial ≠ autorización de fabricación. Corrección aplicada:

- `productionExportOk` y `resolveChromePrimary` ya NO consumen el status de la
  QuoteRevision. La condición moderna es
  `releaseAuthorityOf(project)?.source === 'canonical'` — el
  ProductionRelease exacto que el server resolvió (`resolved_production_release`).
- Legacy compatibility clasificada: los statuses `accepted|produced` sólo
  habilitan producción cuando la obra NO tiene revisiones de cotización del
  Digital Thread (`quoteAuthority` ausente/empty). En una obra moderna con
  QuoteRevisions, un `Project.status=accepted` accidental NO autoriza
  producción sin release — la UI cuenta la misma historia que el backend, que
  rechaza el comando.
- 'Marcar producida' permanece ligado al lifecycle literal (untouched).
- Tests UI reescritos (4 casos): quote aceptada sin release ⇒ cerrado; release
  canónico con project draft ⇒ 'Abrir en Producción'; stamp legacy sobre obra
  moderna ⇒ cerrado; obra pre-DT ⇒ compatibilidad preservada.
- E2E: `quote-list-authority.spec.ts` prueba pre-P1 (Q aceptada, sin release ⇒
  sin chrome de producción); `project-reconciliation.spec.ts` prueba post-P1
  (P1 canónico + Project.status draft ⇒ 'Abrir en Producción' visible, sin
  'Marcar producida').

## 4. Cadena de autoridad (después)

```text
QuoteRevision     → aceptación comercial (condición para crear el release)
DesignRevision    → aprobación técnica/diseño (contra la QuoteRevision compatible)
ProductionRelease → autoridad de fabricación, congela (QN, RN); habilita producción en UI
Project.status    → workflow operativo/legacy; fuera de la cadena comercial
```

## 5. Evidencia

- PR: https://github.com/tiagofur/muebleria/pull/673 (label único `type:feature`; issue #642 OPEN `status:approved`).
- Go storage (PostgreSQL real `localhost:5445`):
  `TestProductionRelease_AuthorityIsQuoteRevisionNotProjectStatus` PASS;
  suites `TestProductionRelease*|TestApproveDesignRevision*|TestDigitalThreadE2E*|TestRequote*|TestQuoteLifecycle*` PASS (80.077s).
- Go completo `go test ./... -count=1`: OK en todos los paquetes en ambos heads (storage 559.6s/538.0s sobre PostgreSQL real; pilotreadiness 247.2s/270.0s).
- `pnpm test` (head de corrección): domain 1407 / storage 191 / excel 335 (+3 skip hardware preexistentes) / desktop 17 / mobile 73 / ui 1738 / web 449 — todos PASS.
- `pnpm typecheck`: 7/7 paquetes, 0 errores.
- `pnpm openapi:check`: sin drift (sin cambios de contrato).
- Browser gate completo (head inicial, Chromium + Go + PostgreSQL efímero): 48/48 PASS (3.2m). Incluye `demo-golden-path.spec.ts` 10/10 con ledger final `Project.status=draft / Q1=superseded / Q2=accepted / R1=published / R2=approved / P1=active` y la negative proof del stage 10.
- Browser gate specs modificados por la corrección de review (head final): `quote-list-authority.spec.ts` 3/3 + `project-reconciliation.spec.ts` 4/4 = 7/7 PASS (56.1s), incluyendo las dos evidencias nuevas de autoridad de fabricación (pre-P1 cerrado; post-P1 'Abrir en Producción' con Project.status draft).
- `git diff --check`: limpio.

## 6. Fuera de alcance (documentado)

- #577 downstream: BOM/stock/warehouse/production execution siguen usando
  `Project.status` operativo (almacén/producción), incluida la estampa
  operativa post-release de `project-reconciliation.spec.ts`.
- Dashboard Inicio/Ventas (#642 Entrega 2B), PDF, XLSX, impuestos/descuentos,
  PTX/CADmatic, SketchUp, Proyectar, hardware, rediseño del lifecycle.

## 7. Nota operativa

El worktree principal compartido estaba siendo editado en paralelo por la lane
#667 (hardware 3D assets); esta lane trabajó desde un worktree aislado
(`git worktree`) sobre la misma rama, sin incluir archivos ajenos en sus
commits.
