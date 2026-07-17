# Sesión actual

- **Branch:** `feat/quote-measure-presets-104`
- **Issue:** [#104](https://github.com/tiagofur/muebleria/issues/104) — Cotización: elegir preset de medida del mueble (H09)
- **Estado:** listo para PR

## Entregado (F051 / #104)

- Domain: `Module.presets`, `Module.structureId`, `ProjectItem.measurePresetId`, `measurePresets.ts`, `resolveBom` con preset
- Storage/Go: migration `000016`, mappers, persistencia en proyectos/módulos
- UI: presets comerciales en editor de mueble; selector de medida en cotización
- Tests: domain + ui + storage + web typecheck verdes

## Nota de alcance

- **No cierra #101 / #103** (componentes reutilizables y UI completa de ingeniería de componentes no están en este PR).
- **#102** solo slice: `structureId` + merge de estructura en resolución; sin catálogo de componentes.
