# ODD — #989 El preview vivo de la web consume la demanda de herrajes por perfil

- **Issue**: tiagofur/muebleria#989 (`status:approved`, elección del owner
  2026-10-03 sobre el menú post-merge de la demanda comercial).
- **Lane**: Delegated Direct. Un escritor.
- **Base**: `origin/main` @ `e6dab065` (post #988). Rama
  `feat/989-preview-demand`, worktree `../muebles-worktrees/989-preview-demand`.
- **Estado**: MAPPED_PENDING_DESIGN_DECISION (actualizar).

## Hechos verificados (T1, 2026-10-03)

1. **Plugin HUD: YA cubierto.** `apps/sketchup-extension/.../granete-commercial-projection.js`
   renderiza la proyección comercial SERVIDA (backend), que desde #987 incorpora
   demanda. Falta sólo la verificación/evidencia pedida por la issue (proof o
   lectura de camino), código sólo si hay hueco real.
2. **La web ya consume el breakdown servido**: `projectStore.ts:2484` hace POST
   `/projects/{id}/calculate` → `backendBreakdown` — ese endpoint es
   demand-priced desde #987 (`DeriveLiveProfileDemand` + breakdown extendido).
   PERO: (a) el endpoint opera sobre el estado GUARDADO del proyecto (no acepta
   payload); (b) `resolveDisplayBreakdown(local, remote, showCosts)`
   (derivations/breakdown.ts:112) muestra LOCAL primero para quien ve costes —
   y el local (`computeSelectedProjectBreakdown` → `calcProjectBreakdown`) no
   tiene demanda.
3. **La demanda es verdad del servidor**: asignaciones + perfiles pineados +
   recetas + política viven server-side. La respuesta del resolve de autoría YA
   trae `hardwareProfileDemand` por unidad (validada en
   `sketchupAuthoringResolve.ts:1111`); el web ya corre resolve en las pantallas
   de diseño (JoineryResolveSection, queries keyed por intent).

## Decisión de seam pendiente (opciones)

- **(A) Remote-first condicionado**: mostrar el breakdown servido cuando esté
  fresco y no haya edits sin guardar; local con estado stale/explícito cuando
  hay edits. Respeta server authority al máximo; cambia la semántica de
  `resolveDisplayBreakdown` + estados.
- **(B) Join de demanda del resolve en el espejo local** (RECOMENDADA): el
  espejo TS del breakdown acepta la matriz de demanda (misma forma index-aligned
  que Go, consumiendo `calcProfileDemandHardwareTotal` ya pineada por fixture) y
  las pantallas de diseño la alimentan con el `hardwareProfileDemand` del
  resolve que YA fetch-ea el servidor (React no recrea resolve/pricing: une la
  derivación del servidor a su espejo de respuesta inmediata). Proyectos sin
  diseño/resolve: preview byte-idéntico. Requiere hoistear/compartir las
  queries del resolve (hoy viven en JoineryResolveSection) hacia la derivación
  del preview + estados loading/blocked honestos mientras la demanda no llegó
  (NUNCA $0 silencioso).
- **(C) Estimar servido con payload**: extender /calculate para aceptar estado
  no guardado — nueva superficie HTTP; descartada por costo/contrato salvo que
  el owner pida lo contrario.

## Pendiente del owner/ODD al (re)tomar

1. Ratificar (B) (o elegir A) — el precio de (B) es mover las queries del
   resolve a alcance de la derivación del preview.
2. `computeModuleCostPreview` (preview de DEFINICIÓN, breakdown.ts:79): sin
   colocación física no hay contactos → sin demanda por contrato; DOCUMENTAR en
   UI/doc en vez de forzar inputs (el ODD de #986 ya lo nombró).
3. Implementación: espejo TS del parámetro demanda (calcProjectBreakdown con
   matriz opcional) → wiring derivación/pantalla → estados → spec browser gate
   (diseño con joinery gobernado → preview muestra herrajes → consistente con
   cotización) → verificación HUD.
4. Absorber sugerencias del review de #987: (b) test E2E Q1-con-demanda + test
   HTTP estimado-con-demanda en este slice si toca estimado; (c) skip
   preset-driven observable.
