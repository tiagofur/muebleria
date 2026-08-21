# Sesión activa

**Feature:** F131 — Editor visual 2D de perforaciones por cara + gizmo 3D (perforaciones CNC — 5/5)
**Estado:** done (review APPROVED, pushed) — SERIE COMPLETA
**Inicio:** 2026-08-21 (noche)

## Plan

1. Investigar: HardwarePlacementGizmo (huérfano F070), HardwarePlacementsEditor,
   PartInspector/preview3d (dónde montar), ComponentDetailView (perforaciones RO).
2. Vista 2D por cara (SVG): pieza + caras (face-plane), herrajes manuales y
   agujeros derivados (F129+F128), drag con snap 32, validaciones inline.
3. Montar gizmo 3D en el viewport (deuda F070).
4. Tests de interacción + tokens design.md + suite + reviewer + cierre.

## Bitácora

- 2026-08-21: F130 cerrada (APPROVED). Serie F127-F130 done. F131 in_progress.


## Bitácora (implementación F131)

- `PieceFaceDrillingEditor` (preview3d): vista SVG por cara con las dimensiones
  del face-plane (getFaceDimensions del dominio), grilla 32, agujeros REALES del
  motor F128 (manual+derivado), anclas arrastrables con snap 32 y validaciones
  inline (issues del motor con hole resaltado). Helper puro `snappedPlacementPatch`
  (limpia fórmulas — drag explícito gana a paramétrico); test de coordenadas vía
  helper porque jsdom no transporta clientX en pointer events.
- Integración: sección Herrajes del PartInspector (prop opcional hardwareCatalog;
  editor sobre las filas numéricas existentes).
- Gizmo montado (deuda F070): BoardMesh renderiza HardwarePlacementGizmo para la
  pieza seleccionada con placements, posicionado en localPosition del resolved,
  snap 32, editable vía props opcionales `rawHardwarePlacements` +
  `onUpdateHardwarePlacement` (thread FurnitureScene3D→SceneContent→ModuleGroup→
  BoardMesh); sin ellos monta read-only. Helper puro `pickGizmoPlacement`.
- Gates respetados: radiogroup (no tablist local), 0 literales de color nuevos
  (tokens brand/surface/accent).
- Tests: editor 7 (caras, holes del motor, redibujo por face-plane, helper snap,
  wiring pointerDown, issues inline, sin catálogo), gizmo +1, inspector +1.
  Suite 2453, typecheck 7/7.


## Cierre de serie (2026-08-21)

- F131 APPROVED (`progress/review_F131.md`) tras fixes (snapValue dominio, tokens).
- **Serie F127-F131 completa**: perforaciones CNC de punta a punta — catálogo →
  motor → reglas → DXF/reportes → editor visual. F132 (SCM nativo) postergada.
- Follow-ups abiertos: shell que cablee hardwareCatalog/rawHardwarePlacements;
  placements manuales de agregados; test persistido del espejo back del DXF;
  paridad Go de settings PTX; btn--secondary del panel.
