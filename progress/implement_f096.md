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
