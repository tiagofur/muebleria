# Handoff F001 — scaffold_monorepo

**Status:** self-verified, awaiting reviewer  
**Feature:** F001 — Scaffold monorepo TypeScript  
**Agent:** implementer  
**Date:** 2026-07-15

## What was created

Root monorepo config:

| File | Role |
|------|------|
| `package.json` | Root workspace scripts (`build`, `test`, `typecheck`); `pnpm.onlyBuiltDependencies: [esbuild]` |
| `pnpm-workspace.yaml` | `packages/*`, `apps/*` |
| `tsconfig.base.json` | `strict: true`, ESM, path aliases `@muebles/*` |
| `pnpm-lock.yaml` | Lockfile after successful install |
| `.gitignore` | node_modules, dist, caches, etc. |

Packages (`@muebles/*`):

| Package | Path | Notes |
|---------|------|--------|
| `@muebles/domain` | `packages/domain` | Pure TS; no runtime deps; vitest smoke test |
| `@muebles/ui` | `packages/ui` | React placeholder component; depends on domain |
| `@muebles/excel` | `packages/excel` | `exceljs` declared; **no export logic** |
| `@muebles/storage` | `packages/storage` | Structure only; depends on domain; Node types |

Apps:

| App | Path | Notes |
|-----|------|--------|
| `@muebles/web` | `apps/web` | Vite + React thin shell; imports domain + ui |
| `@muebles/desktop` | `apps/desktop` | Electron-ready shell stub (no Electron runtime yet); wires domain + storage names |

Each workspace package has: `package.json`, `tsconfig.json`, `src/index.ts` (or app entry), smoke `*.test.ts`, `vitest.config.ts` where applicable.

## Acceptance mapping

1. **`pnpm-workspace.yaml` with correct workspaces** — `packages/*` + `apps/*` per technical_design §3.1.
2. **`tsconfig.base.json` with `strict: true` and package paths** — present; paths for `@muebles/domain|ui|excel|storage`.
3. **Each package `package.json` named `@muebles/<pkg>`** — domain, ui, excel, storage, web, desktop.
4. **`pnpm install` without errors** — green via `./init.sh` and direct `pnpm install`.
5. **`pnpm build` / `tsc --noEmit` without config errors** — all packages + apps green; web also runs `vite build`.

## Commands run and results

```text
pnpm install          # OK (after approving esbuild build scripts)
pnpm build            # OK — domain/ui/excel/storage/desktop tsc; web tsc+vite
pnpm test             # OK — 7 tests across 6 workspaces
pnpm typecheck        # OK
./init.sh             # OK — [OK] Entorno listo. Puedes empezar a trabajar.
```

## Out of scope (intentionally NOT done)

- Domain types/engine (F002/F003)
- Excel Optimizer export logic (F004)
- Storage atomic JSON implementation (F005)
- Real UI screens (F006+)
- Full Electron main/preload/IPC (later features)

## Residual risks / notes for reviewer

1. **pnpm build scripts (esbuild):** pnpm 11 ignores dependency postinstall by default. Root `package.json` sets `pnpm.onlyBuiltDependencies: ["esbuild"]`. Fresh clones may need `pnpm approve-builds esbuild` once if install warns/fails before the allowlist is applied.
2. **Desktop is a stub:** no `electron` dependency yet — only TypeScript shell identity + workspace wiring. Acceptable for F001; Electron wiring can land when desktop UI is needed.
3. **Source exports:** packages export `./src/index.ts` (dev monorepo style). Fine for scaffold; later may switch to emitted `dist` + project references if needed.
4. **`apps/web/dist`:** produced by `vite build`; covered by `.gitignore`.
5. **Feature status:** left as `in_progress` — implementer does not mark `done`.

## Suggested reviewer checks

- [ ] Workspace layout matches architecture.md package boundaries
- [ ] No domain/business logic leaked into scaffold
- [ ] `./init.sh` green
- [ ] Names are `@muebles/*` for all six workspaces
