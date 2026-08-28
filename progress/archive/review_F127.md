# Review — feature F127

**Commit:** `a7bfacb` (implementación) + `dd16108` (fix de review)
**Veredicto:** APPROVED (2026-08-20, tras fixes de review)

> Cierre de la primera vuelta (CHANGES_REQUESTED): la implementación era
> correcta contra los 7 acceptance items y las convenciones, pero aplicaba
> la regla dura del reviewer (trabajo sin `git push`) + un fix menor de
> formato. Ambos fixes fueron verificados por el revisor:
>
> 1. `dd16108` separa los imports fusionados (`hardware.ts:7-8`) — diff de
>    solo 2 líneas, sin cambios de comportamiento; web 288/288 tests +
>    typecheck verde sobre el HEAD final.
> 2. Push verificado: `git rev-parse HEAD origin/main` = `dd16108` (ambos
>    iguales); `git log origin/main..HEAD` vacío.
>
> Con esto F127 puede cerrarse como `done`.

## Checkpoints

- C1: [x] Harness completo; `pnpm test` verde (equivalente al gate de `./init.sh`)
- C2: [x] Solo F127 `in_progress`; features `done` con tests verdes;
       `progress/current.md` describe la sesión activa
- C3: [x] `packages/domain` puro (hardwareMachining.ts importa solo `./errors`
       y `./types`; package.json sin deps nuevas); UI no calcula dominio
       (solo invoca `validateMachiningProfile` / `countMachiningOperations` y
       captura `ValidationError`); `packages/excel` no tocado; sin
       `console.log` ni `as any` nuevos en el diff
- C4: [x] Verificación real: `pnpm test` 2376/2376 en 7 workspaces;
       `pnpm typecheck` verde (7/7); `go test -count=1 ./internal/...` ok
       (incl. `TestHardware_PersistsMachiningProfile` contra Postgres local
       5445, corrido real — no skip); `go vet` limpio
- C5: [x] **Resuelto en cierre:** `a7bfacb` + `dd16108` pushed;
       `HEAD == origin/main == dd16108` (verificado con `git rev-parse` y
       `git log origin/main..HEAD` vacío tras `git fetch`).

## Diseño UI/UX (design.md)

- D1: [x] Bloque `.hardware-machining__*` en `catalogs.css` (líneas 725–792)
       con tokens only: `--border-subtle`, `--radius-sm`, `--surface-input`,
       `--surface-card`, `--space-*`, `--density-form-gap` (con fallback),
       `--text-sm`, `--weight-semibold`, `--text-secondary`. 0 hex, 0 px sueltos.
- D2: [x] Patrón correcto: disclosure `catalog-form__disclosure*` dentro del
       Modal SM de herraje (mismo patrón F117/F080), resumen en fila expandida
       (`.catalog-row-detail__*`).
- D3: [x] Sin modales nuevos; usa el `Modal` común (focus trap/Esc ya provistos).
- D4: [x] Sin toasts nuevos; error de validación inline en el form (§4.4).
- D5: [x] Solo iconos Lucide (`ChevronDown/Right`, `Plus`, `Trash2`) con
       `strokeWidth={1.5}` y `aria-hidden`.
- D6: [x] Sin animaciones nuevas (toggle display, igual que F117).
- D7: [x] DoD §8: la justificación de screenshot review está escrita en
       `progress/current.md` (sección dentro de modal existente con clases ya
       especificadas — aceptada).
- D8: [x] Copy ES sentence case («Maquinado CNC», «Rol de la parte»,
       «Cara opuesta», «Quitar parte cup»…); icon-only con `aria-label`
       (botón quitar operación, línea 234 de HardwareMachiningSection.tsx);
       hint que enseña (§4.9); unidades `mm` en labels de campo.

## Acceptance (7/7 cubiertos)

1. **Tipos** ✓ — `MachiningOperation` (kinds blind_hole|through_hole|
   counterbore|screw_pilot, `diameterMm`, `depthMm` según kind,
   `innerDiameterMm`, `xMm/yMm`, `face anchor|opposite`) +
   `HardwareMachiningPart` + `HardwareMachiningProfile` en
   `packages/domain/src/types.ts:195-229`, colgados de `Hardware.machining?`
   opcional (retrocompatible), todo `readonly`.
2. **Validación** ✓ — `validateMachiningProfile` lanza `ValidationError`
   accionable: Ø≤0, profundidad faltante/negativa en kinds ciegos,
   `innerDiameterMm` faltante en counterbore, face inválida, ids/roles
   duplicados; con contexto `{part, operationId}` (hardwareMachining.ts).
   Bonus: reglas extra coherentes (pasante sin profundidad, Ø interior solo
   en escareado). Tests cubren cada rama (+22 domain).
3. **Seeds paridad TS/Go** ✓ — plantillaDemo.ts vs seed.go verificados valor
   a valor por el revisor: bisagra taza Ø35×12.5 + 2 fijaciones Ø5 a ±22.5
   (45 mm), placa base 2×Ø5 a ±16 (32 mm), taquete Ø8×15/lado, minifix
   cam Ø15×13 + bolt piloto Ø5×12, tornillo Ø3×35. Ids/labels/valores
   espejo exactos. Golden TS (`hardwareMachining.test.ts` describe "seeds
   demo de maquinado (F127 golden)"). En Go la paridad es por mirror
   documentado (patrón F116), sin golden test Go — aceptado por precedente.
4. **Sección Maquinado en catálogo** ✓ — `HardwareMachiningSection.tsx`
   (ver/agregar/quitar partes y operaciones, auto-open F117 al editar herraje
   con perfil, cambio de kind preserva id/label/offsets); resumen «N partes ·
   N operaciones» en fila expandida; UI no calcula dominio.
5. **Persistencia** ✓ — apiMappers TS (`normalizeMachiningProfile` en ingest,
   `null` en legacy/cost-only, +3 tests round-trip y garbage-drop); struct Go
   con JSON casing espejo del TS; migración `000063_hardware_machining.up.sql`
   aditiva (`ADD COLUMN IF NOT EXISTS machining JSONB`, NULL = cost-only, con
   down); localStorage: el perfil viaja en el workspace JSON vía
   `plantillaCatalog → plantillaCatalogWithModules → seedCatalogExpandedLatAm
   → createSeedWorkspace` (round-trip implícito en workspace.test.ts).
6. **Tests** ✓ — verificación unit domain, golden seeds TS, round-trip
   mappers (+3 storage), render del editor (+5 ui: auto-open, agregar,
   bloqueo con error del dominio visible, quitar, resumen), store web (+2),
   Go integración real (nil preservado, clear on update, dos partes con
   profundidades intactas).
7. **Verdes** ✓ — `pnpm test` 2376/2376; `pnpm typecheck` 7/7;
   `go test -count=1 ./internal/...` ok.

## Boundaries y convenciones

- `packages/domain` sin deps nuevas ni React/fs ✓. Doc comment de una línea
  en módulos nuevos ✓. Identificadores en inglés, copy ES ✓.
- Tamaños: hardwareMachining.ts 298, HardwareMachiningSection.tsx 439
  (panel denso extraído a su archivo — espíritu de partición cumplido) ✓.
- Regresiones: los 3 items nuevos (HER-TAQ-8X30, HER-MIN-15, HER-PLACA-BIS)
  no están referenciados por optionGroups ni hardwareLines (grep en todo el
  repo: solo aparecen en plantillaDemo.ts); `.machining` no tiene consumidores
  en `packages/domain/src/engine/` ni `packages/excel/` → BOM/exports/
  optimizer intactos. Herrajes existentes (bisagra, tornillo) ganaron el
  campo opcional sin cambiar costo ni comportamiento (motor no lo lee).
- Re-scope del backlog (F081 → done, F127–F132) en el mismo commit:
  autorizado por el dueño del producto y documentado en current.md — no se
  trata de trabajo "ajeno" mezclado.

## Cambios requeridos

1. ~~**`git push`**~~ — **RESUELTO**: verificado `HEAD == origin/main == dd16108`.
2. ~~**Fix menor de formato**~~ — **RESUELTO en `dd16108`**: imports de
   `apps/web/src/stores/catalog/hardware.ts:7-8` separados en dos líneas;
   web tests 288/288 + typecheck verde sobre el HEAD final.

## Notas (no bloqueantes)

- El round-trip localStorage de `machining` queda cubierto de forma
  implícita (el workspace JSON serializa el campo); si se quiere explícito,
  una aserción en `workspace.test.ts` sería bienvenida en F128+.
- `hardwareMachiningArg`/`scanHardwareMachining` silencian errores de
  marshal/unmarshal devolviendo nil — consistente con `part_finishes` (F080),
  aceptado.
