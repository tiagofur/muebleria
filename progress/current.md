# Sesión actual — QA de campo #251

- **Issue:** [#251](https://github.com/tiagofur/muebleria/issues/251)
- **PR fixes:** [#252](https://github.com/tiagofur/muebleria/pull/252) **MERGED** → `main` @ `628cbcc`
- **Inicio:** 2026-08-07

## Hecho

- Smoke auto domain/ui/web + typecheck
- 7 bugs multi-space / OP / free-only (ver issue)
- Checklist browser ampliado (Proyectar + Producción §5.4)

## Pendiente (ojo humano)

1. Proyectar: regresión +Ambiente vacío + soft lock 2 users  
2. Producción: elevaciones 2 ambientes + filtro despiece  
3. Cerrar #251 cuando §5 manual esté tildado (o aceptar residual)

## Comandos

```bash
pnpm --filter @muebles/domain test
pnpm --filter @muebles/ui test -- project3dPreview productionModuleRows
```
