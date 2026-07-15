# Slice A — Project client contract cleanup

> **Date:** 2026-07-15  
> **Scope:** UI residual debt after F024 — `Project.customerId` as source of truth (no `customerName` on `Project`).  
> **Non-goals:** customer picker (Slice B), F023 dashboard, Login wiring, feature_list status changes.

---

## What changed

### Contract
- Domain `Project` remains: `customerId: string` only.
- `ProjectDraft.customerName` kept as free-text form field (shell still resolves via `findOrCreateCustomer`).
- Removed all `(project as any).customerName` / `(p as any).customerName` fallbacks in UI helpers.

### `projectToDraft`
| Field | Before | After |
|-------|--------|-------|
| `customerId` | display name / free-text | `project.customerId` |
| `customerName` | resolve + `as any` fallback | `resolveCustomerName(project.customerId, customers)` only (orphan id fallback) |

### `filterProjectsByQuery`
- Client haystack = `resolveCustomerName(p.customerId, customers)` only (no `as any`).

### Tests
- Valid `Project` fixtures (`customerId`, never `customerName` on Project).
- Customers catalog fixtures for display-name assertions.
- `ProjectDraft` tests still use `customerName` on **drafts** only.
- New cases: orphan fallback (`projectToDraft`, filter), `resolveCustomerName` unit coverage.
- `ProjectsScreen` tests pass `customers` and use `cust-ana` / `cust-bruno` ids.

---

## Files touched

| File | Change |
|------|--------|
| `packages/ui/src/projects/projectHelpers.ts` | `projectToDraft` + `filterProjectsByQuery` contract |
| `packages/ui/src/projects/projectHelpers.test.ts` | valid Projects + customers fixtures + resolve tests |
| `packages/ui/src/projects/ProjectsScreen.test.tsx` | customers catalog + real customerIds |

**Unchanged (intentionally):**
- `ProjectsScreen` free-text Cliente input + `customerId: draft.customerName` payload bridge (Slice B picker).
- Shell `findOrCreateCustomer` / `App.tsx` wiring.
- `feature_list.json` (F022 already `done`; residual cleanup only).

---

## Verification

Run from repo root:

```bash
pnpm --filter @muebles/ui test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web typecheck
# preferred full gate:
./init.sh
```

### Expected results (static review)

- No remaining `as any` customerName reads on `Project` in `packages/ui`.
- Helpers type-check against domain `Project` + optional `Customer[]`.
- Card/detail display continues via `resolveCustomerName(project.customerId, customers)`.
- Create form free-text still maps name through draft → shell (Slice B later).

### Runtime gate

Implementer applied code + tests. **Orchestrator should re-run the commands above** and paste results into this file or session notes before treating Slice A as fully closed.

---

## Residual for later slices

1. **Slice B** — replace free-text Cliente with customers picker (select existing + optional create).
2. **F023** — dashboard (depends on clean customer display — now unblocked for UI contract).
3. Login wiring / design.md screen polish — out of scope.
