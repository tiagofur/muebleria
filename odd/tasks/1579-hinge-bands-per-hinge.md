# #1579 — Bisagras por alto declaradas por bisagra y aplicadas a puertas-agregado

## Objective

Cada bisagra del catálogo declara su tabla alto → cantidad (2..5) editable. La
puerta —de módulo o agregado— compra, dibuja y perfora la cantidad que
corresponde a la bisagra efectivamente elegida y a su alto real. Una puerta por
encima de la última banda usa el máximo de la tabla y muestra un aviso visible
sin bloquear.

## Problem

- La escalera existe pero es única (`hingeDemand.ts`, `domain/hinge_demand.go`):
  dos bisagras distintas comparten números. `HingesForDoor` no mira la bisagra.
- Puertas-agregado (`AGR-PUE-*`): cada motor hace una cosa distinta (fijado por
  tests de caracterización en T1):
  - TS: el colector de banda de módulo ve la puerta-agregado (por colocación
    `puerta`) → demanda N por alto; las posiciones por rol de la receta no
    cuentan; las líneas bulk no se deduplican contra la banda.
  - Go: la banda sólo ve partes con rol `FRENTE` y las posiciones de agregado
    no son demanda. Con rol `FRENTES` (el del catálogo real) y sólo posiciones
    → **0 bisagras**; con rol `FRENTE` + línea bulk → doble conteo.
  - Dibujo y perforación usan sólo las posiciones fijas de la receta (2).
- Sin pantalla de edición de la tabla ni aviso cuando la puerta excede la tabla.
- Bug previo reportado al owner 2026-11-23 (fuera de #1579, movería cotizaciones
  cerradas): el servidor cotiza 0 bisagras en `AGR-PUE-DER/IZQ/-ALA`;
  `AGR-PUE-2P` cotiza 4 fijas a cualquier alto.

## Why

Pedido del owner (dossier de herrajes 2026-11-10) con decisiones cerradas el
2026-11-11: tabla en cada bisagra, sin peso, máximo + aviso, migrar `AGR-PUE-*`
sin mover lo cotizado o liberado.

## Scope

- `Hardware.hingeDemand` (JSONB `hardwares.hinge_demand`, nula = sin tabla).
- Orden de resolución: excepción del componente → tabla de la bisagra elegida →
  política de fábrica → escalera de librería.
- `HardwarePlacement.countRule` (opt-in): la receta declara borde y offsets de
  extremos; el motor expande a N posiciones con las medidas reales de la bahía.
- Aviso en la línea de banda resuelta cuando el alto supera la última banda.
- Ficha web del herraje: sección de tabla (prellenada al crear una bisagra).
- Autoría mínima en `HardwarePlacementsEditor`.
- Migración de datos de las 4 recetas `AGR-PUE-*` del catálogo del owner.

## Non-goals

- Peso de la puerta como entrada (decisión owner).
- Pantalla de política de fábrica de bisagras: issue aparte (decisión owner
  2026-11-23).
- Lado de giro y espejo de recetas (#1574, #1575); herraje distinto por copia
  (#1452); F129 server-side en Go (#1218 ítem 3).

## Constraints

- Issue #1579 `status:approved`; base `origin/main` @ `879ae6a7`.
- Un escritor; worktree `../muebles-1579`, rama `feat/1579-hinge-bands-per-hinge`.
- Cotizaciones cerradas se re-resuelven contra pins: todo cambio debe ser
  byte-idéntico con datos que no declaren `hingeDemand` ni `countRule`.
- Sin backfill de tablas (la tabla pasaría sobre una política de fábrica y
  movería cotizaciones cerradas).
- Posiciones fijas siguen siendo intención de autor y siguen ganando.
- Counts válidos en la tabla de la bisagra: 2 a 5.

## Authorized scope

`packages/domain` (hingeDemand, hingeBandDemand, agregados, jointDrillingRules,
projectDrilling, types), `packages/storage` (mappers, generated),
`backend-go` (domain, engine, storage/materials.go, api/catalog_handlers.go,
generated, migración `000195`), `contracts/openapi`,
`contracts/hingeDemandBands.contract.json`, `packages/ui` (ficha de herraje,
HardwarePlacementsEditor, pintado del aviso), `docs/guia-de-uso.md`,
`tests/organization/hinge-demand-bands.spec.ts`.

## Acceptance criteria

- Dos bisagras con tablas distintas en el mismo grupo → la misma puerta compra
  cantidades distintas según la elegida, en cotización, despiece, 3D y perforación.
- Puerta-agregado de 720, 1200, 1800 y 2200 mm → 2, 3, 4 y 5 bisagras con la
  tabla por defecto.
- Sin tabla en el herraje → política de fábrica; sin política → escalera de
  librería (comportamiento actual, byte-idéntico).
- Fixture de paridad TS↔Go en `contracts/`.
- Puerta por encima de la última banda → máximo + aviso visible, sin bloquear.
- Verificación en vivo del owner en web y SketchUp.

## Execution tasks

- [x] **T1 — Caracterización (Go + TS) del resolve actual con recetas `AGR-PUE-*`**
  - Route: inline.
  - Outcome: tests que fijan la salida actual; deben seguir verdes tras T2..T14.
- [x] **T2 — Migración `000195` + storage Go**
- [x] **T3 — Go: campo, validación API, `ResolveHingeCount`, selección de política**
- [x] **T4 — Contrato OpenAPI + regeneración**
- [x] **T5 — TS: dominio, banda, F129, mappers**
- [x] **T6 — Web: `HardwareHingeDemandSection` + draft**
- [x] **T7 — Aviso: `notice` en línea resuelta + pintado**
- [x] **T8 — Paridad: fixture ampliado + vitest + go test**
- [x] **T9 — Guía de uso + issue aparte (política de fábrica)**
- [x] **T10 — PR1: verificación, commits, PR, revisor**
- [ ] **T11 — `countRule` en tipos (TS+Go) y reglas de draft/transform**
- [ ] **T12 — Expansión TS compartida**
- [ ] **T13 — Go: expansión en layout + demanda con exclusividad**
- [ ] **T14 — Autoría mínima en `HardwarePlacementsEditor`**
- [ ] **T15 — Browser spec**
- [ ] **T16 — Migración de datos `AGR-PUE-*` (backup + PUT + readback)**
- [ ] **T17 — «Lo congelado no se mueve»: resolve antes/después**
- [ ] **T18 — PR2: verificación, commits, PR encadenado, revisor**

## Verification plan

- `gofmt -l <archivos Go tocados>` — sin salida.
- `go test ./internal/domain/... ./internal/api/...` (en `backend-go`) — PASS.
- Storage con PostgreSQL real en contenedor desechable (fresh + upgrade 000195).
- `pnpm typecheck` — 0 errores (vitest no typechequea).
- `pnpm test` en domain, storage y ui — PASS.
- `python3 scripts/generate_openapi.py` + `python3 scripts/check_openapi_drift.py` — drift 0.
- `python3 scripts/verify_affected.py --base origin/main --plan` y la selección que devuelva.
- Browser: `tests/organization/hinge-demand-bands.spec.ts` en navegador real.
- Vivo web + SketchUp: owner (`NOT_RUN` hasta entonces).

## Delivery forecast

- Forecast: PR1 ≈ +450/−60 y PR2 ≈ +600/−80 líneas autoras (generados excluidos).
- Delivery strategy: `ask-on-risk`, dos PR encadenados (decisión explícita del
  owner 2026-11-23, por tamaño y riesgo sobre la cotización en Go).
- PR1 base `main`, `Refs #1579` + `Delivery: partial`. PR2 encadenado sobre
  PR1; cierra la issue cuando PR1 esté en `main`.

## Progress and evidence

- 2026-11-23: issue y decisiones leídas; sin trabajo previo (rama y worktree
  limpios, sin PR ni artefacto). Worktree avanzado a `879ae6a7`. Exploradores
  de solo lectura lanzados al inicio quedaron atorados en su primera llamada y
  fueron detenidos; el mapeo se hizo con lecturas directas. Plan aprobado por el
  owner.
- 2026-11-23 T1: `hinge_agregado_characterization_test.go` (12 casos) y
  `hingeAgregadoCharacterization.test.ts` (12 casos) fijan la salida actual.
  `go test` exit 0; vitest exit 0; `tsc --noEmit` exit 0 (atrapó 2 errores de
  tipos que vitest dejó pasar). Catálogo real leído (SELECT de solo lectura):
  componentes de puerta con rol `FRENTES`; `AGR-PUE-DER/IZQ/-ALA` con 2
  posiciones por rol BISAGRA a `y=90` y `PH-90`, sin línea bulk; `AGR-PUE-2P`
  con línea fija de 4 (id concreto) — la migración son 5 recetas.
- 2026-11-23 T2..T9 (commits `47f10bc3`, `a1d270e9`, `718be526`, `e8348539`,
  `42a6ce11`): migración 000195 (sin backfill a propósito), storage roundtrip
  PG real fresh (195 migraciones aplicadas, exit 0), API 422 + PUT omitido
  conserva/null borra, `HingeDemandForDoor` (excepción → tabla → fábrica →
  librería), `ResolveHingeCount` + aviso en `ResolvedHardwareLine.Notice`,
  tri-estado del surge protegido por `UnmarshalJSON` (null = desactivado),
  OpenAPI regenerado drift 0, TS espejo (55 casos de contrato), F129 perfora
  con la tabla de la bisagra elegida, ficha web con sugerencia precargada
  (nunca pisa lo declarado), aviso en el preview de costo (`CostPreview =
  QuoteBreakdown + notices`, cálculo aislado del costo), guía §8c.5c, issue
  #1699 (pantalla de política de fábrica) fileada.
- Decisión de diseño anotada: la escalera de librería es una tabla también —
  sin tabla en la bisagra, un desborde de la escalera SE avisa (deja de ser
  silencioso); la cantidad no cambia. Fijado por test en ambos stacks.
- Hallazgo preexistente reportado al owner, fuera de alcance: el gate de
  opciones exige BISAGRA en módulos con puerta colocada pero
  `defaultOptionChoicesForModule` no lo pre-elige → el preview nace bloqueado
  salvo que otra línea declare el rol (fileado como #1700).
- 2026-11-23 T10 (commits `06b35986`, re-pin): verificación completa de PR1.
  V0: gofmt limpio en los tocados; `pnpm typecheck` workspace 0 (incluye
  tests); drift OpenAPI 0. V1: `pnpm test` workspace PASS (ui 2624 · web 663 ·
  mobile 87 · isolation 16); suite Go completa `backend-test.sh ./...` 916s
  contra PG efímero fresh — 15 paquetes ok + 1 fallo = el pin de esquema del
  test de definiciones (184) que su propio comentario ordena re-anclar cuando
  la lectura de catálogo requiere columnas nuevas → re-anclado a 195,
  confirmado exit 0 en PG fresh (storage 7.4s); rubocop 322 archivos 0
  ofensas + `rake unit` 1530/0 (el `rake verify` local cae sólo por
  bundler/Ruby 4; cero archivos Ruby en el diff). V2: browser gate 2/2 PASS
  (la misma puerta 2100 cotiza 5 vs 4 según la tabla de la bisagra, dinero
  congelado en Q1, readback de la tabla íntegro); visual proyectar 12/12
  PASS. foundation-postgres: NOT_RUN local, lo cubre el CI del PR.
  NOT_RUN esperando al owner: vivo en web y SketchUp (aceptación explícita).
- 2026-11-23 Review independiente fresco sobre `32337b88` (read-only):
  **APPROVED, 0 blockers**, 8/8 focos verificados (escalera en ambas pilas,
  byte-idéntico, tri-estado del surge en todo el viaje, omitido-conserva del
  PUT, F129, aviso, migración/pin, forma del PR) + 5 sugerencias no
  bloqueantes y escalación a juicio dual por tocar migraciones + contratos de
  paridad (protocolo del reviewer; ceremonia función/contrato del taller).
  S2 y S3 aplicadas en el mismo PR (comentario del PUT; retirar la sugerencia
  intacta si el herraje deja de ser bisagra, respetando lo editado — 11/11
  pruebas de la sección). S1 = nota para PR2 (rol por puerta en drilling);
  S4/S5 = notas de precisión, sin cambio.
- Escalación ejecutada: juicio dual ronda 1 (dos jueces ciegos read-only,
  alcance y prompt idénticos) sobre `48adb5f2`. Ledger: **0 CRITICAL, 0
  contradicciones**. Confirmado por AMBOS (WARNING): `HardwareWrite` del
  OpenAPI sin `hinge_demand` — la escritura documentada no expresaba el campo
  que el servidor acepta. Info: S-A2 mapper TS trunca tabla con fila inválida
  (gemelo Go descarta entera), S-A3 texto del aviso ambiguo en el caso
  multi-puerta por herraje, W-B2 aviso en escalera de librería vs. letra del
  byte-idéntico (**decisión owner 3 explícita: deja de ser silencioso**),
  S-B3 log en scan (espeja precedente pieces). Ronda 1 de pulido (ordenaria,
  no de fix-day: ninguna era severa): `hinge_demand` declarada en
  `HardwareWrite` + clientes regenerados + drift 0; mapper TS descarta la
  tabla entera ante cualquier fila inválida (+test); aviso reredactado a
  «…bisagras por puerta» en Go/TS/fixture/tests (9 anclas). Verificado:
  build Go 0, go test TestHinge ok (domain+engine), drift 0, types 0, vitest
  domain 61/61 · storage 120/120 · ui 14/14 · web 89/89. HEAD final: ver
  `git log`.

## Next step

PR2 sobre este PR: countRule en la receta, expansión TS/Go, autoría mínima,
migración de catálogo (autorizada por el owner 2026-11-23) y «lo congelado
no se mueve».
