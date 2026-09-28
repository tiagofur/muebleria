# Formato KDTPanelFormat — Especificación técnica

> **Fuente**: análisis de 417 archivos de producción real exportados desde
> Promob Studio v5.60.47.2 con Plugin Flexdrill 1200 v1.60.50.0.
> **Objetivo**: documentar el formato para implementar el adapter de exportación
> de Granete hacia máquinas KDT (y compatibles).
>
> **Estado de la especificación**: `CLIENT_CONFIRMED` para los campos observados
> en muestra; `FIELD_VERIFICATION_REQUIRED` para los campos marcados como tales.

---

## Índice

1. [Descripción general](#1-descripción-general)
2. [Origen del formato](#2-origen-del-formato)
3. [Convención de nombres de archivo](#3-convención-de-nombres-de-archivo)
4. [Estructura del archivo](#4-estructura-del-archivo)
5. [Bloque PANEL](#5-bloque-panel)
6. [Operaciones CAD — tipos](#6-operaciones-cad--tipos)
   - [TypeNo 1 — Vertical Hole](#61-typeno-1--vertical-hole)
   - [TypeNo 2 — Horizontal Hole](#62-typeno-2--horizontal-hole)
   - [TypeNo 3 — Line](#63-typeno-3--line)
   - [TypeNo 6 — Rect](#64-typeno-6--rect)
   - [TypeNo 7 — Path](#65-typeno-7--path)
7. [Sistema de cuadrantes](#7-sistema-de-cuadrantes)
8. [Sistema de coordenadas](#8-sistema-de-coordenadas)
9. [Edge banding (enchape)](#9-edge-banding-enchape)
10. [Prefijos de archivo → tipo de pieza](#10-prefijos-de-archivo--tipo-de-pieza)
11. [Valores de espesor observados](#11-valores-de-espesor-observados)
12. [Comentario de autor](#12-comentario-de-autor)
13. [Arquitectura de integración](#13-arquitectura-de-integración)
14. [Mapping hacia operaciones de mueble](#14-mapping-hacia-operaciones-de-mueble)
15. [Preguntas abiertas](#15-preguntas-abiertas)

---

## 1. Descripción general

**`KDTPanelFormat`** es un formato XML propietario de Promob Software Solutions
utilizado para transferir la definición de mecanizado de **una pieza de panel** a
una máquina CNC. Cada archivo XML describe exactamente **una pieza** con:

- Sus dimensiones y contorno geométrico.
- Todas las operaciones de mecanizado necesarias (taladros, ranuras, recortes).

El formato es consumido directamente por el software de control de las máquinas
CNC de la línea **KDT Flexdrill**, aunque la misma estructura puede servir a
otros modelos de KDT según la configuración del plugin.

### Características clave

| Característica | Valor |
|----------------|-------|
| Formato | XML con Windows line endings (`\r\n`) |
| Encoding | UTF-8 (sin BOM explícita) |
| Granularidad | 1 archivo = 1 pieza física |
| Unidades | Milímetros (mm), decimales con punto |
| Plano de referencia | Cara superior de la pieza como plano Z=0 |
| Coordenadas | Sistema 2D+profundidad, origen en esquina de la pieza |

---

## 2. Origen del formato

El formato **no es generado manualmente** — es la salida del plugin
**Flexdrill 1200** de **Promob Studio** (software CAD/CAM de mobiliario, de
origen brasileño).

```
Promob Studio
└── Plugin Flexdrill 1200 v1.60.50.0
    └── exporta → KDTPanelFormat XML
        └── consume → KDT Flexdrill 1200 (línea de perforación horizontal)
```

El plugin convierte el modelo 3D del mueble en una lista de operaciones por pieza
y genera un XML por pieza. No hay archivos de proyecto o batch — cada pieza es
atómica.

---

## 3. Convención de nombres de archivo

```
<PREFIX><NÚMERO>A.xml
```

### Prefijos → tipo de pieza

| Prefijo | Significado | Ejemplos de nombre de panel |
|---------|-------------|----------------------------|
| `BA` | Base | Base Superior, Base Inferior |
| `BAS` | Base (variante) | Base Superior |
| `CA` | Cajón | Trasera Cajon Blum |
| `DI` | División | Division |
| `DIV` | División (variante) | Division |
| `EN` | Entrepaño | Entrepaño Movil Rinconero L Superior |
| `FO` | Fondo | Fondo |
| `FON` | Fondo (variante) | Fondo |
| `LA` | Lateral | Lateral Derecha, Lateral Izquierda |
| `LAT` | Lateral (variante) | Lateral |
| `PA` | Panel general | Vista Inferior, Vista Superior |
| `PAN` | Panel (variante) | — |
| `RE` | Refuerzo | Refuerzo Frontal |
| `TR` | Trim | Trim Electrodomestico |

El **número** (ej. `41026`, `72301`) corresponde al ID interno del proyecto en
Promob. El sufijo **`A`** denota la cara/lado de mecanizado (Face A = cara superior).

---

## 4. Estructura del archivo

```xml
<?xml version="..." encoding="..."?>  <!-- Opcional, a veces ausente -->
<KDTPanelFormat>
  <PANEL>
    <!-- Una sola definición de panel con dimensiones y contorno -->
  </PANEL>
  <CAD><!-- Operación 1 --></CAD>
  <CAD><!-- Operación 2 --></CAD>
  <!-- ... una <CAD> por cada operación de mecanizado -->
</KDTPanelFormat>
<!--AUTHOR: ...-->  <!-- Comentario de metadata de Promob, ignorado por la máquina -->
```

### Reglas estructurales

- Exactamente **un** `<PANEL>`.
- **Cero o más** `<CAD>` — los paneles simples (ej. traseras de cajón) pueden
  tener solo una operación.
- El comentario `<!--AUTHOR:...-->` siempre va al final, fuera de `<KDTPanelFormat>`.
- No hay encabezado de trabajo (job header) ni nesting — cada archivo es autónomo.

---

## 5. Bloque PANEL

```xml
<PANEL>
  <PanelLength>1710</PanelLength>       <!-- mm, dimensión mayor -->
  <PanelWidth>540</PanelWidth>          <!-- mm, dimensión menor -->
  <PanelThickness>16.5</PanelThickness> <!-- mm, espesor del panel -->
  <PanelName>Lateral Derecha</PanelName><!-- Nombre descriptivo de la pieza -->
  <PanelOutline>
    <Vertex>...</Vertex>
    <Vertex>...</Vertex>
    <!-- mínimo 4 vértices (rectangular); más para formas no rectangulares -->
  </PanelOutline>
</PANEL>
```

### 5.1 Campos del panel

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `PanelLength` | Integer mm | Dimensión mayor del panel |
| `PanelWidth` | Integer mm | Dimensión menor del panel |
| `PanelThickness` | Decimal mm | Espesor real del panel (incluye laminado) |
| `PanelName` | String | Nombre descriptivo — sin relevancia para el mecanizado |

### 5.2 Vértices del contorno (`PanelOutline`)

Los vértices definen el perímetro cerrado de la pieza. Para paneles rectangulares
siempre son 4; para piezas en L o con escotes pueden ser 6 o más.

```xml
<Vertex>
  <X1>1710</X1>           <!-- coordenada X del vértice -->
  <Y1>540</Y1>            <!-- coordenada Y del vértice -->
  <Bulge>0</Bulge>        <!-- 0 = borde recto; ≠0 = arco (no observado en muestra) -->
  <Banding>1</Banding>    <!-- tipo de enchape para este canto -->
  <!-- Solo cuando Banding=2: -->
  <Description>AlignmentFace</Description>
  <BandingColor>rgb(255,0,0)</BandingColor>
  <DescriptionColor>rgb(255,0,0)</DescriptionColor>
</Vertex>
```

#### Valores de `Banding`

| Valor | Significado |
|-------|-------------|
| `1` | Canto con enchape estándar |
| `2` | Canto con enchape **y** es la **cara de alineación** (`AlignmentFace`) |

El canto `AlignmentFace` (marcado en rojo) es el canto de referencia que el
operador alinea contra el tope de la máquina. Solo **un vértice** por archivo
tiene `Banding=2`.

---

## 6. Operaciones CAD — tipos

Cada `<CAD>` tiene los campos comunes `<TypeNo>` y `<TypeName>`, seguidos de
campos específicos del tipo.

### Tabla de tipos observados

| TypeNo | TypeName | Descripción |
|--------|----------|-------------|
| `1` | `Vertical Hole` | Taladro desde cara superior (eje Z) |
| `2` | `Horizontal Hole` | Taladro desde un canto (eje X o Y) |
| `3` | `Line` | Ranura/dado lineal en una cara |
| `6` | `Rect` | Bolsillo rectangular |
| `7` | `Path` | Ruta libre de fresado (polilínea) |

> TypeNo 4 y 5 no fueron observados en la muestra de 417 archivos.
> `FIELD_VERIFICATION_REQUIRED` sobre su existencia y uso.

---

### 6.1 TypeNo 1 — Vertical Hole

Taladro vertical desde la **cara superior** del panel (eje Z hacia abajo). Usado
para: clavijas de ensamble, tornillos cam (excéntrica), pines de entrepaño,
tornillos para bisagras.

```xml
<CAD>
  <TypeNo>1</TypeNo>
  <TypeName>Vertical Hole</TypeName>
  <Depth>21.81</Depth>      <!-- profundidad de taladro en mm -->
  <X1>1701.76</X1>          <!-- posición X desde origen del panel -->
  <Y1>37</Y1>               <!-- posición Y desde origen del panel -->
  <Diameter>8</Diameter>    <!-- diámetro de la herramienta en mm -->
  <HoleNo>1</HoleNo>        <!-- número de agujeros en patrón (siempre 1 en muestra) -->
  <IntervalX>0</IntervalX>  <!-- espaciado X para patrones múltiples -->
  <IntervalY>0</IntervalY>  <!-- espaciado Y para patrones múltiples -->
</CAD>
```

#### Valores observados

| Campo | Valores frecuentes | Interpretación |
|-------|-------------------|----------------|
| `Diameter` | `5`, `8` | 5mm = clavijas/pines; 8mm = cam locks |
| `Depth` | `10`, `12` (Ø5) | Clavija de ensamble o pin de entrepaño |
| `Depth` | `19.94`, `21.81` (Ø8) | Agujero receptor de excéntrica cam lock |

---

### 6.2 TypeNo 2 — Horizontal Hole

Taladro horizontal desde **un canto** del panel. Usado para: parte macho del cam
lock, clavijas de unión de costado.

```xml
<CAD>
  <TypeNo>2</TypeNo>
  <TypeName>Horizontal Hole</TypeName>
  <Depth>36</Depth>         <!-- profundidad desde el canto, en mm -->
  <Quadrant>2</Quadrant>    <!-- canto de entrada (ver §7) -->
  <X1>0</X1>                <!-- posición a lo largo de la longitud -->
  <Y1>37</Y1>               <!-- posición a lo largo del ancho -->
  <Z1>8.24</Z1>             <!-- altura desde cara superior = Thickness/2 -->
  <Diameter>5</Diameter>    <!-- diámetro; siempre 5mm en muestra -->
  <HoleNo>1</HoleNo>
  <IntervalX>0</IntervalX>
  <IntervalY>0</IntervalY>
  <IntervalZ>0</IntervalZ>
</CAD>
```

#### Campos específicos de Horizontal Hole

| Campo | Descripción |
|-------|-------------|
| `Quadrant` | Canto de entrada (1–4, ver §7) |
| `Z1` | Altura del centro del taladro desde la cara superior. Siempre ≈ `PanelThickness / 2` |
| `Depth` | Profundidad de penetración desde el canto (siempre 36mm en muestra) |

> **Regla Z1**: `Z1 = PanelThickness / 2`, redondeado. Verificado en toda la muestra:
> thickness 16.5 → Z1 = 8.24 (≈8.25); thickness 15.5 → Z1 = 7.74 (≈7.75).

---

### 6.3 TypeNo 3 — Line

Ranura o dado lineal sobre una cara del panel. Usado para: ranura de cajón
(para recibir la trasera del cajón tipo Blum).

```xml
<CAD>
  <TypeNo>3</TypeNo>
  <TypeName>Line</TypeName>
  <PlaneID>0</PlaneID>      <!-- 0 = cara superior -->
  <BeginX>-4</BeginX>       <!-- X de inicio (puede ser negativo = fuera del panel) -->
  <BeginY>174.5</BeginY>    <!-- Y de inicio -->
  <EndX>540</EndX>          <!-- X de fin (puede superar PanelLength) -->
  <EndY>174.5</EndY>        <!-- Y de fin -->
  <Correction>0</Correction><!-- compensación de herramienta: 0=centro, 1=dcha, 2=izq -->
  <Width>19</Width>          <!-- ancho de la ranura en mm -->
  <Depth>5.5</Depth>        <!-- profundidad de la ranura en mm -->
</CAD>
```

Los valores `BeginX < 0` y `EndX > PanelLength` son intencionales: la herramienta
entra y sale del material para evitar rebabas en los extremos.

---

### 6.4 TypeNo 6 — Rect

Bolsillo o canaleta rectangular. Usado para: ranura longitudinal de panel trasero
en marcos de cocina.

```xml
<CAD>
  <TypeNo>6</TypeNo>
  <TypeName>Rect</TypeName>
  <Radius>0</Radius>        <!-- radio de esquinas (0 = esquinas vivas) -->
  <Depth>7.5</Depth>        <!-- profundidad del bolsillo en mm -->
  <X1>-6</X1>               <!-- X de inicio (puede ser negativo) -->
  <Y1>182.6</Y1>            <!-- Y de inicio -->
  <Length>1522</Length>     <!-- longitud del bolsillo en mm -->
  <Width>14.8</Width>       <!-- ancho del bolsillo en mm -->
  <Empty>1</Empty>          <!-- 1 = corte pasante/abierto; 0 = cerrado -->
</CAD>
```

---

### 6.5 TypeNo 7 — Path

Ruta de fresado libre definida por una polilínea. Usado para: recortes de
electrodomésticos (campana, horno, microondas), canaletas en L, perfiles de
enchape en esquina.

```xml
<CAD>
  <TypeNo>7</TypeNo>
  <TypeName>Path</TypeName>
  <Width>8</Width>           <!-- diámetro de fresa en mm -->
  <Depth>16.6</Depth>       <!-- profundidad de corte (> PanelThickness = pasante) -->
  <Correction>1</Correction> <!-- compensación: 0=centro, 1=izquierda, 2=derecha -->
  <Close>1</Close>           <!-- 1 = camino cerrado (recorte); 0 = abierto -->
  <Enable>1</Enable>         <!-- 1 = activo -->
  <Vertexes>
    <Point>                  <!-- punto de inicio (movimiento rápido sin corte) -->
      <X1>398.5</X1>
      <Y1>750</Y1>
    </Point>
    <Line>                   <!-- segmento de línea hasta este punto (con corte) -->
      <X1>98.5</X1>
      <Y1>750</Y1>
    </Line>
    <Line>
      <X1>98.5</X1>
      <Y1>250</Y1>
    </Line>
    <!-- más <Line> o potencialmente <Arc> (no observado en muestra) -->
  </Vertexes>
</CAD>
```

#### Comportamiento de `Close` y `Depth`

| `Close` | `Depth` vs Thickness | Resultado |
|---------|---------------------|-----------|
| `1` | `Depth > PanelThickness` | Recorte pasante (cutout completo) |
| `1` | `Depth < PanelThickness` | Bolsillo cerrado |
| `0` | cualquiera | Ranura o rebaje abierto (entra/sale del borde) |

#### `Correction` — compensación de herramienta

| Valor | Significado |
|-------|-------------|
| `0` | Centro de la fresa sobre la línea de corte |
| `1` | Fresa a la izquierda de la dirección de avance |
| `2` | Fresa a la derecha de la dirección de avance |

---

## 7. Sistema de cuadrantes

El campo `<Quadrant>` en `Horizontal Hole` determina desde qué canto entra el
taladro:

```
              Quadrant 3
              (Y = PanelWidth)
              ───────────────────
             │                   │
Quadrant 2   │      PANEL        │  Quadrant 1
(X = 0)      │                   │  (X = PanelLength)
             │                   │
              ───────────────────
              Quadrant 4
              (Y = 0)
```

| Quadrant | Canto | Coordenada de referencia |
|----------|-------|--------------------------|
| `1` | Derecho / final | `X1 = PanelLength` |
| `2` | Izquierdo / inicio | `X1 = 0` |
| `3` | Superior / fondo | `Y1 = PanelWidth` |
| `4` | Inferior / frente | `Y1 = 0` |

**Verificación** — en `BA11025A.xml` (Base Superior 587×540mm):
- Quadrant 2, X1=0 → taladra desde canto izquierdo ✓
- Quadrant 1, X1=587 → taladra desde canto derecho ✓

En `FO11029A.xml` (Fondo 1677×587mm):
- Quadrant 3, Y1=587 → canto superior ✓
- Quadrant 4, Y1=0 → canto inferior ✓

---

## 8. Sistema de coordenadas

```
     Y (PanelWidth)
     ↑
     │
  (0,W)────────────────(L,W)
     │                   │
     │   Panel (top     │
     │    face view)    │
     │                   │
  (0,0)────────────────(L,0) → X (PanelLength)
```

- Origen `(0, 0)`: esquina inferior izquierda de la pieza.
- `X` positivo → hacia la derecha (a lo largo de `PanelLength`).
- `Y` positivo → hacia arriba (a lo largo de `PanelWidth`).
- `Z` (implícito): desde la cara superior hacia abajo. No se especifica en
  operaciones verticales — la máquina asume la cara superior como Z=0.
- Para operaciones horizontales, `Z1` es la altura desde la cara superior
  (siempre ≈ `PanelThickness / 2`).
- Las coordenadas pueden ser **negativas** o **mayores que las dimensiones del
  panel** cuando la herramienta debe entrar/salir fuera del material.

---

## 9. Edge banding (enchape)

El enchape (cinta de borde) se especifica por canto en los vértices del
`PanelOutline`. Cada `<Vertex>` representa el **canto que conecta ese vértice
con el siguiente** (en el orden de la polilínea).

| `Banding` | Significado |
|-----------|-------------|
| `1` | Canto con enchape estándar |
| `2` | Canto con enchape **y** referencia de alineación (`AlignmentFace`) |

### AlignmentFace

El vértice con `Banding=2` siempre tiene:

```xml
<Description>AlignmentFace</Description>
<BandingColor>rgb(255,0,0)</BandingColor>
<DescriptionColor>rgb(255,0,0)</DescriptionColor>
```

Es el canto que el operador alinea contra el tope de referencia de la máquina.
Define el sistema de coordenadas absoluto para el mecanizado. Solo existe
**uno** por archivo.

---

## 10. Prefijos de archivo → tipo de pieza

Mapeo confirmado a partir de los valores de `<PanelName>` en los archivos de
muestra:

| Prefijo | Piezas de mueble | Operaciones típicas |
|---------|-----------------|---------------------|
| `BA` / `BAS` | Base horizontal (superior/inferior) | Horizontal Holes + Vertical Holes |
| `CA` | Trasera de cajón | Line (ranura para trasera tipo Blum) |
| `DI` / `DIV` | División vertical interior | Horizontal Holes + Vertical Holes |
| `EN` | Entrepaño (fijo o móvil) | Path (ranura de enchape en L) |
| `FO` / `FON` | Fondo | Muchos Horizontal Holes (4 cantos) |
| `LA` / `LAT` | Lateral (derecho/izquierdo) | Muchos Vertical Holes (pines entrepaño) + Vertical Holes cam |
| `PA` / `PAN` | Panel de cierre o visual | Path + Rect (recorte + canaleta) |
| `RE` | Refuerzo | Horizontal Holes únicamente |
| `TR` | Trim de electrodoméstico | Path (recorte pasante cerrado) |

---

## 11. Valores de espesor observados

Los espesores tienen `+0.5 mm` sobre el nominal del tablero (los `0.5 mm`
corresponden al doble de la cara de melanina ≈ 0.25 mm por cara):

| `PanelThickness` | Material nominal | Uso observado |
|-----------------|-----------------|---------------|
| `15.5` | 15 mm | Divisiones interiores, entrepaños |
| `16.5` | 16 mm | Laterales, bases, fondos (estándar) |
| `18.5` | 18 mm | Panels de cierre, vistas exteriores |

---

## 12. Comentario de autor

Todos los archivos terminan con un bloque de comentario XML fuera del tag raíz.
**La máquina no lo parsea** — es metadata de Promob para trazabilidad y soporte.

```xml
<!--AUTHOR: Copyright ® Promob Software Solutions
Promob Studio Start KVA
Promob: 5.60.47.2
3DE Render - 2.2.1 - Activated
Build Closet - 5.5.0.6 - Activated
New Revest - 1.8.6 - Activated
Plugin Builder - 1.60.50.5 - Activated
Plugin Builder Budget - 1.60.50.0 - Activated
Plugin Cut Pro - 1.60.50.0 - Activated
Plugin Flexdrill 1200 - 1.60.50.0 - Activated
Plugin New Promob - 1.0.0 - Activated
-->
```

En la muestra existen dos versiones de Promob: `5.60.46.6` y `5.60.47.2`.
Los archivos más antiguos tienen `Plugin Flexdrill 1200 - 1.60.46.0`.

---

## 13. Arquitectura de integración

```
┌─────────────────────────┐     KDTPanelFormat XML      ┌────────────────────────┐
│   Promob Studio         │ ─── 1 archivo por pieza ──► │  KDT Flexdrill 1200    │
│   + Plugin Flexdrill    │                              │  (CNC drilling line)   │
└─────────────────────────┘                              └────────────────────────┘

                  ↕ (propuesta de integración Granete)

┌─────────────────────────┐     KDTPanelFormat XML      ┌────────────────────────┐
│   Granete               │ ─── 1 archivo por pieza ──► │  KDT Flexdrill 1200    │
│   + KDT adapter         │                              │  (misma máquina)       │
└─────────────────────────┘                              └────────────────────────┘
```

El adapter de Granete deberá:
1. Recibir cada `CutPiece` con sus operaciones de hardware.
2. Serializar la geometría del panel (dimensiones + contorno + AlignmentFace).
3. Serializar cada operación como el TypeNo correcto.
4. Emitir el archivo con el nombre correcto y line endings `\r\n`.

---

## 14. Mapping hacia operaciones de mueble

| Hardware / conexión | TypeNo | Parámetros clave |
|--------------------|--------|-----------------|
| Excéntrica cam lock — receptor (cara) | `1` — Vertical Hole | Ø8, depth ≈ 21.81 |
| Excéntrica cam lock — tornillo (canto) | `2` — Horizontal Hole | Ø5, depth 36, Quadrant según canto |
| Clavija de ensamble | `1` + `2` | Ø5, depth 10–12 (vertical) + depth 36 (horizontal) |
| Pin de entrepaño | `1` — Vertical Hole | Ø5, depth 10 |
| Ranura trasera cajón (tipo Blum) | `3` — Line | width 19, depth 5.5 |
| Canaleta panel trasero | `6` — Rect | depth 7.5, Empty=1 |
| Recorte electrodoméstico | `7` — Path | Close=1, Depth > PanelThickness |
| Rebaje de canto | `7` — Path | Close=0, Depth < PanelThickness |

---

## 15. Preguntas abiertas

| # | Pregunta | Prioridad |
|---|----------|-----------|
| 1 | ¿Existen TypeNo 4 y 5? ¿Qué operaciones representan? | Alta — antes de implementar el adapter |
| 2 | Cuando `HoleNo > 1`, ¿cómo funciona el patrón de `IntervalX/Y`? Siempre fue 1 en la muestra. | Media |
| 3 | ¿Existe `<Arc>` como hijo de `<Vertexes>` en Path? ¿Cuáles son sus campos? | Media |
| 4 | ¿Cómo selecciona Promob el `AlignmentFace`? ¿Es siempre el canto frontal/visible? | Alta — para implementar la lógica en Granete |
| 5 | ¿Qué versión exacta del software de control usa la máquina? ¿Hay validación de versión en el XML? | Alta — para garantizar compatibilidad |
| 6 | ¿Cuáles son los valores de `PlaneID` distintos de `0`? ¿Representan la cara inferior? | Media |
| 7 | ¿Se pueden tener múltiples `AlignmentFace` (Banding=2) en piezas no rectangulares? | Baja |
| 8 | ¿Cuál es el comportamiento cuando `Empty=0` en TypeNo 6 Rect? ¿Bolsillo cerrado? | Baja |

---

## Referencias

- KDT Machinery Co., Ltd.: [kdt-machinery.com](https://kdt-machinery.com)
- Promob Software Solutions: [promob.com](https://promob.com)
- Dossier de máquina: [`docs/machines/client-b/machine-c-kdt-flexdrill1200.md`](./machines/client-b/machine-c-kdt-flexdrill1200.md)
- Muestras XML: [`docs/machines/client-b/samples/`](./machines/client-b/samples/)
- Machine profiles & adapters: [`docs/architecture/machine-profiles-and-adapters.md`](./architecture/machine-profiles-and-adapters.md)
