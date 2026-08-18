# Sesión activa

- **Cambio en curso (sin feature del backlog): gating por etapa del proceso.**
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
