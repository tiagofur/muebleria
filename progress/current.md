# Sesión actual — F058a Extracción de modales de ProjectsScreen

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-projects-a` (basada en `main` post-F064)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F058 — phase0_split_projects_screen (sub-slice a de 3)
- **Iniciada:** 2026-07-22

## Plan F058a (slice aprobado)

1. ✅ Branch + marcar F058 in_progress.
2. Extraer StatusBadge.
3. Extraer 4 modales simples (Delete, Reopen, SaveAsTemplate, TemplatesManagement).
4. Extraer MetaModal + AddItemModal (los grandes con form).
5. Extraer TemplatePickerModal.
6. Verificar.
7. Reviewer + push.

## Sub-slicing F058

- **F058a** (este): extrae los 7 modales + StatusBadge.
- F058b: parte el detalle (chrome + body).
- F058c: separa la lista.

## Objetivos

- ProjectsScreen.tsx 2793 → ~2000 L.
- 7 modales extraídos + StatusBadge.
- 35 tests existentes pasan sin cambios.

## Notas

- Refactor de presentación pura — sin cambios de comportamiento.
- packages/ui no toca stores (todo por props).
- Tests existentes testean por testid/role/texto — red de seguridad.
