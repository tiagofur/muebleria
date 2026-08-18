# Arquitectura de Pantallas del Taller — Overview

**Fecha:** 2026-08-17  
**Estado:** Plan aprobado, documentación inicial  
**Alcance:** Reorganización de pantallas del taller por área de trabajo

---

## 0. Problema actual

La pantalla de "Producción" (`ProductionWorkspace` / `ProductionOrderHub`) concentra **3 áreas distintas** en una sola:

| Área | Tabs que hoy están en Producción |
|------|----------------------------------|
| **Ingeniería** | Resumen, Módulos, Despiece, Vistas, Optimización, Documentos |
| **Fábrica** | Piso, Control de Carga, Etiquetas |
| **Almacén** | Herrajes |

Esto genera confusión: un operador de planta ve tabs de ingeniería que no le sirven, y un ingeniero no tiene su propio espacio para verificar documentación antes de enviar a fábrica.

---

## 1. Modelo mental del taller

```
┌─────────────────────────────────────────────────────────────────┐
│                        TALLER MUEBLES                           │
├──────────┬──────────┬───────────────┬──────────────────────────┤
│  VENTAS  │INGENIERÍA│COMPRAS/ALMACÉN│   PRODUCCIÓN/INSTALACIÓN │
│          │          │               │                          │
│ Cotizar  │ Diseñar  │ Comprar       │  Corte → CNC → Encintado │
│ Clientes │ Documentar│ Recibir      │  Armado → Embalaje       │
│ Seguimiento│ Verificar│ Guardar     │  Despacho → Instalación  │
│          │          │ Despachar     │                          │
└──────────┴──────────┴───────────────┴──────────────────────────┘
```

---

## 2. Las 5 pantallas

| # | Pantalla | Reemplaza | Para quién |
|---|----------|-----------|------------|
| 1 | **Dashboard de Ventas** | Nada (nueva) | admin, gerente_ventas, vendedor |
| 2 | **Ingeniería** | Tabs de Producción que son de ingeniería | admin, ingeniero, gerente_produccion (ver) |
| 3 | **Producción** (ex-Fábrica) | Mi Estación + tabs de piso de Producción | admin, gerente_produccion, produccion |
| 4 | **Compras/Almacén** | Tab Herrajes de Producción | admin, gerente_produccion (ver), almacen |
| 5 | **Estado de Planta** | Se mantiene | Todos |
| 6 | **Embarques** (post-plan) | Tabs Despacho/Instalación de Fábrica | admin, gerente_produccion, produccion |

### 2b. Menú canónico (post reorg 2026-08-18)

```
TRABAJO           Inicio · Estado de Planta            (todos)
PRODUCCIÓN        Producción (estaciones) · Embarques · Órdenes* · Dashboard Producción
VENTAS            Dashboard · Cotizaciones · Clientes · Vitrina
INGENIERÍA        Ingeniería
COMPRAS/ALMACÉN   Almacén
LIBRERÍA          Muebles · Estructuras · Agregados · Componentes · Grupos
CATÁLOGOS         Materiales · Cantos · Herrajes · Acabados
CONFIG            Ajustes
```

\* **Órdenes** = la cola + hub por obra (ex menú "Producción"). TEMPORAL.

### M2 — eliminación del hub "Órdenes" (plan, no implementado)

El hub conserva tabs que aún no migran: **Piso** (paperless), **despacho**
(el checklist completo de carga vive ahí; Embarques linkea "Ver control de
carga"), **etiquetas/herrajes** (la generación ya está en Ingeniería —
Documentos; quedan como vista por obra). Pasos: migrar Piso al workspace de
Producción/Embarques → migrar o retirar el checklist de despacho → borrar
nav `production` + `ProductionWorkspace`. Rutas `/produccion/:id` se
redirigen o deprecian.

Más las pantallas que **no se tocan**:
- **Ingeniería ABM** (Composición + Materiales) — ya existe y está bien armada
- **Cotizaciones/Proyectos** — flujo comercial, no se toca

---

## 3. Flujo de datos entre pantallas

```
VENTAS                          INGENIERÍA
Cotización aceptada ──────────→ Diseño + Despiece
                                     │
                                     ├── Genera: Optimizer, CSV, pack
                                     ├── Genera: Etiquetas pieza/módulo
                                     ├── Genera: Lista herrajes
                                     └── Genera: Elevaciones, docs
                                          │
                                          ▼
                              COMPRAS/ALMACÉN
                              Recibe: lista herrajes
                              Recibe: necesita tableros
                              Despacha materiales ──────→ FÁBRICA
                                                           │
                                                           ├── Corte
                                                           ├── Encintado
                                                           ├── CNC
                                                           ├── Armado
                                                           ├── Embalaje
                                                           ├── Despacho
                                                           └── Instalación
```

---

## 4. Decisión clave: Ingeniería genera, Fábrica ejecuta

**Regla:** La documentación de fábrica (Optimizer, etiquetas, herrajes, elevaciones, pack) se **genera** desde Ingeniería y se **usa** en Fábrica/Almacén.

| Documento | Se genera en | Se usa en |
|-----------|-------------|-----------|
| Optimizer (Excel) | Ingeniería → Optimización | Fábrica → Corte |
| Cut-list CSV | Ingeniería → Optimización | Fábrica → Corte |
| Etiquetas pieza (PDF/ZPL) | Ingeniería → Documentos | Fábrica → imprimir en planta |
| Etiquetas módulo (PDF) | Ingeniería → Documentos | Fábrica → imprimir en planta |
| Lista herrajes (Excel) | Ingeniería → Documentos | Almacén → picking |
| Elevaciones (PDF) | Ingeniería → Documentos | Fábrica → armado |
| Pack de producción (ZIP) | Ingeniería → Documentos | Fábrica → todo junto |
| Hojas de armado (PDF) | Ingeniería → Documentos | Fábrica → armado |
| Perforaciones (JSON) | Ingeniería → Documentos | CNC |
| CNC pilot (JSON) | Ingeniería → Documentos | CNC |

**Flujo:** Ingeniería verifica → genera docs → Fábrica imprime y ejecuta.

---

## 5. Roles y visibilidad

| Rol | Dashboard Ventas | Ingeniería | Fábrica | Compras/Almacén | Estado Planta |
|-----|------------------|-----------|---------|----------------|---------------|
| **admin** | ✅ todo | ✅ todo | ✅ todo | ✅ todo | ✅ ver |
| **gerente_ventas** | ✅ todo | 👁 ver | 👁 ver | ❌ | ✅ ver |
| **vendedor** | ✅ cartera | 👁 ver | ❌ | ❌ | ✅ ver |
| **ingeniero** | ❌ | ✅ todo | 👁 ver | ❌ | ✅ ver |
| **gerente_produccion** | ❌ | 👁 ver | ✅ todo | 👁 ver | ✅ ver |
| **produccion** | ❌ | ❌ | ✅ sus sectores | ❌ | ✅ ver |
| **almacen** | ❌ | ❌ | ❌ | ✅ sus materials | ✅ ver |

---

## 6. Documentación por pantalla

Cada pantalla tiene su propio doc con detalle completo:

| Doc | Contenido |
|-----|-----------|
| `01-ventas.md` | Dashboard de Ventas — contenido, métricas, UX |
| `02-ingenieria.md` | Ingeniería — tabs, generación de docs, verificación |
| `03-fabrica.md` | Fábrica — tabs por sector, cola de trabajo, avance |
| `04-compras-almacen.md` | Compras/Almacén — tabs por material, stock, despacho |
| `05-implementation-phases.md` | Fases de implementación — orden, esfuerzo, archivos |
| `06-stock-almacen.md` | Stock real por material — entradas/salidas, mínimos, recepción (fase 3b) |
