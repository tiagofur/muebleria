# Review — feature F161 / GitHub #346

**Veredicto:** APPROVED

Slice 1 reviewado como parte del PR #369 (mergeado); este round cubre el
slice 2 y el cierre de #346. Fuentes: `docs/sketchup-manufacturing-contract.md`
(actualizado con namespace granete.*), `docs/architecture.md` §SketchUp,
`docs/conventions.md`, `CHECKPOINTS.md`, issue #346 completo.

## Verificación ejecutada por el revisor

| Probe | Result |
|---|---|
| `pnpm vitest run src/sketchupAuthoring` | 22/22 — identity, idempotencia/replay, atomicidad, tombstones assembly+sub-entidad, no-reuse, conflictos por omisión y base stale, issues estructurados, golden round-trip, feedback read-only, fingerprint |
| `tsc --noEmit` (domain) | 0 errores |
| `./init.sh` | exit 0 real (log completo verificado por secciones) |
| Boundary spot-check | El envelope no puede expresar resolved data (test + tipos); sin React/fs/xlsx en domain; errores como `ContractIssue` estructurados, no strings |
| Contract parity | Todos los codes del contract §9 usados o reservados; paths estables §9; receipt/respuesta §7 fiel |

## Puntos verificados contra el contrato

1. **Stable IDs (§3):** unicidad por proyecto validada; anchors/hosts sólo
   `componentInstanceId`; definition compartible sin ser anchor; no-reuse tras
   delete en toda granularidad (tests explícitos).
2. **Full-snapshot-with-tombstones (§7):** omisión → conflicto con entityId y
   path (assemblies y sub-entidades); tombstone desconocido o coexistente →
   `ENTITY_TOMBSTONE_INVALID`; apply atómico (cualquier error deja el estado
   intacto, `result.state === state`).
3. **Idempotency (§8):** mismo key+payload replaya la misma respuesta
   (incluido responseMessageId); key+payload distinto → `IDEMPOTENCY_CONFLICT`
   sin mutar.
4. **Migrations (§7):** registry fail-closed; versión sin camino lossless
   rechaza ANTES de validar/mutar (test).
5. **Read-only feedback (§6/§7):** tipos con provenance de variante única
   (`isValidDerivedOperationProvenance` rechaza `{}` y formas truncadas);
   `resolvedFeedback?` sólo en la response; el envelope no tiene campo para
   expresarlo (test de boundary).
6. **Units/transforms (§4):** mm/deg, precision de transporte en fingerprint,
   quaternion normalizado, escala negativa/no-uniforme → error explícito (V1).

## Desviación documentada

Namespace `granete.sketchup-authoring.v1` en lugar del `muebles.*` del issue:
registrada en el contract doc, el ledger F161 y comentario del issue #346.
Nada publicó `muebles.*` → sin migración pendiente.

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0 real.
- C2: [x] Una feature `in_progress` (F161) al comenzar; current.md describiendo
  la sesión activa.
- C3: [x] Boundaries respetados: dominio puro en `packages/domain`, sin UI ni
  IO; manufacturing truth no viaja al authoring side.
- C4: [x] Verificación real: 22 tests del contrato + suite completa verde +
  golden fixture versionado.
- C5: [x] Cierre limpio: ledger F161 `done`, `history.md` con entrada,
  current.md actualizado, todo pusheado.

## Diseño UI/UX

No aplica: F161 no toca UI (sin cambios en packages/ui ni css).

skill_resolution: paths-injected
