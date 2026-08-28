# Review — feature F158 (branch-local) / GitHub #345

**Veredicto:** CHANGES_REQUESTED

Candidate reviewed exactly as
`origin/main...origin/codex/345-sketchup-extension-bootstrap` after fetching both
refs:

- `origin/main`: `413f6c3a56f0099f7666f0d91d7e5664312d794c`
- candidate / local `HEAD`: `df2ab4ba7a7a1c8412e5e881e995d6b8ae87af0a`
- merge base: `13aeb4f24b7d356774c96bcb31ae2c4a021dcfbd`
- candidate: 2,405 additions + 44 deletions = 2,449 changed lines / 38 files
- pre-review worktree: clean; local `HEAD` equals the pushed remote; no local-only commits
- commits contain no `Co-Authored-By` or AI attribution

The live authority is [GitHub #345](https://github.com/tiagofur/muebleria/issues/345),
not the narrower F158 ledger entry.

## Findings

### BLOCKER — the branch collides with current `main`'s feature ledger and review history

The candidate allocates `F158` to SketchUp at `feature_list.json:3677-3682`, but
current `origin/main` already allocates `F158` to issue #255
(`production_island_elevation_sheet`) at
`origin/main:feature_list.json:3677-3682`. Current main also already owns
`progress/review_F158.md` for #255. The branch is four commits behind main and
`git merge-tree` reports conflicts in both `feature_list.json` and
`progress/current.md`.

This is not administrative polish: merging as-is would corrupt feature identity and
make the requested `progress/review_F158.md` ambiguous. Synchronize with current main,
allocate an actually free feature ID, and reconcile `progress/current.md`, the
implementation evidence, and this review filename before delivery.

### BLOCKER — the live load/unload acceptance criterion has no target-host evidence

The issue requires the extension to load and unload without errors on the documented
target versions. The candidate explicitly records that **no licensed SketchUp/TestUp run
was executed**, every 2024/2025/Windows row is pending, the 2026.2 macOS row is only a
candidate, and CEF 112 has static evidence only
(`progress/implementation_F158.md:178-186`; `apps/sketchup-extension/README.md:7-9,100-115`).
The missing screenshot is also recorded honestly, not passed
(`progress/implementation_F158.md:152-157`).

That honesty is correct, but it does not satisfy #345. If the six matrix rows remain
version targets, each needs the issue's host proof. Otherwise the target set must be
narrowed explicitly without turning the other rows into implied support. For every kept
target, bind installation/restart, dialog open→close→recreate, disable/restart,
enable/restart, uninstall, TestUp JSON, host/Ruby/CEF/OS versions, and the exact RBZ
SHA-256.

### HIGH — `shutdown` is not connected to SketchUp's real disable/unload lifecycle

`Runtime.shutdown` exists at
`apps/sketchup-extension/src/muebles_for_sketchup/runtime.rb:13-15`, but repository
search finds no production caller; only unit code calls `Application#shutdown`.
`main.rb:10-25` starts the runtime and never registers an `AppObserver` or equivalent
host lifecycle integration. The README therefore tests only disable→restart
(`README.md:49-50`), not cleanup at the actual disable event.

SketchUp's documented `SketchupExtension#uncheck` does not stop already-running Ruby in
the current session, while `Sketchup::AppObserver#onUnloadExtension` is the notification
surface for user deactivation. Define and test the real semantics instead of treating an
unreachable method as unload support:

- <https://ruby.sketchup.com/SketchupExtension.html#uncheck-instance_method>
- <https://ruby.sketchup.com/Sketchup/AppObserver.html#onUnloadExtension-instance_method>

### HIGH — the planned TestUp smoke loads checkout source instead of the installed RBZ

`test/testup/TC_BootstrapSmoke.rb:7-12` constructs paths under the repository `src/`
and explicitly `load`s that root loader. After installing the RBZ, this can register/load
a second source path and proves the checkout, not the installed candidate bytes. Merely
recording an RBZ hash beside that output does not bind the TestUp result to the package.

Make the suite fail closed unless the installed `Muebles for SketchUp` extension is
already registered/loaded at the expected version and installed extension path; do not
load the candidate runtime from the checkout. The fixture/test suite may remain external,
but the product under test must be the installed artifact.

### HIGH — path redaction leaks relevant private absolute paths and can erase safe diagnostics

`logging.rb:16-17` only recognizes `/Users|/home` and `C:\Users`. Direct read-only
probes show that all of these survive unchanged:

```text
/Volumes/Private Client/model.skp
D:\Projects\Private Client\model.skp
\\server\Private Client\model.skp
```

Those are normal macOS external-volume, Windows non-system-drive, and UNC model paths,
so the live criterion “no private paths” is not met. At the same time,
`logging.rb:72-74` substitutes every sensitive value across every other string. With
`customer_name: "a"`, the innocent message `safe status and catalog` becomes
`s[REDACTED]fe st[REDACTED]tus ...`. Add leak and non-over-redaction tests covering
POSIX volumes, Windows drive roots, UNC paths, short/common customer values, and URLs
that can carry authorization material.

### HIGH — the automated guards are not mutation-resistant enough for their claims

`test/boundary/ownership_test.rb:8-18` omits issue terms such as `part/parts`, generic
release/stale decisions, and `postprocessing`. Its dependency scan at lines 42-45 only
matches the exact line form `require 'name'`; `require(...)`, `Kernel.require`, or other
runtime-loading forms bypass the zero-gem gate. Also, no standalone test executes the
packaged `main.rb` wiring, so removing `Runtime.start` or a support require can leave
`rake verify` green while the extension entrypoint no longer works.

The current Ruby source is boundary-clean by direct inspection: no BOM/parts/joints/
drilling/nesting/kerf/release/preflight/postprocessing implementation exists, metadata is
intent-only, and the RBZ contains zero third-party gems. The required change is to make
the gate actually preserve that state under realistic mutations.

### HIGH — delivery must be chained; three commits do not reduce a 2,449-line PR

The three implementation commits are 695, 1,176, and 388 changed lines; the evidence
commit adds another 200. The 1,176-line core commit combines lifecycle, ports,
redaction, metadata, HtmlDialog, stubs, and tests. This exceeds the 400-line review guard
and is not independently reviewable merely because it has a work-unit message
(`progress/implementation_F158.md:159-176`). Promote coherent units into chained PRs
(scaffold/toolchain; runtime boundaries; local UI/host smoke; repository gates/docs),
keeping code with its tests.

### MEDIUM — CI and HtmlDialog evidence remain incomplete

- The Ruby job runs only on `ubuntu-latest` (`.github/workflows/ci.yml:79-98`), while
  the documented runtime targets are macOS and Windows. Add portable Ruby/RBZ jobs on
  the relevant OS families; licensed SketchUp smoke remains a separate manual/host gate.
- There is no PR and no remote CI run for this branch yet (`gh pr list` and
  `gh run list` both returned empty arrays).
- The dialog's heading is permanently “Conexión no configurada”
  (`resources/dialog.html:262-267`) even when injected ready ports make the dynamic
  paragraph say the connection is configured (`application.rb:49-54`). Tests assert
  only the generated script, not coherent DOM state.
- `resources/dialog.html:115` introduces an un-tokenized HSL color, and the required
  host screenshot/responsive smoke is unavailable. Source inspection found local
  resources, safe `textContent`, JSON-escaped Ruby→JS status, a two-callback surface,
  CEF-112-compatible constructs, keyboard focus, and reduced-motion handling, but that
  is not visual/host proof.

## Checkpoints

- C1: [x] Harness present. `./init.sh` completed with exit 0.
- C2: [ ] Candidate has one local `in_progress`, but its `F158` identity conflicts with
  current main and cannot be merged coherently.
- C3: [x] Current Ruby implementation preserves the SketchUp-authoring / Muebles-
  manufacturing boundary; identifiers/files are English; transport/auth are separate
  fail-closed ports; `entityID` is not used.
- C4: [ ] Local gates pass, but target-host load/unload, installed-RBZ TestUp binding,
  screenshot/CEF host render, redaction coverage, and mutation-resistant entrypoint
  proof are missing.
- C5: [ ] Candidate commits are pushed and clean, but the feature cannot close while the
  ledger/history collision and live issue blockers remain.

## Diseño UI/UX

- D1: [ ] Local Muebles tokens are mostly mirrored, but `dialog.html:115` hardcodes a
  color outside the token block.
- D2: [x] A restrained local HtmlDialog shell is appropriate for the external host.
- D3: [ ] Native HtmlDialog close/recreate behavior has no target-host proof.
- D4: [x] No toast system is introduced; not applicable to this minimal shell.
- D5: [x] No competing icon library or custom SVG is introduced.
- D6: [x] Interaction has focus-visible and reduced-motion handling.
- D7: [ ] `docs/design.md §8` is incomplete: screenshot and responsive/host smoke are
  explicitly unavailable.
- D8: [ ] Source-level semantics/copy are mostly accessible, but configured state can
  contradict its static heading and no real CEF/keyboard pass exists.

## Verification executed by reviewer

| Command | Result |
|---|---|
| `bundle exec rake verify` with Ruby PATH pinned | exit 0; Ruby 3.2.11; Bundler 4.0.19; syntax OK; 22 RuboCop files; unit 11 runs/46 assertions; boundary 3 runs/203 assertions; RBZ SHA-256 `de821a4f15a75378153c0a7154d2df5eac34ead8b644c8aff6c426c268674614` |
| `./init.sh` (exactly once) with the same PATH | exit 0; Node v24.14.1; pnpm 11.1.2; typecheck green; 288 TS files / 3,057 tests green; Go suite green; Ruby/RBZ gate green |
| `bundle outdated --strict` | exit 0; `Bundle up to date!` |
| official template verification | pinned SHA `d763ff062f6a140ee5f4c04645fb14e0689b56db` exists and equals the current official default-branch head |
| RBZ readback | exactly `muebles_for_sketchup.rb` plus `muebles_for_sketchup/`; 11 files; no tests/vendor/cache/gems; digest matches |
| `git diff --check` | exit 0 |
| push/cleanliness/attribution | local candidate equals remote; pre-review tree clean; no AI attribution |

## Changes required

1. Sync with current main, allocate a collision-free feature ID, and reconcile the
   progress/review artifacts.
2. Satisfy the live target-version load/unload criterion with bound licensed-host
   evidence (or explicitly and honestly narrow the target set before testing it).
3. Implement/document real SketchUp disable/unload semantics and connect lifecycle
   cleanup to the host surface.
4. Make TestUp test the installed RBZ, not the repository source loader.
5. Fix redaction leaks and over-redaction; add adversarial tests.
6. Strengthen entrypoint, runtime-dependency, boundary, fixture, and package mutation
   resistance.
7. Fix configured-state UI coherence and complete the target-host visual/a11y smoke.
8. Deliver as a chained review sequence and run remote CI, including portable Ruby/RBZ
   coverage on relevant OS families.

skill_resolution: paths-injected
