# Sesión actual

- **Cerrados esta sesión:** #7 #8 #9 #11 #12 #13
- **Último cierre feature:** F028 — grain_inherited_from_material

## Frontend reliability (#11–#13)

### #11 URL hardcodeada
- `App.tsx` calculate: `DEFAULT_API_BASE` + `readAuthToken()`
- `APIWorkspaceRepository(DEFAULT_API_BASE)`

### #12 Feedback cálculo
- Props `breakdownLoading` / `breakdownError` en `ProjectsScreen`
- Spinner + alert; toast error; fallback a breakdown local

### #13 Error Boundary
- `ErrorBoundary` en `@muebles/ui`, wrap en `main.tsx`
- Load fallido → recover explícito (no seed silencioso)

## Verificación
- `pnpm --filter @muebles/ui test` → 186 passed
- `pnpm --filter @muebles/web test` → 61 passed

## Abiertos relevantes
- #10 overflow herrajes Go (MEDIO)
- #14–#20 varios MEDIO/BAJO
