# Plan de refactor React + residuales backend (2026-10-04)

**Disparador:** léelo al planear una sesión de refactor de `apps/web` /
`packages/ui` / `packages/storage`, o al decidir dónde extraer algo de
AppContent/ShellView. **Audiencia:** agente writer que ejecuta una sesión;
owner para priorizar.

**Fuente:** reporte de ejecución 2026-10-04 (fix #1049 side-assignments +
slice #1052 construcción persistente, que atravesaron spec → backend Go →
4 capas React) y la evaluación agent-first React del mismo día. El backend
post-#1017 está completo en main (plan 2026-09-27); este doc define las
sesiones siguientes. Nada de esto está fileado todavía: cada sesión filea su
issue al arrancar, con OK del owner.

## Hechos verificados (main @ 3c4fa98a, 2026-10-04)

- Monolitos React: `apps/web/src/AppContent.tsx` (3.760 líneas, 1 componente
  raíz) y `apps/web/src/ShellView.tsx` (3.181), unidos por un `ctx` de ~100
  props. Trazar `updateComponent` del click al store toma ~6 saltos.
- Monolito TS en ciernes: `packages/storage/src/apiMappers.ts` (4.421 líneas;
  ya tiene suite de 2.857 en `apiMappers.test.ts`, pero sin paridad Go).
- Doble cerebro del draft de Component: `componentToDraft` en
  `packages/ui/src/components/componentDraft.ts` (293) y `draftToComponent`
  en `apps/web/src/stores/catalogMappers.ts` (147). 5 consumidores en total.
- `ComponentDraft` usa `string` para enums (placement, roles): los casts viven
  en el mapper en vez de en el tipo.
- Backend funcionó sin fricción de navegación (reporte 2026-10-04). Residuales:
  `Component` del dominio vive en `domain/module.go:333` + handlers en
  `modules_handlers.go`; el CRUD de componentes está fuera del spec acotado v1
  (tribal); triple mapeo a mano sin paridad (apiMappers ↔ tags Go ↔ SQL).

## Reglas transversales (ya ratificadas; este plan las aplica, no las inventa)

- Metodología §8.1: extracción-al-tocar; máx 1 extracción por PR; commit
  `refactor(<dominio>)` separado; move mecánico, verde por commit.
- "Lo nuevo no entra a monolitos": aplica a AppContent, ShellView **y
  `apiMappers.ts`** — cada entidad nueva mapea desde su propio archivo.
- Un escritor, rama aislada, issue al arrancar, review fresca, sin merge
  propio. Topología Inline Direct salvo que la sesión crezca.

## Sesiones React, en orden recomendado

1. **R1 — Contrato API de dos capas (docs-only).** Sección corta en
   `docs/architecture.md`: capa 1 = spec acotado v1 (cliente generado);
   capa 2 = CRUD hand-mapeado fuera del spec (componentes, etc.), con punteros
   exactos (`routes_catalog.go`, `modules_handlers.go`,
   `storage/components.go`, `packages/storage/src/apiMappers.ts`) y la regla
   para endpoints nuevos. Elimina el hallazgo tribal que costó sondas.
2. **R2 — Unificar el draft de Component en un módulo.** Mover
   `draftToComponent` (y sus tests) a `packages/ui/src/components/
   componentDraft.ts`: una conversación (entidad↔draft), un archivo, una
   dirección por función. Move mecánico; 5 consumidores; cero cambio
   semántico. `packages/ui` ya depende de `@granete/domain`.
3. **R3 — Paridad apiMappers↔Go con corpus compartido (+ B2).** Fixture JSON
   de Component en `contracts/fixtures` leído por el test TS
   (`packages/storage`) y por un test Go (`backend-go`): mismo input, mismo
   output. Empieza por Component; extensible por entidad. Guarda el triple
   mapeo antes de que `apiMappers.ts` crezca más.
4. **R4 — Tipar `ComponentDraft` con enums del dominio.** Tras R2 (mismo
   panel): placement/roles pasan de `string` a uniones de `@granete/domain`;
   los casts salen de los mappers y quedan en el tipo.
5. **R5 — Monolitos AppContent/ShellView, dos modos:**
   - **(a) Piggyback (siempre, obligatorio):** regla 8.1 en cada PR de
     feature — la sección de pantalla que el diff toca sale a su archivo.
     Candidatas por churn reciente: Construcción (#1052), Herrajes/maquinado
     (bug depthMm pasante), side-assignments.
   - **(b) Sesiones dedicadas (sólo si la cola de features está vacía):** una
     sección por sesión, move mecánico con ctx acotado, empezando por (a).

## Residuales backend (micro-sesiones, no bloquean React)

- **B1 — Renombre mecánico:** `Component` del dominio a
  `domain/component.go` (y evaluar `modules_handlers.go` →
  `components_handlers.go` si el archivo es mayormente de componentes).
  Cero cambio de comportamiento; `go test` verde por commit. Corrige el
  nombre que miente sin tocar lógica.
- **B2 — Parte Go de la paridad:** se ejecuta con R3.
- **B3 — Decisión del owner (no agendada):** llevar el CRUD de componentes al
  spec acotado v1 (APIs generadas) o mantenerlo en capa 2 documentado por R1.
  Es cambio de contrato, no refactor; requiere aprobación de alcance.

## Coordinación y arranque

- El agente de perforaciones/KDT opera backend/contracts/plugin. **R1 y R2 no
  colisionan** (docs + packages/ui/apps/web imports). R3 toca tests de
  backend-go → agendar después de ese agente o coordinar reservas. R5 (a)
  sigue las features, no compite.
- **Arranque:** al recibir el OK del owner (cuando termine el agente de tests
  reales de perforaciones y XML KDT), filear issue de R1 y ejecutar. Una
  sesión = un PR; el progreso se mide con las métricas §6 de la metodología
  (tamaño máximo de archivo, blast radius), no con un ledger nuevo.

## No-goals

Sin big-bang, sin reescrituras, sin mover invariantes, sin consolidar
catálogos/docs. R2/R3/B1 son moves mecánicos: cualquier mejora de lógica es
otra issue.
