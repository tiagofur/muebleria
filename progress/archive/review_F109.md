# Review — feature F109

**Veredicto:** APPROVED

Fecha: 2026-08-19

## Alcance revisado

Migración de todas las implementaciones locales de tabs al contrato único de
`common/Tabs.tsx` (§4.0a). 46 archivos (16 superficies + CSS + tests).

### Extensiones al primitivo compartido (hacia atrás compatibles)

- `TabDefinition` gana `title` (tooltip nativo), `icon` (Lucide) y `alert`
  (marca "!" con tokens warning). CSS `.tabs__alert` en `common/tabs.css`.
- `Tabs.test.tsx` extendido (3 tests).

### Clasificación peer vs workflow (rationale)

- **WorkspaceTabs (peer)**: 4 editor forms (vistas paralelas de la misma
  entidad), ProductionQueue (estados pares de la cola), purchasing completo
  (PurchasingScreen ×2 tablists, PurchaseOrdersPanel, StockPanel), Showcase
  (portafolio/módulos), PresentationMode (ambientes + diapositivas),
  KitchenPlanSlide (ambientes), SpatialStudio (ambientes, sidebar,
  inspector).
- **WorkflowTabs (ordenados)**: Despiece (Material→Módulo→Lista), Labels
  (tipos de documento ordenados), Paperless (pipeline de estado de piso).

### Contrato compartido intacto

- ARIA roles, aria-controls ↔ panel id + aria-labelledby, roving tabindex,
  Arrow/Home/End — provistos por `useRovingTabList` en todos los casos.
- Gate test nuevo `common/tabsRollout.test.ts`: 0 `role="tablist"` fuera de
  common/Tabs.tsx y 0 clases `tab-btn`/`tab-bar` en markup o CSS. Legacy
  `.tab-bar`/`.tab-btn` de tabs.css eliminado (~150 líneas); selectores
  huérfanos podados en projects.css, projectSpatialStudio.css, purchasing.css,
  production.css, modules/structures/components/agregados.css.
- Casos especiales: PresentationMode no avanzaba doble con flechas (guard
  `[role=tablist"]` en el handler window); labels copy-mode per-piece/per-unit
  se convirtió en toggle `aria-pressed` (`.prod-seg-btn`, no tablist —
  setting radio-like, no navegación).

## Checkpoints

- C1: [x] `./init.sh` verde (todos los workspaces, 2026-08-19).
- C2: [x] Solo F109 en `in_progress` al revisar; `current.md` al día.
- C3: [x] Sin cambios de boundaries; UI no calcula dominio.
- C4: [x] Tests focales por superficie migrada (tablist contract + roving en
  cada una); suites de purchasing 35/35, producción 36/36, editors 77/77,
  showcase/presentation 104/104; suite UI completa verde vía init.sh.
- C5: [x] Al cierre: F109 `done`, entrada en history, commit atómico sin el
  WIP ajeno `processStage.*`, `git push`.

## Diseño UI/UX

- D1: [x] Solo tokens (`.prod-seg-btn` y `.tabs__alert` usan tokens).
- D5: [x] Iconos Lucide con aria-hidden vía `icon` prop.
- D7: [x] Detector Impeccable: 0 hallazgos sobre packages/ui/src.
- D8: [x] A11y §4.0a/§4.8: contrato ARIA completo por superficie.

## Notas / deudas menores

- `StructureEditorAgregadosPanel` (compartido por module+structure editors)
  no tiene id de tabpanel estático (sirve a dos idPrefix). Pre-existente, no
  rompe aria-controls del resto de tabs; anotado para F111 si aplica.
- Cambio de comportamiento documentado: tabs con gate de estructura en
  ModuleEditorForm ahora son `disabled` reales (antes clicables-but-muted);
  tests actualizados en consecuencia.
