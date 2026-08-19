# Review — feature F105

**Veredicto:** APPROVED

## Checkpoints

- C1: [x] `./init.sh` exit 0 (corrida final post-último-cambio)
- C2: [x] Una sola `in_progress` (F105 al cerrar); UI 1013/1013; `current.md` al día
- C3: [x] Presentación pura en `packages/ui`; sin lógica de dominio; tokens-only (sin hex/px nuevos; detector 0)
- C4: [x] Suite domain verde dentro de init.sh; sin export/storage
- C5: [x] Cierre atómico: feature done + history + current en plantilla; WIP ajeno excluido de commits

## Diseño UI/UX (docs/design.md §8)

- D1: [x] Primitivos compartidos (`PageHeader`/`PageToolbar`) y `.btn`; CSS huérfano podado con verificación de uso TSX por clase
- D2: [x] §4.1a/§4.1b: título = label de nav (Vitrina); una primaria por nivel (Inicio: primaria única con demotion a ghost cuando el checklist la posee — gramática validada en vivo); read-only PlantBoard sin primaria
- D3: [x] Estructura Vitrina correcta: header de página en `ShowcaseScreen`, tabs en toolbar, contenido de tab sin duplicar título (§4.1a workspaces: contexto local no compite)
- D4: [x] Icon-chips del mapa §3.7/§6 (LayoutDashboard/TrendingUp/Users/Store/KanbanSquare); Factory local de PlantBoard retirado
- D5: [x] Modales/toasts no tocados; `data-testid` preservados (dashboard-*, showcase-*, portfolio-*)
- D6: [x] Sin animaciones nuevas; reduced-motion intacto
- D7: [x] Responsive smoke computado 1280/390 sin overflow en las 5 rutas; screenshots analizados (Inicio: chip + una primaria + quick action secundaria); captura Vitrina post-reestructura bloqueada por runtime IAB y declarada como tal con evidencia computada
- D8: [x] Tests de composición cubren el contrato por pantalla; aria-labels de toolbar distintos de los del search

## Nota

La reestructura de Vitrina (header de pantalla + tabs en toolbar) excede la
migración mecánica pero es la aplicación correcta de §4.1a al descubrir que
la ruta `/showcase` era un contenedor de tabs sin dueño de título; queda
documentada en el handoff.
