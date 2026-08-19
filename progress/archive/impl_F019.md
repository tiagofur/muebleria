# Handoff — F019 ui_toast_system

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F019 — UI toast / notification system

## Summary

Added shared toast system in `@muebles/ui` (`packages/ui/src/common/`): `ToastProvider`, `useToast().toast({ type, message })`, stacked top-right viewport (max 3, oldest exits), 4s auto-dismiss with progress bar, enter/exit motion, types `success | info | warning | error` with semantic tokens. Wired `ToastProvider` at `apps/web` App root and fire toasts on create/update/deactivate/reactivate/duplicate/export. Export validation errors remain inline (`ExportIssueList`), not toasts.

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `useToast().toast({ type, message })` top-right | `ToastProvider` portal `.ui-toast-viewport` `top/right: var(--space-4)`; RTL test “renders in top-right viewport” |
| 2 | Auto-dismiss 4s + progress bar | `TOAST_DURATION_MS = 4000`; `.ui-toast__progress` + keyframes; test advances timers |
| 3 | Max 3 simultaneous (oldest exits) | `TOAST_MAX = 3`; burst-4 test drops oldest “One” |
| 4 | Types success/info/warning/error + token colors | CSS `--success-*`, `--info-*`, `--warning-*`, `--danger-*` on type classes; source + CSS tests |
| 5 | Enter/exit animation | phases `enter`/`visible`/`exit`; CSS translateX+opacity; `prefers-reduced-motion` |
| 6 | Create material → toast created | App `createMaterial` → `✓ "${code}" creado` (design.md §4.4; acceptance “Creado correctamente” or similar) |
| 7 | Export Optimizer success toast; validation inline | success toast with `result.fileName`; failures only `setExportErrors` |

## API

```ts
type ToastType = 'success' | 'info' | 'warning' | 'error';
type ToastInput = { type: ToastType; message: string };

function ToastProvider({ children }: { children: ReactNode }): ReactNode;
function useToast(): {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
};

const TOAST_DURATION_MS = 4000;
const TOAST_EXIT_MS = 250;
const TOAST_MAX = 3;
```

## Message map (design.md §4.4)

| Action | Type | Message |
|--------|------|---------|
| Create (material/edge/hardware/group/module/project) | success | `✓ "{code\|name}" creado` |
| Update | success | `✓ Cambios guardados` |
| Deactivate / reactivate | info | `↓ "{name}" desactivado` / `↑ "{name}" reactivado` |
| Duplicate module | success | `✓ Duplicado como {newCode}` |
| Export Optimizer / hardware list OK | success | `✓ {fileName} descargado` |
| Export validation fail | — | inline `exportErrors` only |

## Files touched

### New
- `packages/ui/src/common/Toast.tsx` — provider, hook, viewport, cards
- `packages/ui/src/common/toast.css` — tokens-only styles
- `packages/ui/src/common/Toast.test.tsx` — 9 RTL/jsdom + CSS/source guards
- `progress/impl_F019.md` — this handoff

### Modified
- `packages/ui/src/common/index.ts` — export toast surface
- `packages/ui/src/index.ts` — re-export toast API
- `packages/ui/src/index.test.ts` — F019 export surface
- `apps/web/src/App.tsx` — `ToastProvider` root + toast calls on mutations/export
- `apps/web/src/designSystemShell.test.ts` — App wiring guards for F019
- `feature_list.json` — F019 → `in_progress`
- `progress/current.md` — session state

## Verification run

```text
pnpm --filter @muebles/ui typecheck  → ok
pnpm --filter @muebles/web typecheck → ok
pnpm --filter @muebles/ui test       → 97 passed
pnpm test                            → all packages green
  domain 60 · excel 14 · storage 17 · ui 97 · web 37 · desktop 7
```

## Notes for reviewer

- Testing: `@testing-library/react` + `user-event` + fake timers (`@vitest-environment jsdom` on Toast tests).
- When a 4th toast is pushed, oldest enters exit phase immediately (async via `setTimeout(0)`), then unmounts after `TOAST_EXIT_MS`.
- Progress bar uses CSS animation duration `TOAST_DURATION_MS`; hidden under `prefers-reduced-motion: reduce`.
- z-index 200 (above modal 100) so toasts remain visible over dialogs.
- UI strings Spanish to match product copy; identifiers English.
- No catalog list/modal refactor (F020).

## Out of scope / not done by implementer

- Do **not** mark F019 `done` until reviewer approves.
- F020 catalog modal migration not started.
