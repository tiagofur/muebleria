# Sesión actual

- **Branch:** `feat/rbac-roles-67`
- **Issue:** [#67](https://github.com/tiagofur/muebleria/issues/67) — Roles de producto + matriz RBAC (F035)
- **Estado:** implementado, listo para PR / review

## Hecho F035
- Roles producto: admin, gerente_ventas, vendedor, ingeniero, produccion, user
- Migración `000010_product_roles`: disenador→ingeniero, carpintero→produccion
- Domain RBAC TS + Go + ownership gerente assign/see-all
- API 403 mutaciones denegadas; calculate con ownership; GET /api/assignable-owners
- UI: UsersScreen 5 roles, nav filtrada, canMutate/canDelete/export gates
- PRD §6.6 documentado
- Tests matriz mínima (Go + domain + shell)

## Smoke
```
cd backend-go && go test ./internal/domain/ ./internal/api/
pnpm --filter @muebles/domain test
pnpm --filter @muebles/ui test
pnpm --filter @muebles/web test
```

## Siguiente
- PR cierra #67
- Luego F036 produced + reopen
