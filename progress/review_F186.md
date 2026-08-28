# Review — feature F186 (#415 / SU-ENT-2)

**Veredicto:** CHANGES_REQUESTED

**Rama:** `feat/415-native-component-renderer` (0 commits vs `origin/main`; todo el
trabajo está sin commit: 19 archivos modificados + 3 sin trackear)

**Verificación ejecutada por el revisor (todo verde):**

- `bundle exec rake verify` (syntax + lint + unit + boundary + RBZ): OK —
  159 runs / 2217 assertions, RBZ sha256 `519d3db9…` (coincide con la evidencia
  declarada en `progress/current.md`).
- `go test ./...` backend-go: OK (incl. `TestLayoutComponentDefinitionIdentity`
  y `TestLayoutTransformContractSerializationGolden` con `-count=1`).
- `pnpm typecheck` + `pnpm test`: OK (301 test files TS; sin cambios TS).
- Fixture `test/fixtures/native_layout.json` == golden
  `contracts/sketchupLayoutTransform.contract.json` (comparado byte a byte por
  contenido JSON: idénticos).

## Checkpoints

- C1: [x] Archivos base y docs/skills presentes; gates equivalentes a
  `./init.sh` (typecheck + tests TS + go test) ejecutados en verde por el
  revisor.
- C2: [x] Cero features `in_progress`; F186 `done` con tests que pasan;
  `progress/current.md` describe la sesión activa F186.
- C3: [x] Boundaries respetados: Ruby sin reglas de manufacturing (boundary
  ownership verde, sin tabla slot/role→rotación, sin inferencia de espesor/
  orientación), geometría local pura + transform #414 aplicado 1:1
  (`Geom::Transformation.axes`). Golden diverge intencionalmente por el campo
  nuevo `componentDefinitionId` y está documentado con comentario en
  `layout_transform_test.go:310-315`.
- C4: [x] `@granete/domain` 90 files verde; golden Go↔Ruby compartido consumido
  textual por los tests Ruby; paridad afirmada por fixture, no por inspección.
- C5: [ ] **Trabajo sin commit/push** — `git log origin/main..HEAD` está vacío;
  toda la feature vive sólo en el working tree. Los 3 archivos sin trackear son
  legítimos (tests/fixture), `progress/history.md` tiene la entrada F185 y
  `feature_list.json` refleja F186 `done`, pero la regla dura del skill
  (nunca aprobar trabajo no pushed; `docs/verification.md` §15.9) impide
  cerrar así.

## Diseño UI/UX

No aplica: no se tocan `packages/ui/src/` ni `.css`; el wiring del
`dialog_controller` es del lado SketchUp (WebView), sin componentes de
design system.

## Evaluación contra los criterios del issue #415

1. **Jerarquía nativa:** cumple. Mueble top-level = `ComponentInstance` con
   definición aislada por instancia; tableros/herrajes = `ComponentInstance`
   anidados con geometría sólida local; negative proof anti-Group
   (`native_entity_renderer_test.rb:77-99`) y path genérico offline también
   nativo (líneas 356-370).
2. **Aislamiento FI-A/FI-B:** cumple. Definiciones top-level distintas
   (`refute_same`, líneas 180-207) y rebuild de FI-A no muta children/geometría
   de FI-B. `purge_orphan_generated_definitions` es scoped (sólo prefijos
   Granete Parte/Herraje sin instancias vivas; jamás broad purge).
3. **Identidad:** cumple. `componentDefinitionId` publicado por Go
   (`layout.go`, compartido por copias, ≠ instanceId), preservado verbatim por
   el parser, ≠ GUID nativo ≠ catalogComponentId (tests líneas 227-292);
   rename no altera metadata; GUIDs/persistent_ids ausentes del JSON de
   metadata (negative proof por búsqueda textual).
4. **Geometría/transform:** cumple. Caja local `[0,width]×[0,thickness]×[0,length]`
   en origen (test líneas 157-178), transform == `axes(translation, basis)`
   exacto, bases 90° con entradas 0/±1, `rigid?` impide escala no-uniforme/
   espejo, move/rotate top-level no reescribe children.
5. **Atomicidad:** cumple. Una operación por insert/rebuild; fallo ⇒ abort sin
   jerarquía ni definiciones parciales (test líneas 308-329, con journal de
   rollback en los stubs); metadata se escribe dentro de la misma operación,
   sólo con jerarquía ya válida; stubs modelan rollback estructural
   (`test/support/sketchup.rb` journal + `clear!`/`remove` registrados).
6. **Boundary Ruby:** cumple. `render_layout` rechaza bodies crudos
   (`ArgumentError`); el parser falla cerrado ante contrato ausente/desconocido/
   base no ortonormal o zurda; herrajes mantienen AABB server-resuelto con
   traducción pura (decisión #414 documentada).
7. **Negative proofs:** presentes y significativos (los 5 requeridos por el
   issue: shared-definition side effect, world-AABB baked, escala no-uniforme,
   GUID como identidad, inferencia slot/AABB).
8. **No-goals:** #416 no implementado (sólo fail-closed — **pero ver hallazgo
   H2**), #417 no tocado, #404 sólo wiring mínimo, Digital Thread #385+ no
   tocado.
9. **Veracidad de evidencia:** cumple. Host smoke declarado PENDIENTE en
   `current.md`, `README.md` y el acceptance del ledger, sin simulación —
   consistente con `docs/verification.md` §15 (blocked/environment). La suite
   TestUp es fail-closed (flunkea si no hay RBZ instalado o si carga el
   checkout).

## Hallazgos

### H1 — Bloqueante (regla dura): trabajo sin commit ni push

La rama tiene **cero commits** contra `origin/main`; toda la feature (19
modificados + `native_entity_renderer_test.rb`, `TC_NativeEntitySmoke.rb`,
`native_layout.json` sin trackear) vive sólo en el working tree. El skill del
revisor prohíbe aprobar trabajo no pushed; `AGENTS.md` §4 exige commit/push en
rama antes de cerrar.

**Acción:** commit atómico de F186 (sólo los archivos listados arriba, sin
trabajo ajeno — verificado: todos pertenecen a esta feature) y push a
`origin/feat/415-native-component-renderer` + PR con base `main`.

### H2 — Fail-closed legacy Group no es host-accurate (`respond_to?(:definition)`)

`apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:252-254`:

```ruby
unless furniture.respond_to?(:definition)
  return { 'success' => false, 'error' => LEGACY_REPRESENTATION_ERROR }
end
```

En el host real, `Sketchup::Group#definition` **existe** (los Groups envuelven
una `ComponentDefinition`; API disponible desde SU2016). Por lo tanto un Group
legacy con metadata Granete válida **pasa** el guard: `update_furniture`
ejecuta `furniture_definition.entities.clear!` y re-renderiza children nativos
dentro de la definición del Group, devolviendo `success=true` con un top-level
que sigue siendo `Group` — exactamente el estado híbrido que la propia doc
actualizada en este diff dice que debe fallar cerrado
(`docs/architecture/sketchup-native-entity-model.md` §2.1: *"updating a legacy
Group through the current extension fails closed with a #416 pointer"*).

El unit test `native_entity_renderer_test.rb:331-343` sólo pasa porque
`GroupStub` (`test/support/sketchup.rb:227-238`) no modela `#definition`: el
stub es más estrecho que el API real justo en el predicado bajo test. La cadena
producción lo alcanza: `selection_observer.rb:30` resuelve cualquier entidad
con `kind: furnitureInstance` (incluidos Groups legacy con metadata válida) y
el controller forwarda esa entidad a `update_furniture`.

**Acción:** discriminar por clase y no por `respond_to?` — p. ej.
`furniture.is_a?(Sketchup::ComponentInstance)` (en el API real `Group` y
`ComponentInstance` son clases hermanas, ambas bajo `Drawingelement`, así que
el `is_a?` excluye Groups) o rechazo explícito de `Sketchup::Group`. Hacer que
`GroupStub` modele `definition` para que el unit test pruebe el comportamiento
del host real, y agregar un caso legacy-Group a `TC_NativeEntitySmoke.rb`.

### H3 — Doc canónica contradictoria: `sketchup-interaction-model.md` quedó stale

Este diff actualiza `docs/architecture/sketchup-native-entity-model.md`
(§2.1 legacy / §2.2 "[CURRENT]") pero **no** toca
`docs/architecture/sketchup-interaction-model.md`, que ahora miente sobre el
runtime:

- §3.1 "Runtime actual [CURRENT]": describe la jerarquía Group como vigente;
- §3.3 "Hasta cerrar #415: … ninguna feature nueva debe elevar Groups…";
- §7 (cierre): "El renderer Group actual sigue consumiendo el AABB hasta #415";
- §20 lista "#415: Group renderer → native ComponentInstances" como deuda
  abierta.

Dos docs canónicos del mismo programa quedan contradictorios (regla de
conflicto de `AGENTS.md` §1: registrar/corregir la discrepancia).

**Acción:** actualizar §3.1/§3.3/§7/§20 de `sketchup-interaction-model.md` al
estado post-#415 (renderer nativo CURRENT, Group = legacy #416), en el mismo
commit de la feature.

### H4 — Menor / recomendado (no bloqueante)

1. **Boards legacy: defID == instanceId.** `layout.go:330-333`
   (`legacyBoardStack`) asigna `defID = fmt.Sprintf("legacy-%s-%d", …)` — el
   mismo valor que `id`, colapsando los namespaces definition/instance en ese
   path. El test Go sólo afirma `defID != instanceId` sobre el path de
   structures. Pragmáticamente aceptable (boards legacy no tienen copias), pero
   conviene documentarlo en el campo o cubrirlo con test/issue para que el
   contrato #346 no se erosione silenciosamente.
2. **Hallazgo lateral del implementador** (componentInstanceId colisionantes
   cuando el catálogo duplica la misma entrada `ComponentID`, paridad TS↔Go
   preexistente): `current.md` pide registrarlo como issue aparte — hacerlo
   antes de cerrar la sesión.
3. **Host smoke PENDIENTE:** correctamente declarado, no simulado. Recordar que
   el ítem 8 de verificación de ADR-0004 (validación en host real + OCL) queda
   abierto y es scope de #417; ejecutar `TC_NativeEntitySmoke` en host apenas
   haya RBZ + TestUp disponibles y adjuntar output JSON + sha256.

## Cambios requeridos

1. **(H1)** Commit atómico de F186 en `feat/415-native-component-renderer` +
   `git push` + PR con base `main` (regla dura: no se aprueba trabajo no
   pushed; hoy hay 0 commits).
2. **(H2)** Reemplazar el guard `respond_to?(:definition)` de
   `furniture_builder.rb:252` por una discriminación host-accurate
   (`is_a?(Sketchup::ComponentInstance)` o rechazo explícito de Group),
   alinear `GroupStub` con el API real (que responda `definition`) para que
   `test_update_rejects_legacy_group_representation` pruebe el caso real, y
   agregar caso legacy al host smoke.
3. **(H3)** Actualizar `docs/architecture/sketchup-interaction-model.md`
   (§3.1, §3.3, §7, §20) para dejar de describir el renderer Group como
   CURRENT.
4. **(H4)** Registrar el issue del hallazgo lateral (componentInstanceId
   colisionantes) y dejar documentado/cubierto el caso defID==id de boards
   legacy.

## Nota de calidad

La implementación es sólidamente correcta contra ADR-0004 y los criterios del
issue #415 (matriz obligatoria + negative proofs golden-driven, atomicidad con
journal real en stubs, identidad tri-namepaced sin GUIDs, cleanup scoped,
boundary manufacturing limpio). Los hallazgos H1 (proceso) y H2 (un predicado
stub-faithful pero no host-faithful) son los únicos bloqueantes; H2 es
precisamente el tipo de divergencia stub↔host que el host smoke pendiente
debería atrapar cuando se ejecute.

---

# Round 2 — re-verificación (2026-08-27)

**Veredicto final:** APPROVED (condicionado al cierre — ver condiciones)

## Re-verificación ejecutada (todo verde)

- `bundle exec rake verify`: OK — 156 runs / 1422 assertions (unit, +6 vs
  round 1 por el test reforzado) + 3 runs / 801 assertions (boundary); RBZ
  sha256 `245785d090fab70c98f232948e2860b4f09119d048ac30a29eab375e21609c88`
  (coincide con el declarado).
- `go test -count=1 ./...` backend-go: OK (sin caché; incluye
  `TestLayoutComponentDefinitionIdentity` y
  `TestResolveFurnitureLayoutLegacyModuleStacksAllPieces` con la aserción
  defID==id del path legacy).
- TS sin cambios desde round 1 (el diff no toca `packages/` ni `apps/web`);
  el verde de `pnpm typecheck` + `pnpm test` de round 1 sigue vigente.
- Fixture `native_layout.json` == golden contract: sin cambios, idénticos.

## Estado de los hallazgos round 1

- **H1 (commit/push):** atendido por protocolo — el commit atómico + push +
  PR (base `main`) se ejecutan al cierre de esta ronda, después de este
  veredicto, según el protocolo acordado con el orquestador y `AGENTS.md`
  ("Antes de cerrar: push"). La aprobación queda **condicionada** a que ese
  push ocurra; sin él la sesión no se cierra.
- **H2 (guard host-accurate):** RESUELTO y verificado.
  `furniture_builder.rb` (`update_furniture`) ahora discrimina por TIPO con
  `furniture.is_a?(::Sketchup::ComponentInstance)` + comentario que explica
  por qué `respond_to?(:definition)` es inseguro. `test/support/sketchup.rb`
  define `Sketchup::ComponentInstance`/`Sketchup::Group` como clases base
  hermanas (host-faithful) con `GroupStub < Sketchup::Group` **con**
  `#definition` (líneas 240-258) y `ComponentInstanceStub <
  Sketchup::ComponentInstance`. El unit test
  `test_update_rejects_legacy_group_representation` ahora aserta el trap real
  (legacy responde a `definition` Y ES Group → rechazado, **sin iniciar
  operación**, definición intacta). `TC_NativeEntitySmoke` agrega
  `test_legacy_group_representation_fails_closed_with_416_pointer` (Group real
  con geometría + metadata → error #416, group válido e intacto).
- **H3 (doc contradictoria):** RESUELTO en lo sustancial.
  `sketchup-interaction-model.md` §3.1/§3.3/§6.2/§7/§17/§22 ahora declaran el
  renderer nativo como CURRENT post-#415 y el Group como legacy #416. **Residual
  menor (R2-1):** §20 "Current implementation debts" sigue listando
  "#414: authoritative local part transform…" y "#415: Group renderer →
  native ComponentInstances" como deudas abiertas (y, preexistente a esta
  feature, #402/#403 ya mergeadas). Contradicción interna de bajo impacto,
  pero del mismo tipo que H3.
- **H4 (legacy defID + hallazgo lateral)::** RESUELTO. `layout.go`
  `legacyBoardStack` documenta defID==id como intent (pieza flat =
  definición single-instance) y
  `TestResolveFurnitureLayoutLegacyModuleStacksAllPieces` lo aserta
  explícitamente. Hallazgo lateral registrado como issue
  [tiagofur/muebleria#434](https://github.com/tiagofur/muebleria/issues/434)
  (OPEN, con análisis de paridad TS↔Go y propuesta).

## Checkpoints (round 2)

- C1: [x] — idem round 1, gates re-ejecutados en verde.
- C2: [x] — idem round 1; `current.md` documenta además la round 1 y el #434.
- C3: [x] — idem round 1; el fix H2 no introduce lógica de dominio en Ruby
  (es un discriminador de tipo host).
- C4: [x] — re-ejecutado con `-count=1`: verde.
- C5: [x] condicionado — archivos sin trackear legítimos (tests/fixture +
  este review); `history.md` F185 presente; F186 `done` con tests verdes.
  El commit/push queda como paso de cierre obligatorio (condición H1).

## Condiciones de cierre (obligatorias para cerrar la sesión)

1. Commit atómico de F186 en `feat/415-native-component-renderer` (sólo los
   archivos de esta feature + este review + `current.md`) y `git push`;
   PR con base `main` (verificar base antes de mergear — regla de PRs
   apilados de `docs/verification.md` §4).
2. En el mismo commit de cierre, limpiar los bullets stale de
   `docs/architecture/sketchup-interaction-model.md` §20 (mínimo #414 y #415;
   idealmente también #402/#403 ya mergeadas). Es un edit de dos líneas; no
   justifica otra ronda de revisión pero no debe quedar atrás.
3. Host smoke `TC_NativeEntitySmoke` (ahora con el caso legacy incluido):
   sigue PENDIENTE de ejecución en host real — ejecutarlo apenas haya RBZ +
   TestUp disponibles y registrar output + sha256 (no simular). Queda además
   como verificación abierta de ADR-0004 ítem 8 → scope #417.

## Veredicto final

**APPROVED** — los dos hallazgos bloqueantes de fondo (H2, H3-sustancial) y
los menores (H4) están correctamente resueltos con evidencia; la verificación
completa re-ejecutada está verde (rake verify con RBZ `245785d0…`, go test sin
caché, TS sin cambios y verde en round 1). La aprobación está condicionada a
las condiciones de cierre 1-2 (push + limpieza §20 en el mismo commit); la
condición 3 queda registrada como deuda de verificación en host, no
simulable, trackeada por #417.
