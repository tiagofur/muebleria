# Roadmap — React Native Companion App (`apps/mobile`)

> **Estado:** Documento de estrategia, arquitectura de producto y plan de ejecución  
> **Fecha:** 2026-08-15  
> **Área:** Aplicación Móvil Nativa (iOS / Android)  
> **Monorepo Target:** `apps/mobile` en pnpm monorepo  
> **Relación con otros docs:** Complementa `docs/prd-v2.md`, `docs/architecture.md` y `docs/production-flow-v2.md`.

---

## 1. Visión y Propósito de la App Móvil

La aplicación móvil **Granete Native** no es un clon reducido de la versión web de escritorio. Es una **herramienta de campo, taller y ventas de alta velocidad operativa**, diseñada específicamente para los momentos físicos donde una computadora portátil no es práctica:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ECOSISTEMA GRANETE                                 │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    WEB / DESKTOP (Oficina Técnica)   │       REACT NATIVE (Campo & Taller)   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Diseño CAD/CAM 3D y muros          │ • Escáner QR de piezas en taller (<100ms)│
│ • Edición paramétrica de módulos     │ • Avance de estados de piso de fábrica│
│ • Configuración avanzada de catálogos│ • Relevamiento en obra con fotos y cotas│
│ • Exportación a Optimizer.xlsx y CNC │ • Conexión con distanciómetro láser BLE│
│ • Administración global y reportes   │ • Cotización rápida & firma de cliente│
│                                      │ • Mesa de ayuda y tickets de garantía│
│                                      │ • Modo 100% Offline con sincronización│
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 1.1 Por qué React Native & Expo en nuestro stack
1. **100% Reutilización de Dominio:** `@granete/domain` (BOM, costeo, validaciones, QR parsing) está escrito en TypeScript puro sin dependencias de DOM/fs, permitiendo importación directa en React Native sin duplicación de lógica.
2. **Acceso a Hardware Nativo:** Cámara de alto rendimiento para códigos QR y captura de fotos, Bluetooth Low Energy (BLE) para distanciómetros, acelerómetro/giroscopio, almacenamiento seguro (SecureStore) y notificaciones push.
3. **Fluidez y Ergonomía Táctil:** Interfaz táctil optimizada para operar con una sola mano, respuestas hápticas, escaneo continuo y navegación por gestos.
4. **Offline-First:** Capacidad de operar en sótanos, galpones y obras sin cobertura celular, encolando mutaciones y sincronizando al recuperar conexión con el backend Go.

---

## 2. Usuarios y Casos de Uso (JTBD)

### 2.1 Operario de Fábrica / Armador en Banco
- **Escaneo de Piezas:** Escanea la etiqueta QR de una pieza recién cortada para ver al instante: módulo al que pertenece, qué cantos llevan tapacanto (`L1+W2`), medida exacta y material.
- **Avance de Estado de Piso:** Pasa el estado del ítem (`pending` → `cut` → `edged` → `assembled` → `installed`) en 1 tap.
- **Visualizador Paperless:** Consulta despieces, hojas de armado y planos de elevación en tablet sin necesidad de imprimir hojas de papel.

### 2.2 Instalador / Carpintero en Obra (Relevamiento y Montaje)
- **Relevamiento Fotográfico:** Captura fotos de muros, tomas eléctricas y desagües antes de instalar, anotando cotas directamente.
- **Medición Asistida por Láser:** Conecta el medidor láser por Bluetooth para cargar medidas de muros automáticamente.
- **Checklist de Instalación y Acta de Entrega:** Valida cada mueble instalado y hace firmar al cliente en la pantalla táctil, sacando fotos finales del trabajo terminado.
- **Reporte Rápido de Garantías:** Si una pieza llega fallada, saca foto, selecciona la pieza del despiece original y genera el ticket de re-fabricación en segundos.

### 2.3 Vendedor Técnico / Proyectista en Calle
- **Catálogo en el Bolsillo:** Muestra a los clientes materiales, colores, tiradores y fotos de proyectos reales terminados.
- **Cotizador Express:** Arma una cotización rápida seleccionando módulos estándar y opciones de material, obteniendo precio al instante.
- **Presentación Visual al Cliente:** Muestra el render/previsualización del proyecto en tablet y envía el presupuesto formal por WhatsApp con un solo botón.

### 2.4 Dueño de Taller / Gerente
- **Control de Planta en Tiempo Real:** Visualiza el tablero de control de obras en curso, alertas de cuellos de botella y proyectos listos para instalar.
- **Aprobaciones de Handoff:** Recibe notificaciones push para aprobar el pase a corte de un proyecto validado por ingeniería.

---

## 3. Decisiones Estratégicas Clave (D-RN)

| ID | Decisión | Fundamento Técnico |
|---|---|---|
| **D-RN-1** | **Expo SDK 52+ con New Architecture (Bridgeless / Turbomodules)** | Máximo rendimiento en C++, soporte nativo de `expo-camera`, `expo-sqlite` y facilidad de compilación con EAS Build dentro del monorepo pnpm. |
| **D-RN-2** | **Reutilización 100% de `@granete/domain`** | Se importa `@granete/domain` directo en React Native. Las fórmulas de despiece, resolución de BOM, parsers de QR y RBAC son idénticos a Web y Go. |
| **D-RN-3** | **Offline-First con SQLite & Cola de Mutaciones** | Se usa `expo-sqlite` o WatermelonDB como store local respaldado por TanStack Query + Zustand, permitiendo trabajar sin internet y resolver conflictos por versión (`productionRevision.ts`). |
| **D-RN-4** | **Hardware Nativo: Cámara & BLE** | Integración de `expo-camera` para escaneo de QR v2 (#141) con respuesta háptica y `react-native-ble-plx` para distanciómetros láser (Bosch GLM, Leica Disto). |
| **D-RN-5** | **Compresión de Imágenes en Cliente** | Las fotos de obra tomadas desde la app se redimensionan y comprimen a WebP/JPEG optimizado en el dispositivo antes de subirse al backend Go (`/api/projects/:id/photos`). |
| **D-RN-6** | **UI/UX Táctil y Modo Taller** | Componentes con touch target mínimo de 48px, soporte de modo oscuro y modo alto contraste para visualización bajo sol en obra o polvo en taller. |
| **D-RN-7** | **Contrato Dual de QR (Offline JSON + Deep Link)** | El parser `parsePieceLabelScan` soporta JSON directo v2 y URLs tipo `muebles://scan#<json>` manteniendo compatibilidad con etiquetas físicas ya impresas. |
| **D-RN-8** | **Notificaciones Push y Chat Técnico** | Notificaciones vía Expo Push Notifications / WebSockets para consultas técnicas entre taller y ventas (`project_internal_messages`). |

---

## 4. Fases de Implementación

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 0: Cimientos del Monorepo & Autenticación                              │
│ • Setup apps/mobile con Expo & pnpm symlinks                                │
│ • Design tokens móviles (Inter, colores de docs/design.md, spacing)         │
│ • Auth JWT con Go Backend + Biometría (FaceID/Huella)                       │
│ • Integración de @granete/domain y @granete/storage                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 1: Escáner QR de Piso & Trazabilidad de Producción                     │
│ • Escáner de cámara ultra-rápido con respuesta háptica                      │
│ • Parsing instantáneo con parsePieceLabelScan (JSON v2)                     │
│ • Ficha de pieza: dimensiones, material, tapacantos (L1/W2)                 │
│ • Transición de estado de piso (cut -> edged -> assembled -> installed)     │
│ • Cola de escaneos offline                                                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 2: CRM en Obra, Relevamiento & Galería Multimedia                      │
│ • Cámara de obra con compresión local de imágenes                           │
│ • Galería por etapas: Relevamiento, Taller, Instalado, Acta de Entrega      │
│ • Chat técnico contextual entre ventas y taller con push notifications      │
│ • Módulo de Tickets de Garantía con captura de fotos del defecto            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 3: Catálogo Móvil & Cotizador Express de Campo                         │
│ • Navegación y búsqueda de materiales, cantos, herrajes y módulos           │
│ • Cotizador rápido con presets y cálculo en vivo vía @granete/domain        │
│ • Compartir presupuesto por WhatsApp / PDF con un toque                     │
│ • Historial y ficha 360° del cliente                                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 4: Medición Asistida con Distanciómetro Láser BLE                      │
│ • Conexión Bluetooth Low Energy (Bosch GLM 50C / Leica Disto D2)            │
│ • Captura de medidas en vivo sobre esquema de muros                         │
│ • Anotación de cotas sobre fotos de relevamiento                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FASE 5: Modo Presentación 3D, Firma Digital & Pulido Final                  │
│ • Viewport 3D adaptado para tablet (Three.js / Expo GL)                     │
│ • Firma digital de actas de entrega en pantalla táctil                      │
│ • Modo Paperless de banco para tablets de taller                            │
│ • Auditoría de rendimiento, testing E2E con Maestro y release EAS          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Detalle de Fases y Entregables

### Fase 0 — Cimientos del Monorepo & Auth (Completada)
**Objetivo:** Tener la aplicación compilando en iOS y Android dentro del monorepo pnpm, conectada al backend Go y consumiendo el dominio compartido.

- [x] **0.1 Setup de `apps/mobile`:** Configuración con Expo SDK 52+, TypeScript estricto, y resolución de symlinks en `metro.config.js` para `@granete/domain` y `@granete/storage`.
- [x] **0.2 Sistema de Diseño Móvil:** Implementación de tokens de color HSL, tipografía Inter, espaciados y componentes base (`Button`, `Card`, `Input`, `Badge`, `BottomSheet`, `Header`).
- [x] **0.3 Autenticación & Sesión:** Login con JWT contra Go backend (`POST /api/auth/login`), guardado seguro de tokens con `expo-secure-store`, refresh token automático y login biométrico opcional (`expo-local-authentication`).
- [x] **0.4 Capa de Red y Cliente API:** Cliente HTTP Axios/Fetch configurado con interceptores de autenticación y manejo de errores tipados `DomainError`.

### Fase 1 — Escáner QR de Piso & Trazabilidad de Producción (Completada)
**Objetivo:** Entregar la herramienta operativa más crítica para el taller: escaneo instantáneo de etiquetas de piezas (#141 / PROD-3.1).

- [x] **1.1 Visor de Cámara para QR:** Lector continuo con `expo-camera` optimizado para escanear etiquetas de piezas a 30-50 cm con respuesta háptica (`expo-haptics`) y feedback sonoro.
- [x] **1.2 Integración con `parsePieceLabelScan`:** Decodificación instantánea del payload JSON v2 (`projectId`, `module`, `part`, `material`, `L`, `W`, `edges`, `edge`, `rev`).
- [x] **1.3 Ficha Táctica de Pieza:** Vista flotante tipo BottomSheet con datos claros: dimensiones resaltadas, diagrama visual de qué lados llevan tapacanto (`L1`, `L2`, `W1`, `W2`) y nombre del material.
- [x] **1.4 Actualización de Estado de Piso:** Botones de 1-tap para avanzar el estado del ítem (`setProjectItemFloorStatus`: cortado, encintado, armado, instalado).
- [x] **1.5 Cola de Sincronización Offline:** Si el taller no tiene internet, los escaneos y cambios de estado se guardan en SQLite local y se sincronizan al recuperar conexión.

### Fase 2 — CRM en Obra, Relevamiento & Fotos (Completada)
**Objetivo:** Dotar a los instaladores y vendedores de una herramienta fotográfica completa vinculada al proyecto (CRM Fases 1 a 3).

- [x] **2.1 Cámara de Obra Integrada:** Captura de fotos con selector de etapa (`survey`, `in_workshop`, `installed`, `delivery_receipt`).
- [x] **2.2 Compresión & Preprocesamiento:** Redimensionado a max 1920px y compresión WebP antes de upload, con soporte de subida en segundo plano y reintentos.
- [x] **2.3 Galería Multimedia del Proyecto:** Visualizador de fotos con zoom/pinch y soporte de captions.
- [x] **2.4 Chat Técnico Interno:** Hilo de mensajes contextuales por proyecto (`project_internal_messages`) con notificaciones push para resolver dudas de obra con ingeniería.
- [x] **2.5 Mesa de Ayuda de Garantías:** Registro de reclamos de post-venta (`warranty_tickets`), fotos de la falla y selección de piezas para re-fabricación.

### Fase 3 — Catálogo Móvil & Cotizador Express (Completada)
**Objetivo:** Permitir cotizaciones y consultas comerciales en el bolsillo del vendedor.

- [x] **3.1 Explorador de Catálogos:** Búsqueda y filtrado de tableros, cantos, herrajes y módulos estándar con fotos e imágenes de acabado.
- [x] **3.2 Cotizador Rápido de Módulos:** Selección de ítems, ajuste de medidas con presets (`measurePresets.ts`), selección de grupos de opciones y costeo instantáneo en el dispositivo vía `engine.ts`.
- [x] **3.3 Generación de Propuesta PDF:** Generación/descarga de resumen comercial en PDF y botón de "Compartir por WhatsApp" con mensaje predeterminado.
- [x] **3.4 Ficha 360° del Cliente:** Vista de clientes con proyectos asociados, saldos y acceso directo a llamada o WhatsApp.

### Fase 4 — Medición Asistida con Láser BLE (Completada)
**Objetivo:** Automatizar la toma de medidas en obra para eliminar errores manuales.

- [x] **4.1 Integración BLE:** Escaneo y conexión con distanciómetros láser compatibles con protocolo estándar Bluetooth (Bosch GLM 50 C / 100 C, Leica Disto D2 / X3).
- [x] **4.2 Modo Medición de Muros:** Al presionar el botón del distanciómetro, el valor en milímetros se vuelca automáticamente en la cota activa de la app.
- [x] **4.3 Anotación sobre Fotos:** Herramienta simple para dibujar flechas y escribir cotas sobre fotos tomadas en el relevamiento de obra.

### Fase 5 — Modo Presentación 3D, Firma Digital & Release (Completada)
**Objetivo:** Pulir la experiencia de presentación para clientes y preparar el lanzamiento.

- [x] **5.1 Viewport 3D en Tablet:** Renderizado ligero de módulos y muebles usando Three.js / Expo GL con controles de órbita táctiles.
- [x] **5.2 Firma Digital de Acta de Entrega:** Canvas táctil para firma del cliente al completar la instalación, guardándose como foto de tipo `delivery_receipt`.
- [x] **5.3 Modo Paperless de Banco:** Vista de pantalla completa para tablets fijadas en el taller con listado de cortes y hojas de armado.
- [x] **5.4 Testing E2E & CI/CD:** Automatización de builds con Expo Application Services (EAS Build) y pruebas de flujo crítico con Maestro.

---

## 6. Matriz de Valor vs. Esfuerzo

```
Alto  ▲
      │ [Fase 1] Escáner QR de Piso      [Fase 2] CRM, Relevamiento & Fotos
      │ (Impacto crítico taller)         (Elimina pérdidas de info en obra)
      │
V     │ [Fase 3] Cotizador Express       [Fase 4] Medidor Láser BLE
A     │ (Ventas ágiles en calle)         (Diferenciador tecnológico)
L     │
O     │ [Fase 0] Setup & Base Auth       [Fase 5] 3D Tablet & Firma
R     │ (Cimientos obligatorios)         (Cierre de experiencia)
      │
Bajo  └─────────────────────────────────────────────────────────────►
       Bajo                        Esfuerzo                        Alto
```

---

## 7. Matriz de Riesgos y Mitigación

| Riesgo Técnico / Operativo | Impacto | Probabilidad | Estrategia de Mitigación |
|---|---|---|---|
| **Pérdida de conectividad en obras/sótanos** | Alto | Alta | Arquitectura **Offline-First**: SQLite local almacena catálogos y proyectos; mutaciones se encolan con reintentos exponenciales. |
| **Lentitud en escaneo de QR con mala luz** | Alto | Media | Utilizar `expo-camera` con selector de antorcha (flash LED), ROI (región de interés) centrada y algoritmo de contraste. |
| **Conflictos de concurrencia en cambios de estado** | Medio | Media | Los cambios de estado de piso solo modifican `floorStatus` y `updatedAt` por ítem. El backend Go resuelve mediante Last-Write-Wins con versionado semántico. |
| **Tamaño excesivo de bundle o imágenes** | Medio | Baja | Compresión WebP en cliente antes de subida; lazy loading de módulos e iconos SVG optimizados. |
| **Fragmentación de dispositivos Android de taller** | Medio | Alta | Pruebas continuas en dispositivos de gama de entrada (Android 10+, 3GB RAM); diseño con touch targets amplios (≥48px). |

---

## 8. Anti-Scope (Qué NO hace la App Móvil)

Para garantizar velocidad, estabilidad y foco en la experiencia móvil:

- ❌ **NO es un editor CAD de muros complejos:** El trazado milimétrico de muros poligonales complejos y snapping CAD avanzado se realiza en Web/Desktop.
- ❌ **NO reemplaza el nesting de sierra:** La generación de `Plantilla_Optimizer.xlsx` y post-procesadores CNC se realiza en Web/Desktop.
- ❌ **NO es un editor de fórmulas de módulos:** La creación paramétrica de fórmulas y reglas de carpintería se mantiene en la oficina técnica.
- ❌ **NO requiere conexión permanente a internet:** Todas las operaciones críticas de consulta y escaneo deben funcionar offline.

---

## 9. Métricas de Éxito y KPIs

| Métrica de Impacto | Estado Actual (Web/Manual) | Meta con React Native |
|---|---|---|
| **Tiempo de consulta de pieza en taller** | ~45 seg (buscar en hoja impresa) | **< 2 segundos** (escaneo QR) |
| **Trazabilidad de avance de fábrica** | Manual / Fin de día | **En tiempo real** por pieza/módulo |
| **Tiempo de relevamiento fotográfico de obra** | Desordenado en WhatsApp | **1 flujo ordenado** por etapas |
| **Tiempo de envío de cotización en visita** | 1 a 2 días hábiles | **En la misma reunión** (WhatsApp) |
| **Disponibilidad en zonas sin internet** | 0% (la web no carga) | **100% de funciones de campo operativas** |

---

## 10. Referencias y Documentación Relacionada

- [docs/mobile-architecture.md](file:///Users/tiagofur/dev/carpinteria/muebles/docs/mobile-architecture.md) — Arquitectura técnica, integración de monorepo, capas de datos y reutilización de código.
- [docs/mobile-ui-ux.md](file:///Users/tiagofur/dev/carpinteria/muebles/docs/mobile-ui-ux.md) — Sistema de diseño móvil, ergonomía táctil y modo taller.
- [docs/production-module.md](file:///Users/tiagofur/dev/carpinteria/muebles/docs/production-module.md) — Contrato del módulo de producción y estados de piso.
- [packages/domain/src/pieceLabelQr.ts](file:///Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/pieceLabelQr.ts) — Parser oficial del payload QR v2.
