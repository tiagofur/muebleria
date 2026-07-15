# F025 — module_hierarchical_categories (implementer handoff)

**Status:** implemented, awaiting reviewer  
**Date:** 2026-07-15  
**Do not mark done** until reviewer APPROVED.

## Acceptance map

| Criterion | Evidence |
|-----------|----------|
| User can create/edit/organize categories up to 3 levels | ModulesScreen category modal + tree admin; shell `createCategory` / `updateCategory` / `deleteCategory` |
| Go backend validates max depth 3 on create/relocate | `domain.ValidateCategoryPlacement` + storage Create/Update; unit tests `categories_test.go` |
| ModulesScreen filter panel + cascade selector | Tree panel `category-filter-panel`; editor cascade `module-category-cascade` |
| Quote add-item modal filters by hierarchy | ProjectsScreen cascade `add-item-category-cascade` + `filterModulesByCategory` |
| Uncategorized modules remain valid | Optional `Module.categoryId`; filter “Sin categoría”; seed modules unchanged |

## Key files

### Domain (TS)
- `packages/domain/src/types.ts` — `ModuleCategory`, `Module.categoryId?`, `Catalog.categories?`
- `packages/domain/src/categories.ts` + `categories.test.ts` — depth, placement, filter, cascade
- `packages/domain/src/duplicate.ts` — preserves `categoryId`

### Backend Go + Postgres
- `backend-go/db/migration/000001_init_schema.up.sql` — categories + `modules.category_id`
- `backend-go/db/migration/000002_module_categories.up.sql` — apply on existing volumes
- `backend-go/internal/domain/categories.go` + `categories_test.go`
- `backend-go/internal/storage/categories.go` + module queries with `category_id`
- `backend-go/internal/api/handlers.go` / `routes.go` — `/api/catalog/categories`

### Storage / shell / UI
- `packages/storage/src/apiWorkspaceRepository.ts` — load/save categories
- `apps/web/src/App.tsx` — wire CRUD categories + pass props
- `packages/ui/src/modules/*` — tree filter, cascade, admin modal
- `packages/ui/src/projects/ProjectsScreen.tsx` — PRJ-11 cascade in add-item

## Verification

- `pnpm --filter @muebles/domain test` — 70 ✓ (incl. categories)
- `pnpm --filter @muebles/ui test` — 174 ✓ (3 new F025 screen tests)
- typecheck domain/ui/web OK
- `go test ./...` in `backend-go` OK
- Migration applied to Docker Postgres (`muebles-postgres` :5445)

## Notes for reviewer

- Restart Go API after pull so `/api/catalog/categories` is registered.
- Existing modules without `categoryId` stay valid (compat).
- Category delete blocked if children exist (client toast + DB RESTRICT).
- JSON for categories uses camelCase (`parentId`, `sortOrder`, `categoryId`) to match TS domain.
