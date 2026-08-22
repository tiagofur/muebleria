# Sesión

- **Feature activa:** F141 — Biblioteca lateral persistente de muebles en Proyectar (#309, meta #308 etapa E1)
- **Inicio:** 2026-08-22
- **Estado:** in_progress — seguimiento de PR #329; no cerrar hasta que CI y UX estén verificados.

## Plan

1. Corregir el aislamiento de estado persistido que duplica tarjetas en los tests de la biblioteca.
2. Reemplazar los chips L1/L2 por un selector jerárquico compacto y scopes de colecciones.
3. Hacer que la búsqueda respete el scope activo, con una única lista y recuperación clara de estados vacíos.
4. Persistir la navegación de biblioteca durante cambios de tab y eliminar el scroll anidado/espacio vertical del buscador.
5. Ampliar cobertura focal y ejecutar typecheck + tests de UI.
