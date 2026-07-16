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
- **En curso:** ninguna feature `in_progress`
- **Último cierre feature de producto:** F028 — grain_inherited_from_material
- **Última acción:** auditoría PRD vs repo + backlog formalizado (2026-07-15)

## Estado del producto (resumen)

| Capa | Estado |
|------|--------|
| MVP (PRD §6.1 + §18) | **Hecho** |
| v1.1 core (snapshot, herrajes, merma, duplicar, canto default) | **Hecho** |
| v1.1 restante | **Pendiente** — F029/F030 |
| Etapa 2 Go/Postgres/auth | **Avanzada** |
| Design system UI | **Hecho** (F016–F023) |

## Backlog listo para tomar (menor id)

| Feature | Issue | Título |
|---------|-------|--------|
| **F029** | [#35](https://github.com/tiagofur/muebleria/issues/35) | Opciones a nivel proyecto + override por línea |
| F030 | [#36](https://github.com/tiagofur/muebleria/issues/36) | Export cotización comercial (Excel) |
| F031 | [#37](https://github.com/tiagofur/muebleria/issues/37) | Pantalla Ajustes (defaults taller) |
| F032 | [#38](https://github.com/tiagofur/muebleria/issues/38) | Desktop Electron empaquetado |
| F033 | [#39](https://github.com/tiagofur/muebleria/issues/39) | Atajos teclado en grillas |

**Siguiente feature según harness:** `F029` (única `pending` de menor id).

## Docs actualizados esta sesión

- `docs/prd.md` — estado real MVP/v1.1/Etapa2, roadmap con checkboxes, links a issues
- `feature_list.json` — F029–F033 `pending` + `github_issue`
- Issues GitHub #35–#39 abiertos

## Cómo retomar desde otra máquina

```bash
./init.sh
# leer progress/current.md + feature_list.json (pending de menor id)
# o: gh issue list --state open
```
