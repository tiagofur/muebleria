# Sesión actual

- **Branch:** feat/ux-empty-states-32
- **Issue:** [#32](https://github.com/tiagofur/muebleria/issues/32) — Empty states consistentes

## Plan
1. `EmptyState` variant `empty` | `no-results`
2. Cablear en listas: módulos, proyectos, materiales, cantos, herrajes, grupos, clientes, usuarios
3. design.md §4.5
4. Tests: EmptyState + Modules + Materials

## Estado
- Implementado; tests de #32 verdes
- Modal body-scroll flake preexistente en suite completa (pasa en aislamiento)
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
