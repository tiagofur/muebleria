# Impl — F026 auth_register_admin_approval

## What

End-to-end registration with admin approval + roles (`admin` | `user` | specialty).

## Backend (already present; tightened)

- `POST /api/auth/register` → role=`user`, `active=false`
- `POST /api/auth/login` → 403 if pending approval
- Admin: list / approve / role / reject under `/api/admin/users*`
- `EnsureAdminExists`: `tiagofur@gmail.com` / `asd123` role admin
- `domain.IsValidUserRole` on role updates
- `AdminMiddleware` test (user 403, admin 200)

## Frontend wiring (completed this session)

- `session.ts`: `registerRequest`, `storeAuthUser` / `readAuthUser`, login returns user+role, 403 pending message
- `SessionGate`: Login ↔ Register screens
- `AppShell`: optional CONFIG → Usuarios (`showAdminUsers`)
- `AppContent`: `UsersScreen` only when `role === 'admin'`
- Domain TS `UserRole` includes `user`
- Exports: `RegisterScreen`, `UsersScreen`

## Verification

- `./init.sh` green
- Go tests: api/auth/domain green
- Live smoke: register → 403 login → admin approve → login user → non-admin 403 on admin routes → role change ok
