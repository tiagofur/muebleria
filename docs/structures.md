# Estructuras (cuerpos de ingeniería) — F049 / H04

**Estado:** completado · issue [#99](https://github.com/tiagofur/muebleria/issues/99)

## Glosario

| Término | Significado |
|---------|-------------|
| **Estructura** | Cuerpo reutilizable de taller (laterales, fondo, techo, base…). Catálogo de ingeniería. |
| **Componente** | (H06) Puerta, entrepaño, etc. — aún no implementado. |
| **Mueble** | Plantilla cotizable actual (`Module`) con piezas fijas. Sigue funcionando **sin** estructuras. |
| **Preset de medida** | (H05) Valores 300/400/500… — aún no implementado. |

## Composición futura (no en F049)

```
Estructura + Componentes[] + Presets + Opciones
        → Mueble resuelto (H07)
```

F049 solo define y persiste **Estructuras**. No cambia la cotización ni `resolveBom` de módulos fijos.

## Modelo (domain)

- `Structure`: `id`, `code`, `name`, `boardParts[]`, `externalDims?`, `notes?`, `active?`
- Piezas = mismo `BoardPart` que en módulos (medidas fijas mm + `optionRole` + edges)
- `Catalog.structures?` — omitido = `[]` (workspaces viejos)

## Validación

`validateStructure`: código/nombre no vacíos; ≥1 pieza; cada pieza con dims > 0 y 4 edges.

## Roles

Nav **Estructuras**: admin / ingeniero (y guest local). No vendedor / producción.
