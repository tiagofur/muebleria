# Slice C — Shell hygiene (OPT-05 demo removal)

> **Date:** 2026-07-15  
> **Scope:** Remove developer leftover `ModulePricePreviewDemo` from production Grupos (optionGroups) surface.  
> **Non-goals:** F023 dashboard, Login, feature_list status, deleting `PricePreviewGate` / `canShowPricePreview` (still used by modules/projects).

---

## What changed

### App shell (`apps/web/src/App.tsx`)
- `navId === 'optionGroups'` mounts **only** `OptionGroupsScreen` (no fragment, no demo).
- Deleted entire `ModulePricePreviewDemo` component (~L185–343).
- Dropped demo-only imports: `PricePreviewGate`, `membersForKind`.
- **Kept** `canShowPricePreview` — still used by `computeModuleCostPreview` (module editor preview).

### CSS (`packages/ui/src/optionGroups/optionGroups.css`)
- Removed dead `.price-preview-demo*` rules (title, hint, choices, price).
- **Kept** `.price-preview-gate*` styles — still used by `PricePreviewGate` in modules/projects.

### Tests
- `App.test.ts` OPT-05 unit tests on `canShowPricePreview` + domain price **stay** (gate wiring, not demo UI).
- `designSystemShell.test.ts`: new assertion that App surface has **no** `ModulePricePreviewDemo` / `price-preview-demo` / “Demo preview de precio”.

---

## Files touched

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Remove demo component, mount, imports |
| `apps/web/src/designSystemShell.test.ts` | Assert demo not on App surface |
| `packages/ui/src/optionGroups/optionGroups.css` | Remove demo-only CSS |

---

## Verification

```bash
pnpm --filter @muebles/web test
pnpm --filter @muebles/web typecheck
pnpm --filter @muebles/ui test
pnpm --filter @muebles/ui typecheck
```

**Static guarantees (source reviewed):**
- `App.tsx`: no `ModulePricePreviewDemo`, no `price-preview-demo`, no `PricePreviewGate`/`membersForKind` imports.
- `optionGroups` branch is single child `OptionGroupsScreen`.
- `canShowPricePreview` retained for `computeModuleCostPreview`.
- `optionGroups.css`: only `.price-preview-gate*` remains; demo classes gone.
- New `designSystemShell` test fails if demo is reintroduced.
- Existing OPT-05 tests in `App.test.ts` / `optionGroupHelpers.test.ts` unchanged (domain gate, not demo UI).

---

## Next

1. **Slice D** — F023 Dashboard  
2. **Slice E** — Login tokens + gate  
3. **Slice F** — Polish / design.md  
