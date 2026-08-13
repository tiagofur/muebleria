# Sesión — F086 Catálogo de Acabados 3D: Jerarquía de 3 Niveles, Desacoplamiento y RBAC

- **Fecha:** 2026-08-13
- **Scope:** Implementación de F086 (Evolución de 'Ambiente' a 'Acabados', Categorías hasta 3 niveles, Desacoplamiento de superficies, RBAC Admin/Ingeniero)
- **Estado:** Completada (100% verificada)

## Completado — F086 Catálogo de Acabados 3D

1. **Dominio (`packages/domain`):**
   - Definidos `CategoryNode` genérico y `AmbientCategory = CategoryNode` con `id`, `name`, `parentId?`, `sortOrder` (profundidad 1..3).
   - Extendido `AmbientMaterial` con `categoryId?: string`.
   - Generalizados todos los helpers de árbol de categorías en `categories.ts` (`cascadeFromCategoryId`, `cascadeOptions`, `cascadeSelectedCategoryId`, `filterAmbientMaterialsByCategory`, `childrenOf`, `categoryDepth`, etc.).
   - Actualizado `rbac.ts` para que `ambientMaterials` en el menú lateral esté restringido a `roleCanMutateModules(role)` (Admin e Ingeniero).
   - Verificación: 476/476 tests pasando en `@muebles/domain`.

2. **Backend Go (`backend-go`):**
   - Migración SQL aditiva: `000041_ambient_categories.up.sql` (`ambient_categories` con `parent_id`, constraints, índices y `ambient_materials.category_id`).
   - Entidad de dominio Go `AmbientCategory` y validación de jerarquía `ValidateAmbientCategoryPlacement`.
   - Storage Postgres + Store en memoria para tests con CRUD completo.
   - Endpoints HTTP CRUD `/api/catalog/ambient-categories` con RBAC estricto (`RoleCanMutateCatalog`) y actualización de `AmbientMaterial`.
   - Tests de storage y API en Go pasando al 100%.

3. **Almacenamiento Local y API Mappers (`packages/storage`):**
   - Implementados mappers `ambientCategoryToApi`, `ambientCategoryFromApi`, soporte de `category_id` en `ambientMaterialToApi`/`ambientMaterialFromApi` y `ambientCategories` en `catalogFromApi`.
   - `apiWorkspaceRepository.ts` sincroniza categorías de acabados y las ordena topológicamente con `sortCategoriesForSave`.
   - Verificación: 82/82 tests pasando en `@muebles/storage`.

4. **UI & Web Shell (`packages/ui`, `apps/web`):**
   - Renombrado menú en `AppShell.tsx` a **"Acabados"** con icono `Palette` (Lucide).
   - Implementado panel lateral de árbol de categorías jerárquico en `AmbientMaterialsCatalog.tsx` (idéntico al UX de Muebles) con selector en cascada de 3 niveles en el modal, columna de categoría con badge en la tabla y modales ABM de categorías con eliminación segura.
   - Actualizado `catalogStore.ts` con acciones de mutación de categorías de acabados (`createAmbientCategory`, `updateAmbientCategory`, `deleteAmbientCategory`).
   - Conectado `App.tsx` pasando categorías y handlers de mutación.
   - Verificación: 752/752 tests pasando en `@muebles/ui`, 232/232 tests en `apps/web`, `pnpm typecheck` 100% verde y `./init.sh` limpio.
