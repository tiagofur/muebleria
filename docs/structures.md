# Estructuras (cuerpos de ingeniería)

**Estado:** Completado y evolucionado (Component-based architecture + Vista 3D).

## Glosario y Arquitectura

| Término | Significado |
|---------|-------------|
| **Estructura** | Cuerpo reutilizable del taller (cuerpo base de gabinete, alacena, etc.). Se compone de instancias de componentes del catálogo. |
| **Componente** | Pieza atómica paramétrica con geometría y posición calculada por fórmulas ($W, H, D, PW, PH, PD, T, i$). |
| **Preset de medida** | Valores de ingeniería (ancho, alto, profundidad) para probar la respuesta dimensional del cuerpo. |
| **Vista 3D** | Pestaña interactiva en el editor (`StructuresScreen`) para inspeccionar el despiece del cuerpo ensamblado en 3D (`Furniture3DViewer`). |
| **Pin de revisión** | (#108) Congelamiento de versión de la estructura en cotización/proyecto para inmunidad a cambios futuros del catálogo. |

## Composición Real

```
Estructura (components[]) + Componentes Adicionales + Presets Comerciales + Opciones
        → Mueble / Módulo Resuelto (resolveBom)
```

## Modelo (`packages/domain`)

- `Structure`: `id`, `code`, `name`, `components[]`, `presets[]`, `externalDims?`, `notes?`, `active?`, `revision?`
- Las piezas de tablero del cuerpo no se guardan fijas: se expanden dinámicamente desde `components[]` en `resolveComposedModule`.
- `Catalog.structures` en el almacenamiento.

## Pestañas del Editor (`StructuresScreen`)

1. **Datos Generales:** Código, nombre, observaciones y estado activo/inactivo.
2. **Presets de Medida:** Lista de dimensiones de prueba (ancho × alto × profundidad en mm).
3. **Componentes:** Instancias asignadas (p. ej. 2x Lateral, 1x Base, 1x Techo, 1x Fondo) con sus cantidades y overrides opcionales.
4. **Vista 3D:** Renderizado 3D en vivo del cuerpo con selector de preset de medida y controles de cámara/proyección.

## Roles

Nav **Estructuras**: Admin / Ingeniero / Carpintero. Permite definir el cuerpo estándar del taller.
