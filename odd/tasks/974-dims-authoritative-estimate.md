# #974 — El estimado de diseño presupuesta con las medidas colocadas (dims-authoritative)

## Objective and authority

Make the design commercial projection price preset-driven modules from the SketchUp working copy. Owner-directed 2026-10-02 after the live diagnosis on "Test Presupuesto RT": every module of the taller carries `module_presets`, so the estimate always died on "elegí un preset de medida" — the working copy has no preset field and presets only reach the engine through quote lines. Tracked in [#974](https://github.com/tiagofur/muebleria/issues/974).

## Root cause

`resolveModuleDims` (engine) requires `MeasurePresetID` whenever `Module.Presets` is non-empty; `GetDesignCommercialProjection` never sets it (the working copy cannot). Quotation is unaffected — presets arrive via quote lines there.

## Design

Reuse the existing #727 authority boundary instead of inventing one: `publishedDesignAuthority` already means "explicit dimensions are the truth, measure presets are neither required nor consulted, structured modules MUST carry dims (fail closed)".

- `domain.ProjectItem.DimsAuthoritative bool` (`json:"-"` — never on the wire, excluded from projection fingerprints). Set ONLY by the design projection; quotation stays on `commercialPresetAuthority` with its preset gate.
- `CalcProjectBreakdown` routes dims-authoritative items through `ResolveBomForRelease`; every other caller unchanged.
- Non-preset structured modules keep pricing with placed dims (same result as the old commercial-authority dims override); fixed modules keep rejecting dims ("no es paramétrico") in every authority.

## Tasks

- [x] T1 — `DimsAuthoritative` on `domain.ProjectItem` (internal, non-serialized).
- [x] T2 — `CalcProjectBreakdown` routes `DimsAuthoritative` items through the release authority (`ResolveBomForRelease`).
- [x] T3 — `GetDesignCommercialProjection` sets `DimsAuthoritative: true` on every pricing item.
- [x] T4 — Engine tests: gate intact for quotation, dims-authoritative skips the gate, structured-without-dims fails closed, non-preset module keeps placed dims.

## Evidence (2026-10-02)

- `go test ./internal/domain/...` → ok (engine includes 4 new tests: `calc_dims_authoritative_test.go`, all existing CalcProjectBreakdown tests still green).
- `go test ./internal/storage/` → ok (pure projection tests).
- `go build ./... && go vet ./internal/domain/engine/ ./internal/storage/` → clean.
- Acceptance #1 on REAL local data ("Test Presupuesto RT", gabinete MOD-BAJ-1P-IZQ 450×720×590): probe of `GetDesignCommercialProjection` (new code) → `status: "current"`, `issues: []`, `amounts.saleTotal 676.12 MXN` (materials 287.06 + edges 51.01, margin 2×). Probe deleted after use.

## NOT_RUN / deferred

- Foundation PostgreSQL/browser proofs and storage shards: covered by CI on the PR head.
- No TS-side change: the projection endpoint is Go-only and the flag is `json:"-"`, so no contract/fixture parity surface.
