# Sesión activa

**Feature:** F129 — Reglas de unión paramétricas sistema 32 (perforaciones CNC — 3/5)
**Estado:** implementada, esperando review
**Inicio:** 2026-08-21

## Plan

1. Estudiar: resolver F128 (partRole/placements derivados), workshopRules,
   Structure/instancias, persistencia de structures (mappers/Go), fixture gabete demo.
2. Tipos declarativos `JointDrillingRuleSet` (unión, herraje, offsets paramétricos,
   grilla 32) + `DEFAULT_JOINT_DRILLING_RULES` del taller; override opcional por
   estructura.
3. Generador `deriveJointHardwarePlacements(...)`: costado-piso/techo (minifix),
   respaldo (tornillo), puerta-costado (bisagra+placa, cantidad vía workshopRules).
   Emite placements derivados que F128 resuelve; snap 32 y línea de sistema 37mm
   configurable.
4. Golden del gabete demo + tests unitarios.
5. Suite + typecheck + go test + commit + reviewer + cierre.

## Bitácora

- 2026-08-21: F128 cerrada (3 rondas review, APPROVED). Deuda saldada:
  DEFAULT_BOARD_THICKNESS_MM unificado (6689a4a). F129 in_progress.

## Bitácora (implementación)

- Tipos declarativos JointKind/PanelJointRule/BackPanelRule/DoorHingeRule/JointDrillingRules
  en types.ts + `Structure.jointDrillingRules?` (drilling-only: NO bump de revisión BOM,
  NO viaja en structureRevision). `BoardPart/ResolvedBoardPart.componentPlacement?` — el BOM
  expone el placement del componente para clasificar piezas (bom.ts expansión+resolución).
- `jointDrillingRules.ts`: DEFAULT_JOINT_DRILLING_RULES (taller: minifix+taquetes 50/512,
  fondo tornillos 16/400, bisagra 22.5/37/100, grilla 32) + `deriveJointHardwarePlacements`
  (puro). Reglas referencian herrajes por CÓDIGO (portables); merge parcial con defaults
  via effectiveRules. Uniones: costado↔piso/techo (cazuela en cara del costado a T_piso/2
  exacto — floor() sacaba la Ø15 0.5mm del canto con Arauco 15mm; perno en canto top/bottom
  del piso), respaldo (perímetro), puerta (tazas + placas a D−37, cantidad via
  suggestHingeCount). Snap 32 en intermedios; taquetes a ±32 exacto del minifix.
- `HardwarePlacement.derivedMachining?` (F129): maquinado de aplicación que reemplaza el
  perfil de catálogo para ese placement — el fondo usa piloto PASANTE Ø3 (el tornillo del
  catálogo es piloto ciego 35mm para miembros gruesos; profundidad > fondo = error real
  de aplicación). Resolver: `placement.derivedMachining ?? hardware?.machining`.
- Tests domain 10 (unit posiciones/hinge, override parcial, golden gabete 300×720×590
  con BOM real resuelto — piso 269×590×15, costados ×2, puerta 717, fondo 6 pasantes —
  e integración F129→F128: cada pieza resuelve sin issues). Storage +2 round-trip del
  override. Suite 2439, typecheck 7/7, go test verde.
- Persistencia: apiMappers to/from (joint_drilling_rules, revisiones NO), Go
  JointDrillingRules structs (camelCase JSONB), structures.go SELECT/INSERT/UPDATE con
  nullableJSON, migración aditiva 000065 (JSONB).
