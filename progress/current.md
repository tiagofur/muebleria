# Sesión activa

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
