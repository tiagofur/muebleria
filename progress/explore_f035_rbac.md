# Explore F035 — Product roles + RBAC matrix

**Date:** 2026-07-16  
**Scope:** read-only map of current role/auth/permission system before implementing F035 (#67).  
**Depends on:** F034 ownership (in progress / PR #76) — portfolio isolation for `vendedor`.

---

## Current state summary

Today the system has **role labels**, not a **permission matrix**.

| Layer | What exists | What is missing |
|-------|-------------|-----------------|
| DB `users.role` | CHECK: `admin`, `user`, `vendedor`, `disenador`, `carpintero` | Product roles `gerente_ventas`, `ingeniero`, `produccion` |
| JWT | Carries `role`; middleware reloads live role/active from DB | Role-based allow/deny beyond admin |
| API | Auth on almost everything; **AdminMiddleware** only on `/api/admin/*`; ownership filter for `vendedor` on customers/projects | Catalog/module CRUD, delete/reopen, exports, calculate ownership |
| UI | Admin-only «Usuarios» nav; owner picker for assigners | Nav/actions/home by product role |
| Domain helpers | Ownership (sees-all / can-assign) | Generic RBAC helpers (`canMutateCatalog`, `canDeleteProject`, …) |
| PRD | §4.2 secondary user is thin; feature_list cites §6.6.x | **`docs/prd.md` has no §6.6** — matrix lives in issues + feature_list |

**Practical security today:** any *approved* authenticated user can full-CRUD catalogs, modules, categories, option groups, customers, and projects (subject only to F034 owner isolation for `vendedor` on customer/project rows). Guest mode uses local workspace with no roles.

---

## 1. Roles today

### 1.1 Go types

`/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/types.go:16-34`

```go
type UserRole string
const (
  RoleAdmin      UserRole = "admin"
  RoleUser       UserRole = "user"
  RoleVendedor   UserRole = "vendedor"
  RoleDisenador  UserRole = "disenador"
  RoleCarpintero UserRole = "carpintero"
)
func IsValidUserRole(role UserRole) bool { /* five values above */ }
```

### 1.2 TS types

`/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/types.ts:61-67`

```ts
export type UserRole =
  | 'admin'
  | 'user'
  | 'vendedor'
  | 'disenador'
  | 'carpintero';
```

Session stores role as plain `string` (`apps/web/src/session.ts` AuthUser).

### 1.3 DB schema / migrations

| Migration | Role impact |
|-----------|-------------|
| `backend-go/db/migration/000001_init_schema.up.sql:5-14` | `role VARCHAR(50) NOT NULL DEFAULT 'vendedor' CHECK (role IN ('admin','vendedor','disenador','carpintero'))` |
| `backend-go/db/migration/000003_admin_approval.up.sql:1-4` | Drops/re-adds CHECK: adds **`user`** |
| `backend-go/db/migration/000009_owner_user_id.up.sql` | Ownership columns; backfill uses `role = 'admin'` — **no role enum change** |

No migration yet for product-role rename.

### 1.4 Seed / defaults

| Path | Behavior |
|------|----------|
| Register | Always `RoleUser` + `active=false` — `handlers.go:121-126` (no role field on request) |
| Admin CLI | `cmd/admin create` → `RoleAdmin` + `active=true` — `cmd/admin/main.go:105-111` |
| Server boot | **No** auto admin seed (`cmd/server/main.go` notes seed removed) |
| Default column | Historical DB default `'vendedor'` in 000001 (register overrides with `user`) |

### 1.5 Role migrations already done

Only F026: add `user` to CHECK (000003). No rename of `disenador`/`carpintero`.

---

## 2. Auth middleware

### 2.1 JWT carries role

`backend-go/internal/auth/auth.go:38-42, 80-98`

- Claims: `user_id`, `email`, `role`
- TTL: 15 minutes (`AccessTokenTTL`)
- `GenerateToken` embeds role at mint time

### 2.2 Auth middleware (live role)

`backend-go/internal/api/middleware.go:56-96`

1. Bearer JWT validate  
2. `GetUserByID` — reject if missing/inactive  
3. **Overwrite** `claims.Role` and `claims.Email` from DB (demotion immediate)  
4. Put `*auth.Claims` in context (`UserContextKey`)

### 2.3 Admin-only

`middleware.go:99-111` — `AdminMiddleware` = Auth + `claims.Role == domain.RoleAdmin` → else **403** `"admin access required"`.

Wired only in `routes.go:83-88`:

- `GET /api/admin/users`
- `PUT /api/admin/users/{id}/approve`
- `PUT /api/admin/users/{id}/role`
- `DELETE /api/admin/users/{id}`

### 2.4 ownership.go (API)

`backend-go/internal/api/ownership.go`

- `claimsFromRequest` / `actorRole`
- `filterCustomersByOwner` / `filterProjectsByOwner` — if not `RoleSeesAllOwners`, keep `owner_user_id == actorID`

Domain logic: `backend-go/internal/domain/ownership.go` (parity TS: `packages/domain/src/ownership.ts`)

| Helper | Current rule | F035 note in comments |
|--------|--------------|------------------------|
| `RoleSeesAllOwners` | everything **except** `vendedor` | Gerente stays global viewer |
| `RoleCanAssignOwner` | **only** `admin` | Must add `gerente_ventas` |
| `ResolveOwnerOnCreate/Update` | assigners may pick; others forced/self | Same |
| `CanAccessOwnedResource` | all-owners OR owner match | Same |

### 2.5 Permission helpers (generic)

**None.** No `RequireRole`, no action matrix, no `CanMutateCatalog`. Only ownership + admin middleware.

---

## 3. API enforcement gaps

### 3.1 Route map (auth level)

From `backend-go/internal/api/routes.go`:

| Area | Middleware | Role checks inside handler |
|------|------------|----------------------------|
| `POST /api/auth/register`, `login` | Rate limit only (public) | N/A |
| `POST /api/auth/refresh` | Auth | Live user reload |
| Customers CRUD | Auth | Ownership filter/access (F034) |
| Projects CRUD | Auth | Ownership filter/access (F034) |
| `POST /api/projects/{id}/calculate` | Auth | **No ownership check** (gap) |
| Materials / edges / hardware CRUD | Auth | **None** |
| Option groups CRUD | Auth | **None** |
| Categories CRUD | Auth | **None** |
| Modules CRUD | Auth | **None** |
| Admin users | **Admin** | Role validate on PUT role via `IsValidUserRole` |

### 3.2 Handler detail

**Customers / projects** (`handlers.go` ~231-552):  
List filters by owner for vendedor; get/put/delete use `CanAccessOwnedResource` → **404** (not 403) when out of portfolio. Create/update resolve `owner_user_id` via domain helpers.

**Calculate** (`handlers.go:555+`): loads project by id, computes breakdown — **no claims / ownership**. Any auth user who knows UUID can calculate any project.

**Catalogs / modules / categories**: pure CRUD for any auth user (example modules `handlers.go:840-917`).

**Admin role change** (`handlers.go:1046-1075`): validates body with `IsValidUserRole` only.

**Exports:** no Go endpoints. Optimizer / hardware / commercial quote are **client-side** (`apps/web` + `packages/excel`). RBAC for export is UI + whatever data the API already returned.

### 3.3 Gap table (F035 targets)

| Resource / action | Any auth today | Intended product control (from F035+siblings) |
|-------------------|----------------|-----------------------------------------------|
| Catalog ABM (materials, edges, hardware, option groups) | Yes | Engineer/admin (not vendedor/producción) |
| Modules ABM | Yes | Engineer/admin |
| Categories ABM | Yes | Engineer/admin (likely same as modules) |
| Customers CRM | Yes (+ owner scope) | Sales roles; not producción |
| Projects CRUD | Yes (+ owner scope) | Sales; producción read/export/mark only |
| Project delete | Any owner-accessible | Gerente/admin only (F036) |
| Project reopen | N/A (no status yet) | Gerente/admin (F036) |
| Calculate | Any auth, **no owner filter** | Same portfolio rules as project get |
| Admin users | Admin only | Admin only |
| Production export | Client, any who can open project | Ingeniero/producción/admin; not vendedor (F041) |
| Cost fields | Full DTOs to all | Hide from vendedor (F039 — after/with RBAC) |

---

## 4. UI by role

### 4.1 UsersScreen role assignment

`packages/ui/src/users/UsersScreen.tsx:35`

```ts
const ROLES = ['user', 'admin', 'vendedor', 'disenador', 'carpintero'] as const;
```

- Admin-only screen (comment + shell gate).  
- Active users: `<select>` → `PUT .../role`.  
- Pending: approve / reject only.  
- Tests assert legacy role strings (`UsersScreen.test.tsx:17-18`).

### 4.2 AppShell nav

`packages/ui/src/shell/AppShell.tsx`

- Full TRABAJO + CONFIG always for everyone.  
- `showAdminUsers` appends **Usuarios** under CONFIG (`resolveNavSections`).  
- `roleLabel` map: admin/user/vendedor/disenador/carpintero (`:89-97`).  
- **No** role-based hide of materials/modules/customers/etc.

### 4.3 App.tsx

`apps/web/src/App.tsx`

- `showAdminUsers = session === 'auth' && isAdminRole(authUser?.role)` (`:464`)  
- `canAssignOwner = roleCanAssignOwner(authUser?.role)` (`:465`)  
- Loads assignable owners from `/admin/users` when assigner (admin-only API).  
- Nav deep-link to `users` redirected if not admin (`:575-578`, `:1615`).  
- Passes `canAssignOwner` / owner lists into customers & projects screens.  
- Guest session: full local workspace, no role.

### 4.4 Login / register

| Piece | Role handling |
|-------|----------------|
| `LoginScreen` | No role; parent stores JWT + user from API |
| `loginRequest` (`session.ts:184-253`) | Requires `user.role` string; no whitelist |
| `isAdminRole` (`session.ts:158-160`) | `role === 'admin'` only |
| `registerRequest` | Name/email/password only → backend forces `user` pending |
| `RegisterScreen` | No role picker |

---

## 5. PRD / docs

### 5.1 What the repo actually has

| Doc | Content related to multi-user roles |
|-----|-------------------------------------|
| `docs/prd.md` | §4.2 “Usuario secundario (futuro)” = cut-list helper, **out of MVP permissions**. **No §6.6.** Etapa 2 auth mentioned in §6.5 (F026). |
| `docs/architecture.md` | Package boundaries; no RBAC matrix |
| `docs/technical_design.md` §6.3 | JWT + LoginScreen + Bearer on API — no role matrix |
| `docs/design.md` | «Usuarios» = admin only; §6.6 is **Login** UI (not product RBAC) |
| `feature_list.json` F034–F041 | Cites `docs/prd.md §6.6.2` … `§6.6.7` — **stale refs** |
| GitHub #67 | Authoritative F035 brief (see below) |

### 5.2 Intended product roles (F035)

From `feature_list.json` F035 + issue [#67](https://github.com/tiagofur/muebleria/issues/67):

| Product role | Code | Notes |
|--------------|------|--------|
| Admin | `admin` | Users admin; full power |
| Gerente de ventas | `gerente_ventas` | All portfolios; assign owner; reopen/delete (F036); sales dashboard (F037) |
| Vendedor | `vendedor` | Own portfolio only; no catalog ABM; no production export; costs hidden (F039) |
| Ingeniero | `ingeniero` | Catalogs + modules; production exports (F041) |
| Producción | `produccion` | Queue: accepted/produced, export cut/hardware, mark produced; no CRM/catalog ABM (F038) |
| Sin puesto | `user` | Approved account **without** job until admin assigns |

### 5.3 Role rename map (legacy → product)

| Legacy (DB / API / UI today) | Product (F035) | Action |
|------------------------------|----------------|--------|
| `admin` | `admin` | Keep |
| `vendedor` | `vendedor` | Keep |
| `disenador` | `ingeniero` | Migrate data + code |
| `carpintero` | `produccion` | Migrate data + code |
| `user` | `user` | Keep as “no job title” |
| — | `gerente_ventas` | New |

### 5.4 Intended matrix (reconstructed — **PRD §6.6.3 missing in file**)

Rebuilt from F034–F041 + #67 acceptance tests. Confirm with product when writing PRD §6.6.

| Capability | admin | gerente_ventas | vendedor | ingeniero | produccion | user (no job) |
|------------|:-----:|:--------------:|:--------:|:---------:|:----------:|:-------------:|
| Admin users approve/role | ✓ | — | — | — | — | — |
| See all customers/projects | ✓ | ✓ | own only | ✓* | limited* | ? |
| Assign/reassign owner | ✓ | ✓ | — | — | — | — |
| CRM customers CRUD | ✓ | ✓ | own | ? | — | — |
| Projects quote workflow | ✓ | ✓ | own | read/export? | accepted+ | — |
| Delete / reopen project | ✓ | ✓ | — | — | — | — |
| Catalog + modules ABM | ✓ | ? | — | ✓ | — | — |
| Export Optimizer / herrajes | ✓ | ? | — | ✓ | ✓ | — |
| Mark produced | ✓ | ? | — | ? | ✓ | — |
| See unit costs / margin | ✓ | ✓ | — (F039) | ✓ | ? | — |
| Settings / global defaults | ✓ | ? | — | ? | — | — |

\*Ingeniero/producción visibility of full CRM is product-defined; F038 says producción home is production queue only.  
`user` without job: safest default = **read-none / blocked UI** until role assigned (not specified — decide in apply).

**Home by role (later features):**  
gerente → F037 dashboard; producción → F038 queue; vendedor → own metrics only.

---

## 6. Test patterns to copy for RBAC

### 6.1 Handler ownership tests

`backend-go/internal/api/handlers_test.go:340-474`

```go
func withClaims(req *http.Request, userID, role string) *http.Request {
  claims := &auth.Claims{UserID: userID, Role: role, Email: userID + "@test.com"}
  return req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
}
```

Patterns:

- `stubStore` with list/get fixtures  
- Inject claims (skip real JWT for handler unit tests)  
- Assert filtered lists, forced owner on create, 404 for foreign owner, admin reassign  

**Copy for RBAC:** same `withClaims` + expect **403** on catalog POST as vendedor/producción; 403 on delete project as vendedor; keep ownership tests for portfolio.

### 6.2 Middleware tests

`middleware_test.go:184-255` — live role from DB demotes admin JWT; non-admin gets 403 on AdminMiddleware.

### 6.3 Domain ownership

- Go: `backend-go/internal/domain/ownership_test.go`  
- TS: `packages/domain/src/ownership.test.ts`  

Extend with `gerente_ventas` can assign + sees all; `ingeniero`/`produccion` sees-all for projects (if product says so) or not.

### 6.4 UI contract tests

- Source-string tests for roles list and admin endpoints (`UsersScreen.test.tsx`)  
- `session.test.ts` `isAdminRole`  
- Shell `resolveNavSections` for admin users only  

F035 should add helpers like `canAccessNav('materials', role)` with unit tests.

---

## Proposed enforcement points (checklist)

### API (Go)

- [ ] Migration `000010_product_roles.up.sql`: expand CHECK; `UPDATE disenador→ingeniero`, `carpintero→produccion`  
- [ ] `UserRole` constants + `IsValidUserRole` (+ optional `IsAssignableJobRole`)  
- [ ] Domain package `rbac.go` (or extend ownership): matrix helpers  
  - `RoleCanAssignOwner` → admin **or** gerente_ventas  
  - `RoleSeesAllOwners` → not vendedor (confirm ingeniero/producción)  
  - `RoleCanMutateCatalog`, `RoleCanMutateModules`, `RoleCanManageCustomers`, `RoleCanMutateProjects`, `RoleCanDeleteProject`, `RoleCanManageUsers`  
- [ ] `RequireRole` / `forbid` helper → **403** JSON for mutations (lists may 404 for ownership)  
- [ ] Catalog handlers (materials, edges, hardware, option-groups, categories): mutate only engineer/admin (gerente? TBD)  
- [ ] Modules mutate: engineer/admin  
- [ ] Customers/projects: sales roles + ownership; block producción CRM writes  
- [ ] `HandleProjectCalculate`: apply same access as project GET  
- [ ] Project DELETE: gerente/admin only (align F036; can stub now)  
- [ ] Admin users endpoints stay admin-only; role PUT accepts 5 product roles + `user`  
- [ ] Tests: matrix minimum from #67  

### UI (TS)

- [ ] `UserRole` type + labels (español taller)  
- [ ] `packages/domain` ownership/RBAC parity with Go  
- [ ] `UsersScreen` ROLES = product set  
- [ ] `AppShell`: `resolveNavSections(role)` — hide catalog/CRM/users by role  
- [ ] `App.tsx`: gate routes + deep-links; clear Spanish message  
- [ ] `isAdminRole` keep; add `canAssignOwner` already domain; add nav/action helpers  
- [ ] Hide create/edit/delete buttons on catalogs/projects when forbidden  
- [ ] Export buttons: hide for vendedor (F041 can complete)  
- [ ] Guest mode: unchanged local full access (document as non-RBAC)  

### Docs

- [ ] Write real `docs/prd.md` §6.6 (roles + matrix) — currently **missing**  
- [ ] Fix feature_list references once PRD section exists  
- [ ] `docs/design.md` nav table by role  
- [ ] Migration note in progress/impl  

---

## Key files to touch

| File | Why |
|------|-----|
| `backend-go/db/migration/000010_*.sql` (new) | Role CHECK + data rename |
| `backend-go/internal/domain/types.go` | Role constants / validation |
| `backend-go/internal/domain/ownership.go` | Gerente assign/see-all |
| `backend-go/internal/domain/rbac.go` (new) | Action matrix |
| `backend-go/internal/api/middleware.go` | Optional role middleware helpers |
| `backend-go/internal/api/handlers.go` | Enforce on catalog/project/calculate |
| `backend-go/internal/api/ownership.go` | Shared forbid helpers |
| `backend-go/internal/api/handlers_test.go` | RBAC matrix tests |
| `backend-go/internal/domain/ownership_test.go` | Gerente cases |
| `packages/domain/src/types.ts` | UserRole union |
| `packages/domain/src/ownership.ts` (+ new rbac.ts) | Parity |
| `packages/ui/src/users/UsersScreen.tsx` | Role select |
| `packages/ui/src/shell/AppShell.tsx` | Nav by role + labels |
| `apps/web/src/App.tsx` | Gates + owner assign for gerente |
| `apps/web/src/session.ts` | Role helpers if needed |
| `docs/prd.md` | Add §6.6 |
| `feature_list.json` | F035 status when done |

---

## Risks / gotchas

1. **PRD §6.6 does not exist** — implementers must not invent a full matrix without product confirmation; use #67 + F036–F041 as bounds; add PRD section in same effort.  
2. **F034 incomplete coupling** — `RoleCanAssignOwner` is admin-only “until F035”; shipping F035 without extending assigner to `gerente_ventas` breaks F034 acceptance (“Gerente puede asignar”).  
3. **404 vs 403** — ownership uses 404 to avoid leaking foreign IDs; RBAC denials should be **403** per F035 acceptance. Don’t mix blindly.  
4. **Calculate endpoint** — ownership hole today; easy to leave open.  
5. **Client-side exports** — API can hide data, but UI must hide actions; vendedor with project payload can still call excel packages in browser unless cost/export redaction (F039/F041) is done.  
6. **JWT role string** — refresh reloads role; long-lived client state in `localStorage` user object may show stale role label until re-login/refresh — refresh path already returns live user.  
7. **DB CHECK constraint** — app-level `IsValidUserRole` is not enough; migration must update CHECK or inserts fail.  
8. **`user` default** — register still creates `user`; UI must not treat `user` as vendedor (DB default historically was vendedor).  
9. **Assignable owners list** — uses `/admin/users` (admin-only). Gerente needs either admin list access (bad) or a narrower `GET /api/users/assignable` for active sales users.  
10. **Guest mode** — full power locally; document out of multi-user RBAC.  
11. **Feature_list F034 still says gerente can assign** while code only allows admin — F035 must close that gap.  
12. **Parallel features** — F036 produced/reopen, F038 production queue, F039 cost hide, F041 engineer export depend on these role names; keep codes stable (`gerente_ventas`, `ingeniero`, `produccion`).  
13. **Tests listing legacy roles** — `ownership_test.go` loops `RoleDisenador`, `RoleCarpintero`; update when renaming.  
14. **No export API** — production RBAC tests may be domain/UI until export endpoints exist.

---

## Suggested implementation order

1. Migration + type rename (Go + TS) + `IsValidUserRole`  
2. Domain RBAC helpers + ownership gerente  
3. API enforce 403 on catalog/module mutations + calculate ownership  
4. Admin UsersScreen five roles  
5. UI nav/action gates  
6. Minimal matrix tests  
7. PRD §6.6 write-up  
8. Leave F036–F041 hooks (delete/reopen/export/cost) as helpers even if full UX is later  

---

## Sources (absolute paths)

- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/types.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/domain/ownership.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/middleware.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/routes.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/ownership.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/handlers.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/api/handlers_test.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/auth/auth.go`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/db/migration/000001_init_schema.up.sql`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/db/migration/000003_admin_approval.up.sql`
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/db/migration/000009_owner_user_id.up.sql`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/types.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/ownership.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/users/UsersScreen.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/shell/AppShell.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/apps/web/src/App.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/apps/web/src/session.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/feature_list.json` (F034–F041)
- `/Users/tiagofur/dev/carpinteria/muebles/docs/prd.md` (no §6.6)
- https://github.com/tiagofur/muebleria/issues/67
