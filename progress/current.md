# Sesión actual

- **Branch:** `feat/project-produced-68`
- **Issue:** [#68](https://github.com/tiagofur/muebleria/issues/68) — F036 produced + reopen/delete
- **Estado:** implementado, listo PR

## Hecho
- ProjectStatus + produced (TS/Go/DB 000011)
- isProjectClosed incluye produced; snapshot en accepted→produced
- roleCanReopen / roleCanMarkProduced
- API PUT: reopen 403 vendedor; mark produced para prod/eng
- UI: badge, Marcar en producción, Reabrir confirm
- PRD §6.6.4
