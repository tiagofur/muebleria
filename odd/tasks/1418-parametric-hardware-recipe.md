# ODD 1418 — Receta paramétrica: fórmulas en anclajes + presets + navegación

Issue: https://github.com/tiagofur/muebleria/issues/1418 (status:approved 2026-10-29,
cadena fase 1→2→3 del owner). Base: feat/1417-hardware-design-parts (fcb357ef).
Topología: Delegated Direct. Writer: sesión ZCode 2026-10-29 (única).

## Outcome observable

El owner escribe `PW/2 - 100` en el offset de un miembro (o pulsa el preset
«riel centrado») y el ancla se recalcula sola al cambiar el ancho del
mueble; el preset «cajón con correderas» arma los 4 miembros fijos/móviles
de una vez. TS y Go resuelven idéntico (paridad con fixture compartida).

## Decisiones de diseño

- `AssemblyAxisPlacement.offsetFormula?: string` — cuando está presente
  REEMPLAZA offsetMm. Vocabulario acotado del evaluador compartido
  (PW/PH/PD + números + - * /). Mapeo por eje: X→PW, Y→PD, Z→PH.
- **Convención de paridad**: el resultado de la fórmula se REDONDEA a mm
  entero en ambos motores (el evaluador Go ya redondeaba; TS aplica
  Math.round). La fixture `contracts/agregadoOffsetFormula.contract.json`
  congela casos con el valor esperado exacto por ancho.
- Validador: formato fail-closed (TS usa el evaluador compartido; Go chequea
  el mismo charset — el evaluador Go vive en el package engine y no es
  importable desde domain). La evaluación real corre en resolve con error
  explícito.
- Navegación ficha↔diseño y modo «2 herrajes con partes» del asistente:
  DECLARADOS RESTANTES (UX aditiva; el PR ya cubre el núcleo paramétrico).

## Tareas

1. [x] domain TS: offsetFormula en AssemblyAxisPlacement + validación +
       resolución con redondeo + tests (4 casos nuevos incl. legacy
       byte-idéntico). Fixture de paridad + test TS.
2. [x] Go espejo: struct + validador charset + evaluator en engine +
       fixture de paridad compartida PASS.
3. [x] UI: input de offset acepta número o fórmula (texto con placeholder
       «ej. -10 o PW/2 - 100»; número puro → offsetMm, lo demás →
       offsetFormula) + presets «cajón con correderas» y «riel centrado».
4. [x] E2E: agregado-offset-formula.spec.ts — preset cajón → 4 miembros con
       readback exacto; preset centrado → offsetFormula PW/2 en la revisión;
       simulate del servidor evalúa la fórmula.

## Verificación (V0/V1/V2) — evidencia congelada

- V0: typecheck workspace 0 · gofmt limpio en tocados · sin drift (la receta
  viaja por el dominio, no por generated API) · sin migraciones.
- V1: domain 2044/2044 (fórmula + paridad) · go domain+engine OK · ui
  agregados+hardware 149/149.
- V2: gate organization browser — agregado-offset-formula **1 passed**;
  regresiones recipe-authoring (endurecido), hardware-kit-wizard y
  hardware-design-parts **4 passed** en la corrida combinada.
- Lección de la ronda: el spec #1412 tenía una carrera (leía version antes
  del commit del PUT; la tarjeta optimista la disimulaba) que el panel más
  pesado de esta fase expuso — endurecido esperando el PUT explícitamente
  (patrón aplicado también al spec nuevo).

## Entrega

`Refs #1418` + `Delivery: partial` (restante: navegación bidireccional
ficha↔diseño, modo 2 herrajes del asistente, link declarado en la ficha).
