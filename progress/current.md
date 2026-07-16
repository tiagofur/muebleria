# Sesión actual

- **PR en curso:** feat/ux-high-pickers-tabs-identity — issues #27 #28 #29
- **Último merge main:** #26 HTTP body limits / a11y

## UI/UX Alto (#27–#29)

### #27 Pickers buscables
- `CatalogPicker` combobox con búsqueda, teclado, CAT-05
- Cableado: Projects (cliente + mueble), Modules (herraje fijo), Materials (cintilla)

### #28 Editor de mueble en pestañas
- Modal LG: General / Piezas / Herrajes / Costo
- Validación salta al tab correcto

### #29 Identidad de sesión en topbar
- `AppShell` `sessionMode` + `user` (email/rol o Invitado)
- Cableado desde `apps/web/src/App.tsx`

## Verificación
- `pnpm --filter @muebles/ui test` → 202 passed
- `pnpm --filter @muebles/web test` → 68 passed

## Siguiente
- #30–#34 (medios/bajo) o merge de este PR
