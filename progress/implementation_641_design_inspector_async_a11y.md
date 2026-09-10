# Issue #641 — Design inspector async and accessibility correction

- Estado: `IMPLEMENTED_PENDING_REVIEW` (corrección autorizada para PR #648).
- Base exacta del PR: `a20bc412bff0e4f6579d690385f7d40bec5658ea`.
- Head recibido: `5b9592aef900dbef273fb7b90627da4475e832fa`.
- Rama: `fix/641-design-inspector-async-a11y`.
- Sin merge, cierre, aprobación propia ni cambios de metadata de GitHub.

## Corrección

1. El borrador de trabajo muestra un estado accesible durante la carga inicial.
2. Un fallo de actualización con datos cacheados conserva el borrador conocido,
   lo identifica como desactualizado y ofrece reintento.
3. Una lista de revisiones vacía en cache no se presenta como ausencia de negocio
   cuando falla la actualización: prevalece un error explícito con reintento.
4. Los estilos nuevos usan tokens del sistema de diseño; se eliminó la franja
   lateral de 3 px y los fallbacks/tamaños de tipografía y espaciado hardcodeados.
5. Los iconos Lucide introducidos por el PR usan `strokeWidth={1.5}`.

## Evidencia

- Unitario focal UI: `ProjectDesignsScreen.test.tsx` — 55/55 PASS.
- Typecheck completo del monorepo: PASS.
- Browser gate real: `project-designs.spec.ts` — 4/4 PASS sobre
  Chromium + Go + PostgreSQL efímero.
- `git diff --check`: PASS.

## Go Backend Tests del run 34493299232

El fallo observado no fue una aserción de #641: el job agotó el timeout global
de 10 minutos en `internal/storage` mientras
`TestHardwareLineQuantityDoublePrecision` aplicaba migraciones. El PR no modifica
archivos backend. Por eso no se alteró Go fuera de alcance; el rerun del head
exacto debe confirmar si fue transitorio.

## Archivos de la corrección

- `packages/ui/src/digitalThread/ProjectDesignsScreen.tsx`
- `packages/ui/src/digitalThread/ProjectDesignsScreen.test.tsx`
- `packages/ui/src/digitalThread/digitalThread.css`
- `progress/current.md`
- `progress/implementation_641_design_inspector_async_a11y.md`

