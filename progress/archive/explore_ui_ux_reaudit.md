# UI/UX re-audit — post F016–F024 growth

> **Date:** 2026-07-15  
> **Scope:** UI-only (`packages/ui`, `apps/web` shell wiring). No Go backend, no formula redesign.  
> **Sources:** `docs/design.md`, `docs/architecture.md` (UI boundaries), `packages/domain/src/types.ts`, `feature_list.json` F016–F024, live code under `packages/ui/src/` + `apps/web/src/App.tsx`, `progress/current.md`, `progress/review_F022.md`.

---

### Executive summary

Phase-4 redesign (F016–F022) largely landed: design tokens + Inter + Lucide, sidebar shell, Modal/Toast primitives, catalogs as table+search+chips+modal SM, modules/projects as cards → detail → modal. F024 also shipped **Customers** and a **LoginScreen** component, and extended **MaterialBoard** with board dimensions/price — but the product shell still has gaps and contract debt.

**Blockers for clean typecheck / honest F022 close:** (1) `calcMaterialCostPerM2` exists in domain engine but is **not re-exported** from `@muebles/domain` while Materials UI imports it; (2) project helpers/tests still treat `Project` as if it had `customerName` while domain only has `customerId`; (3) many UI test fixtures omit required `MaterialBoard` fields (`widthMm`, `lengthMm`, `boardPrice`).

**Process drift:** `feature_list.json` marks **F022 `done`**, but `progress/current.md` + `progress/review_F022.md` still say **CHANGES_REQUESTED** on the client contract. Runtime cards already use `resolveCustomerName(project.customerId, customers)` — partial fix exists; typecheck/tests not fully aligned. **F023 Dashboard** is still a shell `HomePlaceholder`. **LoginScreen** is exported but **not wired** into `App.tsx`. Project meta form is still free-text client, not a customers catalog picker.

`docs/design.md` has **no §6.x screen specs** (F021–F023 references are stale); section 6 is implementation rules only. F023 acceptance + feature description remain the practical dashboard contract.

---

### Inventory table

| Screen/area | Path | Pattern vs design.md | Health | Notes |
|-------------|------|----------------------|--------|-------|
| Design tokens + reset | `packages/ui/src/design-system/tokens.css`, `reset.css`; loaded from `apps/web/src/main.tsx` | §3 OK | OK | Inter in `apps/web/index.html`; tokens HSL/spacing/shadows present |
| AppShell + nav | `packages/ui/src/shell/AppShell.tsx`, `appShell.css` | §4.1 sidebar TRABAJO/CONFIG | OK / minor drift | Extra nav **Clientes** (F024, not in original wireframe). TopBar has title+meta only — no global search/user as sketch. Default route `home` ✓ |
| Toast system | `packages/ui/src/common/Toast.tsx` + shell `ToastProvider` in `App.tsx` | §4.4 | OK | Wired on create/update/deactivate/export |
| Modal | `packages/ui/src/common/Modal.tsx` | §4.3 sm/md/lg | OK | Used by catalogs, modules, projects, customers |
| EmptyState / SearchInput / StatusChips | `packages/ui/src/common/*` | §4.5–4.6 | OK | Shared primitives; option groups skip StatusChips (no active flag) |
| Materials catalog | `packages/ui/src/catalogs/MaterialsCatalog.tsx` | §4.2 table + modal SM + search/chips | **drift** | Pattern OK; board redesign fields (`widthMm`/`lengthMm`/`boardPrice` + live cost) **OK vs domain type**; **imports non-exported** `calcMaterialCostPerM2` |
| Edges catalog | `packages/ui/src/catalogs/EdgesCatalog.tsx` | same as materials | OK | Table + expand + modal SM |
| Hardware catalog | `packages/ui/src/catalogs/HardwareCatalog.tsx` | same | OK | Table + expand + modal SM |
| Option groups | `packages/ui/src/optionGroups/OptionGroupsScreen.tsx` | §4.2 adapted (no active chips) | OK / polish | Search + table + modal SM; **OPT-05 demo** still mounted under same nav in shell |
| Modules (Muebles) | `packages/ui/src/modules/ModulesScreen.tsx` | cards → detail → Modal LG | OK | Estimates from shell `moduleEstimates`; domain-only costs |
| Projects (Cotizaciones) | `packages/ui/src/projects/ProjectsScreen.tsx`, `projectHelpers.ts` | cards → detail → Modal MD | **drift** | UX pattern matches F022 acceptance; client display via `resolveCustomerName`; draft still free-text `customerName`; helpers still read `project.customerName` (not on type); no customer **picker** |
| Customers | `packages/ui/src/customers/CustomersScreen.tsx` | catalog pattern (beyond original design map) | OK | Table + StatusChips + Search + Modal; wired in `App.tsx` under `navId === 'customers'` |
| Login | `packages/ui/src/auth/LoginScreen.tsx` | not in design.md screens | **missing / polish** | Component exists + tests; **not used** by `apps/web/src/App.tsx`. Heavy **inline styles** (hardcoded blues/rgba), not design tokens / co-located CSS |
| Home / Dashboard | `apps/web/src/App.tsx` `HomePlaceholder` only | F023 / feature_list dashboard | **missing** | Opens on `home` but placeholder card only. No `packages/ui/src/dashboard/` |
| Price preview demo | `App.tsx` `ModulePricePreviewDemo` + `optionGroups.css` | leftover dev UX | debt | Still rendered under Grupos nav — confuses product surface |
| Export issue list | `packages/ui/src/projects/ExportIssueList.tsx` | §4.4 inline validation | OK | Issues stay inline, not toasts |
| Shell wiring | `apps/web/src/App.tsx` | architecture: thin shell, domain costs in shell | OK / drift | Toasts, estimates, `findOrCreateCustomer` by free-text name; no auth gate; seed via `createSeedWorkspace()` |

**Navigation (canonical):** `APP_NAV_SECTIONS` in `AppShell.tsx`  
- TRABAJO: Home, Cotizaciones, **Clientes**, Muebles  
- CONFIG: Materiales, Cantos, Herrajes, Grupos  
- Default: `useState<AppNavId>('home')`  
- Auth gate: **none** in web shell  

**F016–F024 status (feature_list vs reality):**

| ID | Title | feature_list | Code/session reality |
|----|-------|--------------|----------------------|
| F016 | Design system | done | done |
| F017 | Sidebar layout | done | done (+ Clientes) |
| F018 | Modal | done | done |
| F019 | Toast | done | done |
| F020 | Catalogs modal list | done | done (+ materials board redesign fields) |
| F021 | Modules cards/detail | done | done |
| F022 | Projects cards/detail | **done** | **Not cleanly closed** — `current.md` CHANGES_REQUESTED; residual type/test contract issues |
| F023 | Dashboard | **pending** | Placeholder only; depends on clean project/customer display + workspace stats |
| F024 | Go backend + auth + customers + boards | done | Backend/out of UI scope; UI pieces partial (Customers OK, Login unwired, project client free-text) |

---

### Contract / typecheck blockers

Verified by reading sources (not only historical tsc output). Residual issues that prevent clean UI/web typecheck:

1. **`calcMaterialCostPerM2` not exported from package entry**  
   - Defined: `packages/domain/src/engine.ts` ~L497–506  
   - Barrel: `packages/domain/src/index.ts` exports engine helpers but **omits** `calcMaterialCostPerM2`  
   - Consumer: `packages/ui/src/catalogs/MaterialsCatalog.tsx` L6, L152–157, L491–494  
   - **Fix (UI-facing):** re-export from `packages/domain/src/index.ts` (display helper already lives in domain — correct boundary).

2. **`Project` has `customerId`, not `customerName` / `clientName`**  
   - Domain: `packages/domain/src/types.ts` L138–153 (`customerId: string`)  
   - Helpers still access missing prop:  
     - `packages/ui/src/projects/projectHelpers.ts` L107 (`project.customerName`)  
     - `packages/ui/src/projects/projectHelpers.ts` L188 (`p.customerName`)  
   - Draft field `customerName` on **ProjectDraft** is fine (UI form DTO); shell maps via `findOrCreateCustomer` in `App.tsx` L349–367, L828–892.  
   - **Runtime cards/detail** already call `resolveCustomerName(project.customerId, customers)` (`ProjectsScreen.tsx` ~L639, L682) — UX path partly fixed since review_F022.

3. **Tests build invalid `Project` / `MaterialBoard` objects**  
   - `packages/ui/src/projects/projectHelpers.test.ts` ~L171–183: fixture uses `customerName: 'Ana'` on `Project` (should be `customerId` + optional customers catalog for display tests).  
   - Same file materials ~L91–118 and `ProjectsScreen.test.tsx` ~L40–70: `MaterialBoard` missing required `widthMm`, `lengthMm`, `boardPrice` (required in `types.ts` L21–34).  
   - `optionGroupHelpers.test.ts` materials similarly incomplete (grep shows `costPerM2` only).  
   - **CustomersScreen.test.tsx** currently matches `Customer` (no `createdAt`) — **no live drift** found; earlier concern not present in current file.

4. **F022 process inconsistency**  
   - `feature_list.json` F022 `status: "done"`  
   - `progress/current.md`: F022 `in_progress` / CHANGES_REQUESTED; typecheck FAIL notes still reference client field  
   - Do **not** treat feature as closed until typecheck green + re-review; do **not** mark done again from this audit.

5. **Seed customers exist** for display resolution  
   - `plantillaDemo.ts` catalog `customers` + project `customerId: IDS.custPlantilla1/2` — with helpers fixed and customers passed, seed cards can show “Cliente Demo” / “Cliente Plantilla”.  
   - UI tests that set `customerId: 'Ana López'` without customers prop only show raw id (acceptable if intentional; better: pass customers array).

---

### UI/UX debt & opportunities (prioritized)

#### P0 — Block typecheck / close F022 honestly

- **P0.1** Export `calcMaterialCostPerM2` from `@muebles/domain` (or move a pure display formatter, but domain already owns the formula — export is correct).  
- **P0.2** Remove all `project.customerName` / `clientName` reads on domain `Project`; rely on `customerId` + `resolveCustomerName` + draft-only `customerName`.  
- **P0.3** Fix UI test fixtures (`Project`, `MaterialBoard`) to match domain contracts.  
- **P0.4** Align session/process: re-review F022 after typecheck green; only then reconcile `feature_list` / `current.md` (orchestrator, not this audit).

#### P1 — Product UX gaps after F024 growth

- **P1.1 Project customer picker**  
  Free-text “Cliente” (`ProjectsScreen.tsx` ~L419–428) + shell `findOrCreateCustomer` works but bypasses the Clientes catalog UX (duplicates, no email/phone context, hard to pick inactive). Prefer select/combobox of active customers + “Nuevo cliente” shortcut (modal or navigate).  
- **P1.2 F023 Dashboard**  
  Acceptance still valid vs code: stats (active projects draft+quoted, monthly quoted total, modules count, active materials), last 5 projects by `updatedAt`, quick actions, default home.  
  design.md **does not define §6.1** — implement from **feature_list F023** + design tokens/patterns (§4–5). Update design.md later if product wants a formal screen section.  
  Dependencies: reliable customer names on project cards (P0), estimates map already in shell.  
- **P1.3 Login polish + wire decision**  
  `LoginScreen` uses inline non-token styles (`#3b82f6`, system-ui, ad-hoc rgba). Extract `login.css` with tokens; Lucide already used.  
  Shell has **no** auth gate — either wire local/API login flow or document guest-only web until storage API is default. Guest path exists on component props (`onGuestAccess`) but unused.  
- **P1.4 Remove or hide OPT-05 ModulePricePreviewDemo** from production Grupos screen (`App.tsx` L1055–1067) — developer leftover; confuses CONFIG area.

#### P2 — Polish / consistency

- **P2.1 Top bar** — design sketch had search + user; shell only title + meta schema line. Optional after F023.  
- **P2.2 Option groups** — no StatusChips (groups have no `active`); OK. Consider kind chips filter if list grows.  
- **P2.3 Catalog list→detail** — F020 uses **row expand**, not full read-only detail page (design §4.2 ideal). Acceptable phase-4 compromise; full detail only on modules/projects.  
- **P2.4 Customers ↔ Projects deep link** — from project detail open customer; from customer list filter related projects.  
- **P2.5 Login / empty states copy** — product Spanish OK; keep Inter/tokens.  
- **P2.6 design.md maintenance** — add short § for Login, Clientes, Dashboard once F023 ships; fix F021–F023 references that point at missing §6.x.  
- **P2.7 Button class naming** — design.md shows `.btn-primary`; code uses BEM `.btn--primary` in `catalogs.css`. Consistent in code; doc drift only.  
- **P2.8 Architecture reminder** — UI must not re-implement board cost if domain helper is available; keep `calcMaterialCostPerM2` in domain (already the case).

---

### Recommended sequence

Ordered slices, each roughly one implementer session / one feature:

1. **Slice A — Typecheck / F022 contract close (P0)**  
   Export `calcMaterialCostPerM2`; scrub `project.customerName`; fix UI fixtures; green `pnpm --filter @muebles/ui typecheck` + web; re-review F022; sync `feature_list` / `progress` only after APPROVED.

2. **Slice B — Project × Customer picker (P1.1)**  
   Replace free-text client with picker of `customers` (active); optional “create customer inline”; keep shell resolve path for safety; tests for display name on seed project.

3. **Slice C — Shell hygiene (P1.4 + small)**  
   Remove `ModulePricePreviewDemo` from default Grupos surface (or gate behind dev flag); ensure Customers nav icon/copy stable.

4. **Slice D — F023 Dashboard (P1.2)**  
   New `packages/ui/src/dashboard/Dashboard.tsx`; replace `HomePlaceholder`; stats + recent projects + quick actions; shell passes workspace-derived props only (no cost formulas in UI); tests for ordering/counts; responsive 2-col stats.

5. **Slice E — Login polish + optional gate (P1.3)**  
   Tokenized CSS for `LoginScreen`; decide wire: guest-default vs real auth against API adapter. Do not block Dashboard on auth if product remains local-seed first.

6. **Slice F — Polish backlog (P2)**  
   design.md screen section update; top-bar user chip; customer↔project navigation; catalog expand→true detail if needed.

---

### Explicit non-goals

- **Go backend / Postgres / JWT implementation** — F024 backend is out of this UI re-audit; only surface wiring notes.  
- **Domain formula changes** — no rework of BOM/margin/export math; only re-export or use existing display helpers (`calcMaterialCostPerM2`).  
- **Excel / Optimizer column changes.**  
- **Electron desktop-specific chrome** unless sharing `@muebles/ui` screens already.  
- **Marking features `done`** or editing `feature_list.json` from this exploration.  
- **Dark mode**, global command palette, multi-tenant theming.  
- **Rewriting all catalogs to full page-detail** unless product prioritizes after Dashboard.

---

### Quick reference — key files

| Concern | Path |
|---------|------|
| Domain Project / MaterialBoard / Customer | `packages/domain/src/types.ts` |
| Board cost helper (unexported) | `packages/domain/src/engine.ts` → fix `index.ts` |
| Shell nav + home + catalogs wiring | `apps/web/src/App.tsx` |
| Nav ids | `packages/ui/src/shell/AppShell.tsx` |
| Project client resolve | `packages/ui/src/projects/projectHelpers.ts` (`resolveCustomerName`) |
| Materials board form | `packages/ui/src/catalogs/MaterialsCatalog.tsx` |
| Customers ABM | `packages/ui/src/customers/CustomersScreen.tsx` |
| Login (unwired) | `packages/ui/src/auth/LoginScreen.tsx` |
| F022 review debt | `progress/review_F022.md`, `progress/current.md` |
| Design source of truth | `docs/design.md` (§3–5 patterns; **no §6 screens**) |

---

*End of re-audit. Implementation should start at Slice A (contract/typecheck), then B/C, then F023.*
