# Granete — Current execution ledger

> **Purpose:** this file is a short, low-conflict summary of work that is active or immediately next.
> It is **not** the historical record, CI log, review diary, or technical specification.
>
> Historical snapshot before this reset:
> `progress/archive/current-2026-09-19-pre-ledger-reset.md`
>
> GitHub issues/PRs and feature-specific docs are the source of truth. If this file disagrees with them,
> fix or remove the stale summary here; do not rewrite history in this ledger.

## Editing contract

1. Keep this file below **200 lines / ~20 KB**.
2. An open issue gets **one row** in the open-work table. Do not create a new H1 section for each review round.
3. Do **not** paste test logs, full verification matrices, commit histories, long SHAs, review transcripts, or implementation narratives here.
4. Detailed evidence belongs in the PR, issue comments, `docs/verification.md`, or the feature-specific document.
5. A feature PR should normally update this file **at most once**, near a material ownership/status change or merge. If status did not materially change, omit `progress/current.md` from the PR.
6. When an issue closes, remove it from the open table and optionally add **one line** to “Recently completed”. Keep at most 10 recent entries.
7. Structural edits to this ledger should be isolated in a docs/process PR. Feature branches should edit only their own row.
8. On merge conflicts, GitHub issue/PR state wins. Never resolve a conflict by concatenating both historical blocks.
9. Historical detail that still matters must be moved to an archive or feature doc before removal; do not grow this file to preserve history.
10. No agent should use this file as a scratchpad. Use the PR/issue or an `odd/tasks/` work unit for in-progress notes.

## Snapshot

- Ledger reset issue: #798.
- Audit date: 2026-09-19.
- Former ledger: 1,746 lines, ~266 KB, 60 H1 sections.
- 46 distinct issue references were present; only 8 of those were still open at audit time.
- The largest duplicate histories appeared 11 and 6 times respectively.
- Open PRs at reset time: none.

## Open work and ownership

| Area | Issue(s) | Role / state | Next gate |
| --- | --- | --- | --- |
| PTX/CADmatic r5 | #787 | META open, approved | Keep r5 execution in the ordered receiver → CUTS → CADLink → final-route rows below; no client field attempt before the final gate. |
| PTX receiver | #790 | **Next PTX implementation**; open, approved | Receiver HPP250/CAD4: MATERIALS, BOOK, RULES and record shape. |
| PTX CUTS | #791 | Queued; open, approved | Correct 90..99 semantics and differential/golden r5. |
| PTX CADLink | #792 | Queued; open, approved | `/RESULT`, `.RLT` parser and reproducible field pack. |
| PTX final route | #793 | Final r5 gate; open, approved | Profile r5, adapter identity/routing, frozen CNC scope and final candidate. |
| Hardware 3D | #666 | META open, approved | Coordinate remaining AS3D work without mixing scopes. |
| Hardware resources | #667 | Open umbrella; M1/M2 history archived | Triage remaining umbrella scope before adding more work under it. |
| SketchUp hardware SKP | #668 | Open/reopened | Preserve exact-asset/mounting guarantees; keep GLB work separate. |
| GLB / coherent 3D | #669 | **Next/current hardware implementation**; open | GLB representation across catalog/agregados/muebles/Proyectar. |
| Rigid assemblies pilot | #670 | Open | Continue MERIVOBOX/pilot work under its own acceptance gates. |
| Ops revision continuity | #741 | Open, not current priority | Resume only when explicitly reprioritized; preserve P1/P2 authority rules. |
| SketchUp commercial | #677 | Open, not current priority | Resume live commercial total/delta work when reprioritized. |
| Legacy pairing umbrella | #499 | Open, needs triage | Confirm remaining scope vs already merged handoff work before new implementation. |
| Quote authority umbrella | #642 | Open, needs triage | Consolidate remaining acceptance instead of adding more progress sections here. |
| PTX umbrella | #650 | Open, needs triage | Treat the r5 META/receiver chain as current execution; close or redefine this umbrella only through its issue. |

## Stable execution invariants

### PTX/CADmatic 4 r5

The PTX rows in the table are intentionally ordered **receiver → CUTS → CADLink → final route**.

- r2/r3/r4 are historical evidence and must remain byte/digest stable.
- The strict preflight and label/identity increments are completed; later work should not silently reopen their scope.
- No “CADmatic compatible”, “CADLink accepted”, or machine-validation claim before field evidence.
- No client field attempt before the final r5 route and independent final review.
- The controlled field attempt must capture CADLink `.RLT` evidence; verbal popup feedback alone is insufficient.
- Productive CNC `DRAWING` scope at the final route must come from frozen release identity (for example `manufacturingFingerprint` or equivalent), never a free UI string.

### Hardware / 3D

The **GLB / coherent 3D** row in the table is the next/current implementation surface.

- Native SKP/download/mounting and rigid-assembly/pilot work remain separate authorities.
- Do not duplicate host evidence or test matrices in this ledger.
- New findings belong to their issue/PR or feature docs; this table gets only a one-line state change.

## Recently completed

- **#789 / PR #797** — PARTS_INF/PARTS_UDI, industrial labels, edge mapping and scoped CNC identity for PTX r5; merged 2026-09-19.
- **#788 / PR #795** — strict Pattern Exchange spec preflight for r5; merged.
- **#781** — post-first-rejection PTX field dialect corrections; closed.
- **#778** — removed byte-exact PDF flake from engineering cutting-demand verification; closed.
- **#768** — compact Venta → Ingeniería → Producción flow visibility; closed.
- **#740** — durable release-scoped engineering/material/physical-start gate work; closed.
- **#739** — engineering and PTX test path from exact frozen release cutting demand; closed.
- **#738** — canonical ProductionRelease entry into Ingeniería; closed.

## Conflict policy for future agents

Before editing this file:

1. Read the current version from `main`.
2. Verify the relevant issue/PR state directly on GitHub.
3. Edit only the row or one-line recent-completion entry you own.
4. Do not carry forward stale review-round prose.
5. If another branch changed the same row, reconcile against GitHub state rather than combining both texts.
6. If the needed update takes more than a few lines, it belongs in the issue/PR/docs, not here.

## Archive policy

The pre-reset ledger is preserved at:

`progress/archive/current-2026-09-19-pre-ledger-reset.md`

Future archival should prefer periodic snapshots or feature-specific docs. The archive is historical evidence, not an active file and should not be edited by normal feature PRs.
