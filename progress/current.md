# Sesión activa

- **Re-critique post-v2.1 (2026-08-19): score 28 → 30/40.** Trend: 24 → 28 → 30.
  Snapshot: `.impeccable/critique/2026-08-19T03-12-17Z__*.md`. Detector: 0.
  Veredicto visual: "ya tiene lenguaje visual propio" (cotizaciones),
  "se ve que alguien está al mando" (muebles). Subieron Consistencia (3→4)
  y Estética (2→3). Ruta a 32+: higiene de datos en UI (teléfono crudo,
  "schema v3"), nav (dos "Dashboard", 24 ítems), título de cards de
  cotización, ayuda contextual (H10=2).
- **Capa de craft v2.1 (2026-08-19): IMPLEMENTADA — post re-critique 28/40.**
  - Plan acordado con el dueño: controles+profundidad primero · P1+P2
    completo · temperamento **tonal** (Apple execution + Google M3 tonal).
  - Cambios (todo tokens, 0 hex nuevo):
    - **Controles**: `.btn` a `--radius-md` (8px) + `:active` (translateY 1px,
      primary 500→700) + primario con `--shadow-xs`→`sm`; chips de filtro a
      8px + active; Mismo lenguaje que `.tab-btn` (que ya lo tenía).
    - **Badges**: sin borde en semánticos (tinte `-50` + texto `-700` + dot);
      neutrales conservan borde. Fin del borde a saturación plena.
    - **Sidebar tonal**: activo 18%→28% del color de área + ícono en `-300`;
      labels de sección a `-300` pleno.
    - **Dashboard hero**: `.stat-card--emphasis` = borde brand-300 + lavado
      tonal sutil + chip brand + valor 28px (momento editorial).
    - **Muebles**: placeholder sin foto = silueta tintada `--area-eng-100`
      (antes caja dashed vacía).
    - **Login**: panel de marca indigo (brand-800 + BrandMark 64 + tagline)
      a la izquierda en ≥900px; submit con estados táctiles.
    - **sales.css**: 3 hsl sueltos → tokens; comentario que disparaba el
      detector reescrito (detector ahora **0 hallazgos**).
  - docs/design.md → v2.1 (política de radios §3.5, estados táctiles §5.1,
    badges §5.2, hero §5.4, sidebar §4.1, login §6.12, media Muebles §6.3).
  - Verificación: `pnpm test` monorepo verde + `pnpm typecheck` verde +
    detector 0 + pantallas verificadas en vivo (login/dashboard/materiales/
    muebles; screenshots V2-*.png en /tmp/muebles-critique2/, efímero).
  - Pendiente sugerido: re-critique para medir (meta 32+); P3 menores no
    tocados ("schema v3" en topbar — vive en App.tsx del shell (apps/web);
    teléfono crudo en card; dos ítems "Dashboard" en nav).
- **Re-critique UI (2026-08-18): completado — score 24 → 28/40.**
  - Score **24 → 28/40** (Good). Snapshot:
    `.impeccable/critique/2026-08-19T00-19-38Z__packages-ui-src-todas-las-pantallas-de-la-app-web.md`.
  - Veredicto: NO es slop AI banneado (detector: 1 hallazgo, `transition: width`
    sales.css:394, reincidencia). El gap restante es **craft estético** (heurística
    8 = 2/40): "crafted pero de molde". Traducción del "se ve web IA" del dueño:
    botones radio 4px sin `:active`/state layers, cards sin hover elevation,
    3 lenguajes de radio (4px btn / 8px input / pill chip), badges con borde
    -500 pleno, sidebar activo 18% alpha casi invisible, dashboard hero-metric
    template, login sin marca, cards de Muebles 100% texto.
  - Evidencia: 16 screenshots admin en `/tmp/muebles-critique2/` (efímero);
    init.sh verde (2114+ tests). Pendiente: plan de acción acordado con el dueño
    (preguntas de prioridad/alcance/intensidad).
- **Cerrada (2026-08-18): estandarización UI integral — IMPLEMENTADA y pushed.**
  - Commits: `bc9c526` (docs design v2) + `24f8923` (feat(ui) estandarización).
  - Todo el plan ①–⑦ ejecutado: headers unificados (aliases de .page-header,
    0 sistemas propios), 141 font-size → tokens, tokens muertos eliminados
    (solo excepción logo WhatsApp), color de área en sidebar/topbar/chips
    (--area-sales/eng/work), statusBadge.css + statCard.css comunes,
    Ingeniería rehecha (cards neutras + badges semánticos), ConfirmDialog
    común (0 window.confirm), destructivas btn--danger, copy sobrio.
  - Verificación: 2106 tests verdes + typecheck monorepo OK; pantallas
    verificadas en vivo (admin); evidencia en /tmp/muebles-critique/
    (NEW-*.png, efímero).
  - Pendiente sugerido: re-critique para medir score (meta 32+/40);
    Phase 3 de design.md (migrar editores LG a rutas propias) sigue abierto.
  - Nota: `packages/domain/src/processStage.{ts,test.ts}` modificados en el
    working tree son trabajo del dueño en paralelo (App.tsx ya los consume);
    NO fueron commiteados por esta sesión.
- **Sesión previa (cerrada, integrada): gating por etapa del proceso.**
  - **Critique completado (2026-08-18):** score 24/40. Snapshot:
    `.impeccable/critique/2026-08-18T18-53-56Z__packages-ui-src-todas-las-pantallas-de-la-app-web.md`.
    Evidencia: 28 screenshots en `/tmp/muebles-critique/` (efímero) + auditoría
    de consistencia (sub-agente) integrada al snapshot.
  - **Diagnóstico central:** no es slop AI (detector: 1 hallazgo —
    `transition: width` sales.css:413); es fragmentación por fases: 7 sistemas
    de header (page-header 22px vs eng/sales/purch 1.35rem vs producción 18px
    ×3 copias vs PM h1), 141 font-size literales, 15+ familias de badge,
    6 stat-cards, tokens muertos que renderizan paleta Tailwind (warranty 78
    hex, projectPhotosGallery 61, sectorAssignment, csvExport, whatsApp),
    UsersScreen con clases sin CSS, doble título topbar+header.
  - **Decisiones del dueño (2026-08-18):** (1) atacar **unificación primero**;
    (2) design.md = **evolución v2** (conserva núcleo bueno, agrega esqueleto
    único, color por área, stat-card/status-badge únicos); (3) color de área =
    **3 familias + neutro** mapeadas al proceso: VENTAS teal hsl(170) /
    INGENIERÍA+LIBRERÍA+CATÁLOGOS indigo marca hsl(245) / ALMACÉN+PRODUCCIÓN
    naranja hsl(25) ramp `--work-*`; TRABAJO+CONFIG neutro. Color solo señala
    ubicación (nav activo, sección, icon-chip), nunca reemplaza brand en
    acciones; (4) **sin zonas intocables** (no tocar dominio/export/backend
    en esta pasada).
  - **Plan acordado (orden):** ① document v2 (design.md: esqueleto de página
    + áreas) → ② unificación headers/tipografía (todas a page-header +
    `--text-*`) → ③ tokens muertos → ④ colorize por área → ⑤ extract
    stat-card/status-badge → ⑥ polish final + re-critique.
  - **Nota entorno:** password de `admin2@test.com` (cuenta test, DB local)
    reseteado a `Critique2026!` para capturar pantallas admin — cambiar si
    molesta (`backend-go/dev.sh admin reset-password`).
- **Sesión previa (cerrada, integrada): gating por etapa del proceso.**
  - Secuencia implementada: ventas (accepted) → **solo Ingeniería** → enviada
    a producción → **solo Almacén** (botón "Material completo") → material
    liberado → **Fábrica/Órdenes**. Una obra ya no aparece en todos lados a
    la vez.
  - Dominio: `packages/domain/src/processStage.ts`
    (`projectProcessStage`, `filterProjectsByProcessStage`,
    `canReleaseMaterials`, `PROCESS_STAGE_LABELS_ES`) + `canSendToProduction`
    en `engineering.ts` (exige ingeniería documentada) + campo
    `Project.materialsRelease` (`{releasedBy, releasedAt}`).
  - Persistencia: `materials_release` JSONB en `projects` (migración Go
    aditiva 000059, verificada en Postgres local); mappers en
    `packages/storage/apiMappers.ts` con round-trip testeado.
  - UI: Ingeniería (cola = etapa ingeniería, sección "Enviadas" read-only),
    Almacén (proyectos filtrados a etapa almacén + botón "Material completo"
    por card, admin/almacen), Fábrica (`fabricProjectCards` exige
    `materialsRelease`), Órdenes (`ProductionWorkspace` filtrado a etapa
    producción). Embarques/Instalaciones/Estado de Planta sin cambio
    (gatean por floorStatus / son overview).
  - Store: `releaseProjectMaterials` nuevo; `sendProjectToProduction` ya no
    permite bypass sin log documentado (test del bypass reemplazado por
    gate).
  - Tests: `pnpm test` (2114 tests) y `pnpm typecheck` verdes; `go test
    ./internal/...` verde; server arranca y aplica 000059.
  - Docs: `docs/project-lifecycle.md` §8 (implementación), tabla §3 +
    historial en `docs/production-module.md`.
  - Pendiente explícito: event log completo `ProjectEvent[]` con KPIs de
    tiempos (§5) — no pedido aún.
- **Último cierre:** F099 — Polish final del módulo Producción (APPROVED, 2026-08-18).
- **Próximo pendiente por id:** F077 — prep_venta_pricing_landing.
