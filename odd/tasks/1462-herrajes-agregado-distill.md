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

- [ ] F1: form sin chooser + sección entrada + copy corto
- [ ] F1: tarjeta kit única con picker dentro + Plantillas ▾ (2 fábricas + confirm)
- [ ] F1: Por cantidad con botón propio
- [ ] F2: Receta sin picker/presets + fábrica compartida
- [ ] F1/F2: tests unit actualizados
- [ ] F3: 3 specs browser + gate local
- [ ] Verificación V0/V1/V2 + PR + handoff

## Evidencia (al congelar cada fase)

- V0 preflight: `PREFLIGHT_OK_NOT_VERIFIED` (2026-11-03, main feaebb7d, árbol limpio).

## Forecast y entrega

Commits Conventional por fase; PR único `Closes #1462` + `Delivery: complete` con DoD completo; si queda alcance, `Refs` + partial explícito. Riesgo principal: specs browser que usan los caminos eliminados — se actualizan con aserciones de readback intactas.
