# Estructuras (cuerpos de ingeniería) — F049 / H04 + S1 espacial

**Estado:** completado · issue [#99](https://github.com/tiagofur/muebleria/issues/99) · spatial S1 en progreso

## Glosario

| Término | Significado |
|---------|-------------|
| **Estructura** | Cuerpo reutilizable de taller (laterales, fondo, techo, base…). Catálogo de ingeniería. |
| **Componente** | (H06) Puerta, entrepaño, etc. Mini-BOM reutilizable. |
| **Mueble** | Plantilla cotizable (`Module`): fija y/o `structureId` + `components[]` + presets. |
| **Preset de medida** | **Comercial en el mueble** (`Module.presets`, H09 / #104). |
| **Ensamble espacial (S1)** | Pose de cada tablero en el volumen del mueble para 3D (no afecta BOM de corte). |

## Composición

```
Estructura + Componentes[] + Presets + Opciones
        → resolveBom (corte + costo)
        → resolveAssembly (piezas colocadas en mm)  [S1]
```

## Marco de ejes del taller (S1)

- **X** = ancho, 0 = izquierda  
- **Y** = alto, 0 = piso  
- **Z** = profundidad, 0 = **frente** (+Z hacia el fondo)

Fórmulas de tamaño y origen: tokens `W H D T i n` y operadores `+ - * / ( )`.

| Token | Significado |
|-------|-------------|
| W H D | exterior del mueble / preset |
| T | espesor (material o `designThicknessMm`, default 18) |
| i | índice de instancia 0..n-1 |
| n | cantidad de instancias del componente |

## Modelo (domain)

- `Structure`: `id`, `code`, `name`, `boardParts[]`, `externalDims?`, `notes?`, `active?`
- `BoardPart` (opcional S1): `face`, `placement`, `originX/Y/ZFormula`, `designThicknessMm`
- `ModuleComponentRef` (opcional S1): `placement`, `originX/Y/ZFormula`
- `resolveAssembly(module, choices, catalog, measurePresetId?)` → `ResolvedAssembly`
- Completeness: `full` | `partial` | `outer_only` (sin metadata espacial)

## Validación

`validateStructure`: código/nombre no vacíos; ≥1 pieza; cada pieza con dims > 0 y 4 edges.  
Fórmulas de origen: mismos caracteres que fórmulas de tamaño.

## Roles

Nav **Estructuras** / **Componentes**: admin / ingeniero (y guest local).
