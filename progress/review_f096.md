# Review — feature F096

**Veredicto:** CHANGES_REQUESTED

## Evidencia revisada

- Spec: `docs/roadmap-screens/03-fabrica.md` §§2–5; implementación y mapping en los tres `progress/*f096*` solicitados.
- Código: `FabricScreen.tsx`, `fabricProjectCards.ts`, `production.css` y cableado de `App.tsx`.
- Verificación: `./init.sh` verde (monorepo completo), `pnpm --filter @muebles/ui typecheck` verde y `git diff --check` verde. El suite UI informó 104 archivos / 952 tests verdes; los avisos de canvas/WebGL ya son ruido existente del harness.

## Checkpoints

- C1: [x] Harness y `./init.sh` presentes/verdes.
- C2: [x] `feature_list.json` tiene exactamente una feature `in_progress` (F096) y `progress/current.md` la describe.
- C3: [x] El selector UI consume resultados del dominio; no hay fórmulas nuevas, fs, React en domain ni `console.log` de debug.
- C4: [x] Tests de UI, dominio, storage y export pasan mediante `./init.sh`; typecheck UI verde.
- C5: [ ] La feature continúa `in_progress` y el árbol tiene cambios sin commit/push; no puede cerrarse todavía.

## Diseño UI/UX

- D1: [x] Los estilos nuevos usan tokens; el único `backgroundColor` es el dato `previewColor` del canto, no un token visual inventado.
- D2: [x] El board usa cards por obra/estación y conserva tabs con roving tabindex, conforme al patrón de Producción v2.
- D3: [x] No introduce modales.
- D4: [x] Errores de claim/finish se propagan al toast existente desde el shell.
- D5: [x] Iconos nuevos Lucide con `strokeWidth={1.5}`.
- D6: [x] No introduce animaciones.

## Cambios requeridos

1. **P1 — confirmar antes de cerrar el claim.** En `packages/ui/src/production/FabricScreen.tsx:160-164`, `finishAndAdvance()` hace `onFinish()` antes de llamar al batch. El batch del shell recién abre `window.confirm()` en `apps/web/src/App.tsx:2131-2137`: si el operador cancela, el claim queda finalizado pero todos los ítems siguen en cola. La spec exige “Terminar = finish + avance pendientes, con confirmación”. Separá la confirmación de la mutación (o hacé que el callback devuelva confirmación) y cubrí aceptar/cancelar con tests. Además, con dos claims activos cada botón vuelve a intentar avanzar todos los ítems.
2. **P1 — mostrar la hora de inicio del claim.** `FabricScreen.tsx:188-191` descarta `startedAt`, aunque `FabricActiveClaim` lo expone. La card v2 requerida debe mostrar “En curso · empezó HH:MM · operario”. Formateá `startedAt` de forma localizada y agregá cobertura de renderizado.
3. **P2 — restaurar el formato convencional.** `FabricScreen.tsx:167-280` concentra JSX complejo en líneas muy largas (incluidos tablist, tabla y panel), contrario a la configuración Prettier por defecto exigida en `docs/conventions.md`. Reformatéalo y mantené el screen como orquestador legible; la nueva longitud total está dentro del soft budget.
