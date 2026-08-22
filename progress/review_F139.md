# Review — feature F139

**Veredicto:** APPROVED

> Re-review (2026-08-21): los 2 cambios requeridos fueron aplicados y
> verificados — D1: `costingView.ts` ahora delega en `timeEntryCost` del
> dominio; D2: `loadQuoteSnapshotTx` distingue `pgx.ErrNoRows` del error real.
> Suite re-ejecutada verde (panel 10/10, `go test` sin caché, `pnpm typecheck`
> monorepo OK).

**Fecha:** 2026-08-21 · **Rama:** `feat/f139-job-costing` (issue #304, OC-080..OC-084)

## Checkpoints

- C1: [x] Harness completo; `./init.sh` verde (domain 911 · storage 150 · ui 1197 · web 301 · mobile 45 · desktop 17 · `go test ./...` OK).
- C2: [x] Una sola feature `in_progress` (F139); tests asociados pasan; `progress/current.md` describe la sesión activa.
- C3: [x] Boundary OK tras fix D1 (`timeEntryCost` del dominio en la UI).
- C4: [x] Verificación real por capa: workflow (transición inmutable/void-once en
  `ValidateJobCostingTransition` TS+Go), RBAC (403 vendedor sin flag, void de
  piso 403), auditoría (`cost_*` en misma tx), paridad TS↔Go vía
  `contracts/jobCosting.json` + `contracts/projectEventTypes.json` con tests
  espejo en ambos lados.
- C5: [x] Sin archivos tmp/dist; ledger/progress coherentes (se cierra tras
  aplicar fixes; el push se exige antes del done final).

## Diseño UI/UX

- D1: [x] (fix aplicado) **Cost calculado en React** — `packages/ui/src/projects/costingView.ts:178`
  computa `(entry.minutes / 60) * entry.ratePerHour`. Violación de
  `docs/architecture.md` §15 ("no calcular costos... en React") y del principio
  §1 ("UI no calcula dominio"). **Fix:** importar `timeEntryCost` de
  `@muebles/domain` y delegar (igual que `materialPlanningView` delega al dominio).
- D2: [x] Tokens: `costing.css` sólo usa `var(--*)`; sin hex, sin font-size
  literales, sin px de spacing sueltos (el `1px` es border-width estándar del
  sistema). CSS co-localizado junto al panel.
- D3: [x] Patrón correcto: panel dentro del workspace de Cotización (detalle de
  obra), consistente con OC-091 (sección Costs transversal del proyecto); h3/h4
  sin competir con el título del workspace (§4.1b).
- D4: [x] Sin modales propios; toasts vía el toast del shell en handlers
  (`✓ Baseline de costos capturado`), éxito tipo success (§4.4).
- D5: [x] Iconos Lucide (`DollarSign`, `ClipboardCheck`, `ShieldAlert`) con
  `strokeWidth={1.5}`; ninguno icon-only sin aria-label.
- D6: [x] Sin animaciones nuevas (transiciones del sistema vía `.btn`);
  nada que envolver en `prefers-reduced-motion`.
- D7: [x] Gate §8 aplicado a panel embebido: una primaria (Capturar baseline),
  `.btn` del sistema con estados completos, disabled con validación,
  focus-visible en inputs del panel, `—` para ausentes, tabular-nums, badges
  con texto (no color solo). Loading/empty justificados: datos locales +
  refresh server en background; empty con hint que enseña el siguiente paso.
  Screenshot review: cubierto por behavior tests del panel (estándar F138);
  sin captura manual en esta capa.
- D8: [x] Copy taller en español ("Costos de la obra", "MO modular"); errores
  que enseñan (blockers del baseline dicen cómo resolverlo §7.3); a11y:
  `aria-label` en tablas/inputs, `th scope="col"`, variance con ▲/▼ + texto.

## Cambios requeridos

1. **D1 (boundary):** `packages/ui/src/projects/costingView.ts:178` — reemplazar
   el cálculo inline por `timeEntryCost(entry)` del dominio. (El test del panel
   ya cubre el valor; debe seguir verde.)
2. **D2 (robustez backend):** `backend-go/internal/storage/jobCosting.go:133`
   — `loadQuoteSnapshotTx` devuelve `nil, nil` ante **cualquier** error del
   QueryRow; un error real de DB se reportaría como "sin snapshot" y el
   baseline lo explicaría mal. Distinguir `pgx.ErrNoRows` (→ nil, nil) del
   resto (→ devolver el error).

## Notas (no bloqueantes)

- `HandleProjectCosting` usa el Mutate con lock para el GET: consistente con el
  patrón materials/quality aprobado en F138.
- Rework labor se valora a la tarifa vigente y las entries a su tarifa
  congelada: política documentada en el dominio (`jobCosting.ts` — "history is
  never rewritten"); correcto.
- Costo labor nulo sin tarifa + minutos > 0 (Data Truth) probado en ambos lados.
