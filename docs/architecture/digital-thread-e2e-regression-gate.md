# Digital Thread End-to-End Contract & Regression Gate

> Canonical technical authority and automated regression gate for the complete Granete Digital Thread (#385–#398 / DT-1 through DT-14).

---

## 1. Executive Summary

The **Digital Thread** connects commercial intent, architectural design, manufacturing truth, and production execution into a single unbroken chain:

```text
Quote
  ↓
QuoteRevision (Q1)
  ↓
FurnitureInstance (Physical Units)
  ↓
Design & DesignWorkingCopy
  ↓
SketchUp Host Placement
  ↓
DesignRevision (R1)
  ↓
Reconciliation
  ↓
Explicit Requote (Q2)
  ↓
Design Approval
  ↓
ProductionRelease (P1)
```

**DT-14 (#398)** does not implement new isolated features; it serves as the **deterministic regression gate** proving that all independently built slices (#385 through #395) function as **ONE cohesive, deterministic, and secure system**.

Every scenario in this gate executes under server authority, row-level security (`granete_app` non-bypass role), and strict concurrency/immutability guarantees.

---

## 2. Canonical Scenarios Automated

### Scenario A: Quote-First Authoring & Release Lifecycle
- **Setup**: Project initiated commercially with Quote Lines:
  - 1-door lower cabinet (`widthMm: 600`)
  - 3-drawer unit (`widthMm: 600`)
- **Flow**:
  1. `CreateQuoteRevision` (Q1) produces distinct physical `FurnitureInstance` records (`FI-1`, `FI-2`).
  2. Design is created and bound to Project and Q1.
  3. SketchUp working copy syncs both instances; designer modifies drawer width from `600mm` to `650mm`.
  4. `PublishDesignRevision` produces `R1` (revision 1) with deterministic fingerprint.
  5. `ReconcileProject(Q1, R1)` evaluates commercial/manufacturing impact:
     - `FI-1`: `synced`
     - `FI-2`: `modified` (flags `requiresRequote: true`).
  6. `RequoteProject` creates draft `Q2` inheriting modified parameters; transitioning `Q2` through `published -> accepted` locks commercial acceptance.
  7. Re-reconciliation `ReconcileProject(Q2, R1)` confirms all items are now `synced`.
  8. `ApproveDesignRevision` records formal approval for `R1`.
  9. `CreateProductionRelease` produces `P1`, pinning exact `R1` and `Q2`.
  10. **Negative Proof**: Subsequent publication of `R2` advances design to revision 2, but `P1` remains byte-identical, frozen, and pinned to `R1`.

### Scenario B: Quantity Greater Than One (Physical Unit Individuation)
- **Problem**: A quote line with `quantity = 3` cannot be represented as a single modeled entity with a multiplier count.
- **Flow**:
  1. Commercial quote with `qty: 3` expands into 3 discrete physical `FurnitureInstance` IDs (`FI-A`, `FI-B`, `FI-C`).
  2. In the CAD host, the user places only 2 instances (`FI-A`, `FI-B`).
  3. Publish manifest contains only the 2 placed instances.
  4. Reconciliation flags:
     - `FI-A`: `synced`
     - `FI-B`: `synced`
     - `FI-C`: `quoted_not_modeled` (blocking release).
  5. Server strictly prevents release until all quoted physical units are resolved.

### Scenario C: Design-First Authoring & Requote Provenance
- **Setup**: A project starts in the CAD host without prior commercial quotes.
- **Flow**:
  1. Designer inserts catalog definition into SketchUp model.
  2. Server allocates a new `FurnitureInstance` (`FI-D`) with `origin: 'design'`.
  3. Working copy syncs and designer publishes `R1`.
  4. Initial reconciliation against an empty quote identifies `FI-D` as `modeled_not_quoted`.
  5. Commercial team invokes `RequoteProject`, which incorporates `FI-D` into a new `QuoteRevision` (Q1).
  6. Subsequent reconciliation flags `FI-D` as `synced` with complete bidirectional provenance.

### Scenario D: Duplicate Identity Detection & Resolution in Host
- **Problem**: In SketchUp, users duplicate entities using native Move+Copy (`Ctrl/Option + Move`) or Copy/Paste (`Cmd+C / Cmd+V`), producing duplicate component instances sharing identical metadata.
- **Flow**:
  1. `ProjectFurniture::ManagedFurniture.locate` detects duplicate instances sharing `furnitureInstanceId`.
  2. Preflight validation reports `duplicate_identity` and rejects publish.
  3. `DuplicateResolver` invokes server `duplicate_furniture_instance`:
     - Original instance retains its identity and `origin: 'design'`.
     - Copy instance is rewritten with a new server-allocated UUID and metadata stamped with `origin: 'duplicate'` and `originFurnitureInstanceId: original_id`.
  4. Working copy updates atomically; subsequent preflight passes.

### Scenario E: Semantic Managed-Only Scope (Unmanaged Geometry Exclusion)
- **Problem**: Architectural models contain walls, windows, floors, decorative plants, and non-furniture CAD entities.
- **Flow**:
  1. SketchUp model contains 1 managed `FurnitureInstance` alongside raw faces, loose edges, and unmanaged groups.
  2. `DesignPublish::ManifestBuilder` scans model entities and filters out any entity without valid Granete identity metadata and matching `projectId`.
  3. Only the managed instance enters `design_revision_items` and artifact fingerprint.
  4. Adding, moving, or deleting unmanaged geometry has zero effect on the revision manifest or SHA-256 fingerprint.

### Scenario F: Stale-Base Concurrency Conflict
- **Problem**: Two designers or sessions attempting to publish from the same base revision simultaneously.
- **Flow**:
  1. Design is currently at `R1`.
  2. Session 1 publishes `R2` with `BaseRevisionID = R1` (succeeds).
  3. Session 2 attempts to publish `R3` still specifying `BaseRevisionID = R1`.
  4. Backend rejects with `ErrDesignRevisionConflict` (HTTP 409 Conflict).
  5. Active design head remains intact at `R2`.

### Scenario G: ProductionRelease Durability & Immutability
- **Guarantee**: A factory production release must never change, regardless of upstream CAD authoring or quote revisions.
- **Flow**:
  1. Release `P1` created pinning `R3` and `Q3`.
  2. Engineering publishes `R4` and `R5`.
  3. Querying `P1` proves `design_revision_id` remains `R3` and `quote_revision_id` remains `Q3`.
  4. SQL-level immutability of `production_releases` (trigger `protect_production_release_immutability` blocking `UPDATE`/`DELETE`) is proven by the #395 suite (`TestProductionRelease_ReleaseRowsAreImmutableHistory`); this gate consumes that proof and re-proves only the durability of the pins after `R4`/`R5`.

---

## 3. Invariants Matrix

> **Numbering scope:** the IDs below are gate-local (**G1–G9**). The canonical Digital Thread
> invariant numbering is **I1–I14** in `docs/architecture/project-design-digital-thread.md` §3
> and must remain the normative reference; the shared fixture
> `contracts/digitalThreadE2E.json` prefixes its own contract invariants as **C1–C9**.
> Gate-local IDs, spec IDs and contract IDs are deliberately distinct so a test
> failure message can never be mistaken for a canonical spec invariant (or vice versa).

| ID | Invariant Name | Enforcement Layer | Automated Proof |
|---|---|---|---|
| **G1** | Exact Identity Persistence | DB / Go / Ruby | `TestDigitalThreadE2E_ScenarioA_QuoteFirst`, `test_scenario_a_quote_first_contract_conformance` |
| **G2** | Qty > 1 Physical Individuation | Go Storage / Domain | `TestDigitalThreadE2E_ScenarioB_QuantityGreaterThanOne`, `test_scenario_b_quantity_multiple_manifest_filtering` |
| **G3** | Design-First Provenance | Go Storage / Domain | `TestDigitalThreadE2E_ScenarioC_DesignFirst` |
| **G4** | No Implicit Latest | DB Foreign Keys / Go | `TestDigitalThreadE2E_ScenarioF_Concurrency_StaleBaseRejected` |
| **G5** | Server-Authoritative UUIDs | DB / Ruby Resolver | `TestDigitalThreadE2E_ScenarioD_DuplicateIdentity`, `test_scenario_d_duplicate_identity_preflight_and_resolution` |
| **G6** | Managed-Only Scope | Go / Ruby ManifestBuilder | `TestDigitalThreadE2E_ScenarioE_SemanticScope_UnmanagedExclusion`, `test_scenario_e_unmanaged_geometry_exclusion` |
| **G7** | Top-Level ComponentInstance Hierarchy | Ruby Native Model | `test_invariant_g7_nested_subcomponents_do_not_produce_root_instances` |
| **G8** | Deterministic Hashing & Parity | Go Storage / JSON Hashing | `TestDigitalThreadE2E_DeterministicFingerprintParity`, `test_invariant_g8_deterministic_manifest_serialization` |
| **G9** | Multi-Org RLS & Fail-Closed Isolation | PostgreSQL RLS / DB Triggers | `TestDigitalThreadE2E_NegativeProofs`, `test_invariant_g9_fail_closed_session_parser` |

---

## 4. Proof-Layer Status & Boundaries

### Layer status

| Layer | Status | How it runs |
|---|---|---|
| Domain (classification, reconciliation, fingerprint) | **CI green** | Exercised through the Go E2E suite via real storage commands |
| Backend / PostgreSQL E2E (RLS `granete_app` NOBYPASSRLS, tenant tx, immutability triggers) | **CI green (required)** | Job `backend-go` runs `go test -p 1 ./...` with a postgres:16 service container and a mandatory `DATABASE_URL` (anti-false-green, OC-002). Locally without `DATABASE_URL` the shared fixture **skips** — set `DATABASE_URL` to run the gate against real PostgreSQL |
| Ruby client contract (SketchupStub) | **CI green (required)** | Job `sketchup-extension` runs `bundle exec rake verify` on 3 OS |
| Shared contract fixture (`contracts/digitalThreadE2E.json`) | **CI green** | Pinned by the Ruby contract suite; invariants C1–C9 |
| Real SketchUp host (TestUp) | **`REAL_HOST_REQUIRED`** | `TC_DigitalThreadE2ESmoke.rb` is the executable scenario; CI cannot run SketchUp, so this layer must NEVER be reported green from stubs. Evidence convention: run the suite in SketchUp TestUp against the installed RBZ and record `progress/host_smoke_F211_testup_ci.json` (TestUp::CIJsonReporter). Until that artifact exists, report this layer as pending |

### Consumed from focused suites (not re-proved by this gate)

This gate composes real production paths; it deliberately does not duplicate proofs that live in the focused suites of #385–#395:

- **Idempotency** of create/duplicate/publish/requote/approve/release → #385 (materialize convergence), #392 (finalize idempotent per session), #395 (`TestProductionRelease_ApprovalLifecycleAndIdempotency`).
- **Historical reconciliation stability** (reconcile(Q1,R1) unchanged when Q2/R2 exist) → #393 (`TestReconciliation_HistoricalQuote_OldQuoteRevisionStaysOld`).
- **Join strictly by `FurnitureInstance.id`** (never name/definition/geometry/transform) → #385/#393 identity suites.
- **`.skp` / `manifest.json` / preview artifact lifecycle and immutability** → #392 (`FinalizeDesignPublish` suite).

### Publish-path boundary

The Go E2E scenarios publish via the direct snapshot path (`PublishDesignRevision`, #387): the revision is the immutable working-copy snapshot. The staged artifact path — upload session, `model.skp` + manifest + preview, `FinalizeDesignPublish` — belongs to #392 and its immutability is consumed, not re-proved, by this gate (Scenario F additionally pins that a rejected stale publish finalizes zero `design_revision_artifacts` rows).

---

## 5. Execution Commands

### Go Backend E2E Suite
```bash
cd backend-go
# Requires a real PostgreSQL (the suite skips without it):
export DATABASE_URL='postgres://... '
go test -v -run "TestDigitalThreadE2E" ./internal/storage
```

### SketchUp Ruby Client Contract Suite
```bash
cd apps/sketchup-extension
eval "$(rbenv init - zsh)"
bundle exec rake verify
```

### Host Smoke in TestUp — `REAL_HOST_REQUIRED`
```bash
# Executed in SketchUp TestUp runner against the INSTALLED RBZ
# (not the repo checkout — the smoke fails closed if loaded from checkout):
# Suite: Granete::SketchUpExtension::TC_DigitalThreadE2ESmoke
# Record evidence as progress/host_smoke_F211_testup_ci.json
```

### Full Repository Verification
```bash
# Go tests
cd backend-go && go test ./...

# Ruby verification
cd apps/sketchup-extension && bundle exec rake verify

# Web / OpenAPI verification
pnpm openapi:check
pnpm test
```

---

## 6. Fixtures & Golden Policy (no snapshot blessing)

Every canonical fixture in this gate is **deterministic and explicit**:

- Stable, explicit UUIDs for `projectId`, definitions, and expected `furnitureInstanceIds` come from `contracts/digitalThreadE2E.json`.
- Server-generated IDs (e.g. `revR1ID`, release fingerprint) are **captured from the real command result** and then compared explicitly — never predicted, never randomized into an assertion.
- Assertions compare **semantic values** (statuses, exact pins, counts, byte-identical serializations of the same row), not opaque blobs.

Rules for adding or updating fixtures:

1. **Add identities to the contract fixture first** (`contracts/digitalThreadE2E.json`), then reference them from the Go/Ruby suites. Do not inline new magic UUIDs into tests.
2. **Never bless a failing golden blindly.** If an expected value changes, the PR must document *why the contract changed* (which slice, which spec section) in the test/commit message. A golden update without a semantic explanation is a review blocker.
3. **No random business identities in assertions.** If a test needs a server-generated ID, capture it from the authoritative response and compare it across steps (e.g. before/after serialization of the same row).
4. **Failure messages must name the broken contract** (scenario + invariant), following the existing style: `"Digital Thread Scenario F invariant violated: stale-base publish must create no revision…"`.
5. New unmanaged-geometry variants for Scenario E belong in the Ruby manifest suite; the Go gate proves the storage-side consequence (only managed items reach `design_revision_items`).
