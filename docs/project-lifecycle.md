# Project Lifecycle — Modelo de eventos y trazabilidad de tiempos

> Fuente de verdad del ciclo de vida de un proyecto. Todos los timestamps son
> ISO datetime **con hora** (`2026-08-17T15:32:00-06:00`). Nunca solo fecha.

---

## 1. Diagrama de flujo

```
[Ventas]
  quote_created         → vendedor crea la cotización
  quote_sent            → cotización enviada al cliente
  client_accepted       → cliente dice que sí (verbal o firmado)
  deposit_received      → pago recibido ★ ENTRA EN COLA DE INGENIERÍA

[Ingeniería]
  engineering_started   → ingeniero hace click en "Iniciar ingeniería"
  sent_to_production    → ingeniero hace click en "Enviar a producción"
                          ★ REQUIERE DOCUMENTOS GENERADOS (ver §3)

[Fábrica]
  production_started    → fábrica arranca el proyecto
  production_completed  → fábrica terminó todas las piezas

[Despacho / Entrega]
  shipped               → material despachado
  installed             → instalación completada en obra
```

---

## 2. Modelo de datos

```ts
type ProjectEventType =
  | 'quote_created'
  | 'quote_sent'
  | 'client_accepted'
  | 'deposit_received'
  | 'engineering_started'
  | 'sent_to_production'
  | 'production_started'
  | 'production_completed'
  | 'shipped'
  | 'installed';

type ProjectEvent = {
  event:  ProjectEventType;
  by:     string;    // userId — quién realizó la acción
  at:     string;    // ISO datetime con hora — cuándo ocurrió
  note?:  string;    // comentario opcional (ej: "cliente pagó 50% anticipo")
};

// En el proyecto:
// events: ProjectEvent[]   (log cronológico, append-only)
```

---

## 3. Gate "Enviar a producción"

El botón **Enviar a producción** está **bloqueado** hasta que todos los documentos
requeridos hayan sido generados. El sistema valida en tiempo real.

### Documentos requeridos (todos obligatorios)

| Documento | Generado cuando... |
|-----------|-------------------|
| Optimizer (Excel) | Click en `[▶ Generar Optimizer]` |
| Lista de herrajes (Excel) | Generado automáticamente con el Optimizer |
| Cut-list CSV | Click en `[▶ Generar CSV]` |
| Etiquetas pieza (PDF) | Click en `[▶ Generar etiquetas]` |

### Estructura de control

```ts
type RequiredDocument =
  | 'optimizer'
  | 'hardware_list'
  | 'cut_list_csv'
  | 'labels_pdf';

type GeneratedDoc = {
  generatedAt: string;   // ISO datetime con hora
  generatedBy: string;   // userId
};

type GeneratedDocuments = {
  [K in RequiredDocument]?: GeneratedDoc;
};

// generatedDocuments vive dentro de engineeringLog
```

### UX del gate

```
— mientras faltan docs:
┌─────────────────────────────────────────────────────────┐
│  Documentos requeridos:                                 │
│  ✅ Optimizer          15/08 15:32 · Carlos R.          │
│  ✅ Lista herrajes     15/08 15:32 · Carlos R.          │
│  ⬜ Cut-list CSV       pendiente                        │
│  ⬜ Etiquetas PDF      pendiente                        │
│                                                         │
│  [Enviar a producción]   ← DESHABILITADO                │
│  Faltan: Cut-list CSV, Etiquetas PDF                    │
└─────────────────────────────────────────────────────────┘

— cuando todos están generados:
┌─────────────────────────────────────────────────────────┐
│  ✅ Optimizer  ✅ Herrajes  ✅ CSV  ✅ Etiquetas         │
│                                                         │
│  [✔ Enviar a producción]   ← HABILITADO                 │
└─────────────────────────────────────────────────────────┘
```

---

## 4. EngineeringLog completo

```ts
type EngineeringLog = {
  startedBy:           string;              // userId
  startedAt:           string;              // ISO datetime con hora
  generatedDocuments:  GeneratedDocuments;  // gate para enviar a producción
  sentToProductionBy:  string;              // userId
  sentToProductionAt:  string;              // ISO datetime con hora
  revision:            number;              // 1, 2, 3... (sube con cada regeneración)
};
```

---

## 5. Tiempos medibles

| KPI | Desde | Hasta |
|-----|-------|-------|
| **Ciclo de venta** | `quote_created` | `client_accepted` |
| **Tiempo para cobrar** | `client_accepted` | `deposit_received` |
| **Espera en cola de Ingeniería** | `deposit_received` | `engineering_started` |
| **Proceso de Ingeniería** | `engineering_started` | `sent_to_production` |
| **Espera en cola de Fábrica** | `sent_to_production` | `production_started` |
| **Proceso de Producción** | `production_started` | `production_completed` |
| **Lead time total** | `client_accepted` | `shipped` |
| **Lead time completo** | `quote_created` | `installed` |

---

## 6. Reglas de negocio

1. **`deposit_received` es la puerta de entrada a Ingeniería.** Un proyecto no aparece
   en la pantalla de Ingeniería hasta que este evento está registrado.
2. **"Enviar a producción" requiere los 4 documentos generados.** El botón está
   deshabilitado y muestra qué falta. No hay bypass.
3. **Los eventos son append-only.** No se editan ni eliminan. Si hay una corrección,
   se registra un nuevo evento con `note`.
4. **Todos los timestamps son datetime con hora.** Nunca solo fecha.
5. **Si el ingeniero regenera documentos**, `generatedDocuments` se actualiza (cada
   doc tiene su propio `generatedAt`) y `revision` sube.

---

## 7. Impacto en pantallas

| Pantalla | Registra eventos |
|----------|-----------------|
| **Ventas** | `quote_created`, `quote_sent`, `client_accepted`, `deposit_received` |
| **Ingeniería landing** | Muestra proyectos con `deposit_received` sin `sent_to_production` |
| **Ingeniería workspace** | `engineering_started`, actualiza `generatedDocuments`, `sent_to_production` |
| **Fábrica** | `production_started`, `production_completed`, `shipped` |
| **Reportes / Stats** | Lee todos los eventos para calcular tiempos por fase |

---

## 8. Implementación del gating por etapa (2026-08-18)

El paso secuencial entre áreas está implementado en `packages/domain/src/processStage.ts`
(`projectProcessStage` deriva `ventas → ingeniería → almacén → producción`):

| Etapa | Entrada (gate) | Pantallas |
|-------|----------------|-----------|
| ventas | status draft/quoted | Cotizaciones / Dashboard Ventas |
| ingeniería | `accepted` sin `sentToProductionAt` | **solo** landing Ingeniería (los enviados pasan a sección "Enviadas") |
| almacén | `sentToProductionAt` sin `materialsRelease` | **solo** Compras/Almacén (botón "Material completo") |
| producción | `materialsRelease` estampado | Fábrica (estaciones) + Órdenes |

`canSendToProduction` exige ingeniería **documentada** antes del handshake (§3);
`canReleaseMaterials` exige que Ingeniería haya enviado antes de liberar material.
El event log completo `ProjectEvent[]` de este doc sigue **pendiente** — los stamps
`engineeringLog` y `materialsRelease` cubren el gating y la auditoría básica (quién/cuándo).

## 9. Referencia cruzada

- Pantallas de Ingeniería → `docs/roadmap-screens/02-ingenieria.md`
- Pantallas de Ventas → `docs/roadmap-screens/01-ventas.md`
- Pantallas de Fábrica → `docs/roadmap-screens/03-fabrica.md`
