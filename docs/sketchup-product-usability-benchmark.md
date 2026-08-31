# Granete for SketchUp — Professional Product Usability Benchmark

Status: **Canonical measurement method**  
Program: #465  
Owner issue: #506  
Related: #466–#474, #498–#504, #355  
Date: 2026-08-30 America/Mexico_City

## 1. Purpose

This document defines how Granete evaluates whether the SketchUp product is understandable, efficient and confidence-building for its target furniture-factory users.

Technical correctness, TestUp passes, deterministic manufacturing output and API integration are mandatory but do not prove that a designer can complete the workflow without confusion or risky workarounds.

The benchmark answers:

```text
Can the intended user discover the correct furniture,
place and edit it safely,
understand and fix manufacturing feedback,
connect it to the exact Project/Design,
and recover from failures confidently?
```

## 2. Product hypothesis

Granete should differentiate from fragmented SketchUp workflows and broad historical CAD/CAM suites through continuity and clarity:

```text
catalog administration in React
→ fast visual discovery in SketchUp
→ professional semantic authoring
→ authoritative manufacturing feedback
→ exact Project/Design revision workflow
→ release and machine output in Granete
```

The benchmark does not assume the hypothesis is true. It measures it.

## 3. Evidence labels

Every finding and claim uses one label:

```text
observed          directly seen in a referenced workflow/demo/product
measured          measured in a recorded Granete benchmark run
inferred          reasoned from evidence but not directly tested
not_tested        unknown; no claim allowed
```

Never convert an inference into a measured fact.

## 4. Competitive reference policy

Granete may study universal patterns available in public products, documentation, demos or lawfully accessed trials, including:

- visual furniture/material libraries;
- contextual property panels;
- direct internal/hardware editing;
- placement preview/snapping;
- batch editing;
- manufacturing inspection;
- catalog/cloud/version workflows;
- onboarding and recovery patterns.

Granete must not:

- copy proprietary assets, text, source code or distinctive UI composition;
- claim knowledge of internal architecture without evidence;
- reproduce a competitor's trademarked visual identity;
- describe one public demo as complete product capability;
- publish “faster/easier than X” without comparable measured context;
- present an inaccessible or outdated version as the competitor's current product.

Competitive notes record source/version/date and whether the conclusion is observed or inferred.

## 5. Benchmark environments

Every run records:

- Granete plugin version and RBZ SHA-256;
- source commit/release channel;
- SketchUp exact version/build;
- OS/version/architecture;
- embedded Ruby/CEF when relevant;
- computer hardware summary;
- API/backend version;
- network condition category;
- workshop/catalog fixture revision;
- Project/Design/Quote fixture revision;
- participant persona and experience category without personal identifiers;
- whether it is first-use or repeat-use;
- enabled/disabled features and known limitations.

A result without environment context cannot establish a product budget or support claim.

## 6. Canonical fixtures

Use disposable, synthetic and deterministic data.

### Catalog fixture

Include enough categories and definitions to exercise real discovery:

- base cabinets;
- wall/tall cabinets;
- drawer units;
- closet modules;
- repeated/similar names that require category/code distinction;
- typed parameters;
- multiple material roles;
- one unavailable/incompatible/update-required item;
- thumbnails/previews including loading and missing-asset cases.

Catalog size is recorded as actual. Larger fixtures may be introduced after #472 measurements.

### Project fixture

Include:

- one exact Project/Design context;
- QuoteLine quantity greater than one materialized as physical units when #385/#386 exist;
- one pending Project Furniture unit;
- one already placed unit;
- one modified unit;
- one real preflight blocker involving shelf/hardware interaction;
- unmanaged room/decoration geometry excluded from productive scope;
- one stale/offline/reconnect scenario;
- one machine/release view only when the corresponding backend capability exists.

No real customer data is used.

## 7. Participant personas

Use representative consenting participants available to the project, for example:

### Workshop designer/engineer

- familiar with SketchUp;
- understands furniture construction;
- may use other woodworking extensions/tools.

### Sales/design user

- understands customer/furniture needs;
- lower CAD depth;
- needs guided placement/configuration and clear blockers.

### Catalog/technical administrator

- authors definitions/parameters/material roles in React;
- validates how the result appears in SketchUp.

Record experience bands, not names, emails or employer/client identity.

Do not generalize statistically from a small pilot. State participant count and limitations exactly.

## 8. Canonical task set

### T1 — Open and understand context

```text
open plugin
→ identify workshop/session/license/connectivity
→ identify connected/unbound Project/Design state
```

Success requires correct interpretation, not merely dialog open.

### T2 — Find furniture

```text
navigate/search/filter catalog
→ identify correct base cabinet among similar items
→ understand availability/version state
```

### T3 — Place furniture

```text
choose definition/preset
→ preview/snapping
→ rotate/offset if needed
→ commit one correct placement
```

No origin-first workaround in the target flow.

### T4 — Configure material and typed parameter

```text
change BODY material
→ change one non-trivial typed parameter
→ understand pending/resolving/accepted result
```

### T5 — Edit internal component

```text
select concrete shelf
→ move precisely
→ add a second shelf
→ undo/redo one operation
```

### T6 — Edit hardware

```text
select manual hinge/handle
→ move or replace with compatible option
→ distinguish manual from derived placement
```

### T7 — Create and fix manufacturing blocker

```text
trigger real shelf/hinge conflict
→ understand blocked state/remediation
→ navigate exact context
→ correct intent
→ rerun/refresh authoritative preflight
```

### T8 — Inspect manufacturing provenance

```text
select part
→ show read-only ManufacturingFeatures
→ identify source relationship/hardware placement
→ hide overlay without model mutation
```

### T9 — Batch edit

When #471 is included:

```text
select several furniture units
→ recognize mixed/common values
→ apply one compatible batch change
→ understand any incompatibility
```

### T10 — Connect exact Project/Design

When #499 is available:

```text
start from React exact Design
→ initiate secure handoff
→ complete/confirm pairing in SketchUp
→ recognize exact base revision
```

### T11 — Publish/review exact revision

When Digital Thread is available:

```text
publish exact revision
→ find R1 in React
→ distinguish R1 from later revision
→ understand reconciliation/action required
```

### T12 — Recover safely

Exercise one condition per run plan:

- network loss during resolve;
- stale catalog/Design base;
- expired session/license denial;
- incompatible API/plugin version;
- legacy migration required;
- no-results catalog search.

Success means correct recovery/next action with no corrupted productive state.

## 9. Metrics

Record actual observations for each task.

### Outcome

- completed independently;
- completed with hint;
- completed with intervention;
- failed/abandoned;
- unsafe completion/workaround.

### Time

- task start/end convention documented;
- active task time;
- server/host wait time where separable;
- first-use vs repeat-use.

Time alone is never the product goal if correctness/confidence falls.

### Interaction friction

- wrong turns;
- backtracks;
- unnecessary dialog/context switches;
- repeated search attempts;
- attempts to manipulate raw geometry;
- attempts to use unsupported actions;
- undo/recovery actions;
- help requests;
- misunderstood statuses.

### Safety and integrity

- identity-risk mistake;
- revision/context mistake;
- destructive model mistake;
- false ready/success interpretation;
- cross-tenant/context confusion;
- use of generic fallback as productive state.

Any integrity-risk finding is prioritized above cosmetic speed.

### Confidence/ease

Use a stated, consistent post-task question/scale. Record methodology and avoid pretending ordinal ratings are precise interval measurements.

### Accessibility

Where applicable:

- keyboard completion;
- focus visibility/order;
- screen-reader/accessible name behavior;
- status announcement;
- color-independent status comprehension;
- text scaling/long Spanish copy.

## 10. Baseline and targets

Do not invent targets before baseline.

Sequence:

```text
run baseline
→ inspect distributions/findings/limitations
→ approve product budgets/targets
→ implement fixes
→ repeat benchmark
→ compare exact environment/fixture or explain differences
```

Targets may include task completion, error budgets, time ranges or support-request reduction, but every number is explicitly approved after measurement.

## 11. Moderation protocol

- explain that the product, not the participant, is being tested;
- use neutral task prompts;
- do not teach the UI before first-use tasks unless onboarding itself is the tested intervention;
- record hints/interventions separately;
- avoid leading participants toward expected controls;
- stop if data/privacy/customer/model safety is at risk;
- ask debrief questions after task behavior is captured.

## 12. Privacy

Benchmark artifacts exclude:

- names/emails/addresses/phone numbers;
- client/workshop identity unless the participant explicitly authorizes an internal record and policy allows it;
- credentials/tokens/cookies/pairing codes;
- private file paths;
- real customer projects/prices;
- proprietary model geometry unless separately consented and sanitized.

Use opaque participant/run IDs. Video/screen recording requires explicit consent and retention/deletion rules.

## 13. Finding classification

Each finding contains:

```text
findingId
task/environment/persona
observation/evidence
severity
frequency within this sample
integrity risk
owner issue
recommended next experiment/fix
status
```

Severity:

- blocker before technical/commercial pilot;
- P1 product issue;
- P2 polish;
- training/documentation;
- unsupported/out-of-scope.

Frequency is reported only within the observed sample; no population claim.

## 14. Ownership routing

- selection/context → #476/#466;
- mutation runtime/rollback → #498;
- shelf authoring → #467;
- hardware authoring → #468;
- placement → #469;
- manufacturing overlay → #470;
- batch editing → #471;
- degraded/recovery → #474;
- catalog/parameter administration → #497;
- library/onboarding/usability → #506;
- performance → #472;
- pairing/binding → #499/#388;
- Project Furniture/revisions/release → #500/#501/#502;
- diagnostics → #504;
- commercial release → #355.

A benchmark report never becomes a hidden replacement backlog.

## 15. Release relationship

#506 is separate from:

- #354 technical correctness/real-host/machine E2E;
- #472 measured performance;
- #473 exact host compatibility;
- #355 packaging/update/rollback.

Before broad commercial promotion, #355 consumes:

- unresolved blocker findings;
- approved known limitations;
- onboarding/recovery readiness;
- representative task completion evidence;
- claims that are safe to make.

A technical pilot may precede the final usability gate if users are explicitly told the product/status/limitations. Broad claims may not.

## 16. Definition of Done

The benchmark method is complete when:

- canonical fixtures/tasks/environments are versioned;
- representative consenting users complete recorded first-use and repeat-use runs;
- actual baseline and limitations are documented;
- targets are approved after baseline;
- integrity/accessibility/product findings route to owner issues;
- fixes are re-tested;
- no privacy leak or unsupported competitive claim appears;
- #506 records final evidence and #355 consumes the result before broad release.