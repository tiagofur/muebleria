# Handoff — F007 ui_option_groups

**Status:** implemented, tests green, **not marked done** (awaiting reviewer)  
**Date:** 2026-07-15

## Acceptance map

| Criterion | Evidence |
|-----------|----------|
| OPT-01 CRUD de grupos | `OptionGroupsScreen` — create/update/delete; fields code, name, kind, required, optionIds. Wired in `apps/web` App state. |
| OPT-02 Picker filtrado por kind | `membersForKind` + multi-select checkboxes; board→materials, hardware→hardware, edge→edges (active only). Tests in `optionGroupHelpers.test.ts` + `App.test.ts`. |
| OPT-03 Grupos semilla | Seed already has INTERIOR/FRENTE/BISAGRA/CORREDERA (+ FONDO). Asserted via `SEED_OPTION_GROUP_CODES` + App test. |
| OPT-05 Preview bloqueado | `canShowPricePreview` + `PricePreviewGate`. Demo in App tab uses domain `calcProjectBreakdown` **only in shell**. |

## Files touched

### New
- `packages/ui/src/optionGroups/optionGroupHelpers.ts`
- `packages/ui/src/optionGroups/optionGroupHelpers.test.ts`
- `packages/ui/src/optionGroups/OptionGroupsScreen.tsx`
- `packages/ui/src/optionGroups/PricePreviewGate.tsx`
- `packages/ui/src/optionGroups/optionGroups.css`
- `packages/ui/src/optionGroups/index.ts`
- `progress/impl_F007.md`

### Updated
- `packages/ui/src/index.ts` — re-exports F007 surface
- `packages/ui/src/index.test.ts`
- `apps/web/src/App.tsx` — tab «Grupos de opciones» + price preview demo
- `apps/web/src/App.test.ts` — OPT-02/03/05 seed wiring tests
- `feature_list.json` — F007 `in_progress`
- `progress/current.md`

## Architecture notes

- UI package: **no cost formulas** — only choice completeness gate.
- Shell (`apps/web`) may call `calcProjectBreakdown` for the OPT-05 demo.
- Option groups have no soft-delete field → hard delete via `onDelete`.
- Changing kind re-filters `optionIds` to members of the new kind.

## Verify

```bash
./init.sh
# or
pnpm test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web typecheck
```

## Web run command

```bash
pnpm --filter @muebles/web dev
```

Open the app → tab **Grupos de opciones**:
1. List/edit seed groups (Interiores, Frentes, Bisagras, Correderas…).
2. Member checkboxes only show catalog items of the selected kind.
3. Demo below: pick MOD-GAB-01, leave choices empty → **preview bloqueado**; fill INTERIOR/FRENTE/BISAGRA → sale price from domain.

## Out of scope (intentionally)

- Full module editor (F008)
- Full quotation CRUD (F009)
- OPT-04 quotation picker (covered later with projects UI)

## Reviewer checklist hints

- [ ] Controlled props: parent owns `optionGroups`
- [ ] Spanish labels / English identifiers
- [ ] UI does not implement m² / margin / sale formulas
- [ ] Do not mark `done` until review APPROVED
