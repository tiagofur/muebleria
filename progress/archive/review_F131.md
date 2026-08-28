# Review — feature F131

**Veredicto:** APPROVED (re-review 2026-08-21, fixes en `7634f35`)

Re-review del commit de fixes `7634f35` (HEAD == origin/main, árbol limpio):

1. **Fix 1 verificado** — `PieceFaceDrillingEditor.tsx` importa y usa `snapValue`
   de `@muebles/domain` en `snappedPlacementPatch`; snap local eliminado (con los
   guards NaN/step<=0 del dominio). C3 pasa.
2. **Fix 2 verificado** — `pieceFaceDrillingEditor.css`: `font-size: var(--text-sm)`
   y `padding: calc(var(--space-1) / 2) var(--space-2)`. Quedan sólo `1px` de
   border-width (norma del repo, sin token existente — igual que partInspector.css /
   moduleScene3d.css). D1/D7 pasan.
3. **Fix 3 verificado** — doc de `pickGizmoPlacement` dice "Returns false".
4. **Fix 4 verificado** — plural ternario «perforación/perforaciones»; test
   actualizado a «1 perforación». D8 pasa.

Evidencia re-ejecutada: `pnpm test` 2453/2453 verde (ui 1151), `pnpm typecheck`
7/7, gates `designSystem` (9) + `tabsRollout` (2) + tests F131 (22) verdes.
Observación del shell sin cablear (hardwareCatalog/rawHardwarePlacements) queda
como follow-up anotado — no bloquea el cierre.

Estado inicial del review (CHANGES_REQUESTED contra `0fa3076`) preservado abajo.

---

# Review inicial — contra `0fa3076`

**Veredicto:** CHANGES_REQUESTED

Commit revisado: `0fa3076` (HEAD de main, pusheado — `origin/main` coincide, árbol limpio).
Serie: F127–F130 done. F131 `in_progress` en `feature_list.json` (correcto: bajo review).

## Evidencia ejecutada

- `pnpm test`: VERDE — 2453 tests (domain 732, storage 134, excel 89, ui 1151,
  mobile 36, desktop 17, web 294), 0 fail, exit 0.
- `pnpm typecheck`: VERDE — 7/7 paquetes, exit 0.
- Gates explícitos: `designSystem.test.ts` (9) ✓, `tabsRollout.test.ts` (2) ✓,
  `PieceFaceDrillingEditor.test.tsx` (7) ✓, `HardwarePlacementGizmo.test.tsx` (6) ✓,
  `PartInspector.test.tsx` (9) ✓.

## Acceptance (6 ítems)

1. **Vista 2D por cara con herrajes+agujeros derivados** — CUMPLE.
   `PieceFaceDrillingEditor` dibuja el face-plane con `getFaceDimensions` (dominio),
   herrajes como anclas numeradas y agujeros REALES de `resolvePartDrilling`
   (manual + derivados fusionados). Tests: caras, holes del motor, redibujo por
   face-plane (18 × 700 en canto izq.), sin catálogo degrada a grilla+anclas sin romper.
2. **Drag con snap 32 + validaciones inline** — CUMPLE con fix requerido (ver C3/1).
   Wiring pointerDown→dragIndex→pointerMove→patch; validaciones = issues del motor
   con `role="alert"` y agujero ofensivo resaltado (`--error`). El snap está
   duplicado en UI en vez de usar `snapValue` del dominio.
3. **Gizmo montado (deuda F070)** — CUMPLE. BoardMesh monta `HardwarePlacementGizmo`
   para la pieza seleccionada con placements (`pickGizmoPlacement`), posicionado en
   `gizmoAnchor.localPosition` (resolved), `snapMm={32}`. Sin `onUpdateHardwarePlacement`
   los handlers cortan temprano → read-only real.
4. **Tokens + UI no calcula dominio** — NO CUMPLE del todo. Colores 100% tokens
   (0 literales de color; gates verdes), pero: (a) fórmula de snap duplicada en UI;
   (b) `font-size: 12px` y `padding: 2px` literales (§8 "0 font-size literales,
   0 px sueltos").
5. **Tests de interacción** — CUMPLE. 7 editor (incl. helper snap + wiring drag +
   issues inline + degradación), +1 gizmo, +1 inspector. Límite jsdom (sin clientX
   en pointer events) documentado en el código y compensado con helper puro exportado.
6. **Suites verdes** — CUMPLE (ver evidencia).

## Checkpoints

- C1: [x] Harness/docs/skills presentes; suite verde verificada directamente
  (`pnpm test`/`typecheck` reales, no sólo exit de `init.sh` — OC-001).
- C2: [x] Un solo `in_progress` (F131); features done con tests pasando; `current.md`
  describe la sesión activa.
- C3: [ ] **Snap duplicado en UI** — `PieceFaceDrillingEditor.tsx:45` reimplementa
  `Math.round(v / gridMm) * gridMm` cuando el dominio ya exporta `snapValue`
  (`packages/domain/src/hardwarePlacement.ts:270`, con guards NaN/step<=0 que la
  copia UI pierde). `HardwarePlacementGizmo.tsx:46-47` SÍ la usa. Violación de
  "UI no calcula dominio" (architecture.md §1.2 + boundary §6 "fórmulas de negocio")
  y de "una autoridad por concepto" (§1.6). El snap a grilla 32 determina coordenadas
  de maquinado persistidas: es regla de dominio, no presentación.
- C4: [x] `pnpm --filter @muebles/domain test` 732/732; feature no toca export/storage.
- C5: [x] Sin archivos sin trackear; `history.md` tiene entrada F130; ledger
  `in_progress` correcto para feature bajo review.

## Diseño UI/UX

- D1: [ ] `pieceFaceDrillingEditor.css:83` `font-size: 12px` → `var(--text-sm)`
  (equivalente: 0.75rem = 12px = 12 user-units SVG); `:20` `padding: 2px` →
  `calc(var(--space-1) / 2)`. Único font-size literal del directorio preview3d.
  (stroke-width/dasharray en viewBox mm son render especializado razonable.)
- D2: [x] Panel dentro del inspector, CSS co-localizado, BEM, sin screen nueva.
- D3: N/A (sin modales).
- D4: N/A (sin toasts; validación inline como exige §4.4).
- D5: [x] Sin iconos nuevos.
- D6: [x] Sin animaciones nuevas (nada que wrappear).
- D7: [ ] Gate §8: falla el ítem "Solo tokens" (D1). Resto: radiogroup con
  `aria-checked` (precedente MaterialPalette; sin tablist local — gate tabsRollout
  verde), focus-visible cubierto por reset.css global, issues con `role="alert"`.
- D8: [x] Copy ES de taller, sentence case, `×`/mm correctos. Nit: "1 perforaciones"
  (`PieceFaceDrillingEditor.tsx:225`) — pluralizar; el test (`test.tsx:82`) afirma
  el string bugueado, actualizarlo junto al fix.

## Regresión (sin props nuevas)

- `PartInspector` sin `hardwareCatalog`: el editor sólo renderiza si hay placements
  (con degradación a grilla+anclas); el único consumidor de producción
  (`Furniture3DViewer.tsx:437`) no pasa placements → placeholder, idéntico a antes.
  Inputs numéricos X/Y intactos.
- `FurnitureScene3D` sin `rawHardwarePlacements`/`onUpdate`: el gizmo monta read-only
  (handlers inertes sin `onChangePlacement`, sin stopPropagation → selección/drag de
  pieza no se afecta). Cambio visual aditivo intencional (es la deuda F070 saldada).
- Observación (no bloquea): ningún shell cablea hoy `hardwareCatalog` ni
  `rawHardwarePlacements`; el camino editable + agujeros reales queda accesible sólo
  vía tests hasta que un shell lo conecte. Registrar como follow-up.

## Cambios requeridos

1. **[bloquea] `packages/ui/src/preview3d/PieceFaceDrillingEditor.tsx:45`** —
   reemplazar el snap local por `snapValue(xMm, gridMm)` importado de
   `@muebles/domain` (mismo patrón que `HardwarePlacementGizmo.tsx:12`). Mantiene
   el comportamiento (tests del helper siguen válidos) y recupera los guards.
2. **[bloquea §8] `packages/ui/src/preview3d/pieceFaceDrillingEditor.css:83`** —
   `font-size: 12px` → `var(--text-sm)`; **`:20`** — `padding: 2px` →
   `calc(var(--space-1) / 2)`.
3. **[nit] `packages/ui/src/preview3d/HardwarePlacementGizmo.tsx:26-35`** — doc
   dice "Returns null" pero `pickGizmoPlacement` devuelve boolean; corregir comentario.
4. **[nit copy §7] `PieceFaceDrillingEditor.tsx:225`** — singular cuando
   `holesOnFace.length === 1` ("1 perforación"); ajustar también el assert de
   `PieceFaceDrillingEditor.test.tsx:82`.

No hay mezcla de features (sólo archivos F131 + ledger + progress). Trabajo
pusheado. Tests y typecheck verdes. Con los fixes 1–2 (5 líneas) esto aprueba.
