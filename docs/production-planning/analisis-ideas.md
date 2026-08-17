# Análisis de Ideas — Control de Producción

> Basado en `docs/IDEAS/importante-verificar.md` + investigación de sistemas MES,
> trazabilidad QR, y métricas de producción en talleres de carpintería.

---

## Resumen Ejecutivo

El documento plantea **11 puntos críticos** sobre control de producción que van desde
visión del gerente hasta almacén de tableros. Investigamos sistemas como **OpenMES**,
**IMCORE**, **integratePRO**, **INNOVERA**, **Fixner**, **MKWork**, **HOMAG**,
**Cabinet Vision**, **Stolcad**, **TimberCloud**, **Cienapps**, **Cyncly**, **Odoo**,
y **Iwoscan** para extraer las mejores prácticas.

---

## Punto 1: Gerente de Producción — Visión Completa

### Problema actual
No hay forma de ver qué está pasando en cada área de producción en tiempo real.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **OpenMES** | Dashboard supervisor con KPIs en tiempo real, gráficos de throughput, cycle time, tendencias |
| **IMCORE** | "El sistema que conecta el piso de planta con la decisión del director" — dashboard con semáforos |
| **integratePRO** | "Track any job at a click of a button and see workload by week, department and sub process" |
| **INNOVERA** | Target screens con metas diarias, tracking por estación |
| **acpi Cabinets** | Pantallas gigantes con número de producción en tiempo real + bono horario traducido |

### Ideas concretas

1. **Dashboard del Gerente** con vista por área:
   - Cola de corte (piezas pendientes, en proceso, completadas)
   - Cola de ensamble (muebles pendientes, en proceso, completados)
   - Almacén (piezas listas, piezas con problema)
   - Embarque (listos para envío, en tránsito)

2. **Métricas de tiempo por proceso**:
   - Fecha/hora de entrada a cola de corte
   - Fecha/hora de corte completado
   - Tiempo promedio por proceso
   - Identificación de cuellos de botella

3. **Reportes de quién hizo qué**:
   - Nombre del operador por proceso
   - Piezas/hora por operador
   - Comparativa entre operadores

### Pros y Contras

| Pros | Contras |
|------|---------|
| Visibilidad total del proceso | Requiere que cada operador reporte |
| Datos para decisiones de inversión | Puede generar presión sobre operadores |
| Identificación de cuellos de botella | Necesita infraestructura (tablets/pantallas) |
| Base para bonificaciones por desempeño | Resistencia inicial del equipo |

---

## Punto 2: Reporte de Pieza Dañada con QR

### Problema actual
Si una pieza se daña, no se detecta hasta el armado, deteniendo toda la línea.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **Iwoscan** | "Record manufacturing defect immediately, select cause, add replacement quantity automatically" |
| **INNOVERA** | "Receive Damaged Parts / Rework Notifications" — reporte directo desde CNC |
| **Cabinet Vision** | "Defect & Recut Reporting: instant submit from the floor, triggering actions back to office" |
| **Accevo** | "Log defects at the workstation, link to machine/job/product/operator" |
| **HOMAG** | "Rework option: record parts for rework with errors, photos, comments, responsible employee" |

### Ideas concretas

1. **Flujo de escaneo QR para daño**:
   - Escanea QR de la pieza → aparece detalle del proyecto
   - Selecciona tipo de daño (raspón, golpe, error de medida, error de corte, etc.)
   - Opcional: foto del daño
   - El sistema genera automáticamente una pieza de reemplazo en cola
   - Notifica al gerente/encargado

2. **Tipos de daño predefinidos**:
   - Daño en corte (medida incorrecta)
   - Daño en cantoneado (canto despegado)
   - Daño en CNC (perforación incorrecta)
   - Daño físico (golpe, rasión, abolladura)
   - Error de material (tablero equivocado)

3. **Automatización**:
   - Al reportar daño → se crea pieza de reemplazo automáticamente
   - La pieza dañada queda marcada con status "Dañada - Requiere Reemplazo"
   - Si se detecta ANTES del armado → se reprograma sin detener la línea

### Pros y Contras

| Pros | Contras |
|------|---------|
| Detección temprana = menos retrabajo | Requiere escaneo en cada proceso |
| Pieza de reemplazo automática | Puede generar exceso de producción |
| Trazabilidad del daño (quién, dónde, cuándo) | Necesita catálogos de defectos configurados |
| Datos para análisis de causa raíz | Operadores deben reportar consistentemente |

---

## Punto 3: Cola de Cortes y Métricas por Cortador

### Problema actual
No se sabe qué tiene que cortar cada cortador, en qué orden, ni quién cortó qué.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **MKWork** | "Assign parts to machines and operators, track work sessions live, find out real cost per part" |
| **Stolcad** | Piece Work Pay Module — puntos por pieza × coeficiente de estación × tasa del empleado |
| **IMCORE** | "Servicios de corte: el carpintero pide por link, el CC produce y cada pieza viaja con QR" |
| **Fixner** | "Cada trabajador ficha sus tiempos en su propia app" — trazabilidad absoluta |
| **acpi Cabinets** | Bono horario basado en calidad + volumen, visible en pantallas |

### Ideas concretas

1. **Cola de corte por cortador**:
   - Vista de cola ordenada por: fecha de entrega → fecha de envío a producción
   - Si hay 2 cortadores: cada uno ve SU cola
   - Si hay 2 máquinas: se asigna cortador → máquina

2. **Registro de quién cortó**:
   - Al finalizar corte: escaneo o selección de cortador
   - Datos: cortador, máquina, fecha inicio, fecha fin, piezas cortadas

3. **Sistema de bonos por pieza**:
   - Valor configurable por pieza cortada
   - Cálculo automático: piezas × valor = bono
   - Reporte semanal/quincenal/mensual
   - Extensible a todas áreas (armado por muebles, no por piezas)

### Modelo de Bonos (inspirado en Stolcad)

```
Bono = Σ (piezas_cortadas × valor_pieza × coeficiente_dificultad)
```

- **Coeficiente por tipo de corte**: recto = 1.0, curvo = 1.5, complejo = 2.0
- **Coeficiente por material**: MDF = 1.0, contrachapado = 1.2, sólido = 1.5
- **Múltiplo por estación**: corte = 1.0, cantoneado = 0.8, CNC = 1.2

### Pros y Contras

| Pros | Contras |
|------|---------|
| Motivación directa del equipo | Requiere definir valores justos |
| Datos para optimización de产能 | Puede priorizar cantidad sobre calidad |
| Transparencia en compensaciones | Necesita calibración inicial |
| Identificación de top performers | Riesgo de competencia no sana |

---

## Punto 4: Status por Pieza — El Dilema del Escaneo

### Problema actual
¿Escaneamos cada pieza en cada proceso? 200 piezas × 4 procesos = 800 escaneos.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **integratePRO** | "Scan components at each production stage — complete audit trail" |
| **INNOVERA** | Escaneo por CABINET (agrupado), no por pieza individual |
| **IMCORE** | "QR por pieza: corte, canteo, embalaje y entrega validada" |
| **HOMAG** | Batch formation — agrupar piezas por lote, escanear el lote |
| **TimberCloud** | "Scan a barcode to advance" — escaneo por work order, no por pieza |
| **Odoo** | "Scan Cabinet Part Barcode into Bundle/Kit" — agrupación inteligente |

### Solución al dilema: **Escaneo por EVENTO, no por pieza**

En lugar de escanear cada pieza, se escanea por EVENTO significativo:

1. **Escaneo obligatorio** (bajo costo):
   - Inicio de lote/proyecto en cada estación
   - Fin de lote/proyecto en cada estación
   - Reporte de daño (cuando ocurre)

2. **Escaneo automático** (sin costo humano):
   - Cuando el cortador termina un corte → registro automático
   - Cuando la máquina CNC termina → registro automático
   - Lectura de sensores de presencia/ausencia

3. **Escaneo selectivo** (para métricas):
   - Piezas de alto valor o complejas
   - Piezas con historial de problemas
   - Auditorías periódicas

### Modelo Híbrido Recomendado

```
Proceso → Evento Obligatorio → Avance Automático
─────────────────────────────────────────────────
Corte    → Lote inicia         → Piezas completas
         → Lote termina        → Siguiente proceso
         → Daño reportado      → Pieza reemplazo

Cantoneado → Lote inicia       → Piezas completadas
           → Lote termina      → Siguiente proceso

CNC       → Lote inicia        → Piezas completadas
         → Lote termina        → Siguiente proceso

Ensamble  → Mueble inicia      → Mueble completado
         → Mueble termina      → Almacén
```

### Pros y Contras

| Pros | Contras |
|------|---------|
| Costo mínimo de escaneo | Menor granularidad por pieza |
| Avance automático entre procesos | Requiere definir "lotes" inteligentes |
| Detección de daño en tiempo real | No captura tiempo exacto por pieza |
| Balance entre control y eficiencia | Puede perder piezas sueltas |

---

## Punto 4.1: Modelo de Status por Proceso — Fila → Proceso → Finalizado

### Problema crítico
Con 2 máquinas de corte, ambos operadores ven la misma cola. Si no hay control de concurrencia,
**ambos pueden tomar el mismo corte**. Además, el gerente de producción necesita ver QUIÉN
está trabajando en QUÉ, no solo que "algo está en proceso".

### Modelo de estados por proceso

```
┌─────────────────────────────────────────────────────────────────┐
│                    ESTADOS POR PROCESO                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📋 EN COLA (PENDIENTE)                                        │
│  └── Nadie lo ha tomado aún                                    │
│  └── Visible para todos los operadores del área                 │
│  └── Orden: prioridad → fecha entrega                          │
│                                                                 │
│  ⏳ EN PROCESO (ASIGNADO)                                      │
│  └── Un operador lo TOMÓ (claim/lock)                          │
│  └── Dice QUIÉN lo tiene y en qué MÁQUINA                      │
│  └── Los demás operadores NO pueden tomarlo                     │
│  └── Muestra: operador + máquina + hora inicio                  │
│                                                                 │
│  ✅ FINALIZADO                                                  │
│  └── Operador marca como completado                            │
│  └── Registra: piezas cortadas, tiempo, observaciones           │
│  └── Pasa automáticamente al siguiente proceso                 │
│                                                                 │
│  🔴 PROBLEMA (opcional)                                         │
│  └── Pieza dañada, material faltante, etc.                     │
│  └── Bloquea ese proceso hasta resolver                        │
│  └── Notifica al gerente                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de concurrencia (2 máquinas de corte)

```
OPERADOR A (Máquina 1)          OPERADOR B (Máquina 2)
─────────────────────          ─────────────────────
Ve cola: [Corte-001, 002, 003] Ve cola: [Corte-001, 002, 003]

Toma Corte-001                  Toma Corte-002
  ↓                               ↓
Status: ASIGNADO a A            Status: ASIGNADO a B
Máquina: Cortadora 1            Máquina: Cortadora 2
Hora: 08:15                     Hora: 08:16

Cola restante: [003]            Cola restante: [003]

Ninguno puede tomar 001         Ninguno puede tomar 002
porque ya está ASIGNADO         porque ya está ASIGNADO
```

### La "toma" (claim) — Cómo funciona

| Paso | Acción | Resultado |
|------|--------|-----------|
| 1 | Operador abre la cola | Ve solo los que están en COLA |
| 2 | Selecciona un corte | Aparece confirmación: "Tomar Corte-001?" |
| 3 | Confirma | Estado cambia a ASIGNADO, oculto para otros |
| 4 | Trabaja | Timer corre, visible para gerente |
| 5 | Finaliza | Marca completado, pasa al siguiente proceso |

### Qué ve cada rol

#### 👷 Operador de Corte (planta)
```
MI COLA DE CORTE
─────────────────
┌──────────────┬──────────┬──────────┬──────────┐
│ Proyecto     │ Piezas   │ Material │ Estado   │
├──────────────┼──────────┼──────────┼──────────┤
│ Cocina López │ 12       │ MDF 18mm │ ⏳ MI    │
│ Placar García│ 8        │ Contra   │ 📋 Cola  │
│ Repisa Martín│ 4        │ Sólido   │ 📋 Cola  │
└──────────────┴──────────┴──────────┴──────────┘

[TOMAR SIGUIENTE] [FINALIZAR ACTUAL]
```

#### 👔 Gerente de Producción (planta/oficina)
```
VISTA DE PRODUCCIÓN — CORTE
────────────────────────────
Máquina 1: [Juan Pérez] Cocina López — 12 piezas — 08:15-?
Máquina 2: [María García] Placar Ruiz — 8 piezas — 08:16-?

Cola pendiente: 2 proyectos (16 piezas)
Promedio hoy: 45 min/proyecto
```

#### 👔 Gerente de Ventas (oficina — NO planta)
```
MIS PROYECTOS EN PRODUCCIÓN
────────────────────────────
Cocina López:   ████████░░ 80% (En corte)
Placar García:  ███░░░░░░░ 30% (En cola)
Repisa Martín:  ░░░░░░░░░░ 0% (Pendiente)

[Ver detalles] [Contactar planta]
```

### Distinción de Roles — CRÍTICO

| Rol | Ubicación | Ve | Puede hacer |
|-----|-----------|-----|-------------|
| **Gerente Producción** | Planta | Colas, operadores, máquinas, tiempos | Mover, reasignar, priorizar, editar |
| **Gerente Ventas** | Oficina | Estado de SUS proyectos, fechas estimadas | Solo ver, notificar cambios |
| **Operador Corte** | Planta | SU cola de corte | Tomar, trabajar, finalizar |
| **Operador Ensamble** | Planta | SU cola de ensamble | Tomar, trabajar, finalizar |
| **Admin/Sistema** | Donde sea | Todo | Todo (soporte) |

### Por qué son diferentes

- **Gerente Producción**: Necesita saber QUÉ máquina, QUIén está, CUÁNDO empezó, POR QUÉ está parada
- **Gerente Ventas**: Necesita saber CUÁNDO llega, si hay retraso, qué decirle al cliente
- **No deben mezclarse**: El gerente de ventas no necesita ver la cola de corte, el de producción no necesita ver cotizaciones

### Pros y Contras

| Pros | Contras |
|------|---------|
| Evita duplicación de trabajo | Requiere "claim" confiable |
| Visibilidad clara por rol | Más estados que gestionar |
| Trazabilidad completa | Operadores deben ser consistentes |
| Roles separados = foco | Posible confusión inicial |

---

## Punto 5: Orden CNC vs Encintado

### Problema actual
¿Se encinta primero o se CNC primero? Depende de la planta.

### Soluciones investigadas

| Planta típica | Orden | Razón |
|---------------|-------|-------|
| **Mayoría** | Encintado → CNC | Las perforaciones CNC pueden dañar la máquina de encintar |
| **Algunas** | CNC → Encintado | Si el CNC solo hace perforaciones simples |
| **HOMAG** | Configurable | El sistema permite definir el orden por proyecto |

### Ideas concretas

1. **Configuración por proyecto/tipo**:
   - Permitir definir el orden de procesos por tipo de mueble
   - Cocinas: encintado primero (perforaciones complejas)
   - Placares: CNC primero (perforaciones simples)

2. **Regla por defecto configurable**:
   - Default del sistema: Encintado → CNC
   - Override por proyecto cuando sea necesario

3. **Validación automática**:
   - Si el proyecto tiene perforaciones complejas → forzar encintado primero
   - Si solo tiene perforaciones simples → permitir CNC primero

### Pros y Contras

| Pros | Contras |
|------|---------|
| Evita daños a maquinaria | Requiere configuración inicial |
| Flexibilidad por tipo de mueble | Más lógica de negocio que mantener |
| Optimización del flujo | Posible confusión si no está claro |

---

## Punto 6: Admin — Visibilidad y Edición

### Problema actual
El admin solo ve, pero necesita poder mover cosas cuando hay problemas.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **OpenMES** | Admin puede reasignar, priorizar, mover entre colas |
| **Fixner** | "Cambia la prioridad de órdenes urgentes desde tu panel" |
| **Odoo** | "Drag-and-drop rescheduling, move jobs between work centers" |
| **IMCORE** | Auditoría diaria por supervisor vs operario |

### Ideas concretas

1. **Acciones del Admin**:
   - Mover pieza de una cola a otra
   - Reasignar pieza a otro operador
   - Cambiar prioridad de un proyecto
   - Marcar pieza como completada (cuando el sistema no lo detecta)
   - Pausar/reanudar proyecto

2. **Auditoría**:
   - Todo cambio del admin queda registrado
   - Log de quién movió qué y por qué
   - Motivo del cambio (opcional pero recomendado)

### Pros y Contras

| Pros | Contras |
|------|---------|
| Soporte real a la app | Riesgo de cambios no autorizados |
| Resolución de problemas operativos | Necesita logs de auditoría |
| Flexibilidad ante imprevistos | Puede ser abusado sin controles |

---

## Punto 7: Almacén de Herrajes/Accesorios

### Problema actual
No se tiene control de qué accesorios están listos para producción.

### Ideas concretas

1. **Lista de accesorios por proyecto**:
   - Cada proyecto tiene su lista de herrajes/accesorios
   - Status: Pendiente → En almacén → Enviado a planta → Disponible

2. **Escaneo de recepción**:
   - Cuando llegan del proveedor → escaneo → status "Disponible"
   - Alerta si faltan accesorios para proyectos en cola

3. **Control de desinstalación en obra**:
   - Marcar accesorios que se desinstalan de obra para volver a planta
   - Tracking de cuáles regresan y en qué estado

### Pros y Contras

| Pros | Contras |
|------|---------|
| Nunca se empieza un mueble sin herrajes | Requiere conteo físico inicial |
| Alertas tempranas de faltantes | Puede generar sobreinventario |
| Trazabilidad de accesorios | Complejidad de manejo por proyecto |

---

## Punto 8: Almacén de Tableros

### Problema actual
El cortador espera a que surtan el material.

### Soluciones investigadas

| Sistema | Enfoque |
|---------|---------|
| **acadon** | "Board requirements in production derived from cutting order" |
| **HOMAG** | Batch formation agrupa por material para reducir cambios |
| **TimberCloud** | "Cut sheets generate from order itself — no second tool" |
| **Fixner** | "Descuento de material por escaneo y trazabilidad de lotes" |

### Ideas concretas

1. **Lista de tableros a surtir**:
   - Por proyecto: qué tableros necesita y cuáles están listos
   - Por proceso: qué material debe estar en corte antes de empezar
   - Alerta: "Proyecto X necesita 3 tableros MDF 18mm — solo 1 está surtido"

2. **Surtido anticipado**:
   - Cuando se aprueba proyecto → lista de materiales a surtir
   - Almacén prepara material ANTES de que llegue a corte
   - El cortador nunca espera

3. **Stock mínimo por tipo**:
   - MDF 18mm: mínimo 10 tableros
   - Contrachapado 15mm: mínimo 5 tableros
   - Alerta cuando stock < mínimo

### Pros y Contras

| Pros | Contras |
|------|---------|
| Corte sin esperas | Requiere inventario físico preciso |
| Planificación anticipada | Puede generar exceso de stock |
| Optimización de cambios de material | Necesita datos de demanda histórica |

---

## Punto 9: Consideraciones Generales

### Lo que todos los sistemas investigados tienen en común

1. **Trazabilidad de principio a fin**: cada pieza sabe quién la hizo, cuándo, dónde
2. **Dashboard en tiempo real**: no reportes al final del día, sino al momento
3. **Escaneo mínimo eficiente**: no escanear todo, sino lo que genera valor
4. **Automatización donde sea posible**: sensores, fin de ciclo, detección automática
5. **Bonificación por productividad**: datos para motivar al equipo
6. **Detección temprana de problemas**: antes de que detengan la línea
7. **Admin como soporte**: puede mover, reasignar, priorizar

### Prioridad Recomendada de Implementación

| Fase | Componente | Impacto | Esfuerzo |
|------|-----------|---------|----------|
| 1 | Dashboard del Gerente | Alto | Medio |
| 2 | Cola de corte por cortador | Alto | Bajo |
| 3 | Reporte de pieza dañada con QR | Alto | Medio |
| 4 | Métricas y bonos por pieza | Medio | Bajo |
| 5 | Almacén de tableros (surte anticipado) | Medio | Medio |
| 6 | Almacén de herrajes | Medio | Bajo |
| 7 | Admin editable | Medio | Bajo |
| 8 | Orden CNC/Encintado configurable | Bajo | Bajo |

---

## Investigación Adicional Recomendada

- [ ] Revisar **OpenMES** (open source) para patrones de UI
- [ ] Evaluar **IMCORE** para métricas de bonificación
- [ ] Revisar **Stolcad Piece Work Pay** para modelo de puntos
- [ ] Estudiar **INNOVERA** para flujo de kitting/wrapping
- [ ] Revisar **Cabinet Vision Paperless Traveller** para defect reporting
