# Review — feature F133

**Veredicto:** APPROVED

**Commit:** `997bf3b` (HEAD de main, pushed — HEAD == origin/main). Suite completa
ejecutada por el revisor en el árbol final.

## Acceptance items (7/7)

1. [x] `defaultCutStrategy?: CutStrategy` en `WorkshopSettings`
   (`packages/domain/src/types.ts:1234`), `CutStrategy` movida a `types.ts` con
   re-export en `optimizer/types.ts` (imports existentes intactos, sin ciclo).
   Paridad Go: `backend-go/internal/domain/types.go:621` json `default_cut_strategy`
   + `DefaultWorkshopSettings()` default `saw-guillotine`. Mappers API:
   `packages/storage/src/apiMappers.ts:1938` (from) / `:1964` (to).
2. [x] `resolveWorkshopSettings` tolera ausencia y valida el union:
   `workshopSettings.ts:86-90` (cualquier valor fuera del union →
   `DEFAULT_WORKSHOP_SETTINGS.defaultCutStrategy` = `'saw-guillotine'` explícito).
   Test: `workshopSettings.test.ts:100` (undefined y `'laser-cut'` → sierra).
3. [x] Fieldset «Tipo de corte» en Ajustes → Ingeniería y Producción
   (`SettingsScreen.tsx:308-343`), mismo patrón markup/inline que el fieldset
   modo PTX preexistente del mismo tab; `onSubmit` incluye
   `defaultCutStrategy: cutStrategy` (línea 134); `useEffect` re-sincroniza el
   radio con `settings` (línea 80). Test de guardado:
   `SettingsScreen.test.tsx:96` (click nesting → `onSave` con
   `defaultCutStrategy: 'cnc-nesting'`).
4. [x] Panel inicializa `project.cutPlan?.config.cutStrategy ?? defaultCutStrategy
   ?? 'saw-guillotine'` (`ProductionOrderOptimizationPanel.tsx:62-63`). Tests
   cubren los 3 niveles: default del taller sin plan (nesting), sin default y sin
   plan (sierra, retrocompatible), plan de obra gana sobre default nesting.
5. [x] F126 intacto: el diff no toca el selector por obra ni el guardado del
   plan (`currentCutPlan` persiste `cutStrategy` en config, línea 133); solo
   cambió el valor inicial del estado. Tests F126 actualizados y verdes.
6. [x] Tests en los 3 niveles: domain (+2 its), storage mappers (+3: round-trip
   snake_case, basura→sierra al ingerir, sin campo→sierra), ui (settings +1,
   panel +3), payloads de fixtures actualizados.
7. [x] Verificación real (ejecutada por el revisor):
   - `pnpm test` → **2391/2391 verde** (domain 692, storage 132, excel 85,
     ui 1139, mobile 36, desktop 17, web 290). Re-ejecutada con `pipefail`.
   - `pnpm typecheck` → 7/7 workspaces Done.
   - `cd backend-go && go test ./internal/...` → ok en
     api / auth / config / domain / domain/engine / storage.

## Paridad TS/Go

- [x] json `default_cut_strategy` ambos lados; migración `000064` aditiva
  (`ADD COLUMN IF NOT EXISTS ... TEXT`), down seguro (`DROP COLUMN IF EXISTS`),
  numeración correcta (última del directorio), runner embebido idempotente.
- [x] normalize Go (basura/vacío → `def.DefaultCutStrategy` = sierra) espeja
  `resolveWorkshopSettings` TS; test table-driven
  `workshop_settings_test.go` (4 casos). SELECT/UPSERT actualizados.
- [x] Handler sin cambios de API (decoda struct directo) — correcto.
- [x] `workshopSettingsFromApi` pasa por `resolveWorkshopSettings`
  (`apiMappers.ts:1903`), así el cast del campo crudo queda validado después.

## Consistencia del split abbcb10 + 997bf3b (incidente 4fbfe80)

- [x] `git diff 4fbfe80 997bf3b` → **vacío**: el árbol final del split es
  byte-idéntico al commit mezclado original; nada se perdió.
- [x] Sin duplicación ni contradicción entre abbcb10 y 997bf3b (matemáticamente
  descartado por el diff vacío contra el árbol original).
- [x] 4fbfe80 no está en ninguna rama; reflog confirma reset → abbcb10 → 997bf3b.
- [x] Ambos commits compilan standalone (abbcb10 verificado en su mensaje;
  997bf3b verificado aquí: suite + typecheck + go test).

## Checkpoints

- C1: [x] (harness completo; suite verde equivalente a `./init.sh`)
- C2: [x] (una sola in_progress = F133; current.md describe la sesión activa)
- C3: [x] (domain sin imports react/fs/xlsx — grep vacío; UI no calcula
  dominio: el fallback `??` es presentación, la validación del union vive en
  domain; sin `console.log` nuevos)
- C4: [x] (domain 692 verde; storage mappers testeados; no toca export Optimizer)
- C5: [x] (`git status` limpio; HEAD == origin/main — trabajo pushed;
  F133 `in_progress` es correcto pre-cierre)

## Diseño UI/UX (fieldset Ajustes)

- D1: [x] Reutiliza clases existentes (`catalog-form__section`,
  `catalog-form__field`, `settings-hint`); `fontSize: var(--text-sm)` token.
- D2: [x] Patrón idéntico al fieldset modo PTX del mismo tab (aceptación 3 pide
  exactamente eso).
- D3–D6: [x] No agrega modales, toasts, iconos ni animaciones (no aplica).
- D7: [x] Radios nativos con `<label>` asociado (a11y correcta), estados
  nativos de control de form.
- D8: [x] Copy ES de taller, sentence case, hint explica precedencia sin
  jerga de sistema.

## Observaciones (no bloqueantes)

1. **Estilos inline heredados del patrón PTX** — `gap: 8`, `marginTop: 4/6`
   (`SettingsScreen.tsx:315-341`) son px sueltos (deberían ser `var(--space-2)`
   / `var(--space-1)`), deuda del patrón modo PTX que F133 replica por
   exigencia de consistencia (aceptación 3). Migrar ambos fieldsets a tokens
   en un polish futuro de Settings.
2. **`btn--secondary` clase muerta** — `ProductionOrderOptimizationPanel.tsx`
   botón «Por Material (ZIP)» usa `btn btn--small btn--secondary`; design.md §5.1
   dice que `.btn--secondary` no existe (verificado: no está en CSS). No-op
   visual (`.btn` base ya aplica), pero es vocabulario BEM inválido. Es hunk del
   trabajo PTX (abbcb10) que quedó en 997bf3b por compartir archivo; corregir
   en follow-up del lado PTX.
3. **Mensaje de commit dice "web +2"** — los 2 payloads actualizados con el
   campo nuevo viven en `packages/ui/src/settings/SettingsScreen.test.tsx`, no
   en apps/web. Menor imprecisión documental.
4. **Hunks PTX residuales en 997bf3b** (botones PTX por material y firma
   `mode` en panel/workspace/shell): consecuencia inevitable de partir por
   archivo un commit que mezclaba dos features en archivos compartidos. El
   árbol final es exacto y verificado; para futuros splits paralelos, preferir
   hunk-level staging (`git add -p`) para lograr atomicidad perfecta.

## Deuda anotada por el implementador (fuera de scope, confirmada)

- `ptxExportMode`/`defaultSawKerfMm`/trims/deduct sin paridad Go (se pierden en
  modo server al recargar). Correctamente NO mezclado en F133; requiere feature
  de follow-up.
