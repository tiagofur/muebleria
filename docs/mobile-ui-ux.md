# Diseño UI/UX y Ergonomía Móvil — React Native

> **Estado:** Especificación de diseño de interfaz, ergonomía de campo y sistema de componentes  
> **Fecha:** 2026-08-15  
> **Target:** `apps/mobile` (Teléfonos y Tablets iOS / Android)  
> **Diseño Base:** Derivado directamente de `docs/design.md` y adaptado al entorno táctil de carpintería.

---

## 1. Principios de Ergonomía para Taller y Obra

El uso de un dispositivo móvil en un taller de carpintería o en una obra en construcción presenta desafíos físicos únicos: manos con polvo o guantes de trabajo, iluminación variable (sol directo en obra vs galpones con poca luz), ruido de maquinaria y necesidad de operar con una sola mano mientras se sostiene una cinta métrica o una pieza de madera.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REGLAS DE ORO DE ERGONOMÍA MÓVIL                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Zona del Pulgar (Thumb Zone): Acciones primarias en el 40% inferior.    │
│ 2. Touch Targets Grandes: Mínimo 48×48 dp (ideal 56 dp para botones clave). │
│ 3. Confirmación Multimodal: Háptica (vibración) + Audio (beep) + Visual.   │
│ 4. Modo Taller de Alto Contraste: Legibilidad extrema bajo polvo o sol.    │
│ 5. Bottom Sheets Deslizables: Mantienen el contexto sin saltos de pantalla. │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mapa de Navegación de la App

La aplicación se estructura en una barra de navegación inferior (**Bottom Tab Bar**) fija con 5 pestañas principales según el rol del usuario:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            APP NAVIGATION                                   │
├───────────┬─────────────┬─────────────────┬──────────────┬──────────────────┤
│ 📷        │ 📋          │ 📐              │ 📦           │ ⚙️               │
│ Escáner   │ Obras / OP  │ Relevamiento    │ Catálogo     │ Ajustes          │
│ (Taller)  │ (Proyectos) │ & Fotos (Obra)  │ & Cotizador  │ & Perfil         │
└───────────┴─────────────┴─────────────────┴──────────────┴──────────────────┘
```

---

## 3. Especificación de Pantallas Críticas

### 3.1 Pantalla de Escáner de Piso de Fábrica (`ScannerScreen`)

Diseñada para que el operario escanee etiquetas QR de piezas consecutivamente con máxima velocidad:

```
┌──────────────────────────────────────────────────┐
│  [⚡ Flash]               [?] Ayuda   [✕ Cerrar] │
│                                                  │
│                                                  │
│                ┌──────────────┐                  │
│                │ ┏          ┓ │                  │
│                │              │                  │
│                │      QR      │                  │
│                │              │                  │
│                │ ┗          ┛ │                  │
│                └──────────────┘                  │
│             "Alinea el código QR"                │
│                                                  │
│ ──────────────────────────────────────────────── │
│ ▲ FICHA DE PIEZA (BottomSheet Deslizable)        │
│ ┌──────────────────────────────────────────────┐ │
│ │ GAB-01  •  Costado Izquierdo                 │ │
│ │ 720 × 564 mm  •  Blanco 18mm                 │ │
│ │ Cantos: L1 (Frente 2mm) + W2 (Piso/Techo)   │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Estado actual: [ Cortado ✓ ]                 │ │
│ │                                              │ │
│ │ [ ⚡ AVANZAR A ENCINTADO (1-TAP) ]          │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Interacciones Clave:**
- Al enfocar un QR válido: Vibración háptica instantánea (`Haptics.notificationAsync`) + sonido sutil de confirmación.
- La BottomSheet se expande automáticamente mostrando las medidas en números grandes (`24px font-mono`).
- El botón de avanzar estado es de ancho completo y 56px de alto para pulsarse sin mirar fijamente la pantalla.

---

### 3.2 Relevamiento Fotográfico y Medición en Obra (`SurveyScreen`)

Permite capturar fotos categorizadas del espacio antes, durante y después del montaje:

```
┌──────────────────────────────────────────────────┐
│  ← Obra: Cocina Residencia Pérez                 │
├──────────────────────────────────────────────────┤
│  [ Relevamiento (4) ]  [ Taller (2) ]  [ Final ] │
├──────────────────────────────────────────────────┤
│  ┌───────────────────┐  ┌───────────────────┐    │
│  │ 📷 Foto Muro A    │  │ 📷 Tomas Gas/Agua │    │
│  │ Cota: 3,450 mm    │  │ "Revisar llave"   │    │
│  └───────────────────┘  └───────────────────┘    │
│  ┌───────────────────┐  ┌───────────────────┐    │
│  │ 📷 Desagüe Bacha  │  │ ➕ Tomar Nueva    │    │
│  │                   │  │    Foto           │    │
│  └───────────────────┘  └───────────────────┘    │
├──────────────────────────────────────────────────┤
│  Distanciómetro Láser: [ 🟢 Conectado: GLM 50C ] │
│  Última medida recibida: 2,850 mm                │
│  [ 💾 ASIGNAR MEDIDA A MURO SELECCIONADO ]       │
└──────────────────────────────────────────────────┘
```

---

### 3.3 Cotizador Rápido y Catálogo Móvil (`QuickQuoteScreen`)

Permite al vendedor técnico armar presupuestos en vivo durante una visita comercial:

```
┌──────────────────────────────────────────────────┐
│  🔍 Buscar módulos o tableros...                 │
├──────────────────────────────────────────────────┤
│  [ Todos ] [ Bajo Mesada ] [ Alacenas ] [ Torres]│
├──────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐ │
│  │ Bajo Mesada 2 Puertas 80cm                  │ │
│  │ MOD-BM-80 • 800×720×580 mm                  │ │
│  │ Material: Frentes Roble / Int. Blanco       │ │
│  │ Precio Base: $ 185,000                      │ │
│  │ [ - ]  Cantidad: 2  [ + ]     [ + Agregar ] │ │
│  └─────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│  TOTAL ESTIMADO (3 Muebles):  $ 450,000         │
│  [ 📤 ENVIAR COTIZACIÓN POR WHATSAPP ]          │
└──────────────────────────────────────────────────┘
```

---

## 4. Sistema de Tokens Móviles (Design System)

### 4.1 Paleta de Colores

```typescript
// apps/mobile/src/theme/colors.ts
export const colors = {
  // Primarios (Azul Taller / Marca)
  primary: '#2563eb', // hsl(217, 91%, 60%)
  primaryDark: '#1d4ed8',
  primaryLight: '#dbeafe',
  textOnPrimary: '#ffffff',

  // Superficies y Fondos
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceHover: '#f1f5f9',
  surfaceElevated: '#ffffff',

  // Bordes y Divisores
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',

  // Textos y Jerarquía
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',

  // Estados de Taller y Producción
  statusPending: '#64748b', // Gris
  statusCut: '#0284c7',     // Azul Cielo
  statusEdged: '#d97706',   // Ámbar
  statusAssembled: '#16a34a', // Verde
  statusInstalled: '#7c3aed', // Púrpura

  // Alertas y Feedback
  success: '#16a34a',
  successBg: '#f0fdf4',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
};
```

### 4.2 Tipografía (Inter y Tabular Numbers)

```typescript
// apps/mobile/src/theme/typography.ts
export const typography = {
  h1: {
    fontFamily: 'Inter-Bold',
    fontSize: 24,
    lineHeight: 30,
  },
  h2: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 20,
    lineHeight: 26,
  },
  h3: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  bodyBold: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  captionBold: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  mono: {
    fontFamily: 'JetBrainsMono-Medium',
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  priceHero: {
    fontFamily: 'Inter-Bold',
    fontSize: 28,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
};
```

### 4.3 Espaciados y Radios

```typescript
// apps/mobile/src/theme/metrics.ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  touchTargetMin: 48,
  touchTargetHero: 56,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
};
```

---

## 5. Estados de Vacío y Feedback de Carga

1. **Skeletons Shimmer:** En lugar de spinners genéricos, se usan skeletons animados simulando las cards de muebles o filas de piezas mientras se sincroniza con el backend.
2. **Offline Banner:** Una barra delgada en la parte superior (`#d97706` con icono de nube tachada) informa sutilmente al usuario: *"Modo Offline — Los cambios se sincronizarán al recuperar señal"*.
3. **Empty States Ilustrados:** Mensajes claros con llamada a la acción (ej. *"No hay piezas escaneadas hoy. Apunta la cámara a una etiqueta para comenzar"*).
