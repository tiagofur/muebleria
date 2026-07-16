# Sesión actual

- **Branch:** `feat/project-level-options-35`
- **Feature:** F029 — project_level_option_choices (#35)
- **Estado:** in_progress

## Plan

1. Domain: `effectiveOptionChoices` + engine/export/snapshot merge
2. Go: `EffectiveOptionChoices` + Postgres `project_level_choices` + API mapper
3. UI: bloque opciones del proyecto + pickers de línea con heredar/override
4. Tests domain/UI/Go + verificación monorepo
5. PR Closes #35

## Hecho

- TS domain `optionChoices.ts` + engine paths + exportIssues + duplicate
- Go engine/storage/migration 000008 + apiMappers
- ProjectsScreen project-level block + line inherit + Override badge
- App `onUpdateProjectLevelChoices`
- Tests: optionChoices, exportIssues F029, helpers, ProjectsScreen F029, Go option_choices

## Próximo

- `pnpm test` / typecheck / `go test`
- Reviewer + PR
