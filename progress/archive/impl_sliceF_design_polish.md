# Impl — Slice F: design.md maintenance + light polish

**Status:** implemented  
**Scope:** residual UI sequence A–F close-out (no feature_list F*)  
**Verify:** `pnpm --filter @muebles/ui test && pnpm --filter @muebles/web test && pnpm --filter @muebles/ui typecheck && pnpm --filter @muebles/web typecheck`

## What shipped

### Part 1 — `docs/design.md` v1.1

- Header: **v1.1 — post phase-4 + F024 growth**, date 2026-07-15
- **§1 Diagnóstico:** marked as **pre-redesign historical** note; tables kept
- **§3.7 Icon map:** Clientes `Users`; Login `LogIn` / guest `WifiOff` / logout `LogOut`; login field icons `Mail` / `KeyRound`
- **§4.1 Layout:** login gate before shell; wireframe + canonical nav TRABAJO (Home, Cotizaciones, Clientes, Muebles) / CONFIG; default entry `home`; topbar **Salir**
- **§5.1 Botones:** aligned to code BEM — `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--danger`, `.btn--small`, `.btn--icon`; secondary = plain `.btn`; max 1 primary
- **§6 Pantallas definidas** restored:
  - 6.1 Dashboard / Home
  - 6.2 Cotizaciones
  - 6.3 Muebles
  - 6.4 Catálogos
  - 6.5 Clientes
  - 6.6 Login
- Old §6 → **§7 Reglas de implementación**; old §7 → **§8 Referencias**
- F021–F023 `docs/design.md §6.x` references now resolve

### Part 2 — Logout polish

- `AppShell` optional `headerActions?: ReactNode` + `onLogout?: () => void`
- Built-in **Salir** control (`LogOut` + `app-topbar__logout`, tokens only)
- `SessionGate` owns session: `handleLogout` → `clearSession()` + `setSession(null)`
- Wired: SessionGate → AppContent → AppShell `onLogout`
- Clears `muebles_session` + `muebles_token`; returns to `LoginScreen`
- CSS: `.app-topbar__actions`, `.app-topbar__logout` in `appShell.css` (tokens)

### Tests

- `packages/ui` `appShell.test.ts`: customers icon, headerActions/onLogout/Salir, logout CSS tokens
- `apps/web` `designSystemShell.test.ts`: Slice F logout wiring (`clearSession`, `handleLogout`, prop chain)

## Verify commands

```bash
pnpm --filter @muebles/ui test
pnpm --filter @muebles/web test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web typecheck
```

## Files

- `docs/design.md`
- `packages/ui/src/shell/AppShell.tsx`
- `packages/ui/src/shell/appShell.css`
- `packages/ui/src/shell/appShell.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/designSystemShell.test.ts`
- `progress/current.md`
- `progress/impl_sliceF_design_polish.md`
