# F096 — FabricScreen v2: board por obra

## Shape plan

- Reemplazar la cola plana por cards de obra dentro de cada estación, conservando tabs, RBAC y la vista de métricas de supervisión.
- Derivar un DTO puro fuera de React para que `computeProductionTotals`, `estimateBoardSheets`, picking y claims lleguen listos a la pantalla.
- Corte mostrará tableros (m², piezas, planchas y estado del picking `projectId × tableros`); Encintado mostrará ML, espesor, piezas, lados y swatch, usando solo `projectId × cintillas` como clave de picking válida.
- Cada card expondrá claim/finish por obra×estación y avance batch explícito que llama al callback de transición por cada ítem pendiente.
- Armado y Embalaje conservarán las filas de módulos/cantidades, agrupadas bajo su obra.

## Resultado

En progreso.

## Resultado de implementación

- `FabricScreen` ahora presenta cards por obra para Corte, Encintado, Armado y Embalaje, sin mezclar las mejoras posteriores de dashboard o Instalaciones.
- Se agregó el selector puro `fabricProjectCards`: une cola de estación, resultados de dominio (`computeProductionTotals`/`estimateBoardSheets` ya resueltos por el shell), picking persistido únicamente por `projectId × tableros|cintillas` y claims activos.
- Corte muestra m² netos, piezas, planchas estimadas y surtido; Encintado muestra ML, espesor, piezas, lados y swatch de `previewColor`; Armado/Embalaje conservan módulos agrupados dentro de la obra.
- Se cablearon claim y finish por obra×estación. Al terminar, el batch explícito pide confirmación y conserva las transiciones auditadas haciendo una llamada por ítem.
- El contrato de trabajos activos ahora incluye `sector` en Go y storage TS para poder asociar claims a su card; el ajuste de fixture `EdgeDraft.previewColor` corrige un typecheck preexistente revelado por F095.

## Pruebas y verificación

- `pnpm --filter @muebles/ui exec vitest run src/production/FabricScreen.test.tsx src/production/fabricProjectCards.test.ts` — 18 tests verdes.
- `cd backend-go && go test ./internal/api ./internal/domain ./internal/storage` — verde.
- `pnpm typecheck` — verde.
- `pnpm test` — verde (952 UI, 257 web; avisos jsdom/Three existentes, sin fallas).
- `git diff --check` — verde.

## Estado

Implementación lista para revisión. F096 permanece `in_progress` hasta recibir el veredicto.

## Correcciones tras review (2026-08-18)

- La confirmación del batch ahora ocurre **antes** de finalizar el último claim activo; cancelar no muta ni el claim ni los ítems.
- Si todavía hay más de un claim activo en la obra×estación, terminar uno no ejecuta el batch: evita que cada botón intente avanzar el mismo conjunto de ítems.
- La card ahora muestra `En curso · empezó HH:MM · operario`, usando el timestamp del claim.
- `FabricScreen.tsx` fue formateado a estilo convencional para recuperar legibilidad.
- Se agregaron pruebas para cancelar/aceptar la confirmación, hora visible y múltiples claims sin batch duplicado.

### Verificación posterior a correcciones

- `pnpm --filter @muebles/ui exec vitest run src/production/FabricScreen.test.tsx` — 18 tests verdes.
- `pnpm typecheck` — verde.
- `pnpm test` — verde (954 UI tests).
- `cd backend-go && go test ./internal/api ./internal/domain ./internal/storage` — verde.
- `git diff --check` — verde.

Estado: sigue `in_progress`, listo para re-review.

## P2 de formato (2026-08-18)

- `FabricScreen.tsx` fue reformateado con Prettier usando comillas simples, sin cambios funcionales.
- Verificación: `pnpm typecheck`, test focalizado `FabricScreen.test.tsx` (18 verdes) y `git diff --check` verdes.
- F096 sigue `in_progress`.

## Cierre

- Review final: **APPROVED** (`progress/review_f096.md`).
- F096 marcada `done`; commit y push se registrarán a continuación.
