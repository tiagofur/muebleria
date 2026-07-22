# Sesión actual — F058a Extracción de modales de ProjectsScreen (PARCIAL)

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-projects-a` (basada en `main` post-F064)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F058 — phase0_split_projects_screen (sub-slice a de 3)

## Progreso F058a

### Hecho (commit pushed)
- ✅ StatusBadge extraído
- ✅ 4 modales simples extraídos: ConfirmDelete, ConfirmReopen, SaveAsTemplate, TemplatesManagement
- ✅ Verification: typecheck 6/6, tests 320/320, Playwright 6/6

### Pendiente (próxima sesión, MISMA branch)
- [ ] MetaModal — absorber `renderMetaForm` (líneas 963-1139, ~177 L). Recibe draft, customers, options, handlers. State interno del form.
- [ ] AddItemModal — absorber `renderAddItemForm` (líneas 1141-1330, ~190 L). State interno del cascade.
- [ ] TemplatePickerModal — absorber bloque 2596-2693. Recibe templates, handlers.

### Después de F058a completo
- F058b: partir el detalle (chrome + body)
- F058c: separar la lista

## Notas para la próxima sesión

- ProjectsScreen está en 2664 L (de 2793 original).
- Los 320 tests existentes son la red de seguridad (testean por testid/role/texto).
- `renderMetaForm` y `renderAddItemForm` son closures que capturan state de ProjectsScreen — al extraerlas, hay que pasar el state necesario como props.
- El patrón ya está calibrado con los 5 componentes extraídos: import en ProjectsScreen + JSX controlado + state de apertura queda en el orquestador.
- Branch ya pushed: `wip/perfect-app-fase-0-projects-a`. HEAD == origin.
