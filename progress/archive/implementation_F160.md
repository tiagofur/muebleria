# F160 implementation evidence — GitHub #345

## Review state

- Feature: F160 (round 1 reviewed the branch-local id F158; renumbered after
  the collision with #255 on main, see `progress/review_F160_round1.md`)
- Ledger state: `in_progress` (intentionally not marked `done`)
- Branch: `codex/345-sketchup-extension-bootstrap`
- Worktree:
  `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`
- Invariant: SketchUp owns authoring and interaction; Granete owns
  manufacturing truth.
- Brand: the platform formerly named Muebles is renamed **Granete**; this
  bootstrap ships as **Granete for SketchUp** (`granete_for_sketchup`).
- Skill resolution: `paths-injected`

## Generator provenance

Development PATH used for every Ruby generation/dependency command:

```bash
export PATH="/opt/homebrew/opt/ruby@3.2/bin:/opt/homebrew/lib/ruby/gems/3.2.0/bin:$PATH"
```

Verified before generation:

```text
ruby 3.2.11
Bundler 4.0.19
```

The official
`SketchUp/sketchup-extension-vscode-project` template was imported as an
archive without creating a nested Git repository:

```bash
mkdir -p apps/sketchup-extension
curl -fsSL \
  https://api.github.com/repos/SketchUp/sketchup-extension-vscode-project/tarball/d763ff062f6a140ee5f4c04645fb14e0689b56db \
  | tar -xz --strip-components=1 -C apps/sketchup-extension
cd apps/sketchup-extension
bundle install
bundle exec skippy help new
bundle exec skippy new 'Granete::SketchUpExtension' \
  --basename granete_for_sketchup \
  --downcase \
  --template standard
```

Template SHA:
`d763ff062f6a140ee5f4c04645fb14e0689b56db`. (The original scaffold was
generated as `Muebles::SketchUpExtension`/`muebles_for_sketchup` and renamed
to Granete afterwards with `git mv` plus a tracked-file replace; the template
import itself is unchanged and reproducible.)

Only flags printed by the real `skippy help new` command were used. The
generated sample, dynamic metadata, WebDialog-oriented/stale targets, and
platform-specific editor assumptions were not retained as authority.

Dependency changes were also performed through Bundler commands rather than
hand-editing resolved versions:

```bash
bundle remove minitest
bundle add minitest --version '~> 5.15' --group development
bundle add rubyzip --version '~> 3.5' --group development --require false
bundle lock --add-platform ruby arm64-darwin x64-mingw-ucrt
```

## Resolved toolchain

| Dependency | Resolved version | Scope |
|---|---:|---|
| Ruby | 3.2.11 | Development/CI target |
| Bundler | 4.0.19 | Dependency resolver |
| Skippy | 0.5.3.a | Generator input only |
| Rake | 13.4.2 | Development gates |
| Minitest | 5.27.0 | Standalone tests; uses TestUp-2.5.4-compatible APIs |
| rubyzip | 3.5.0 | Development-only RBZ builder/readback |
| RuboCop | 1.90.0 | Analysis |
| RuboCop SketchUp | 2.1.1 | SketchUp-specific analysis |
| SketchUp API stubs | 0.7.11 | Development only |
| Solargraph | 0.60.3 | Development only |
| CommonMarker | 0.23.12 | Documentation only |
| YARD | 0.9.45 | Documentation only |
| TestUp | 2.5.4 | In-host runner contract; not embedded |

All Gemfile dependencies are in explicit development, documentation, or
analysis groups. The RBZ runtime has zero third-party gem dependencies.

## Implemented files and behavior

- `apps/sketchup-extension/src/granete_for_sketchup.rb` — the only RBZ root
  loader; literal metadata and one `SketchupExtension` registration.
- `apps/sketchup-extension/src/granete_for_sketchup/identity.rb` — the
  extension id/name/version constants shared by loader, runtime and tests.
- `apps/sketchup-extension/src/granete_for_sketchup/main.rb` — idempotent
  support entrypoint using `Sketchup.require`; starts the runtime.
- `application.rb`, `lifecycle.rb`, and `runtime.rb` — lifecycle-safe
  composition, one menu action, safe dialog recreation, and a real host
  lifecycle bridge: `AppLifecycleObserver` (a `Sketchup::AppObserver`)
  registered by `Runtime.start`, whose `onUnloadExtension` routes this
  extension's unload notification to `Runtime.shutdown` (closes the dialog
  and deregisters the observer). Uncheck semantics are documented as
  non-unload in the README.
- `auth/provider.rb` and `transport/adapter.rb` — separate replaceable ports
  with null/fail-closed defaults.
- `logging.rb` — structured redaction for bearer values, absolute private
  paths on POSIX (incl. `/Volumes`), Windows drive roots, and UNC shares
  (including spaces inside the path), URLs with embedded userinfo, credential
  query strings, emails, and customer/sensitive context. Sensitive values
  shorter than 4 characters are not substituted into unrelated strings
  (keys still redact their own value), so short names no longer shred
  unrelated messages.
- `metadata/store.rb` — namespaced `bootstrap_intent.v1` JSON with strict
  allowlists, opaque identity references, `nonManufacturable: true`, and one
  undoable SketchUp operation. It never derives identity from `entityID`.
  Dictionary/namespace: `com.granete.sketchup_extension`.
- `resources/dialog.html` — fully local Spanish `UI::HtmlDialog` shell,
  autonomous Granete tokens, no external web dependencies, and a CEF 112
  floor. The connection card renders a coherent state: `GraneteDialog
  .setStatus({state, heading, message})` updates heading, message and
  `data-state` together (dot turns brand-colored when configured); the
  default heading is a neutral "Comprobando conexión" until the first
  status arrives. All colors come from the token block.
- `test/fixtures/non_manufacturable_metadata.json` — deliberately
  non-fabricable intent fixture.
- `test/unit` — loader, runtime/observer lifecycle, wiring of the packaged
  `main.rb` (fails if `Runtime.start` or a require is removed), application,
  ports, metadata, and adversarial redaction tests.
- `test/boundary` — mutation-resistant tripwires: word-boundary forbidden
  manufacturing terms (incl. `part(s)`, `postprocessing`, release/stale
  decisions), runtime dependency scan across `require`/`require(...)`
  /`Kernel.require`/`require_relative`/`load`/`gem` forms, and the
  non-fabricable fixture key gate.
- `test/testup/TC_BootstrapSmoke.rb` plus `testup-ci.yml` — TestUp suite that
  tests **the installed extension**: it fails closed unless *Granete for
  SketchUp* is registered, enabled and loaded at the expected version from
  the SketchUp Plugins directory, and refuses to run against the repository
  checkout. In-host coverage: floor versions, observer registration/unload,
  null ports, dialog recreation, metadata round-trip, redaction.
- `Rakefile` — syntax, lint, unit, boundary, deterministic build, and strict
  package readback gates.
- `README.md` — reproducible quick path, RBZ installation, full manual smoke
  checklist (install/restart, open-close-recreate, disable/restart,
  enable/restart, uninstall + TestUp JSON + versions + RBZ SHA-256), real
  lifecycle semantics, auth/transport boundary, troubleshooting, and a
  compatibility matrix narrowed to **SketchUp 2026.2 macOS as the only
  target** (everything else is planned compatibility without implied
  support).
- `.github/workflows/ci.yml` and `init.sh` — Ruby 3.2.11/Bundler-lock
  verification without bypasses; the CI Ruby/RBZ job now runs on
  ubuntu/macOS/Windows.

The package gate requires exactly two top-level archive items:
`granete_for_sketchup.rb` and `granete_for_sketchup/`. It rejects tests,
vendor/tmp content, caches, secret/credential/token-like paths, environment
files, macOS archive metadata, and source maps.

## Host evidence (2026-08-24) — SketchUp 2026.2 macOS, PASS

Licensed host, executed by the implementer with the leader's documented
procedure. The installed extension bytes were verified identical to the RBZ
before the run (`diff -r` against `dist/granete_for_sketchup.rbz`,
SHA-256 `9b392da4…`).

| Field | Value |
|---|---|
| Host | SketchUp Pro 26.2 (2026.2) macOS, Apple M5 Pro (Mac17,9) |
| OS | macOS 26.6.2 |
| Embedded Ruby | 3.2.2 (arm64-darwin, patchlevel 53) |
| CEF | 137.0.7151.121 (`UI::HtmlDialog::CEF_VERSION` is a String in-host) |
| Runner | TestUp 2.5.4 (`TestUp2_2.5.4_2026-01-22-4f34cb7.rbz`, SHA-256 `7c86a99d…`) via `-RubyStartupArg TestUp:CI:Config:` |
| Product under test | Installed RBZ in the SketchUp Plugins folder (not the checkout; enforced by the suite via `Runtime.method(:start).source_location`) |
| Result | **Success — 7 tests, 27 assertions, 0 failures, 0 errors, 0 skips**; SketchUp exited by itself (`KeepOpen: false`), process exit 0 |

Passing in-host coverage: installed extension registered/enabled/loaded at
0.1.0; host floor (SketchUp ≥24, Ruby 3.2, CEF ≥112); `Runtime.start`
idempotent; host observer registered and `onUnloadExtension` drives the real
shutdown (dialog closed, observer deregistered, redacted
`extension_stopped` logged); null ports fail closed; `UI::HtmlDialog`
opens/closes/recreates without duplicate callbacks on real CEF 137;
non-manufacturable metadata round-trips in an undoable operation on a real
model; logging redacts in-host.

### Real host bugs found by the smoke and fixed

1. **`include Sketchup::AppObserver` raised `TypeError` at load time** — the
   host API declares `AppObserver` as a *class* (stubs: `class
   Sketchup::AppObserver`); observers must subclass it. The unit stub had
   modeled it as a module, so all local gates stayed green while the
   extension failed to load in-host. Fixed: `AppLifecycleObserver <
   ::Sketchup::AppObserver`; the test stub now models a class.
2. **`SafeLogger` crashed under TestUp** — `Sketchup::Console#puts` is
   private and TestUp swaps `$stdout` around each test, so sink identity
   checks are unreliable. Fixed: write-first (`IO#write`/`StringIO#write`)
   with a `Kernel.puts` fallback that reaches the console at C level.
3. **Empty groups are purged by model transactions** — a group created with
   `add_group` and no geometry is invalidated ("reference to deleted
   Entity") by the next commit/transaction, in any model. The smoke fixture
   now carries geometry, like any real furniture instance. Recorded because
   #346 metadata will live on real (non-empty) instances.
4. **`Sketchup.find_support_file` is not reliable for the user Plugins
   folder** (returned nil for the installed loader). The suite binds to the
   loaded bytes via `source_location` instead — stronger evidence anyway.

Manual Extension Manager GUI steps (disable/enable/uninstall via UI) were not
GUI-automated in this run (automation helper lacked Screen Recording/
Accessibility grants); load-without-errors and the unload notification path
are covered by the in-host evidence above.

## Round-1 review corrections applied

All eight changes requested by `progress/review_F160_round1.md`:

1. Synced with current `origin/main` (merge base `ddb19a0`) and #345
   renumbered to the collision-free id **F160**; evidence/history/ledger
   reconciled (this file, `progress/current.md`, `feature_list.json`).
2. Target set narrowed explicitly and honestly: SketchUp 2026.2 macOS is the
   only target; other rows are planned compatibility. Host proof remains
   pending and is never implied.
3. Real disable/unload semantics implemented and documented
   (`AppLifecycleObserver` + `onUnloadExtension`; uncheck ≠ unload).
4. TestUp now tests the installed RBZ and fails closed (no checkout loads).
5. Redaction leaks fixed (`/Volumes`, non-`Users` drive roots, UNC, spaces)
   and over-redaction fixed (min substitution length, literal matching);
   adversarial tests added.
6. Boundary/dependency/wiring guards made mutation-resistant (word-boundary
   terms, all require forms, packaged `main.rb` wiring test).
7. Dialog configured/disabled coherence fixed; heading+message+state injected
   together; un-tokenized color moved into the token block. Host visual/a11y
   smoke remains honestly pending.
8. Delivery restructured into chained reviewable work units (see below), CI
   widened to three OS families; a PR with remote CI follows the push.

## Verification results

Source-mutating normalization ran before the final read-only verification:

```bash
bundle exec rubocop -A
```

The normalizer converged with no offenses. The repository has no configured
Prettier/Biome normalizer for this package.

Successful gates after the corrections (final numbers, see host evidence
below for the in-host run):

| Command | Result |
|---|---|
| `bundle exec rake verify` | PASS — syntax + 25-file lint (0 offenses) + 25 unit runs/115 assertions + 3 boundary runs/421 assertions + deterministic readback |
| `bundle exec rake build` / package readback | PASS — SHA-256 `9b392da4b76eddf73278bb143c0ffdc98f170509eba914eea0fbbb3130be3f59` |
| `./init.sh` (full harness, real exit code) | PASS — exit 0; typecheck 7 workspaces; 3,069 TS tests / 289 files; Go all packages; Ruby/RBZ gate |
| `sh -n init.sh` | PASS |
| `git diff --check` | PASS |

The first integrated `./init.sh` run (round 0) found and proved a real
compatibility bug: Bundler 4 prints `4.0.19` instead of the legacy
`Bundler version 4.0.19` shape. The parser now reads the final field, and the
complete rerun passed.

The HTML shell received source-level visual/compatibility review against
`docs/design.md`, the Granete token block, and the CEF 112 floor.
`text-wrap: balance/pretty` was removed because it postdates that floor.
Automated screenshot attempts could not start Chromium in this macOS execution
environment because Mach port registration was denied; this is recorded as
unavailable, not as a visual or host pass.

## Implementation work units

Delivery is chained and reviewable as work units (history restructured from
the round-0 three-commit layout; tests live with the behavior they verify):

1. scaffold + toolchain (configs, Gemfile/lockfile, Rakefile, CI, init.sh)
2. runtime boundaries (identity, logging, ports, metadata, lifecycle +
   observer, and their unit tests)
3. application wiring + local dialog shell (application, runtime, main,
   loader, dialog controller/HTML, application/loader/wiring tests)
4. host smoke + repository gates (TestUp suite, boundary tripwires,
   testup-ci.yml)
5. docs + evidence (README, ledger F160, progress artifacts, this file)
6. host-smoke fixes (AppObserver subclass, console-safe logger, faithful
   stubs) + host-API smoke corrections (source_location binding, CEF string
   compare, geometry-carrying fixture) — produced by the in-host findings
7. host evidence + review round 2 + ledger close

No commit contains `Co-Authored-By` or AI attribution.

## Remaining risks

- SketchUp 2024/2025 and every Windows row: planned compatibility, not
  targets; no implied support.
- CEF 112 floor is source-level only (host run used CEF 137); real 2024
  rendering remains untested.
- Extension Manager GUI disable/enable/uninstall cycle was not GUI-automated
  (permission-blocked); load and unload-notification paths are covered
  in-host (see Host evidence).
- Auth and transport intentionally remain null; real connection behavior
  belongs to a later integration slice and must preserve these ports and
  redaction.
- Repo-wide brand rename (docs, web app, backend) is out of scope for this
  branch and tracked separately (#366); this branch renames the extension
  deliverable only.

## Reviewer checklist

1. Re-run `bundle exec rake verify` from `apps/sketchup-extension`.
2. Read back `dist/granete_for_sketchup.rbz` and compare its SHA-256
   (`9b392da4…`).
3. Confirm Ruby contains no manufacturing resolver or manufacturing truth.
4. Re-run the host smoke per README (installed RBZ + TestUp CI) and compare
   against the recorded 7/7.
5. Treat every non-2026.2-macOS row as unsupported.

