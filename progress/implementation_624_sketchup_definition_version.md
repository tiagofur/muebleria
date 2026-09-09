# Implementation #624 — SketchUp working-copy definition version guard

## Delivery identity

- Issue: #624 (`status:approved`). Human authorization: `corregimos el 624`.
- Branch: `codex/fix-624-sketchup-definition-version`.
- Exact base: `origin/main@3b2d08539b5d0e3aaf81fc4d6627636398a00fb7`.
- Delivery HEAD: the conventional work-unit commit that contains this report; its exact remote SHA is read back after push because a commit cannot embed its own hash.
- State: `IMPLEMENTED_PENDING_REVIEW`. No PR, merge, issue closure, or ledger mutation was performed.

## Root cause and correction

`FurnitureBuilder` correctly preserves the catalog semantic version in local authoring metadata, but the working-copy adapter treated that catalog value (`"1.0.0"`) as `PublishDesignRevisionItem.definition_version`. The generated Go/OpenAPI type accepts only an optional integer, so the real PUT failed during JSON decoding before the working-copy command.

`ProjectFurniture::Contract.authoritative_definition_version` now selects only an existing Ruby `Integer`; it never parses or truncates strings. The guard is applied when parsing server working copies, creating placement items, building duplicate items from source/historical metadata, and serializing the final request. Therefore:

- catalog semver and numeric strings are omitted;
- an existing authoritative integer revision remains unchanged;
- incompatible historical metadata cannot escape through a later call site;
- no OpenAPI relaxation, parallel DTO, or backend production workaround was added.

The GET → merge → PUT complete-state flow is unchanged. `furniture_instance_id`, furniture definition, parameters, material choices from #620/#621, final host transform, technical locator, other working-copy items, duplicate identity allocation, and rollback behavior remain owned by their existing paths.

## Executable contract boundary

`contracts/sketchupWorkingCopyUpdate.contract.json` is shared by:

1. Ruby, which builds the exact request item from realistic persisted placement intent with catalog `definitionVersion: "1.0.0"`; and
2. the Go API handler, which decodes that same request through generated `openapi.UpdateDesignWorkingCopyRequest` and proves the command receives either an omitted version or integer `7`.

The fixture also supplies the forbidden semver body. The handler returns HTTP 400 and never calls storage for it. This closes the previous permissive-`FakeTransport` gap without editing generated output.

## RED → GREEN evidence

### RED before production correction

- `bundle exec ruby -Itest test/unit/working_copy_contract_test.rb`: **1 failure**; exact Ruby payload contained `"definition_version":"1.0.0"`.
- `bundle exec ruby -Itest test/unit/project_furniture_test.rb --name /semver/`: **1 failure**; confirm placement serialized the catalog semver.
- `bundle exec ruby -Itest test/unit/duplicate_resolver_test.rb --name /semver/`: **1 failure**; duplicate working item retained historical semver metadata.

### GREEN after correction

- Focused contract + complete affected Ruby files:
  - `bundle exec ruby -Itest test/unit/working_copy_contract_test.rb`: **1 run / 2 assertions / PASS**.
  - `bundle exec ruby -Itest test/unit/project_furniture_test.rb`: **40 runs / 264 assertions / PASS**.
  - `bundle exec ruby -Itest test/unit/duplicate_resolver_test.rb`: **16 runs / 91 assertions / PASS**.
- Explicit HTTP 400 rollback regression:
  - `bundle exec ruby -Itest test/unit/project_furniture_test.rb --name /backend_failure_at_confirm/`: **1 run / 7 assertions / PASS**.
- Generated Go handler boundary:
  - `go test ./internal/api -run 'TestWorkingCopyContractFixture|TestHandleDesignWorkingCopy' -count=1`: **PASS**.
  - `go test ./internal/api -count=1`: **PASS** (`11.450s`).
- Extension gate:
  - `bundle exec rake verify`: **632 runs / 4,410 assertions / PASS**; boundary **6 runs / 2,531 assertions / PASS**; RuboCop **168 files / 0 offenses**.
  - Deterministic RBZ SHA-256: `0a8913bd37eda3e5df5664714e206c5be701a9128f0b6256258da33b9c5f44e3`.
- Contract drift:
  - `pnpm openapi:check`: **PASS**, generated files current and negative drift proofs passed.
- Repository gate:
  - `./init.sh`: **PASS** after the final correction; dependency check, workspace typecheck/tests, full `go test ./...`, and Ruby/RBZ gate all green.
- `git diff --check`: **PASS**.

## Acceptance mapping

1. Catalog semver is absent from the serialized integer field: Ruby flow + shared fixture PASS.
2. Integer revision is preserved and incompatible values are omitted: shared Ruby/Go fixture PASS.
3. Corrected Ruby request reaches the generated Go handler: shared fixture handler test PASS.
4. Identity, parameters, quoted finishes, final transform, locator, and complete merge survive: placement regression plus pre-existing complete-merge tests PASS.
5. HTTP 400 still rolls back local insertion without false success: explicit rollback regression PASS.
6. Confirm and duplicate paths are covered beyond permissive transport: Ruby flow tests + generated Go handler boundary PASS.
7. Required local Ruby/OpenAPI/Go gates: PASS.
8. Real-host evidence: **PENDING AFTER REVIEW**.

## Real-host boundary and follow-up

No SketchUp host was driven during this implementation. The built RBZ is not host evidence. Post-review validation must install the RBZ produced from the exact reviewed SHA in SketchUp 2026 and prove:

- a project furniture unit with white carcass and wood front inserts with both quoted finishes;
- Confirm position succeeds against the real Go backend;
- GET working-copy preserves the complete item and omits semver `definition_version`;
- save/reopen preserves visual materials, business identity, final transform, and locator;
- duplicate flow allocates a new server identity and also omits incompatible historical semver metadata.

## Rollback boundary

Revert this single #624 work unit: the integer-only adapter guard in `project_furniture_contract.rb` and `duplicate_resolver.rb`, its Ruby/Go regressions, the shared fixture, and progress evidence. No database migration, generated OpenAPI file, UI, material resolution, backend production handler, business identity, or host mutation sequence needs rollback.
