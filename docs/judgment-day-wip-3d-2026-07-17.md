# Judgment Day — WIP 3D / paneles / espacial (2026-07-17)

**Branch:** `feat/presets-measure-100`  
**Target:** extracciones de editors (modules/structures/components), stack `preview3d`, `spatialPlacement`, color de material, integración `ProjectsScreen`  
**Round:** 2 (post-fix)  
**Verdict Round 1:** `JUDGMENT: ESCALATED`  
**Verdict Round 2:** fixes aplicados; residual WARNING (structure_components sin overrides column; rotate tri-state en DB catalog INT NOT NULL DEFAULT 0)  
**Skill Resolution:** paths-injected (reviewer + architecture/conventions)

---

## Resumen

| Bucket | Count |
|--------|------:|
| CRITICAL confirmed | 3 |
| WARNING (real) confirmed | 8 |
| Suspect (un solo juez) | 5 |
| WARNING (theoretical) / SUGGESTION | INFO |

No se aplicaron fixes en esta ronda: el protocolo pide confirmación del usuario antes del fix agent.

---

## Confirmed — CRITICAL

| ID | Descripción | Archivos |
|----|-------------|----------|
| JD-C1 | `componentToApi` / `componentFromApi` no round-trip de `x/y/zFormula` ni `rotateX|Y|Z`. Backend ya tiene columnas; save/load vía API pierde poses. | `packages/storage/src/apiMappers.ts` |
| JD-C2 | Motor Go solo permite variables `W/H/D`. TS/seed usan `PH/PW/PD/T/i` → BOM distinto o fallo en servidor. | `backend-go/internal/domain/engine/resolve.go` |
| JD-C3 | `ProjectsScreen` declara `catalogStructures` / `catalogComponents` pero `App.tsx` no los pasa → “Vista 3D cotización” rota para muebles compuestos. | `apps/web/src/App.tsx`, `ProjectsScreen.tsx` |

## Confirmed — WARNING (real)

| ID | Descripción | Archivos |
|----|-------------|----------|
| JD-W1 | Cualquier fórmula espacial no vacía apaga heurística de placement en ejes/rotaciones faltantes. | `packages/domain/src/engine.ts` |
| JD-W2 | `lateral_derecho` con `quantity > 1` no ancla a la derecha. | `packages/domain/src/spatialPlacement.ts` |
| JD-W3 | Convención mesh local + `rotateY: 90` no deja laterales como paneles verticales; R3F vs CSS pueden discrepar. | `preview3d/boardPartVisual.ts`, `FurnitureScene3D.tsx` |
| JD-W4 | Sin WebGL, fallback CSS muestra un solo módulo en corridas multi. | `Project3DModal.tsx` |
| JD-W5 | Módulos sin `parts` se ocultan pero el layout conserva su ancho (huecos invisibles). | `FurnitureScene3D.tsx` |
| JD-W6 | Defaults de dims si faltan medidas: module `800×700×500` vs project `600×720×560`. | `module3dPreview.ts`, `project3dPreview.ts` |
| JD-W7 | Color preview de material: texto libre, sin `isValidPreviewColor` en submit. | `MaterialsCatalog.tsx`, `App.tsx` |
| JD-W8 | Overrides espaciales de `ModuleComponentInstance` no se mapean en API. | `apiMappers.ts` |

## Suspect (un juez) — no auto-fix

| ID | Descripción |
|----|-------------|
| JD-S1 | Variable `H` = altura en geom y espesor `T` en espacial. |
| JD-S2 | IDs de piezas `${componentId}-copy-${i}` colisionan entre estructura y módulo. |
| JD-S3 | Upload de imagen pisa `previewColor` aunque el usuario lo haya seteado. |
| JD-S4 | `rotateX \|\| undefined` trata `0` como unset. |
| JD-S5 | Layout de cotización todo en `originZ = 0` (altos en piso) — resuelto a largo plazo por layout de cocina. |

## INFO

- `new Function` en fórmulas TS (teórico).
- Inline styles en toolbars 3D; colores de escena WebGL fuera de tokens.
- `ProjectsScreen` sigue fuera del soft budget de líneas.

---

## Issues de tracking

| JD ID | GitHub |
|-------|--------|
| JD-C1 + JD-W8 | [#125](https://github.com/tiagofur/muebleria/issues/125) |
| JD-C2 | [#126](https://github.com/tiagofur/muebleria/issues/126) |
| JD-C3 | [#127](https://github.com/tiagofur/muebleria/issues/127) |
| JD-W1 + JD-W2 | [#128](https://github.com/tiagofur/muebleria/issues/128) |
| JD-W3–W6 | [#129](https://github.com/tiagofur/muebleria/issues/129) |
| JD-W7 + JD-S3 | [#130](https://github.com/tiagofur/muebleria/issues/130) |
| JD-S1/S2/S4 | [#131](https://github.com/tiagofur/muebleria/issues/131) |

META App Excellence: [#132](https://github.com/tiagofur/muebleria/issues/132) · tabla completa en `docs/app-excellence.md`.

---

## Fixes aplicados (Round 1 → Round 2)

| Issue | Fix |
|-------|-----|
| #125 / #127 | apiMappers espacial + ProjectsScreen props |
| #126 | Go `PH/PW/PD/T/i` en evaluatePartFormula |
| #128 | Per-axis pose; lateral_derecho; laterals rotX+Y 90 |
| #129 | WebGL multi-módulo msg; ghosts; DEFAULT footprint |
| #130 | validate/normalize color; no pisar en upload |
| JD-W8 residual | module_components JSONB overrides espaciales en Go storage |
| JD-S4 residual | draft rotate null vs 0 (ComponentDraft `number \| null`) |

### Residual (no bloquea CRITICAL)

- `structure_components` aún sin columna overrides (solo placement_override) — spatial override en **estructuras** no persiste en API.
- Catálogo Component `rotate_* INT NOT NULL DEFAULT 0` en Postgres: 0 en DB no distingue unset; non-zero y fórmulas sí.

## Criterio de cierre

Estados terminales: `JUDGMENT: APPROVED` (0 CRITICAL + 0 WARNING real en path crítico) o `JUDGMENT: ESCALATED`.
