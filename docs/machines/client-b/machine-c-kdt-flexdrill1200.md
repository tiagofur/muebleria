# Dossier de máquina: KDT Flexdrill 1200 (`machine-c`)

> **Estado**: `NOT_TESTED` — dossier de descubrimiento basado en archivos de
> producción real exportados desde Promob Studio. Sin validación de import/readback
> ni sign-off de operador. Fuente: `PUBLIC_REFERENCE_ONLY` + archivos de muestra
> reales etiquetados `CLIENT_CONFIRMED` solo para la estructura del formato.

---

## 1. Identidad de la máquina

| Campo | Valor | Verificado |
|-------|-------|------------|
| Fabricante | KDT Machinery Co., Ltd. (China) | `PUBLIC_REFERENCE_ONLY` |
| Modelo | Flexdrill 1200 | `PUBLIC_REFERENCE_ONLY` (confirmado por nombre del plugin) |
| Tipo | Línea de perforación horizontal multi-husillo | `PUBLIC_REFERENCE_ONLY` |
| Año / estado general | `FIELD_VERIFICATION_REQUIRED` | ☐ |
| Cliente-piloto (código interno) | `client-b` | `OWNER_CONFIRMED` |

**Fuente de identificación del modelo**: el campo `Plugin Flexdrill 1200` en el
comentario de autor de cada XML de producción (`AUTHOR: Plugin Flexdrill 1200 - 1.60.50.0 - Activated`).

---

## 2. Control y software

| Campo | Valor |
|-------|-------|
| Software CAD/CAM fuente | **Promob Studio** v5.60.47.2 (también v5.60.46.6 en archivos más antiguos) |
| Plugin de exportación | **Plugin Flexdrill 1200** v1.60.50.0 |
| Software de control de la máquina | `FIELD_VERIFICATION_REQUIRED` (posiblemente WoodSystem o TPA-based) |
| Sistema operativo del controlador | `FIELD_VERIFICATION_REQUIRED` |
| Cómo se cargan los programas | `FIELD_VERIFICATION_REQUIRED` (posiblemente USB o red) |

**Plugins Promob activos** (observados en los archivos de muestra):

```
Plugin Builder - 1.60.50.5
Plugin Builder Budget - 1.60.50.0
Plugin Cut Pro - 1.60.50.0
Plugin Flexdrill 1200 - 1.60.50.0   ← generador del KDTPanelFormat
Plugin New Promob - 1.0.0
Build Closet - 5.5.0.6
```

---

## 3. Formatos aceptados

| Formato | ¿Importa? | Versión/variante | Ejemplo real |
|---------|-----------|-----------------|--------------|
| `KDTPanelFormat` XML | ✓ confirmado por muestra | Sin versión explícita; dos builds de Promob distintos | [`samples/`](./samples/) |
| DXF | `FIELD_VERIFICATION_REQUIRED` | — | — |
| MPR | `FIELD_VERIFICATION_REQUIRED` | — | — |
| PTX | `FIELD_VERIFICATION_REQUIRED` | — | — |

> La especificación completa del formato XML está en
> [`../kdt-xml-format.md`](../kdt-xml-format.md).

---

## 4. Capacidades físicas — perforación

| Campo | Valor | Cómo se verificó |
|-------|-------|-----------------|
| Diámetros observados en muestras | 5 mm, 8 mm | `CLIENT_CONFIRMED` — archivos de producción real |
| Profundidades verticales observadas | 10, 12, 19.94, 21.81 mm | `CLIENT_CONFIRMED` — ídem |
| Profundidades horizontales observadas | 36 mm (consistente en todos los archivos) | `CLIENT_CONFIRMED` — ídem |
| Diámetro mínimo | `FIELD_VERIFICATION_REQUIRED` | — |
| Diámetro máximo | `FIELD_VERIFICATION_REQUIRED` | — |
| Nº de husillos | `FIELD_VERIFICATION_REQUIRED` | catálogo técnico pendiente |
| Caras perforables en un pase | Mínimo 4 (Top + 4 cantos) — deducido del formato | `CLIENT_CONFIRMED` — estructura del XML |

---

## 5. Capacidades físicas — tablero

| Campo | Valor | Cómo se verificó |
|-------|-------|-----------------|
| Espesores observados en muestras | 15.5 mm, 16.5 mm, 18.5 mm | `CLIENT_CONFIRMED` — archivos reales |
| Dimensiones máximas | `FIELD_VERIFICATION_REQUIRED` | — |
| Piezas más grandes en muestra | 1930 × 600 mm (Lateral Izquierda) | `CLIENT_CONFIRMED` |
| Piezas más pequeñas en muestra | 536 × 184 mm (Trasera Cajón) | `CLIENT_CONFIRMED` |
| Sierra / ranurado | ✓ (rutas TypeNo 7 con through-cut) | `CLIENT_CONFIRMED` — archivos reales |
| Recortes / pockets | ✓ (TypeNo 6 Rect, TypeNo 3 Line) | `CLIENT_CONFIRMED` — archivos reales |

---

## 6. Sample job

- [x] **417 archivos XML** de una corrida de producción real en [`samples/`](./samples/).
      Representan un proyecto completo de muebles (cocina/closet) con laterales,
      bases, fondos, entrepaños, divisiones, cajones, refuerzos y trim de electrodoméstico.
- [ ] **Readback**: no disponible — se requiere import al controlador real y confirmación.
- [ ] **Fotos** de la máquina y pantalla de import: `FIELD_VERIFICATION_REQUIRED`.

---

## 7. Sign-off del operador

> Pendiente. Sin sign-off, el estado permanece `NOT_TESTED`.

| Campo | Valor |
|-------|-------|
| Nombre/cargo del operador | — |
| Fecha de validación | — |
| Qué validó | — |

---

## 8. Notas de taller

- Los archivos usan **Windows line endings** (`\r\n`) — el controlador de la
  máquina KDT probablemente corre Windows.
- El comentario de autor al final de cada XML (`<!--AUTHOR: ...-->`) no es
  parseado por la máquina; es metadata de Promob para soporte técnico.
- El campo `AlignmentFace` (marcado en rojo `rgb(255,0,0)`) indica al operador
  el canto de referencia para alinear la pieza en la mesa de la máquina.
- Las coordenadas de path (TypeNo 7) pueden ir **fuera de los límites del panel**
  (valores negativos o mayores que PanelLength/Width) — es intencional para
  entradas/salidas limpias de la herramienta.
- `Z1` en perforaciones horizontales es consistentemente ≈ `PanelThickness / 2`
  (centrado en el canto).

---

## Después de la visita al taller

1. Completar secciones con `FIELD_VERIFICATION_REQUIRED`.
2. Obtener sign-off del operador (§7).
3. Ejecutar import/readback con fixture de la muestra.
4. Actualizar estado de `NOT_TESTED` a `PARTIAL` o `VALIDATED`.
5. Construir `MachineProfile` en `packages/excel/src/machines/` con capabilities
   confirmadas (ref. #351 foundation).
