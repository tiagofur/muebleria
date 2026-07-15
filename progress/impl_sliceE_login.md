# Impl — Slice E: Login polish + shell gate

**Status:** implemented (awaiting review)  
**Scope:** re-audit P1.3 residual (no feature_list F*)  
**Verify:** `pnpm --filter @muebles/ui test && pnpm --filter @muebles/web test && pnpm --filter @muebles/ui typecheck && pnpm --filter @muebles/web typecheck`

## What shipped

### UI — `LoginScreen` tokenized
- Co-located `packages/ui/src/auth/login.css` using design tokens only
  (`--surface-sidebar`, `--brand-500`, `--text-inverse`, `--danger-*`,
  `--space-*`, `--radius-*`, `--font-sans`, `--shadow-*`, transitions).
- Removed all inline `style={{...}}` hex/rgba/`system-ui`.
- BEM: `.login-screen`, `.login-card`, `.login-field`, `.login-submit`,
  `.login-guest`, `.login-error`, `.login-divider`.
- Lucide icons with `strokeWidth={1.5}`.
- Props unchanged: `onLogin`, `onGuestAccess`, `loading?`, `error?`.
- `prefers-reduced-motion` disables button transitions.

### Shell gate — `apps/web`
- `App.tsx` imports `LoginScreen`; session `null` → only login (still under
  `ToastProvider`).
- Decision: **login screen first** until authenticate **or** guest.
- Guest: `sessionStorage.muebles_session = 'guest'` → seed workspace.
- Auth: `POST {base}/auth/login` body `{ email, password }`; on success store
  JWT in `localStorage.muebles_token` + `muebles_session = 'auth'`.
- Auth with missing token on refresh → treated as logged out (login again).
- **Seed workspace kept for guest AND auth** — UI gate only.
  **API workspace sync later** (avoid scope creep / flaky tests without backend).

### Helpers
- `apps/web/src/session.ts`: `readSessionMode`, `writeSessionMode`,
  `clearSession`, `storeAuthToken`, `loginRequest`, keys + default base URL.

### Logout
- No dedicated “Cerrar sesión” control (AppShell `meta` is string-only).
- Meta shows `· Invitado` or `· Sesión`.
- Clearing `sessionStorage.muebles_session` + `localStorage.muebles_token`
  returns to login on next load (`clearSession` helper ready).

## Tests
- `packages/ui` LoginScreen: existing + loading disabled + error alert +
  no inline styles / token CSS asserts + Lucide strokeWidth.
- `apps/web` `session.test.ts`: mode persistence, loginRequest success/401/network.
- `designSystemShell.test.ts`: App imports LoginScreen and gates session.

## Verify
```bash
pnpm --filter @muebles/ui test
pnpm --filter @muebles/web test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web typecheck
```

## Files
- `packages/ui/src/auth/LoginScreen.tsx`
- `packages/ui/src/auth/login.css` (new)
- `packages/ui/src/auth/LoginScreen.test.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/session.ts` (new)
- `apps/web/src/session.test.ts` (new)
- `apps/web/src/designSystemShell.test.ts`
- `progress/current.md`
- `progress/impl_sliceE_login.md`
