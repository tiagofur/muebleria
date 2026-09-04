# Audit checkpoint — active, not complete

## Scope

- Request and authoritative DoD: `evidence/request.md`.
- Pinned main: `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`.
- Read-only product archive: `../source`; report-only writes: `audit/`.
- No remote issue/PR writes, product fixes, checkout switch, staging or commits by this audit.
- Original working checkout is separate and active: its #394 work advanced externally during the audit. Latest observed branch `feat/394-impact-classification-requote`, HEAD `bd702e6c2366fd5d371684ab85678962c5c40522`, clean. This does not update the audit baseline. Snapshot source remains clean.

## Executed evidence

| Check | Result | Scope |
|---|---|---|
| init isolated DB | PASS | TS/Go/Ruby/RBZ; package caches/skips are not entire end-to-end proof |
| OpenAPI generated parity | PASS | Generated surfaces, not every legacy consumer |
| Web production build | PASS | Main JS 5048.71kB, gzip1440.98kB; no FPS/latency claim |
| Deployment smoke | PASS | Structural only, not Docker rebuild/live deployment |
| Organization browser gate | 17 PASS | Real isolated Go/Postgres + Chromium auth/MFA/session/tenant flows |
| Foundation pilot proof | PASS | Log ends PASS; no SKIP found in this proof log |
| Exact main CI | 7 successful checks | Includes Foundation Gate A, not licensed native SketchUp |
| Audit defect harness | 3 PASS, reproduced defects | Rotated DXF hole1→0, seven drilling fallback flags lost, mocked stock10→8→6 after retry; no product repairs |
| Guest Web inspection | 15 destinations + detailed panels | Guest data only, not authenticated commercial workflow |
| Proyectar responsive | Failure reproduced | Canvas height0 at390x844 and768x1024; desktop works |
| Native SketchUp | Read-only menu inspection | Existing user model preserved; exact installed SHA and mutation tests UNKNOWN |
| Portal QA | HTTP desktop/mobile/search/filter/order/expand observed | File URL runtime blocked by browser policy; no workaround attempted; button feedback Copiado observed; clipboard bytes not inspected |

Full logs under `evidence/`; screenshots under `assets/`.

## Safety

First preflight Go run received SIGTERM of unknown origin. Retry was deliberately stopped after discovering default connection to shared PostgreSQL5445. Some migrations had executed; shared database unchanged is NOT asserted. Own test processes alone were stopped. Successful subsequent tests used dedicated `granete-audit-360-pg`, loopback55461; browser gate used its own temporary cluster. No further shared DB tests allowed.

## Rolling consolidation snapshot

Generated 2026-09-04T12:37:35.799354+00:00. Pinned audit remains316df57c; main later0eb53be6 mergedPR550/#394, NOT audited. Readback: evidence/main-readback-final.json.

- Features: 204 rows; 200 PARTIAL, 4 UNKNOWN; zero COMPLETE. All-row fragment/scope review is not every acceptance item executed.
- API inventory: 241 runtime registrations + 24 additional OpenAPI declaration/alias rows; not265distinctruntimeendpoints. Supplement: 244 rows, combined handler-semantic review 263, future-scope declarations 2, remaining unreviewed disposition 0. No new HTTP/DB probes in supplements.
- PostgreSQL: 75 public tables (74application/control +schema_migrations), 842columns, 435constraints, 279indexes. Historical76names preserved, two retired. Metadata SELECT-only, not business rows or production.
- Additional pure-domain proofs: template roundtrip3/3 reproduces6field loss; drilling context1/1 reproduces first-owner order dependence. No UI/API/DB/DXF/native/machine proof or product fix.
- Web: 29 primary screen fragments; 26 test bodies inspected; 132 fragment files. Secondary259 / inline140 each classified by specific fragment, shared contract, reused pattern or literal. No remaining context-only gaps; no all-consumer/runtime certification. See web-semantic-audit.coverage for full breakdown.
- Effective permissions: 41 source families, 244 supplement rows linked; separate from536role predicates and all265mixed-row authority ledger. No exhaustive HTTP role-state proof.
- Documentation:371files, selected-claim semantic comparison by15families. Not every sentence/historical proof certified.
- Canonical new findings FM01–05, EPSF01 and AUTH-CONTRACT01 retained in their sources; synthesis references them without duplicate finding rows. QV01 kept distinct from immutable backend revisions.
- Latest portal mappings have static verification only. Prior HTTPdesktop/mobile/filter/search/expand QA retained; final rerun hit browser internal error after reportserverrestart. ServerHEAD200 is not UI proof. file:// blocked by tool policy; no workaround.
- This is a rolling checkpoint, not delivery certification. See evidence/audit-closeout-gaps.md and completion-coverage.json for exact remaining proofs.
