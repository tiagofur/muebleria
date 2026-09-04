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
  4. Database trigger `protect_production_release_immutability` blocks any `UPDATE` or `DELETE` on `production_releases` at the SQL level.

---

## 3. Invariants Matrix

| ID | Invariant Name | Enforcement Layer | Automated Proof |
|---|---|---|---|
| **I1** | Exact Identity Persistence | DB / Go / Ruby | `TestDigitalThreadE2E_ScenarioA_QuoteFirst`, `test_scenario_a_quote_first_contract_conformance` |
| **I2** | Qty > 1 Physical Individuation | Go Storage / Domain | `TestDigitalThreadE2E_ScenarioB_QuantityGreaterThanOne`, `test_scenario_b_quantity_multiple_manifest_filtering` |
| **I3** | Design-First Provenance | Go Storage / Domain | `TestDigitalThreadE2E_ScenarioC_DesignFirst` |
| **I4** | No Implicit Latest | DB Foreign Keys / Go | `TestDigitalThreadE2E_ScenarioF_Concurrency_StaleBaseRejected` |
| **I5** | Server-Authoritative UUIDs | DB / Ruby Resolver | `TestDigitalThreadE2E_ScenarioD_DuplicateIdentity`, `test_scenario_d_duplicate_identity_preflight_and_resolution` |
| **I6** | Managed-Only Scope | Go / Ruby ManifestBuilder | `TestDigitalThreadE2E_ScenarioE_SemanticScope_UnmanagedExclusion`, `test_scenario_e_unmanaged_geometry_exclusion` |
| **I7** | Top-Level ComponentInstance Hierarchy | Ruby Native Model | `test_invariant_i7_nested_subcomponents_do_not_produce_root_instances` |
| **I8** | Deterministic Hashing & Parity | Go Storage / JSON Hashing | `TestDigitalThreadE2E_DeterministicFingerprintParity`, `test_invariant_i8_deterministic_manifest_serialization` |
| **I9** | Multi-Org RLS & Fail-Closed Isolation | PostgreSQL RLS / DB Triggers | `TestDigitalThreadE2E_NegativeProofs`, `test_invariant_i9_fail_closed_session_parser` |

---

## 4. Execution Commands

### Go Backend E2E Suite
```bash
cd backend-go
go test -v -run "TestDigitalThreadE2E" ./internal/storage
```

### SketchUp Ruby Client Contract Suite
```bash
cd apps/sketchup-extension
eval "$(rbenv init - zsh)"
bundle exec rake verify
```

### Host Smoke in TestUp
```bash
# Executed in SketchUp TestUp runner:
# Suite: Granete::SketchUpExtension::TC_DigitalThreadE2ESmoke
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
