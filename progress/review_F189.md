# Review — feature F189 / GitHub #405

**Veredicto:** CHANGES_REQUESTED

**Rama:** `test/405-material-parity-suite` (commit `21ff7f5`, HEAD == upstream; implementación pusheada)

## Checkpoints

- C1: [ ] El harness está presente, pero `pnpm test && pnpm typecheck` no pudo
  ejecutarse mediante pnpm porque el gestor intentó obtener `pnpm@11.1.2` y la
  verificación contra el registry falló. Los gates directos relevantes sí
  pasaron: domain 91 archivos / 1152 tests + typecheck, Go completo y Ruby/RBZ.
- C2: [x] Sólo F189 está `in_progress` y `progress/current.md` corresponde a
  esta sesión.
- C3: [x] El diff sólo agrega fixtures/tests/documentación; no mueve reglas de
  espesor ni geometría a UI o Ruby. Ruby sigue consumiendo `NativeLayout`.
- C4: [ ] Las suites ejecutadas están verdes, pero falta una regresión requerida
  de paridad Go para el escenario C; ver H1.
- C5: [ ] La implementación está limpia y pusheada, pero F189 continúa
  `in_progress`, no tiene entrada en `progress/history.md` y la sesión sigue en
  `progress/current.md`. Esto corresponde al estado previo a aprobación.

## Verificación ejecutada

- `packages/domain`: 91 archivos / 1152 tests verdes; test #405 5/5; typecheck verde.
- `backend-go`: `go test ./... -count=1` verde, incluido engine.
- `apps/sketchup-extension`: `bundle exec rake verify` verde — 164 tests / 1578
  assertions, boundary 3 / 801, RuboCop sin ofensas y RBZ verificado.
- Branch: `git log @{u}..HEAD` vacío y working tree limpio antes de crear este review.

## Evaluación de escenarios

- A — all-16: [x] TS BOM; Go BOM/layout, fórmulas, pose y hardware; Ruby geometría nativa.
- B — BODY 16 / FRONT 18 / BACK 6: [x] TS BOM; Go BOM/layout; Ruby geometría nativa.
- C — FRONT 18→16: [ ] TS compara BOM before/after y Ruby prueba rebuild, pero Go no lo consume ni lo compara.
- D — failure/rollback: [x] TS y Go rechazan material inactivo; Ruby conserva jerarquía/metadata sin operación parcial.
- Negative proof nominal 15/18 vs seleccionado 16: [x] TS y Go fallan si vuelve a ganar el nominal.

## Hallazgos

### H1 — Falta el escenario C en la regresión Go

El contrato define `frontUpdate` con `beforeChoices`, `afterChoices`, role
afectado y roles no afectados
(`contracts/materialThicknessParity.contract.json:42-51`), y la autoridad exige
explícitamente `update FRONT 18→16` y comparación de invariantes semánticos
(`docs/architecture/material-aware-furniture-resolution.md:757-766`).

Sin embargo, `parity405Scenario` sólo deserializa `choices`, `expectedRoles`,
`expectedFormulaResults` y `expectedRejectedRole`
(`backend-go/internal/domain/engine/regression_405_test.go:22-27`); el archivo
sólo ejecuta A, B, D y negative proof (`:110-210`). Por eso un drift en Go que
resuelva correctamente una foto aislada pero cambie BODY/BACK, conteos, pose o
hardware durante FRONT 18→16 no rompe esta suite. Eso contradice la paridad
definitiva pedida por #405 y la descripción de F189, que afirma que TS y Go
comparan esos invariantes (`feature_list.json:4661-4678`).

## Cambios requeridos

1. Agregar en Go una regresión del escenario C que consuma textualmente
   `beforeChoices`, `afterChoices`, `affectedRole`, `expectedAffectedCount` y
   `expectedUnaffectedRoles`; comparar BOM **y layout** antes/después, incluidos
   los cuatro FRONT, BODY/BACK sin cambios, dimensiones exteriores, pose
   dependiente y herraje 578→576.
2. Reejecutar los gates y solicitar una nueva revisión. Tras aprobación, cerrar
   ledger/history/current en el flujo habitual.

## Diseño UI/UX

No aplica: el diff no toca `packages/ui/src/`, CSS ni copy de interfaz.
