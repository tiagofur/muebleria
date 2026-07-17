# Sesión actual

- **Branch:** `feat/furniture-components-101-103`
- **Issues:** #101 #102 #103 (sobre base #104)
- **Estado:** listo para PR

## Entregado

### #101 / F052 — Componentes reutilizables
- Domain: `FurnitureComponent`, kinds, `validateFurnitureComponent`
- Go: migration `000017`, storage CRUD, API `/catalog/components`
- UI: `ComponentsScreen` en Ingeniería

### #102 / F053 — Mueble compuesto
- `Module.components` + `expandModuleComponents` en `resolveBom`
- Dual path: módulos fijos sin cambios
- Persistencia `module_component_refs`

### #103 / F054 — UI Ingeniería
- Nav **Componentes** (RBAC ingeniero/admin)
- Editor de mueble: sección adjuntar componentes + cantidad
- Estructuras ya existían (#99)

## Verificación

- domain/ui/storage/web tests + typecheck verdes
- go test ./... ok
