# F193 — SelectionContext semántico + inspector contextual (#476)

Estado: `in_progress` (implementación, verificación y correcciones de review
completas; pendiente de re-review/cierre).

Worktree: `../muebles-worktrees/476-selection-context` (rama
`codex/476-selection-context` desde `origin/main` b4f8e7e). PR #479.

## Qué se implementó

- `Selection::SelectionContext`: contrato canónico único
  `kind = furniture | aggregate | part | hardware | unmanaged` con namespaces
  de ID estrictamente separados que jamás se colapsan:
  `furnitureInstanceId` (server, #384; `nil` hasta que exista) vs
  `furnitureInstanceRef` (locator local = `identity.instanceRef`);
  `projectId/designId/baseRevisionId` (server) vs
  `projectRef/designRef/sourceRevisionRef` (local). La `identity_key` es por
  OCURRENCIA (owner id/ref + `componentInstanceId` o `hardwarePlacementId`
  según kind): sin IDs de definición ni host bindings.
- `Selection::Resolver`: metadata-only; hardware con namespace propio
  (`hardwarePlacementId`, sin `componentInstanceId` fabricado);
  `placementKind` real del contrato (#350) con fail-closed `unknown`.
  Recuperación del owner: `path` (active_path real del host) > `scan`
  (match único por ref) > `ambiguous` (copias pre-#391: nunca primer-match
  silencioso) > `none`; expuesta como `ownerRecovery` en el payload.
- Layout contract Go↔golden↔Ruby: `LayoutHardware.PlacementKind`
  (`manual`|`derived`) — el engine marca `manual` (procedencia real: todo
  placement del layout nace de overrides autoral; `derived` queda para la
  proyección de relationships). Golden regenerado
  (`contracts/sketchupLayoutTransform.contract.json`), parser Ruby valida y
  rechaza valores desconocidos; fixtures Ruby espejan.
- `MetadataWriter.write_part`/`write_hardware`: `entityClass`,
  `hardwareDefinitionId`, `placementKind` explícitos; hardware escribe
  `identity.hardwarePlacementId`.
- `CapabilityPolicy` + `CapabilityReasons`: autoridad única; copy en español
  SIN números de issue (van al detalle técnico); razones por procedencia
  (manual/derived/unknown).
- Inspector (dialog.html): gating por capability EXACTA
  (`canEditParameters` vs `canEditMaterialRoles`), multi-selección
  fail-closed (fieldset nativo deshabilita TODA mutación), breadcrumb por
  `furnitureInstanceRef` sólo cuando el owner es resoluble, IDs Granete en
  detalle técnico plegado, estados unmanaged/ambiguo/sin owner explícitos.
- Harness Node `test/js/dialog_inspector_test.js` (40 checks) ejecutado
  desde la suite unit: prueba el JS real del HtmlDialog.

## Verificación

- `bundle exec rake verify` verde: RuboCop, **201 unit** (incl. harness JS),
  3 boundary, RBZ determinista `ab6b16b0…`.
- `./init.sh` verde (monorepo completo; `go test ./...` incl. engine + api).
- Host real SketchUp 2026.2 (Ruby 3.2.2) + TestUp 2.5.4 contra RBZ
  instalado `ab6b16b0…`: **36/36 tests, 1053 assertions, Success**
  (incluye `TC_SelectionContextSmoke` con negative proof de copia
  shared-definition: ambigüedad reportada, sin owner silencioso, recuperación
  `scan` al borrar la copia). Evidencia: JSON parseable
  `progress/host_smoke_F193_testup_ci.json` + stdout completo
  `progress/host_smoke_F193_testup_ci_stdout.txt`.

## Decisiones de la revisión (PR #479)

1. **Separación de namespaces** (blocker): el payload ya no fabrica
   `furnitureInstanceRef` copiando `furnitureInstanceId` ni presenta
   `projectRef`/`sourceRevisionRef` como IDs autoritativos. Negative proof
   con las 8 claves coexistiendo sin colapsarse. Breadcrumb/update/delete
   localizan el host por ref.
2. **Procedencia real** (blocker): `placementOrigin: 'resolved'` eliminado;
   el layout publica `placementKind` (#350) y el plugin persiste/valida ese
   valor; ausente → `unknown` fail-closed con remediación propia. Fixtures
   con `manual` y `derived` cubren ambos discriminantes.
3. **Owner recovery** (blocker): active_path del host cuando existe; scan
   único como fallback; ambigüedad explícita (`ownerRecovery=ambiguous`) sin
   navegación. La suite host usa el mismo `TC_NativeEntitySmoke` pattern;
   `Model#active_entities=` no existe en el host (lo probó el smoke) por lo
   que la rama path se cubre con model double fiel en unit.
4. **Inspector obediente** (blocker): cada control consulta su capability
   exacta; multi-selección deshabilita todas las mutaciones (fieldset
   nativo); `onMaterialChoiceApplied` no muta sin `canEditMaterialRoles` ni
   con selección múltiple. Harness DOM/JS cubre furniture/part/hardware/
   unmanaged/denial/breadcrumb/multi (40 checks).
5. **Limpieza**: copy de usuario sin issue-refs (“autoría” corregido), IDs y
   refs de proyecto/revisión en detalle técnico plegado, evidencia separada
   en JSON válido + `.log`.

## Notas de entorno

- TestUp host: SketchUp 2026.2 macOS; corridas espaciadas (~25 s) para
  evitar crashes de relanzamiento rápido.
- TC_NativeValidationSmoke actualizado al namespace de hardware
  (`hardwarePlacementId`); fixtures `native_layout.json` y
  `cabinet_validation_layout.json` espejan el golden regenerado.
