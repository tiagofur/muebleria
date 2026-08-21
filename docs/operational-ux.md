# Operational UX — Contrato de interacción para trabajo real de taller

**Estado:** CANÓNICO junto con `docs/design.md`  
**Fecha:** 2026-08-21

`docs/design.md` define el sistema visual, componentes, accesibilidad y craft. Este
documento agrega las reglas de **UX operacional** que nacen del flujo real del taller.
Ante conflicto, seguridad, trazabilidad y prevención de errores físicos prevalecen sobre
preferencias estéticas.

---

## 1. Pregunta de diseño primaria

Antes de preguntar “¿qué haría Apple?” o “¿qué haría Material?”, preguntar:

> **¿Qué necesita la persona que está ejecutando esta tarea real, con prisa, datos
> incompletos y errores que cuestan material o tiempo?**

Apple guía claridad/chrome; Material guía completitud/a11y; el taller define el problema.

---

## 2. Los siete patrones operativos

### 2.1 Queue — qué toca hacer

Una cola responde:

- qué trabajo está disponible;
- prioridad/fecha necesaria;
- bloqueo;
- siguiente acción;
- dueño/estación.

No es un dashboard de KPI. El operador debe poder empezar trabajo desde la cola.

### 2.2 Workspace — hacer el trabajo

El workspace mantiene contexto estable de obra/revisión y contiene las herramientas de
la tarea. Nunca obliga a navegar por cinco áreas para entender el mismo job.

### 2.3 Dashboard — qué necesita atención

Prioriza excepciones, no decoración:

- instalación en riesgo;
- faltante de material;
- revisión stale;
- cola estancada;
- WIP excesivo;
- QC/rework;
- sobrecosto.

Una métrica sin decisión asociada no merece espacio hero.

### 2.4 Gate — por qué no puedo avanzar

Un gate deshabilitado debe explicar:

1. qué falta;
2. quién puede resolverlo;
3. dónde hacerlo;
4. si existe override y quién puede usarlo.

Nunca botón disabled sin explicación.

### 2.5 Exception — qué salió mal

Errores operacionales deben poder convertirse en trabajo:

- blocker;
- quality issue;
- field issue;
- shortage;
- stale revision;
- rejected approval.

No esconderlos sólo en toast.

### 2.6 Audit — quién hizo qué

Acciones de impacto físico/financiero muestran actor y fecha. Timeline y detalles deben
permitir reconstruir decisiones sin revisar logs técnicos.

### 2.7 Scan — qué pasa después de escanear

Todo QR scan debe mostrar inmediatamente:

- qué entidad se identificó;
- proyecto/revisión;
- estado actual;
- acción disponible;
- resultado del scan;
- error accionable si el código no corresponde a la estación/revisión.

---

## 3. Unidad visual según estación

### Corte / CNC / Enchape

UI centrada en **pieza/lote**:

- partCode grande;
- material;
- medidas;
- lado/cara/operación;
- revisión;
- cantidad/instancia;
- siguiente estación;
- QR;
- blocker/rework.

### Armado / QC

UI centrada en **mueble/unidad**:

- código del mueble;
- unidad N de M;
- piezas listas/faltantes;
- herrajes;
- plano/assembly sheet;
- QC.

### Embalaje / Embarque

UI centrada en **unidad/bulto**.

### Instalación

UI centrada en **visita + unidad + ambiente** con planos, fotos, issues y punch.

---

## 4. Project Workspace

El proyecto/job es el contexto transversal.

Vista objetivo:

```text
Overview
Sales
Survey
Design / Revisions
Engineering / Release
BOM
Materials / Purchasing
Production
Shipping
Installation
Costs
Files / Timeline
Warranty
```

No obliga a usar tabs planas; pueden ser secciones/rutas. La regla es que el usuario
pueda seguir la historia completa de una obra desde un solo contexto.

### Header persistente

Debe poder mostrar según rol:

- job code/name;
- cliente;
- stage;
- revisión liberada;
- instalación comprometida;
- owner/PM;
- blocker count.

Evitar repetir KPIs decorativos en cada tab.

---

## 5. Small workshop vs medium business

### Taller pequeño

Reducir navegación visible; una persona puede hacer varios roles.

Superficie sugerida:

```text
Inicio
Ventas / Proyectos
Producción
Materiales
Instalaciones
```

Las capacidades avanzadas viven dentro del job.

### Empresa mediana

Mantener áreas especializadas:

```text
Ventas
Ingeniería
Compras/Almacén
Producción
Logística
Instalación
```

RBAC, preferencias y tamaño del taller pueden controlar presentación sin duplicar dominio.

---

## 6. Data Truth UX

Toda cifra operacional debe tener semántica de verdad.

### Actual

Dato medido/registrado. Puede mostrarse sin prefijo.

### Estimated

Mostrar `Estimado`, `≈` o equivalente.

### Forecast

Mostrar horizonte/fecha y que es pronóstico.

### Proxy

Sólo temporal y visible como aproximación; nunca como KPI ejecutivo principal.

### Missing

Preferir:

```text
—
Sin medir
Sin datos
```

antes que inventar un valor.

---

## 7. Acciones físicas y financieras

Acciones como:

- liberar producción;
- marcar material listo;
- completar corte/CNC;
- scrap/refabricar;
- cargar;
- instalar;
- cerrar punch;
- aprobar change order;

requieren feedback persistente y auditabilidad.

### Confirmación

No confirmar cada click. Confirmar cuando:

- es destructivo;
- cambia revisión/gate;
- mueve stock/costo;
- salta una etapa;
- cierra trabajo con pendientes.

---

## 8. Overrides

Los overrides son válidos para supervisores porque la realidad de taller tiene
excepciones. Pero deben ser explícitos.

Todo override registra:

- actor;
- razón obligatoria;
- timestamp;
- gate saltado;
- impacto conocido.

UI nunca presenta override como acción primaria normal.

---

## 9. Offline y sincronización

Para superficies móviles/taller:

- mostrar claramente estado offline;
- acciones offline se encolan con timestamp local;
- no fingir sincronización exitosa;
- conflictos de revisión no se resuelven silenciosamente;
- un scan de revisión vieja debe advertir antes de registrar ejecución física.

---

## 10. Touch y entorno de taller

Además de WCAG:

- targets táctiles grandes en estaciones/campo;
- alto contraste práctico;
- no depender de hover;
- códigos/medidas legibles a distancia corta;
- evitar tablas demasiado densas en móvil;
- acciones principales accesibles con una mano cuando el flujo lo requiera.

---

## 11. Dashboards exception-first

Ejemplos de alertas con valor:

```text
🔴 JOB-248 — instalación viernes, faltan 4 bisagras
🔴 JOB-251 — diseño v7 ≠ producción liberada v6
🟡 JOB-233 — ingeniería 4 días sin avance
🟡 CNC — 17 piezas bloqueadas por material
🟢 3 obras listas para embarque
```

Evitar grids de tarjetas idénticas que sólo muestran totales sin acción.

---

## 12. Checklist de review UX operacional

Antes de aprobar una pantalla:

- ¿la unidad de trabajo es correcta: pieza, mueble, bulto, visita o proyecto?;
- ¿se distingue estado real de estimado?;
- ¿se ve la revisión cuando importa?;
- ¿un bloqueo explica cómo resolverlo?;
- ¿el operador entiende qué hacer ahora?;
- ¿el supervisor entiende qué está en riesgo?;
- ¿una acción física deja rastro?;
- ¿hay una sola primaria por contexto?;
- ¿la pantalla funciona bajo presión y no sólo en demo?;
- ¿la excepción se vuelve trabajo y no sólo toast?
