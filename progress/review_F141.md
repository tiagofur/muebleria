# Review — F141 proyectar_module_library (#309, meta #308 etapa E1)

Fecha: 2026-08-21 · Reviewer: agente reviewer (subagent) · Rama: `feat/f141-proyectar-library`

## Primera pasada — CHANGES_REQUESTED

Verificación independiente del reviewer: 177/177 tests de las suites tocadas,
typecheck 7/7, smoke WebGL verde.

Hallazgos:

1. **MEDIA** — px sueltos en `moduleLibrary.css` (max-height 320px, thumb
   44px, silueta 40px) contra el gate §8 "solo tokens" de `docs/design.md`.
2. **MEDIA** — chips de categoría sin `aria-pressed`: la selección viajaba
   sólo por color (§4.8).
3. **BAJA** — icono `Star` fuera del mapa de iconos (§3.7).
4. **BAJA** — `writeToStorage` dentro del updater de `setState`
   (StrictMode invoca updaters dos veces).
5. **BAJA** — screenshot review §8 sin evidencia.
6. **BAJA (observación)** — composición del seeding duplicada entre
   `ProjectAddItemModal` y `quickAddPayloadForModule` (comparten las puras de
   domain; drift posible). Diferido como deuda.

Evaluación de riesgo del flujo atómico: `extraItemIds` es un puente de un
frame seguro — el memo `baseLayout` purga cualquier referencia inválida en el
siguiente render; el agujero se cierra solo.

## Correcciones aplicadas

1. Tokens: `calc(var(--space-16) * 5)`, `var(--touch-min)`,
   `calc(var(--touch-min) - var(--space-1))`.
2. `aria-pressed` en chips Todas/L1/L2.
3. Fila `Star` en `docs/design.md` §3.7.
4. Persistencia movida a `useEffect` sobre el estado asentado.
5. El smoke captura `test-results/proyectar-studio-library.png`; revisado
   visualmente por implementador y reviewer (layout Biblioteca→Canvas→
   Inspector, sin defectos).

## Segunda pasada — APPROVED

Re-verificación sobre el código de cada hallazgo + suites re-ejecutadas
(177/177, typecheck 7/7, smoke 1 passed). Checkpoints C1–C8 y D1–D8 en [x].

Condición de cierre: commit + push (cumplido — ver history).

## Deuda registrada (para E2+)

- `ProjectAddItemModal` debería partir de `quickAddPayloadForModule` como
  default (una sola composición de seeding).
- `ProjectSpatialStudio.tsx` (3.857 líneas): extraer la familia
  place/ghost/drop a un hook propio.
