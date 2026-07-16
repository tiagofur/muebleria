# Sesión actual

- **Branch:** feat/ux-category-counts-31
- **Issue:** [#31](https://github.com/tiagofur/muebleria/issues/31) — Conteos por categoría en filtro de Muebles

## Plan
1. Memo de conteos con `filterModulesByCategory` (catálogo completo, no search)
2. Mostrar count en Todas / Sin categoría / nodos del árbol
3. Estilo secundario con tokens
4. Test de pantalla (2 cats, 2 mods + search no baja conteos)

## Estado
- Implementado en `ModulesScreen` + CSS + test
- Verificando con `pnpm --filter @muebles/ui test`
