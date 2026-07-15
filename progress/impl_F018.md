# Handoff — F018 ui_modal_component

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F018 — UI reusable Modal component

## Summary

Added shared `Modal` in `@muebles/ui` (`packages/ui/src/common/`) per `docs/design.md` §4.3: overlay (`--surface-overlay`), scale+opacity open/close, sticky header (title + Lucide `X`), scrollable body, optional sticky footer, sizes sm/md/lg, Esc + overlay close, focus trap, body scroll lock, `role=dialog` / `aria-modal` / `aria-labelledby`. Catalogs **not** migrated (F020).

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Open animation scale+opacity; close animation | `modal.css` `.is-open` / `.is-closing` + `scale`/`opacity` + `--duration-slow` under `prefers-reduced-motion: no-preference`; unmount after `MODAL_CLOSE_MS` (350) |
| 2 | Esc closes | document `keydown` Escape → `onClose`; test “closes on Escape” |
| 3 | Overlay click closes | `.ui-modal__overlay` `onClick={onClose}`; test “closes on overlay click” |
| 4 | Focus trap Tab / Shift+Tab | `onPanelKeyDown` wraps first↔last; RTL tab cycles stay inside dialog |
| 5 | Document body scroll locked while open | `document.body.style.overflow = 'hidden'` while mounted; restored on unmount |
| 6 | Sizes sm 480 / md 680 / lg 900 | `.ui-modal--sm/md/lg` max-width; tests per size |
| 7 | role=dialog aria-modal aria-labelledby | dialog attrs + title `id` from `useId`; a11y test |

## Props

```ts
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg'; // default 'md'
  children: ReactNode;
  footer?: ReactNode;
};
```

## Files touched

### New
- `packages/ui/src/common/Modal.tsx` — modal component (portal to `document.body`)
- `packages/ui/src/common/modal.css` — tokens-only styles
- `packages/ui/src/common/index.ts` — barrel
- `packages/ui/src/common/Modal.test.tsx` — 18 RTL/jsdom + CSS/source guards
- `progress/impl_F018.md` — this handoff

### Modified
- `packages/ui/src/index.ts` — export `Modal`, types
- `packages/ui/src/index.test.ts` — export surface F018
- `packages/ui/vitest.config.ts` — include `*.test.tsx`, esbuild jsx automatic
- `packages/ui/package.json` — `react-dom` dep/peer; RTL + jsdom devDeps
- `feature_list.json` — F018 → `in_progress`
- `progress/current.md` — session state

## Verification run

```text
pnpm --filter @muebles/ui typecheck  → ok
pnpm --filter @muebles/web typecheck → ok
pnpm --filter @muebles/ui test       → 87 passed (was 68; +18 Modal +1 export)
pnpm test                            → all packages green
  domain 60 · excel 14 · storage 17 · ui 87 · web 35 · desktop 7
```

## Notes for reviewer

- Testing: `@testing-library/react` + `user-event` + `jsdom` (`@vitest-environment jsdom` on Modal tests only; other ui tests stay node).
- Close keeps the portal mounted with `.is-closing` for 350ms (`--duration-slow`) then unmounts.
- Overlay is a non-focusable `div` (`aria-hidden`) so it does not enter the focus trap; close button + body controls remain tabbable.
- UI labels for close control: Spanish `"Cerrar"` (matches product Spanish elsewhere); code identifiers English.
- No catalog/screen refactor (F020).

## Out of scope / not done by implementer

- Do **not** mark F018 `done` until reviewer approves.
- Toast system (F019) and catalog modal migration (F020) not started.
