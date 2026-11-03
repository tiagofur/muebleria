# ODD — #1462 Pestaña Herrajes del agregado: un solo punto de entrada por nivel (distill)

- **Issue:** https://github.com/tiagofur/muebleria/issues/1462 (`status:approved`)
- **Aprobación:** owner 2026-11-03 en sesión («esta pantalla está muy confusa») + 3 decisiones de shape confirmadas con previews: sección-es-el-botón, tarjeta del kit única, menú Plantillas en Del ensamble. «hagamos».
- **Lane:** Delegated Direct — este artefacto único.
- **Escritor:** ZCode (agente). Reviewer: independiente (judgment-day), pendiente.
- **Base:** `main` @ `feaebb7d` (post #1461) · Rama: `feat/herrajes-agregado-distill`.

## Alcance autorizado (resumen del brief confirmado)

F1 Herrajes: fuera header button + chooser + scroll machinery; cada sección con su propio añadir (Del ensamble `+ Añadir herraje` + `Plantillas ▾` con Par izq/der y Riel centrado + confirm; Por cantidad `+ Añadir insumo` NUEVO; por pieza sin cambios); tarjeta del kit = único hogar del picker (siempre visible, picker dentro). Copy: intro 1 línea, secciones 1 línea.
F2 Receta: fuera picker de kit, fuera 2 presets + confirm; «Añadir miembro» usa la fábrica compartida (fixed_rail + body).
F3: specs browser actualizados (niveles #1451, offset-formula #1418, recipe-authoring #1416) con aserciones intactas; tests unit; gate local + CI.

## Exclusiones

Sin cambios de dominio/Go/host; sin tocar campos de tarjeta (#1460), internals de Por cantidad, editor por pieza, badge «N pos.», General/Piezas, borrador/guardado, sync server-side.

## Tareas

- [x] F1: form sin chooser + sección entrada + copy corto
- [x] F1: tarjeta kit única con picker dentro + Plantillas ▾ (2 fábricas + confirm)
- [x] F1: Por cantidad con botón propio
- [x] F2: Receta sin picker/presets + fábrica compartida
- [x] F1/F2: tests unit actualizados
- [x] F3: 4 specs browser + gate local
- [ ] Verificación V0/V1/V2 + PR + handoff

## Evidencia (al congelar cada fase)

- V0 preflight: `PREFLIGHT_OK_NOT_VERIFIED` (2026-11-03, main feaebb7d, árbol limpio).
- F1+F2 (2026-11-03): typecheck packages/ui 0 errores; vitest agregados+modules 260/260. Botones de creación: 7 → 3 en tablero vacío (uno por nivel);chooser y su CSS eliminados; defaults de «Añadir miembro» de Receta unificados (fixed_rail + body). Vocabulario #1451 conservado (títulos «Del agregado»/«De las piezas» — sin renames que desalineen el detalle).
- F3 (2026-11-03): gate browser local (stack efímero del worktree) **7/7 PASS** — herrajes-niveles (#1451), kit-card-dims (#1460), offset-formula (#1418), recipe-authoring (#1416) con aserciones de readback intactas. Fix de regla F111: z-index del menú con `var(--z-dropdown)` (designSystem 9/9). Suites finales: agregados+modules 285/285, design-system 9/9.
- Alcance del diff vs main: 10 archivos (+338/−376), sólo `packages/ui/src/agregados` + `tests/organization` — sin dominio/Go/host. Verificación proporcional aplicable: TypeScript (local PASS; CI completa en el PR) + organization-browser (gate local PASS). Go/PostgreSQL/visual/SketchUp: sin entradas tocadas, corren en CI del PR sobre este HEAD.

## Review (1 revisor independiente, 2026-11-03)

- **Review único** (owner: «no es un cambio grande de funcionalidades») sobre HEAD `e4ea5e0`: **APPROVED, 0 bloqueos** — nada perdido (3 niveles, 2 plantillas con confirm, kit completo, autoría avanzada Receta), specs honestos (readback intacto), defaults unificados sin consumidores rotos, alcance limpio. 4 sugerencias no bloqueantes (ARIA del menú, copy 0 partes, placeholder, Esc/click-afuera/disabled).
- **Ronda review-fix** (`cb6173cf`): las 4 aplicadas — menú Plantillas migrado al DropdownMenu común (role=menu/menuitem + Esc + click-afuera + flechas nativos; extensiones backwards-compatible `triggerTestId`/`item.testId`; CSS artesanal eliminado), copy «todavía no sincronizó partes» restaurado con test de regresión, placeholder «Elegir juego…», disabled nativo. Evidencia: typecheck 0 · vitest 293/293 · gate browser 4/4 PASS (mismos testids, specs intactos). Delta re-confirmado por el mismo revisor; CI re-corriendo en el PR.

## Forecast y entrega

Commits Conventional por fase; PR único `Closes #1462` + `Delivery: complete` con DoD completo; si queda alcance, `Refs` + partial explícito. Riesgo principal: specs browser que usan los caminos eliminados — se actualizan con aserciones de readback intactas.
