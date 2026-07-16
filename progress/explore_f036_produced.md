# Explore F036 — Status `produced` + reopen/delete (gerente)

**Date:** 2026-07-16  
**Issue:** [#68](https://github.com/tiagofur/muebleria/issues/68)  
**Branch (current):** `feat/project-produced-68`  
**Scope:** read-only map before implement.  
**Related:** F035 RBAC (delete helpers already shipped); F038 production queue (consumes `produced`).

---

## 0. Acceptance (source of truth)

### `feature_list.json` F036

| # | Criterion |
|---|-----------|
| A1 | Enum + badge `produced` |
| A2 | Reopen solo gerente/admin e invalida snapshot |
| A3 | `produced` no exige export previo |
| A4 | Export permitido en `accepted` y `produced` |
| A5 | Tests de transiciones y permisos |

**Description extras:** workflow `draft → quoted → accepted → produced`; delete solo gerente/admin; **produced click-only**.

### GitHub #68 (expanded)

| Area | Rule |
|------|------|
| Domain | `ProjectStatus` + `produced`; snapshot on quoted/accepted/**produced**; reopen → `draft` **clears** snapshot |
| Vendedor | May advance own drafts → quoted/accepted; **no** reopen; **no** delete |
| Gerente/admin | Reopen + delete (confirm UI) |
| Producción / ingeniero / gerente / admin | Mark `produced` (click-only; **no** export gate) |
| UI | Badge produced (design.md); taller Spanish confirms |
| Exports | Optimizer + herrajes on **accepted** and **produced** (reprint) |
| Out of scope | `rejected`; long audit log (who/when reopen is nice-to-have) |

### PRD gaps

- **§6.6.4 referenced by F036 does not exist** in `docs/prd.md` (only §6.6.1–6.6.3 roles/matrix/nav).
- **§7.4** still says closed = `quoted` / `accepted` only — must extend to **`produced` freezes snapshot**.
- Design tokens for produced badge **already exist** in CSS (`badge-produced`); design.md names `status-badge--produced` but implementation uses `badge-produced` (same pattern as draft/quoted/accepted).

### Harness note

Both **F035** and **F036** are `in_progress` in `feature_list.json`. Agents.md allows only one `in_progress` — resolve before close (likely finish/close F035 first or leave F035 done).

---

## 1. ProjectStatus — definitions today

### TypeScript (`packages/domain`)

| Location | Content |
|----------|---------|
| `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/types.ts:15` | `export type ProjectStatus = 'draft' \| 'quoted' \| 'accepted'` — **no `produced`** |
| `Project.status` | `readonly status: ProjectStatus` (~L190) |
| `priceSnapshot` comment | “Present when closed (quoted/accepted)” (~L201) |

### Go (`backend-go/internal/domain`)

| Location | Content |
|----------|---------|
| `types.go:40–46` | `ProjectStatus` + `StatusDraft`, `StatusQuoted`, `StatusAccepted` — **no `StatusProduced`** |
| `Project.Status` | `json:"status"` field |

### DB

| Location | Constraint |
|----------|------------|
| `backend-go/db/migration/000001_init_schema.up.sql:148` | `status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'quoted', 'accepted'))` |

**Must add migration** `000011_project_status_produced` (or next free number after `000010_product_roles`) expanding CHECK to include `'produced'`.

### UI labels / badges

| Location | State |
|----------|--------|
| `packages/ui/src/projects/projectHelpers.ts` | `STATUS_LABELS` / `STATUS_BADGE_CLASS` / `PROJECT_STATUSES` — three statuses only |
| Labels ES | draft→Borrador, quoted→Cotizado, accepted→Aceptado |
| Badge classes | `badge-draft`, `badge-quoted`, `badge-accepted` |
| `projects.css` | **`.badge-produced` already defined** (brand purple) + `.badge-rejected` unused |
| `StatusBadge` in `ProjectsScreen.tsx` / `Dashboard.tsx` | Uses helpers above — will pick up produced once type + maps exist |
| Meta form select | Free `<select>` over **all** `PROJECT_STATUSES` — no role gating |
| `apps/web/src/exportCommercialQuote.ts` | `STATUS_LABELS` missing produced |
| `docs/technical_design.md` | Schema still `draft \| quoted \| accepted` |

### Dashboard helpers

| Helper | Rule today | F036 impact |
|--------|------------|-------------|
| `countActiveProjects` | draft + quoted | Probably **exclude** produced (still not “pipeline quote”) — keep unless product says otherwise |
| `sumMonthlyQuotedTotal` | quoted + accepted | Decide: include produced sales? (recommended: **yes**, still sold work) |

---

## 2. How status changes today

### Domain engine (TS)

**File:** `packages/domain/src/engine.ts`

```
isProjectClosed(status) → status === 'quoted' || status === 'accepted'
```

**`transitionProjectStatus(project, newStatus, catalog, capturedAt?)`:**

| Transition | Behavior |
|------------|----------|
| open → closed | Attach `captureQuoteSnapshot` |
| closed → open (draft) | **Remove** `priceSnapshot` (reopen) |
| closed → closed (quoted ↔ accepted) | Keep snapshot; re-freeze only if missing |
| draft → draft | Drop stale snapshot if any |

**No allowed-transition graph** — any status→status is accepted. **No role checks** (pure domain).

**`calcProjectBreakdown`:** if closed + snapshot → frozen breakdown; else live.

### Domain engine (Go)

**File:** `backend-go/internal/domain/engine/generators.go`

- `IsProjectClosed` / `TransitionProjectStatus` / `CaptureQuoteSnapshot` — **parity** with TS; same closed set (quoted/accepted only).

### Shell / UI path

**File:** `apps/web/src/App.tsx`

- Create: force base `status: 'draft'`, then `transitionProjectStatus(base, meta.status, …)` so create-as-quoted captures snapshot.
- Update: merge meta fields → `transitionProjectStatus(withMeta, meta.status, catalog, now)` → `repository.saveProject`.
- **No reopen permission check.**
- **No “mark produced” dedicated action** — status only via meta modal select.

### API path

**File:** `backend-go/internal/api/handlers.go`

| Method | Gate | Status handling |
|--------|------|-----------------|
| POST `/projects` | `RoleCanMutateProjects` | **Forces** `p.Status = StatusDraft` |
| PUT `/projects/{id}` | `RoleCanMutateProjects` | **Trusts client body** — no `TransitionProjectStatus`, no reopen RBAC |
| DELETE | `RoleCanDeleteProject` | Ownership + delete |

**Snapshot persistence:** `backend-go/internal/storage/projects.go` UpdateProject:

```
if status == quoted || accepted → upsert quote_snapshots from p.PriceSnapshot
else → DELETE snapshot (reopen/draft)
```

**Gap:** if client sends `produced` with snapshot, storage today treats it as **else** branch and **deletes** snapshot unless code is updated. Critical for F036.

### apiMappers (TS client)

`packages/storage/src/apiMappers.ts` `projectFromApi`:

```ts
status: (['draft', 'quoted', 'accepted'].includes(status) ? status : 'draft')
```

Unknown statuses **collapse to draft** — must add `'produced'` or API→UI will corrupt status.

---

## 3. Delete project path

### Already done (F035)

| Layer | Status |
|-------|--------|
| TS `roleCanDeleteProject` | admin \| gerente_ventas |
| Go `RoleCanDeleteProject` | same |
| API DELETE | `requirePermission(RoleCanDeleteProject)` → 403 ES message |
| UI `canDelete` prop | `ProjectsScreen`; shell: `session === 'guest' \|\| roleCanDeleteProject(actorRole)` |
| Confirm modal | Spanish: “¿Seguro que querés eliminar…?” |
| Tests | `rbac.test.ts`, `rbac_test.go`, `TestRBAC_VendedorCannotDeleteProject`, `TestRBAC_GerenteCanDeleteProject` |

**F036 work on delete:** mostly **acceptance verification** + ensure vendedor UI cannot see delete (done) and docs/PRD mention delete with reopen. Optional: tighten confirm copy for closed/produced projects.

**Not done:** API does **not** run domain transition on delete (N/A). No soft-delete.

---

## 4. Quote snapshot freeze on closed statuses

### Current closed set

`quoted` | `accepted` only (TS + Go + storage).

### Target closed set (issue #68 + F036)

`quoted` | `accepted` | **`produced`**

Implications:

1. `isProjectClosed` / `IsProjectClosed` include `produced`.
2. `accepted → produced` = closed→closed → **keep same snapshot** (do not re-freeze).
3. `produced → draft` (reopen) = closed→open → **clear snapshot**.
4. `calcProjectBreakdown` freezes for produced.
5. Storage: persist snapshot when status ∈ {quoted, accepted, **produced**}.
6. Commercial quote export uses `isProjectClosed` for “frozen prices” flag — auto-extends once helper updates.
7. **No export prerequisite** to enter produced (A3) — domain must not check cut-list / export history (none exists today; keep it that way).

### Reopen semantics

- Domain already clears snapshot on any closed→draft.
- **Missing:** `roleCanReopenProject` / `RoleCanReopenProject` (admin | gerente_ventas) — issue pairs reopen with delete.
- **Missing:** API enforcement on PUT when `existing.Status` is closed and `new.Status == draft` (or any reopen): only gerente/admin; vendedor → **403**.
- **Missing:** UI: hide/disable reopen option for non-gerente; confirm “Reabrir borra el snapshot de precios…”.

---

## 5. F035 RBAC helpers relevant to F036

**TS** `packages/domain/src/rbac.ts` | **Go** `backend-go/internal/domain/rbac.go`

| Helper | Who | F036 use |
|--------|-----|----------|
| `roleCanMutateProjects` | admin, gerente, **vendedor** | Edit draft / advance quote status |
| `roleCanDeleteProject` | admin, gerente | Delete (done) |
| `roleCanExportProduction` | admin, ingeniero, produccion, gerente | Export Optimizer/herrajes |
| `roleCanAccessProjects` | + produccion, ingeniero | See projects |
| **Missing `roleCanReopenProject`** | should be admin, gerente | A2 |
| **Missing `roleCanMarkProduced`** | should be admin, gerente, ingeniero, produccion (per #68) | Mark produced; **not** vendedor |

**Note:** Producción **cannot** `roleCanMutateProjects` today — so they **cannot** change status via PUT if that gate stays. F036/F038 need either:

- **Option A:** dedicated PATCH/action `mark-produced` allowed for `roleCanMarkProduced`, or  
- **Option B:** expand mutate for status-only produced transitions, or  
- **Option C:** allow produccion limited status update in handler without full mutate.

Recommend **Option A or C** so vendedor cannot mark produced and producción cannot edit line items freely.

**Vendedor** may set quoted/accepted via current mutate (OK per #68). Must **block** selecting `produced` and block reopen to draft.

---

## 6. Tests to extend

### Domain TS

| File | Extend |
|------|--------|
| `packages/domain/src/engine.test.ts` | `isProjectClosed('produced') === true`; `accepted → produced` keeps snapshot; `produced → draft` clears; still no export gate |
| `packages/domain/src/rbac.test.ts` | `roleCanReopenProject`, `roleCanMarkProduced` matrix |
| `packages/domain/src/types.test.ts` | If any status exhaustiveness tests |
| `packages/storage/src/apiMappers.test.ts` | Map `produced` round-trip |

### Domain / API Go

| File | Extend |
|------|--------|
| `engine/generators_test.go` | produced in closed set + transitions |
| `domain/rbac_test.go` | reopen + mark produced helpers |
| `api/handlers_test.go` | PUT reopen forbidden for vendedor; allowed gerente; mark produced permission; delete already covered |
| Storage/integration | optional: status CHECK accepts produced; snapshot kept |

### UI

| File | Extend |
|------|--------|
| `projectHelpers.test.ts` | label “En producción”, class `badge-produced`, `PROJECT_STATUSES` includes produced |
| `ProjectsScreen.test.tsx` | badge render; optional: canDelete false hides button; status options filtered by role props |
| `exportCommercialQuote` tests | label for produced; frozen path |

### Dashboard (if monthly total policy changes)

| File | Extend |
|------|--------|
| `dashboardHelpers.test.ts` | produced in/out of monthly sum |

---

## 7. Concrete implementation plan

### Phase 1 — Domain enum + closed set (TS + Go)

| File | Change | Acceptance |
|------|--------|------------|
| `packages/domain/src/types.ts` | Add `'produced'` to `ProjectStatus` | A1 |
| `packages/domain/src/engine.ts` | `isProjectClosed` += produced; comments §7.4 | A1, A2, snapshot |
| `backend-go/internal/domain/types.go` | `StatusProduced = "produced"` | A1 |
| `backend-go/internal/domain/engine/generators.go` | `IsProjectClosed` += produced | parity |
| Tests engine TS/Go | transitions listed above | A5 |

**No graph enforcement required** for MVP if UI/API only offer legal moves; optional pure helper:

```ts
// suggested
allowedProjectStatusTransitions(from): ProjectStatus[]
// draft: quoted, accepted
// quoted: accepted, draft (reopen), maybe produced? issue says draft→quoted→accepted→produced
// accepted: produced, draft
// produced: draft (reopen only)
```

Prefer **linear forward + reopen to draft only** per issue workflow.

### Phase 2 — RBAC helpers

| File | Change | Acceptance |
|------|--------|------------|
| `packages/domain/src/rbac.ts` | `roleCanReopenProject`, `roleCanMarkProduced` | A2, A5 |
| `backend-go/internal/domain/rbac.go` | same | A5 |
| Tests rbac TS/Go | matrix | A5 |

Suggested matrix:

| Action | admin | gerente | vendedor | ingeniero | produccion | user |
|--------|:-----:|:-------:|:--------:|:---------:|:----------:|:----:|
| Mutate projects (content / quoted) | ✓ | ✓ | ✓* | — | — | — |
| Mark produced | ✓ | ✓ | — | ✓ | ✓ | — |
| Reopen → draft | ✓ | ✓ | — | — | — | — |
| Delete | ✓ | ✓ | — | — | — | — |

\*own portfolio only (F034).

### Phase 3 — Persistence

| File | Change | Acceptance |
|------|--------|------------|
| New migration `000011_…_produced.up.sql` | Drop/recreate CHECK with `produced` | A1 |
| `.down.sql` | reverse | ops |
| `backend-go/internal/storage/projects.go` | Snapshot keep when `produced` (use `IsProjectClosed` or explicit third status) | A2 freeze |
| `packages/storage/src/apiMappers.ts` | Allow `produced` in whitelist | A1 |

### Phase 4 — API status transition enforcement

| File | Change | Acceptance |
|------|--------|------------|
| `handlers.go` PUT project | Compare `existing.Status` vs `p.Status`: | A2, A5 |
| | • reopen to draft → require `RoleCanReopenProject` | |
| | • → produced → require `RoleCanMarkProduced` (even if !MutateProjects) | A3 no export check |
| | • other status changes → require MutateProjects; reject illegal jumps (optional) | |
| | • Prefer server-side `TransitionProjectStatus` with catalog when status changes so snapshot rules cannot be skipped by malicious body | |
| `handlers_test.go` | vendedor reopen 403; prod mark produced 200; vendedor mark produced 403 | A5 |

**Design choice:** either load catalog on status change for snapshot capture, or trust client snapshot only when closed→closed. Prefer engine call when entering closed set for parity with App.tsx.

### Phase 5 — UI

| File | Change | Acceptance |
|------|--------|------------|
| `projectHelpers.ts` | `PROJECT_STATUSES` + labels + badge maps; label **“En producción”** (design.md) | A1 |
| `ProjectsScreen` | Status select: role-filtered options **or** split UX: | A2, click-only |
| | • Meta form: draft/quoted/accepted for sales roles (no produced if not allowed; no draft if cannot reopen) | |
| | • Detail action button **“Marcar en producción”** (click-only) for `roleCanMarkProduced` when status===accepted | A3 |
| | • Reopen control + confirm only if `canReopen` | A2 |
| Props | `canReopen?: boolean`, `canMarkProduced?: boolean` (or shell filters options) | |
| `App.tsx` | Wire helpers; gate `updateProject` status changes client-side; keep `transitionProjectStatus` | |
| `exportCommercialQuote.ts` | STATUS_LABELS produced | A1 |
| `projects.css` | produced already present — verify contrast | A1 |
| Delete | Already gated — smoke only | delete |

### Phase 6 — Exports (A4)

| Check | Today | F036 |
|-------|-------|------|
| `collectExportIssues` | No status gate | Keep **no** status gate (export any status that has BOM) **or** document product allows draft too |
| Issue #68 | Explicitly allow accepted + produced | Ensure UI does not disable export only for those — currently export gated by **role** (`canExportProduction`), not status |
| A3 | produced without prior export | Do not add “must have exported” flag |

**Conclusion:** A4 is mostly **status-agnostic export + no new gate**. Add a regression test that `collectExportIssues` / export builders succeed for `status: 'produced'` fixture. Optional UI: still show export on accepted/produced for producción role (already has projects access + export role).

### Phase 7 — Docs

| File | Change |
|------|--------|
| `docs/prd.md` | Add **§6.6.4** workflow statuses + reopen/delete; extend **§7.4** closed set to include produced |
| `docs/technical_design.md` | ProjectSchema status union |
| `progress/current.md` | Already points at F036 plan |

---

## 8. Acceptance mapping (checklist)

| ID | Criterion | Primary work | Done today? |
|----|-----------|--------------|-------------|
| A1 | Enum + badge produced | types TS/Go, migration, UI maps, CSS (exists) | Partial (CSS only) |
| A2 | Reopen gerente/admin + clear snapshot | rbac helpers + API + UI + engine already clears | Snapshot clear yes; role gate **no** |
| A3 | produced no export prerequisite | Don’t add gates; click-only mark action | Implicit yes |
| A4 | Export accepted + produced | Confirm no status block; test produced fixture | Role-only gate; no status block |
| A5 | Tests transitions + permissions | engine + rbac + handlers + UI helpers | Partial (quoted/accepted only; delete yes) |
| Extra | Delete gerente/admin | F035 done | **Yes** |
| Extra | Workflow linear + produced click-only | UI button + transition allowlist | **No** |

---

## 9. Key absolute paths

### Domain
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/types.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/engine.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/engine.test.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/rbac.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/rbac.test.ts`

### Go
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/types.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/rbac.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/engine/generators.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/storage/projects.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/handlers.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/db/migration/000001_init_schema.up.sql` (status CHECK)

### UI / shell
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/projectHelpers.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/ProjectsScreen.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/projects.css`
- `/Users/tiagofur/dev/carpinteria/muebles/apps/web/src/App.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/storage/src/apiMappers.ts`

### Product
- `/Users/tiagofur/dev/carpinteria/muebles/feature_list.json` (F036)
- `/Users/tiagofur/dev/carpinteria/muebles/docs/prd.md` (§6.6*, §7.4)
- `/Users/tiagofur/dev/carpinteria/muebles/docs/design.md` (§5.2 badges)
- https://github.com/tiagofur/muebleria/issues/68

---

## 10. Risks / decisions

1. **Producción cannot mutate projects today** — mark produced needs a separate permission path (API + UI button).
2. **PUT trusts client status** — without server transition + RBAC, reopen/produced rules are UI-only (insecure).
3. **Storage snapshot branch** will **drop** snapshot for `produced` until updated — data bug if enum lands first.
4. **apiMappers** silently maps unknown → `draft` — same risk.
5. **PRD §6.6.4 missing** — write it in the same feature to avoid inventing rules later.
6. **Dual in_progress F035+F036** — harness conflict; close F035 before marking F036 done if policy enforced.
7. **Dashboard monthly total:** include produced or not — product micro-decision (default: include).
8. **F038** will build production queue on top of `produced`; keep status string stable.

---

## 11. Suggested implement order (minimal risk)

1. Migration + enum TS/Go + `isProjectClosed` + storage snapshot branch + apiMappers  
2. Engine transition tests for produced  
3. RBAC reopen + markProduced (+ tests)  
4. API PUT guards (+ optional TransitionProjectStatus server-side)  
5. UI badge/labels + filtered status UX + “Marcar en producción” + reopen confirm  
6. Export regression tests  
7. PRD §6.6.4 + §7.4 update  
8. `./init.sh` / `pnpm test` + Go package tests  

**Out of scope for F036:** rejected status, F038 queue home, F037 gerente dashboard metrics, long audit trail.
