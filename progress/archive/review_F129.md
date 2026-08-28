# Review — feature F129

**Veredicto:** APPROVED

Commit revisado: `d32f359` (HEAD de main, pusheado; working tree limpio, sin
commits locales sin push). Feature en `in_progress` a la espera de esta review.

## Verificación ejecutada (real, no inspección)

- `pnpm test`: **2439 tests verdes** (domain 727, storage 134, excel 89, ui 1142,
  mobile 36, desktop 17, web 294). Coincide con el claim del commit.
- `pnpm typecheck`: 7/7 workspaces OK.
- `cd backend-go && go test ./internal/...`: ok (api, auth, config, domain,
  domain/engine, storage).
- Test F129 focalizado: `jointDrillingRules.test.ts` 10/10.
- Verificación geométrica independiente ejecutada contra el BOM real del gabete
  demo (script temporal, eliminado tras correrlo):
  - piso 269×590 T=15 (Arauco resuelto del material), lateral 720×590 T=15,
    puerta 717×296 T=18 (Maderado FRENTE), fondo 689×269 T=15.
  - Cámaras minifix en costado: y=7.5 = T_piso/2 exacto desde el extremo
    inferior (Ø15 en zona 15mm spanea 0..15 sin salirse; sin floor()).
  - Pernos en caras top/bottom del piso (extremos del eje length), y=T/2=7.5,
    x=50/540 (margen 50). Correcto según convención de poses base/superior.
  - Placas bisagra en costado: x=553 = D−37 (línea de sistema). Tazas en cara
    back de puerta: x=22.5 (cupInset), y=100/617 (endMargin 100).
  - Fondo: 6 pasantes Ø3 en perímetro de cara interna, **depth=15 = espesor
    resuelto del fondo** (through_hole → maxDepth en partDrillingResolver).
  - Contrafactual ejecutado: sin `derivedMachining`, el perfil de catálogo del
    tornillo (piloto ciego 35mm) produce 6× DEPTH_EXCEEDS_MATERIAL. El override
    es load-bearing y físicamente justificado.

## Acceptance (6 ítems)

1. **Reglas declarativas por estructura con defaults de taller** — CUMPLE.
   `JointDrillingRules` (types.ts:360-416) con 4 `JointKind`, códigos de
   herraje, `endMarginMm/maxSpacingMm/gridMm/withDowels/insetMm/cupInsetMm/
   systemLineMm`; `Structure.jointDrillingRules?` + merge parcial en
   `effectiveRules` (jointDrillingRules.ts:88-99) probado con override
   `endMarginMm: 80, withDowels: false`.
2. **Generación sin intervención del usuario** — CUMPLE. `deriveJointHardwarePlacements`
   es puro y cubre side-to-floor, side-to-top, back-panel y door-hinge sobre el
   BOM resuelto (clasificación por `componentPlacement`). El wiring a
   pantalla/export es F130/F131 (serie 3/5); acceptance no lo exige.
3. **Sistema 32** — CUMPLE. `systemLineMm` default 37 (`u = D − 37`); intermedios
   snapped a la grilla (416/768/704/352 son múltiplos de 32; extremos anclados
   al margen, práctica estándar del sistema 32).
4. **Cantidad sugerida reutiliza workshopRules.ts** — CUMPLE con matiz.
   Bisagras: `suggestHingeCount` (717→2, 1400→3) ✓. Minifix: workshopRules.ts
   **no tiene** sugerencia de minifix que reutilizar; el default vive como
   espaciado paramétrico (50/512) en la regla. Reutilizado todo lo existente.
5. **Golden gabete estándar** — CUMPLE. Golden sobre MOD-GAB-01 con BOM real
   (material Arauco 15mm resuelto del catálogo, no hardcodeado) + integración
   F129→F128 sin issues ni fallback.
6. **Suites verdes** — CUMPLE (ver arriba).

## derivedMachining / revisiones #108

- `HardwarePlacement.derivedMachining?` (types.ts:602-609) pisa el perfil de
  catálogo sólo para ese placement; resolver usa
  `placement.derivedMachining ?? hardware?.machining`
  (partDrillingResolver.ts:444-448). Pasante Ø3 con profundidad = espesor
  resuelto (verificado por ejecución). Correcto físicamente.
- `snapshotStructureRevision` (TS, structures/versioning.ts:39-53) y
  `structureRevisionSnapshot` (Go, structures.go:121-134) **no incluyen**
  `jointDrillingRules`: las revisiones #108 quedan BOM-only, sin contaminación.
  Re-resolver un pin produce el mismo BOM aunque cambien las reglas.

## Paridad TS/Go / migración

- Structs Go `JointDrillingRules/PanelJointRule/BackPanelRule/DoorHingeRule`
  con tags camelCase espejo del JSONB (types.go:334-366); punteros para
  opcionales numéricos/bool (`withDowels: false` sobrevive el round-trip).
- Migración 000065 aditiva (`ADD COLUMN IF NOT EXISTS ... JSONB` + down que
  dropea). Numeración secuencial sin colisión.
- SELECT/INSERT/UPDATE en structures.go leen/escriben la columna;
  `nullableJSON` serializa nil→NULL. Round-trip TS probado en
  apiMappers.test.ts (2 tests). Go no duplica lógica de reglas (solo DTO de
  persistencia, mismo precedent que agregados) → no exige contract fixture.

## Checkpoints

- C1: [x] (harness completo; `docs/prd.md` no existe pero la fuente canónica es
  `docs/prd-v2.md` — estado preexistente del repo, ajeno a F129. Verificación
  real corrida directamente por OC-001 documentado.)
- C2: [x] (sólo F129 in_progress; features done con tests pasando; current.md
  describe la sesión activa)
- C3: [x] (domain puro: imports sólo módulos internos; sin console.log; sin
  `any` nuevo — los 3 `as any` de apiMappers.ts:598/788/1656 son preexistentes;
  resultados estructurados, sin strings crudos)
- C4: [x] (domain 727/727; golden presente y pasando; storage round-trip; go test ok)
- C5: [x] (tree limpio, sin untracked sospechosos, HEAD pusheado; cierre de
  history.md/feature_list sigue el flujo post-aprobación)

## Observaciones no bloqueantes (para F130/F131 o deuda menor)

1. jointDrillingRules.ts:194 y 236 usan literal `|| 18` en vez de la constante
   `DEFAULT_BOARD_THICKNESS_MM` (unificada en 6689a4a). Código muerto-defensivo
   (ResolvedBoardPart siempre trae thicknessMm resuelto), sólo consistencia.
2. jointDrillingRules.ts:236: la `v` de la cazuela usa `horizontal[0]!.thicknessMm`
   para todos los laterales — asume espesor uniforme entre pisos/techos de la
   misma unión (cierto para los componentes actuales).
3. Go `UpdateStructure` incrementa el contador de revisión en cualquier update
   (incluido uno sólo-de-reglas, comportamiento preexistente). El claim "sin
   bump" hold a nivel snapshot/BOM (los snapshots no carryan reglas y el BOM
   no cambia); el número puede avanzar. Sin impacto en quotes congeladas.
4. Acceptance #1 dice "estructura/módulo": el override vive en Structure; a
   nivel módulo sólo vía parámetro del generador (sin campo en Module). Si un
   piloto necesita override por módulo, agregar el campo en F131.
