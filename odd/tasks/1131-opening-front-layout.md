# ODD — #1131 Opening Layout resolver: zonas, ratios, grip boundaries → fronts y cajas

- **Issue**: tiagofur/muebleria#1131 (`status:approved`, épica OPEN-FRONT).
- **Lane**: Inline Direct (contrato puro, bounded, un escritor) con artefacto
  para recuperación — los consumidores de la capa (#1132 body modifiers,
  #1133 BOM, #1137 Inspector) necesitan el mapa de decisiones.
- **Base**: `origin/main` @ `34f43d15` (post merge del PR de Opening Profile).
  Rama: `feat/1131-opening-layout-resolver`, worktree
  `../muebles-worktrees/1131-opening-layout-resolver`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW.

## Resultado observable

`resolveOpeningFrontLayout` (TS) / `ResolveOpeningFrontLayout` (Go) consume la
intención de apertura (layout + grips + posicionamiento) + las dimensiones del
frente (ancho y alto) y produce resultados semánticos por zona: identidad
estable (el `zoneId` declarado), access declarado, caja axis-mapeada
(`widthMm`/`heightMm`/`offsetMm`), grips como datos resueltos (boundary, lado,
perfil, consumo) y reglas aplicadas (dirección, posicionamiento, ratio,
ratioSum, remainderTarget). La matemática de alturas sigue siendo la del
contrato v1 (una sola autoridad); la capa semántica no re-resuelve nada.

## Alcance (de la issue)

1. Caso B 1x/1x/2x coincide exactamente con golden (fixture compartido).
2. A y baseline conservan sus dimensiones esperadas (v1 intacta).
3. Grip boundaries son datos resueltos (lado + perfil + consumo por frente).
4. Cada frente tiene identidad estable (zoneId declarado, orden de zonas).
5. Go y TS producen exactamente el mismo resultado (mismo fixture, goldens
   incluidos los fronts).
6. Sin nombres de componentes: la semántica viene de `access` declarado.
7. Inputs incompatibles fallan cerrado (sección `layoutInvalidCases`).

## Decisiones de diseño

- **D1 Mapeo de ejes fijado en contrato**: layout `vertical` divide la ALTURA
  del frente (zonas top→bottom); `horizontal` divide el ANCHO (left→right);
  el eje cruzado pasa intacto y lo comparten todas las zonas. El input v1
  `cabinetFrontHeightMm` alimenta el eje dividido según dirección; la nueva
  entrada `cabinetFrontWidthMm` completa la caja. Pendiente físicamente
  declarada en el fixture (placeholders que fijan matemática, no datos de
  proveedor).
- **D2 Incidencia de bordes como dato derivado de la dirección**: `top` agarra
  desde ARRIBA a TODAS las zonas en horizontal (todas cruzan la altura) y sólo
  a la primera en vertical; `bottom` simétrico desde ABAJO; `between(a,b)`
  agarra a desde ABAJO y b desde ARRIBA (OQ-1). Casos D (bottom) y E (between
  en horizontal, zona agarrada de ambos lados) pinnan las combinaciones que
  A/B no cubrían.
- **D3 Validación de forma antes que evidencia**: dirección/access
  desconocidos, dimensiones no positivas (o no enteras en TS) y zona sin id
  fallan `OPENING_LAYOUT_INVALID` ANTES de llamar al resolver v1; los errores
  v1 (datasheet pendiente, OQ-3, boundaries) se propagan verbatim. Probado en
  ambas direcciones (forma rota + overhang ⇒ LAYOUT_INVALID; forma válida +
  overhang ⇒ OVERHANG_EVIDENCE_PENDING).
- **D4 `remainderTarget` nombra el ancla de política**: replica exactamente el
  `remainderZoneId` v1 (la última zona) — con resto 0 sigue nombrándola sin
  sumar nada (caso E). Con resto ≥ 2 otras zonas reciben 1 mm (caso B: z2)
  pero el target de política sigue siendo la última: mismo significado que el
  campo congelado v1.
- **D5 Sin segundo resolver**: la capa llama a `resolveOpeningFront` /
  `ResolveOpeningFront`; `boundaryKey` se exporta en TS (un solo formato de
  key `between:<above>:<below>`); Go reusa `openingGripBoundaryKey` del paquete.

## Fuera de alcance (explícito)

- **Integración al authoring resolve vivo**: ningún diseño porta aún una
  intención de apertura (el portador llega con las issues de superficies de
  authoring: overlay de capacidades + Web settings, migración de opciones
  jaladera, Inspector). Los agregados siguen resolviendo contra el stack
  quantity/gapMm hasta que exista el portador; cablear hoy inventaría un input
  que nadie puede producir.
- Body modifiers por rol constructivo, BOM de perfiles, overlay `opening.*`,
  validación `INVALID_OPENING_CONFIGURATION`, bottom_overhang (OQ-3 sigue
  abierto: los casos bloqueados del fixture son el comportamiento correcto).

## Verificación

- `go test ./internal/...` desde `backend-go`: VERDE (contrato v1 con fixture
  extendido, contrato semántico, 5 units de incidencia/propagación).
- `pnpm typecheck` (workspace): limpio. `pnpm test` (raíz): VERDE (29 tests
  opening: 13 v1 + 16 semántica; suites de paquetes intactas).
- Sin cambios storage/SQL/API: no aplica `scripts/backend-test.sh`.

## Siguiente slice

Body modifiers por rol constructivo consume `fronts[].grips` (lado/perfil) y
las dimensiones de frente; el Inspector muestra «Frente 680 × 596 mm» leyendo
estos fronts (read-only, §9 del doc de autoridad).
