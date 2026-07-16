# Sesión actual

- **En curso:** UX categorías de muebles — filtro lateral vs gestión en modal
- **Último cierre feature:** F028 — grain_inherited_from_material

## Cambio UI: categorías sin “doble” panel

**Problema:** el aside de Muebles mezclaba filtro de árbol + lista admin con lápiz/basura → confuso.

**Solución:**
- Lateral = solo filtro (Todas / Sin categoría / árbol)
- Botón **Editar categorías** (toolbar + ícono en el aside) abre modal MD **Gestionar categorías**
- Desde el modal: Nueva / Editar (form SM) / Eliminar (confirm SM)
- CSS admin inline removido; estilos `module-category-manage__*`

**Archivos:** `ModulesScreen.tsx`, `modules.css`, `ModulesScreen.test.tsx`

## Verificación
- `pnpm --filter @muebles/ui test` → 192 passed

## Abiertos relevantes
- #10 overflow herrajes Go (MEDIO)
- #14–#20 varios MEDIO/BAJO
