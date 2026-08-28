# Review — feature F189 / GitHub #405 — ronda 2

**Veredicto:** APPROVED

**Rama:** `test/405-material-parity-suite` (HEAD `f0b35fb` == upstream; implementación pusheada)

## Resultado de la ronda 2

H1 quedó resuelto. Go ahora deserializa `frontUpdate` completo y ejecuta un
before/after real de BOM y layout para FRONT 18→16
(`backend-go/internal/domain/engine/regression_405_test.go:178-294`):

- exactamente cuatro FRONT cambian;
- BODY/BACK conservan material, espesor, dimensiones, transforms e identidad;
- las dimensiones exteriores permanecen `[600, 720, 560]` desde el contrato;
- el herraje conserva `HostComponentInstanceID` y se recompone 578→576 mm.

La comparación usa `ComponentInstanceID`, no orden posicional, y
`same405LayoutSemantics` incluye material, espesor, dimensiones, pose local y
transform autoritativo. Ya no existe el hueco detectado en la ronda 1.

## Checkpoints

- C1: [x] Harness y autoridades presentes. Gates directos de TS/domain,
  Go y Ruby/RBZ verificados entre ambas rondas; el intento de pnpm global de la
  ronda 1 quedó limitado por sincronización de registry, no por tests rojos.
- C2: [x] Sólo F189 está `in_progress` y `progress/current.md` corresponde a
  esta sesión.
- C3: [x] Boundary respetado: TS/Go resuelven semántica; Ruby sólo consume
  `NativeLayout` y verifica geometría/rebuild nativo sin recalcular espesor.
- C4: [x] Fixture compartido consumido por las tres capas; A–D, propagación,
  agregado, hardware, rollback y negative proof cubiertos. Go enfocado verde.
- C5: [x] Implementación limpia y completamente pusheada. Ledger/history/current
  deben cerrarse después de este veredicto, sin marcar `done` desde el reviewer.

## Verificación ejecutada

- Ronda 1 — domain: 91 archivos / 1152 tests; #405 5/5; typecheck verde.
- Ronda 1 — Ruby/RBZ: 164 tests / 1578 assertions; boundary 3 / 801;
  RuboCop y build verdes.
- Ronda 2 — Go #405 enfocado: verde con `-count=1`.
- Ronda 2 — suite Go local: todos los paquetes de dominio/API verdes; los cuatro
  probes storage no pudieron abrir PostgreSQL por restricción de loopback del
  sandbox. La ejecución con PostgreSQL informada para este mismo commit fue
  verde; no hay fallo de código.
- `git diff --check origin/main...HEAD`: verde.
- `git log @{u}..HEAD`: vacío; `f0b35fb` local == upstream.

## Paridad A–D definitiva

- A — all-16: [x] TS BOM; Go BOM/layout, fórmulas, pose y hardware; Ruby geometría nativa.
- B — BODY 16 / FRONT 18 / BACK 6: [x] TS BOM; Go BOM/layout; Ruby geometría nativa.
- C — FRONT 18→16: [x] TS y Go comparan before/after; Ruby prueba rebuild,
  identidad/world transform, roles no afectados y herraje.
- D — failure/rollback: [x] TS/Go rechazan material inactivo; Ruby conserva el
  último mueble válido sin operación parcial.
- Negative proof 15/18 nominal vs 16 seleccionado: [x] TS y Go fallan si vuelve
  a ganar `Component.thicknessMm`.

## Cambios requeridos

Ninguno.

## Diseño UI/UX

No aplica: el diff no toca `packages/ui/src/`, CSS ni copy de interfaz.
