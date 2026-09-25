# #739 — Frozen material identity and display provenance

## Objective and authorization

Restore truthful material identity in Engineering Despiece without changing the
immutable manufacturing demand. The owner authorized this bounded regression,
tests, issue reopening, and an independent partial PR on 2026-09-25.
Issue: https://github.com/tiagofur/muebleria/issues/739
Authorization: https://github.com/tiagofur/muebleria/issues/739#issuecomment-5835658370
Base: `a1b4e75784842b764847bb24f5cbe100b15598a9`.
Initial branch: `codex/398-p1-assembly-first-divergence`, clean and unpublished.
Product branch after RED: `fix/739-frozen-material-provenance`.

## Problem and selected design

The frozen cutting-demand JSON stays intact after a catalog rename, but Despiece
groups and labels materials with the current catalog name under a frozen-release
banner. Keep existing shared materialName/materialCode behavior for unrelated
consumers. Add optional release material identity metadata from frozen pieces.
Group by the exact material ID; display its frozen code when available and its
stable ID honestly when no historical code exists. Any current catalog name is
explicitly labeled current, consistently in the same panel's header and cells.
Never invent a frozen material name or relabel a live code as frozen.

## Scope and exclusions

Allowed: row metadata/mapping, Despiece presentation/search/grouping, focused
domain/UI/workspace wiring tests, and the existing Engineering-start browser test.
No snapshot storage, server/OpenAPI, Q/R/P creation, PDF/PTX, optimizer algorithm,
material authorization, stock, physical execution, assembly, or SketchUp changes.
No persistent database access, automatic merge, issue closure, or force push.

## Route, TDD, and delivery

- Lane: ODD; one writer, one coherent work unit, fresh exact-head reviewer.
- Route: delegated; mapping spans four-plus files and implementation spans two-plus
  non-trivial files. Read-only mapping completed before source edits.
- Strict TDD: enabled by AGENTS.md. Observe failing assertions on the unchanged
  product before implementation, then GREEN and refactor without changing scope.
- Delivery: single independent PR to main; `Refs #739`, `Delivery: partial`,
  exactly `type:bug`. The issue stays open for review and subsequent boundaries.
- Forecast: 320–430 authored additions/deletions including this artifact. The
  session's human review budget is approximately 800; repository guidance uses
  approximately 400 as a planning heuristic. Keep tests with the coherent fix;
  measure the actual diff and do not grant a size exception automatically.
- RDD: disabled/unmanaged (clone-local); ordinary independent review still applies.

## Work unit

- [x] T1 — Restore stable release-material grouping and explicit current aliases;
  prove missing-code honesty, unchanged physical demand, legacy compatibility,
  and Engineering wiring with domain/UI and real browser regressions.
  Route: delegated writer. Work-unit commit: `0937ef8455c098a560c72116842f1100315065a2`.

## Verification

1. `pnpm --filter @granete/domain exec vitest run src/engineeringCuttingDemand.test.ts`
2. `pnpm --filter @granete/ui exec vitest run src/production/ProductionOrderDespiecePanel.test.tsx src/engineering/EngineeringWorkspace.cuttingDemand.test.tsx`
3. `pnpm --filter @granete/domain --filter @granete/ui --filter @granete/web typecheck`
4. `LANG=en_US.UTF-8 bash scripts/organization-browser-gate.sh tests/organization/engineering-state.spec.ts --grep 'Iniciar Ingeniería' --max-failures=1`
5. `git diff --check`; `python3 scripts/factory_preflight.py --require-clean` after commit.
6. Conservative affected-check plan; independent review of exact committed HEAD/base;
   one complete applicable CI run on the published exact HEAD.

Browser proof uses Chromium, Go, and disposable PostgreSQL only. Capture before/after
DOM and cutting-demand readback; do not advance to downloads or Engineering completion.
Rollback removes this display metadata/consumer change and its regression together;
no stored data or migration needs reversal.

## Progress and handoff

Initial fetch/base/cleanliness/preflight and current issue approval verified.
No open PR or published branch conflict. Prior diagnostic evidence is retained
outside the repository under the post-844 rehearsal artifact directory.
### Observed RED and GREEN

- Domain RED: 5 failed / 6 passed against unchanged product at the exact base;
  absent provenance metadata, including undefined/null/empty/whitespace snapshot codes.
  GREEN: 11/11, with immutable demand and unchanged physical row assertions.
- UI/workspace RED: 6 failed / 17 passed; missing frozen identity/qualified alias,
  duplicate-code/name groups merged, and stable-ID/code search missed rows.
  GREEN: 23/23 (13 panel, 10 workspace), including the original keyboard contract.
- Browser RED: exact selected start test failed at stable group equality: the key
  changed from the old catalog name to the renamed catalog name. Cutting-demand
  semantic equality had already passed. This was presentation, not snapshot corruption.
- Browser GREEN: 1/1 selected Chromium test; normal queue entry, explicit start,
  Despiece, catalog rename through API, reload, and readback. Same P1/R1/fingerprint,
  material ID/code, two unit-specific rows, quantity one each, and 590×600×18 mm.
  Current names are explicitly qualified in both heading and Material cells.
- Typecheck: domain, UI, web all pass. `git diff --check`: pass.
- Browser command above appended `--output` pointing outside git to retain proof
  before disposable runner cleanup. Final run: 1 passed (6.3s test runner).

### UI, compatibility, and boundaries

- Existing tokens and semantic headings/cells reused; no new controls, primary
  actions, motion, loading/error/empty states, or workflow behavior. Existing
  workspace loading/error and tab keyboard tests remain green.
- Impeccable detector on the edited panel returned `[]`. Screenshots inspected at
  390/768/1280; headings remain within viewport. Mobile retains the existing
  horizontally scrollable table; a scrolled Material-cell capture verifies access.
  Screenshot animations are disabled to avoid capturing the existing sidebar mid-transition.
- Legacy missing/blank snapshot codes show the exact stable release ID; live code
  is never called frozen. Ordinary rows keep name-based presentation/grouping.
  Distinct release IDs remain separate even with identical codes/current names.
- Read-only consumer inventory: ShellView maps rows into EngineeringWorkspace,
  which passes them unchanged to Despiece and optimization. The optimizer keeps
  originalRow internally but projects explicit physical fields into placements;
  saw/nesting paths do not serialize/hash the whole row. The panel attaches the
  releaseBase separately. Existing materialName/materialCode semantics are unchanged.
- Conservative affected plan selects all six jobs due unknown/shared input. Full
  suites, SketchUp, PDF/PTX, Engineering completion, physical gates, and assembly
  were NOT_RUN here, as excluded. Exact-head independent review and CI are pending.
- Non-failing tool warnings: ignored pnpm.onlyBuiltDependencies, duplicate Three.js
  instances, and unavailable Node localStorage in jsdom. No browser errors observed.

### Evidence and next step

Artifacts: `/Users/tiagofur/.codex/artifacts/739-frozen-material-provenance/`:
`domain-red.log`, `ui-red.log`, `browser-red.log`, `domain-green.log`,
`ui-green.log`, `typecheck.log`, `browser-final.log`, `affected-plan.log`.
`browser-red/` and `browser-final/` retain before/after PNGs and
`material-provenance.json`; final also contains responsive screenshots.
Raw traces stay disabled (no credentials captured into trace files).

Engram mirror: topic `odd/739-frozen-material-provenance/tasks`, observation 1676.
MCP mutation is unavailable due multiple runtime sessions; independent CLI save
with explicit project is supported and used without inventing runtime identity.
Work-unit commit `0937ef8455c098a560c72116842f1100315065a2` contains behavior, regressions, and this artifact.
Clean preflight after that commit: `PREFLIGHT_OK_NOT_VERIFIED`, dirty=false, no errors.
Final authored diff: 376 additions plus deletions across 8 files; no generated files.
RDD remains disabled/unmanaged. Independent review and exact-head CI remain pending.
Next: fresh exact-head review and parent-controlled partial PR publication.
No push, PR, merge, or issue closure by writer.
