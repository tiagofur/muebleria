# Granete for SketchUp

Installable bootstrap for the Granete SketchUp extension. SketchUp owns design
authoring and interaction; Granete remains the authority for manufacturing
validation and outputs.

> **Current status:** the only host target for this bootstrap is **SketchUp
> 2026.2 on macOS**, verified in-host on 2026-08-24 (TestUp CI: 7 tests / 27
> assertions, 0 failures — install/load, dialog open-close-recreate on CEF
> 137, AppObserver unload, ports, metadata round-trip, redaction). Every
> other version is planned compatibility, not a target and not implied
> support.

## Quick path

The development toolchain is Ruby 3.2.11 with Bundler 4.0.19. On Apple Silicon
with Homebrew Ruby:

```bash
export PATH="/opt/homebrew/opt/ruby@3.2/bin:/opt/homebrew/lib/ruby/gems/3.2.0/bin:$PATH"
ruby --version
bundle --version
bundle install
bundle exec rake verify
bundle exec rake build
```

The installable package is `dist/granete_for_sketchup.rbz`. `rake verify`
checks Ruby syntax, RuboCop and SketchUp rules, standalone tests, architecture
boundaries, a deterministic build, and package readback.

## Install locally

1. Build a fresh RBZ with `bundle exec rake build`.
2. Open SketchUp's **Extension Manager**.
3. Choose **Install Extension** and select
   `dist/granete_for_sketchup.rbz`.
4. Restart SketchUp when requested.
5. Open **Extensions → Abrir Granete**.

The shell is entirely local. It does not load fonts, scripts, styles, or any
other resource from the web.

## Sesión del taller, biblioteca remota y licencia

La pestaña **Estado** del dialog permite iniciar sesión con la cuenta del
taller (email, contraseña y URL del servidor Granete). Al iniciar sesión:

- El plugin solicita un **token de extensión de 30 días** (claim
  `client: sketchetchup-extension`), restringido server-side a solo lectura.
- Carga la **biblioteca del taller** desde `GET /api/furniture/definitions`
  (catálogo piloto compartido con `@granete/domain` vía
  `contracts/pilotFurnitureCatalog.json`) y muestra sus modelos listos
  (presets) en la Biblioteca.
- La sesión se persiste en
  `~/Library/Application Support/Granete/sketchup_extension_session.json`.
  Ese archivo es una credencial bearer: no se comparte ni se incluye en
  reportes. Desactivar el usuario en Granete la revoca de inmediato.
- Si la licencia del usuario no está activa, la biblioteca remota se bloquea
  con instrucciones (admin: `PUT /api/admin/users/{id}/license`) y el plugin
  sirve el catálogo local de respaldo.

Sin sesión o sin servidor, el plugin funciona offline con el catálogo local.

## Manual smoke

Use a disposable model. A host row is only supported when **all** of the
following is recorded: exact host/Ruby/CEF/OS versions, the RBZ SHA-256, and
the results of every step below plus the TestUp JSON run.

1. Install the RBZ, restart SketchUp, and confirm **Extensions → Abrir
   Granete** appears exactly once.
2. Open, close, and reopen **Granete for SketchUp** (dialog must recreate
   cleanly, no duplicated callbacks).
3. Confirm the dialog reports the connection as disabled by default.
4. Disable the extension in the Extension Manager and restart SketchUp: its
   command must be absent.
5. Enable it, restart, and confirm one command is present.
6. Uninstall it and confirm only the two extension items are removed.

Do not report a supported host from source review or package installation
alone.

## Lifecycle semantics

Unchecking an item in the Extension Manager (or `SketchupExtension#uncheck`)
does **not** stop already-running Ruby in the current session. The extension
registers a `Sketchup::AppObserver` whose `onUnloadExtension` routes the
host's unload notification for this extension to `Runtime.shutdown`: the
dialog closes and the observer deregisters. A session restart after disable
is therefore still part of the smoke above.

## In-host TestUp smoke

Install [TestUp 2.5.4](https://github.com/SketchUp/testup-2/releases/tag/2.5.4),
then build and **install this extension from the RBZ**. The suite tests the
installed extension only: it fails closed if **Granete for SketchUp** is not
installed, enabled, and loaded at the expected version from the SketchUp
Plugins directory, and it refuses to run against the repository checkout. The
checked-in suite uses only Minitest APIs compatible with the Minitest 5.15
bundled by TestUp 2.5.4.

macOS example:

```bash
'/Applications/SketchUp 2026/SketchUp.app/Contents/MacOS/SketchUp' \
  -RubyStartupArg \
  'TestUp:CI:Config: /absolute/path/to/apps/sketchup-extension/testup-ci.yml'
```

Windows example for a future matrix run:

```powershell
& 'C:\Program Files\SketchUp\SketchUp 2026\SketchUp\SketchUp.exe' `
  -RubyStartupArg `
  'TestUp:CI:Config: C:\absolute\path\to\apps\sketchup-extension\testup-ci.yml'
```

TestUp emits JSON to stdout. Preserve that output with the host version and
RBZ SHA-256; never replace unavailable host evidence with a simulated pass.

### Native entity suite (#415)

Besides `TC_BootstrapSmoke`, the run includes `TC_NativeEntitySmoke`: it
inserts a contract-shaped resolved layout (the fixture mirrors
`contracts/sketchupLayoutTransform.contract.json`) through the **installed**
builder and asserts, in the real host, that managed furniture and every
board/hardware are native `Sketchup::ComponentInstance`s, that part
definitions hold local geometry at origin sized by the #414 local extents,
that the lateral instance transform matches the published basis+translation,
that moving/rotating the furniture never rewrites child geometry, that two
units diverge without shared-definition effects, that rename keeps Granete
identity, that no native GUID appears as business identity, and that a
mirrored basis (or an aborted operation) leaves no partial hierarchy. The
suite self-cleans its entities and generated definitions on teardown.

### Validation + OpenCutList suites (#417)

`TC_NativeValidationSmoke` renders the canonical carpentry cabinet
(`test/fixtures/cabinet_validation_layout.json`: BODY 16 / FRONT 18 / BACK 6,
door + three-drawer-front aggregate sharing one authoring
`componentDefinitionId`, visible hardware) and asserts in the real host: the
full 13-child native hierarchy with six-face solid local boxes, role
thicknesses as LOCAL extents (16/18/6), local axes and transforms unchanged
across move + two quarter turns while world bounds move, rigid right-handed
instance bases (no non-uniform scale), FI-B FRONT→16 isolation from FI-A,
the V1 record (unique part definitions per instance, shared authoring ID
across drawer-front copies), Granete identity surviving regeneration with no
host locator leakage, semantic Outliner names that rename never mutates, and
hardware→door binding metadata. `TC_OpenCutListInteropSmoke` builds FI-A plus
the rebuilt FI-B, saves and **reopens** the `.skp`, pins decimal-millimeter
units, then runs the installed OpenCutList's own
`CutlistGenerateWorker` (its UI command's synchronous path, no dialogs) and
asserts its reading against the Granete fixture truth — part recognition,
per-role thicknesses, material grouping, nesting without explosion. That
evidence is compatibility-only; results and conventions live in
`docs/sketchup-opencutlist-interop.md`. The suites fail closed when the RBZ,
the checkout guard or OpenCutList 7.x is not present.

### Semantic selection suite (#476)

`TC_SelectionContextSmoke` proves the canonical `Selection::Resolver` /
`SelectionContext` contract in the real host through the **installed**
extension: top-level furniture selection resolves `kind=furniture` with its
Granete identity and honest capabilities (a definition missing from the
catalog disables editing with an explanation instead of silently enabling
it), nested board selection resolves `kind=part` with occurrence +
definition IDs and the owning-furniture breadcrumb, hardware selection
resolves `kind=hardware` with placement/host occurrence IDs, derived origin
and manual-edit capabilities disabled with reasons, rename + move/rotate and
full child regeneration preserve every identity key while only the technical
host locator (persistent_id) changes, two occurrences sharing one
`componentDefinitionId` never collapse into one context, and arbitrary user
Groups (which do respond to `#definition` in the host) stay `unmanaged`.
SketchUp defers `SelectionObserver` notifications to its event loop, so the
suite resolves through the observer's public `resolve` — the exact code the
deferred event runs — instead of racing the event loop. Downstream excellence
features (#466/#467/#468/#470/#471) must consume this foundation instead of
building parallel selection payloads.

## Configuration and security boundary

The bootstrap injects two independent ports:

- `Auth::Provider` supplies authorization material when a later integration
  explicitly configures it.
- `Transport::Adapter` carries requests when a later integration explicitly
  configures it.

Both defaults are null implementations and fail closed. The RBZ embeds no
endpoint, token, credential, customer data, or third-party gem. Logs redact
bearer tokens, private absolute paths (POSIX volumes, Windows drive roots, UNC
shares), URLs and query strings carrying credentials, emails, and sensitive
context fields.

Model metadata uses the namespaced dictionary
`com.granete.sketchup_extension` and the versioned key
`bootstrap_intent.v1`. It stores bounded opaque identity and authoring intent,
is explicitly marked `nonManufacturable`, and is written in one undoable
SketchUp operation. It is not a BOM, release, machine, or fabrication contract.

## Compatibility evidence

| Host | Embedded Ruby | CEF | Status |
|---|---:|---:|---|
| SketchUp 2026.2 macOS | 3.2.2 | 137 | **Target — supported**; in-host smoke 2026-08-24: TestUp CI 7/7, RBZ SHA-256 `9b392da4…`; in-host smoke 2026-08-27 (#415): TestUp CI 17/17 (7 bootstrap + 10 native entity), RBZ SHA-256 `efeab3fb…`; in-host smoke 2026-08-28 (#417): TestUp CI **28/28** (7 bootstrap + 11 native entity + 9 native validation + 1 OpenCutList 7.1.0 interop), 968 assertions, RBZ SHA-256 `5fb741e9…` |
| SketchUp 2024/2025 macOS | 3.2.2 | 112/128 | Planned compatibility — not a target, no implied support |
| SketchUp 2024/2025/2026.2 Windows | 3.2.2 | 112–137 | Planned compatibility — not a target, no implied support |

The source floor is SketchUp 2024/Ruby 3.2 and the browser shell is authored
for CEF 112. Planned-compatibility rows become targets only through an
explicit decision plus the full evidence checklist above; compatibility
targets are not support claims.

## Troubleshooting

### Wrong Ruby or Bundler

Run `ruby --version` and `bundle --version`. They must report Ruby 3.2.11 and
Bundler 4.0.19 for development. On Apple Silicon, export the Homebrew path from
the quick path before running Bundler.

### Extension is missing after installation

Confirm Extension Manager shows **Granete for SketchUp 0.1.0** as enabled,
restart SketchUp, and inspect the Ruby Console for a redacted
`extension_started` message. Rebuild the RBZ rather than copying `src/` into a
Plugins folder.

### Dialog does not reopen

Close SketchUp, restart it, and repeat the smoke with the Ruby Console visible.
Keep the redacted event and environment versions; do not include private paths,
model data, or credentials in a report.

### TestUp does not discover the suite

Use the absolute path to `testup-ci.yml`, keep TestUp 2.5.4 enabled, and verify
that `%CONFIG_DIR%/test/testup` resolves from that file. The suite class is
`TC_BootstrapSmoke`.
