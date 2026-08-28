# Review — feature F100

**Veredicto:** APPROVED

> Revisión inicial: CHANGES_REQUESTED. Re-revisión sobre
> `72b0582 feat(ui): add area tonal theme foundation`, publicado en
> `origin/main`: APPROVED.

## Alcance revisado

Cambios F100 examinados:
- `docs/design.md`
- `packages/ui/src/design-system/tokens.css`
- `packages/ui/src/shell/AppShell.tsx`
- `packages/ui/src/shell/appShell.css`
- `packages/ui/src/shell/appShell.test.ts`

Se excluyen explícitamente `packages/domain/src/processStage.ts` y
`packages/domain/src/processStage.test.ts`: son WIP ajeno identificado en
`progress/current.md`, no pertenecen a F100 ni son la causa de este veredicto.

## Checkpoints
- C1: [x] Boundary correcto: foundation visual/documental vive en `packages/ui`; sin dominio, backend ni rutas alteradas.
- C2: [x] El contrato de `docs/design.md §3.2.1` elimina la prohibición previa y define Apple × Material × Muebles, cascada, matriz de superficies y separación de CTA/focus/estados globales.
- C3: [x] `tokens.css:64-119` expone canvas, chrome, container, border, selected, ink y state layers para `sales`, `eng`, `work` y `neutral`, con aliases contextuales.
- C4: [x] `AppShell.tsx:337-340,481` resuelve un contexto explícito y lo propaga a la raíz; `appShell.css:9,181-190,316` aplica canvas al frame/contenido y chrome/borde a la topbar.
- C5: [x] No hay reorganización de IA, cambios de navegación, ni rediseño de botones, formularios, cards o modales fuera del frame.
- C6: [ ] La prueba de propagación no renderiza el shell ni comprueba el atributo resultante: `appShell.test.ts:298-306` sólo busca substrings en archivos. No demuestra que `AppShell` entregue `data-area-context` para cada nav id ni que el web shell lo mantenga integrado.
- C7: [ ] La documentación afirma falsamente que la verificación light ocurre en `areaTheme.test.ts` (`docs/design.md:234-237`), pero el archivo no existe. `appShell.test.ts:308-332` sólo comprueba nombres de tokens y una frase; no calcula ni enumera los 16 pares ink/superficie exigidos.
- C8: [ ] F100 sigue completamente sin commit/push: `git status --short` muestra sus archivos modificados/no rastreados. Aunque `git log origin/main..HEAD` está vacío, no hay una entrega versionada que pueda estar publicada. El protocolo del revisor prohíbe aprobar trabajo no pushed.

## Diseño UI/UX
- D1: [x] Los nuevos valores visuales están centralizados en tokens; la shell consume aliases, no hex locales.
- D2: [x] El patrón es la propagación tonal restringida al frame; cards, inputs y tablas siguen neutrales según el contrato.
- D3: [x] No se modificaron modales.
- D4: [x] No se modificaron toasts.
- D5: [x] No se introdujo iconografía nueva.
- D6: [x] No se introdujo motion.
- D7: [ ] El DoD aplicable de §8 no queda demostrado: faltan pruebas reales de render/propagación y una verificación contrastable de contraste.
- D8: [x] CTA primaria, foco y roles success/warning/danger/info permanecen globales por diseño y por tokens.

## Contraste verificado independientemente

La matemática sRGB de los valores actuales sí cumple AA para texto normal:
- sales: canvas 6.71:1, chrome 6.38:1, container 5.87:1, selected 6.10:1.
- eng: 11.78:1, 10.63:1, 8.87:1, 9.58:1.
- work: 7.83:1, 7.33:1, 6.54:1, 6.85:1.
- neutral: 11.12:1, 10.57:1, 9.54:1, 9.77:1.

Esto valida los valores, pero no sustituye la prueba/documentación prometida por F100. Debe codificarse en un test de tokens o documentarse explícitamente por par, y la referencia inexistente debe corregirse.

## Gates ejecutados
- [x] `pnpm --filter @muebles/ui exec vitest run src/shell/appShell.test.ts` — 18/18.
- [x] `pnpm test` — verde.
- [x] `pnpm typecheck` — verde.
- [x] `./init.sh` — verde.
- [x] `git diff --check` — sin errores de whitespace.
- [ ] `git status --short` / `git log origin/main..HEAD` — no hay commits ahead, pero F100 aún está sin commit ni push.

## Re-revisión — commit `72b0582`

Los tres cambios requeridos fueron cumplidos exactamente:

1. [x] **Render y propagación.** `packages/ui/src/shell/appShell.test.ts:336-370` renderiza el componente real para sales, eng, work y neutral, y verifica el atributo resultante en `.app-layout`. `apps/web/src/areaThemeShell.test.ts` conecta `navFromPath()` para `/quotes`, `/modules`, `/production` y `/` con el `AppShell` real y verifica la misma propagación.
2. [x] **Contraste.** `appShell.test.ts:371-398` parsea los tokens HSL, calcula luminancia relativa sRGB/ratio WCAG y afirma explícitamente los 16 pares ink × canvas/chrome/container/selected, además de exigir `>= 4.5`. `docs/design.md:234-237` ahora apunta al archivo correcto y ya no menciona el inexistente `areaTheme.test.ts`.
3. [x] **Separación y entrega.** El commit contiene exclusivamente los nueve archivos de F100, sin `packages/domain/src/processStage.{ts,test.ts}`. `HEAD` y `origin/main` son `72b0582`; `git log origin/main..HEAD` está vacío. El WIP ajeno persiste sin stage/commit y no fue atribuido a F100.

## Gates de re-revisión
- [x] `pnpm --filter @muebles/ui exec vitest run src/shell/appShell.test.ts` — 22/22.
- [x] `pnpm --filter @muebles/web exec vitest run src/areaThemeShell.test.ts` — 4/4.
- [x] `pnpm test` — verde.
- [x] `pnpm typecheck` — verde.
- [x] `./init.sh` — verde.
- [x] `git diff --check HEAD` — sin errores.
- [x] `git status --short` y `git log origin/main..HEAD` — F100 está committeada y publicada; sólo quedan WIP/reportes ajenos y este reporte de revisión sin stage.

## Cambios requeridos

Ninguno.

skill_resolution: paths-injected
