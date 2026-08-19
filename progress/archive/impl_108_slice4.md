# Impl #108 — Slice 4: Integración UI + handler HTTP Go

> Cierre de la feature "Versionado de estructuras" (#108).
> Slice 1 (dominio TS), 2 (Go), 3 (storage TS) ya APPROVED.
> Este slice hace visible el pin en la UI y conecta el handler HTTP Go para
> que el pin se capture al cerrar cotización en producción (cierre del path
> que el Slice 2 dejó como observación MAJOR).

## Resumen

1. **`App.tsx` `updateStructure`** ahora usa `bumpStructureRevision` del
   dominio: editar una estructura crea nueva revisión + snapshot.
2. **Badge "Rev N"** en StructuresScreen (lista) y ModuleEditorStructurePanel
   (picker) — componente `StructureRevisionBadge` reutilizable.
3. **Indicador "Rev N (cerrada)"** en ProjectsScreen para items con pin.
4. **Handler Go** captura pins al cerrar cotización (cierre del MAJOR del
   Slice 2).

## Archivos tocados

### UI TS

- `packages/ui/src/structures/components/StructureRevisionBadge.tsx` (NUEVO):
  componente puro de presentación. Props `structure? | revision?`, `variant`
  (`default` | `pinned`), `suffix?`. Normaliza `revision ?? 1` para legacy.
- `packages/ui/src/structures/structures.css`: estilos del badge usando
  tokens de `docs/design.md` (`--accent-600` teal informativo, `--text-muted`
  muted para pinned, `--text-xs`, `--font-mono`).
- `packages/ui/src/structures/components/StructureListView.tsx`: badge al
  lado del `code` en cada card (`testId=structure-revision-${code}`).
- `packages/ui/src/structures/index.ts`: reexporta `StructureRevisionBadge`.
- `packages/ui/src/modules/components/ModuleEditorStructurePanel.tsx`: badge
  de revisión de la estructura seleccionada junto al `<select>`.
- `packages/ui/src/projects/components/ProjectItemStructureRevisionIndicator.tsx`
  (NUEVO): wrapper del badge en variante `pinned` con sufijo "(cerrada)".
- `packages/ui/src/projects/ProjectsScreen.tsx`: indicador junto al título
  del item cuando `item.structureRevisionPin !== undefined`.
- `apps/web/src/App.tsx` (`updateStructure`, ~:1447): `bumpStructureRevision`.

### Backend Go (cierre del MAJOR del Slice 2)

- `backend-go/internal/api/handlers.go` (`HandleProjectByID`, ~:619): al
  transicionar a un estado cerrado (`statusChanging && IsProjectClosed(p.Status)`),
  carga catálogo vía `s.Store.GetFullCatalog` y llama
  `engine.CaptureProjectItemStructurePins(p.Items, catalog)` antes del
  `UpdateProject`. Comentario justifica el patrón inline (igual que
  `PriceSnapshot`).
- `backend-go/internal/api/handlers_test.go`:
  - `stubStore.GetFullCatalog` ya no paniquea (devuelve catálogo vacío por
    defecto); añade campo `catalogOverride *domain.Catalog` para tests que
    necesiten estructuras.
  - `TestF108_ClosingQuotePinsStructureRevision` (NUEVO): proyecto draft con
    item que referencia módulo→estructura rev 3, PATCH a `quoted` → el item
    queda con `StructureRevisionPin == 3`.

### Test UI

- `packages/ui/src/structures/StructuresScreen.test.tsx`: caso
  "#108: shows revision badge normalized to Rev 1 for legacy structures".

## Decisiones de diseño

1. **Badge reutilizable con variantes**: `StructureRevisionBadge` sirve para
   los dos contextos (lista/picker = informativo teal; ProjectsScreen cerrado
   = muted). El indicador de proyecto es un wrapper mínimo. Sin duplicación.
2. **Estilos en `structures.css`** (no en un CSS nuevo) porque el badge es del
   dominio structures. Tokens de `docs/design.md`: `--accent-600`/`--accent`
   teal para informativo, `--text-muted` + `--surface-hover` para pinned.
3. **Handler inline, sin refactor a `TransitionProjectStatus`**: el handler
   ya construye el snapshot de precios inline (no invoca
   `CaptureQuoteSnapshot`). Seguir ese patrón para los pins minimiza el
   cambio y respeta la arquitectura actual. Cerrar la brecha arquitectónica
   (migrar el handler a `TransitionProjectStatus` para snapshot Y pins) es
   trabajo mayor fuera de #108.
4. **`stubStore.catalogOverride`** en vez de hacer `GetFullCatalog` siempre
   no-vacío: respeta el patrón de "stub panics on unexpected" del repo
   mientras permite tests dirigidos.

## Autoverificación

```
$ pnpm typecheck   # verde (6 paquetes Done)
$ pnpm test        # monorepo verde
  domain 199, storage 41, excel 25, ui 297 (+1 badge test),
  web 87, desktop 9
$ cd backend-go && go build ./...   # verde
$ cd backend-go && go test ./...    # verde (api +1 test F108)
```

## Cómo se cumplen los criterios del issue

- [x] *"Cambio en estructura no muta en silencio cotizaciones cerradas"*:
  `updateStructure` bumpa revisión (UI) + handler captura pin (backend) +
  `resolveBom` re-resuelve contra pin (dominio, Slice 1).
- [x] *"Flujo claro para actualizarse vs quedarse en N"*: UI muestra "Rev N"
  en estructuras e "Rev N (cerrada)" en items pinneados. "Actualizar a última"
  queda como follow-up (lógica `captureProjectItemStructurePins` ya re-pinnea
  al recerrar).
- [x] *"Tests de no-regresión de snapshot"*: Slice 1 (TS) + Slice 2 (Go) +
  handler F108 + StructuresScreen badge test.

## Desviaciones del plan

1. **Handler inline en vez de invocar `TransitionProjectStatus`** — por
   consistencia con cómo `PriceSnapshot` ya funciona en el handler Go.
2. **`stubStore.catalogOverride`** — mínimo cambio al stub para testear pin.

Sin scope creep: descarté del working tree los archivos ajenos (migración de
tokens CSS `--surface-border`→`--border-default` en `components.css`) que
vinieron del checkout de otra rama del usuario.
