# Roadmap Comercial v2 — Prioridad vigente

> **Estado:** ACTIVO  
> **Actualizado:** 2026-08-21  
> **Norte:** producto vendible y operable en talleres reales de LatAm.

Este documento sigue siendo la fuente narrativa del roadmap comercial, pero desde
2026-08-21 se complementa con `docs/operational-core-v1.md` para la consolidación
operativa. GitHub issues contienen trabajo futuro; `feature_list.json` es ledger de
implementación/historia y no sustituye la priorización narrativa.

---

## 0. Propuesta de valor actualizada

> **Plataforma operativa de muebles: cotizar, proyectar, preparar materiales, producir,
> instalar y saber si la obra fue rentable.**

Más simple de aprender que soluciones pesadas, más profunda que Excel y específica al
lenguaje del taller.

Diferenciadores:

1. cotización rápida con BOM real;
2. Proyectar 2D/3D conectado a producción;
3. corte/etiquetas/CNC integrados al mismo job;
4. flujo material→taller→instalación trazable;
5. rentabilidad por obra como objetivo de Operational Core;
6. UX en español y adaptada a talleres pequeños/medianos.

Dos modos comerciales siguen coexistiendo:

- **Proyectar:** trabajo espacial/3D;
- **Cotizar rápido:** catálogo + opciones sin abrir 3D.

---

## 1. Decisiones cerradas

| # | Decisión | Elección |
|---|---|---|
| D1 | Añadir muebles | Mejorar flujo actual; no copiar barra Promob |
| D2 | Acabados herrajes | Variantes predefinidas primero |
| D3 | Inspector | Evolución del inspector actual, no arquitectura paralela |
| D4 | Fuentes de planificación | Roadmap narrativo + GitHub issues; feature_list como ledger |
| D5 | Nesting | Nativo permitido; sierra y CNC son estrategias distintas |
| D6 | CNC de marca | Postprocesador específico sólo con máquina real confirmada |
| D7 | Granularidad producción | **Corte/CNC/Enchape por pieza; Armado+ por mueble/unidad/bulto** |
| D8 | Próxima prioridad | Tras cerrar F128, Operational Core gana prioridad por defecto |
| D9 | Validación | Pilotos reales compiten con features profundas por prioridad |

---

## 2. Estado real a 2026-08-21

El producto ya superó el roadmap inicial en varias áreas:

- Proyectar/3D avanzado;
- herrajes y placements;
- production workspace y estaciones;
- mobile companion;
- stock + purchase orders;
- dashboards por área;
- cut-plan 2D guillotina;
- CNC nesting + DXF;
- machining profiles;
- F128 drilling resolution en cierre/avance actual.

Por eso las fases A/B/C históricas ya no deben leerse como “todo pendiente”. Ver
`feature_list.json`, código y `docs/documentation-sync-2026-08-21.md` para reconciliar.

---

## 3. Prioridad inmediata — cerrar trabajo activo

### F128 — Drilling Resolution Engine

Se termina correctamente, con tests y wiring acordado. No se abandona una feature
profunda a medio implementar sólo por el cambio de prioridades.

---

## 4. Fase O0 — Guardrails y verdad del producto (P0)

Fuente: `docs/operational-core-v1.md` OC-001–006.

Objetivos:

- arreglar `init.sh`;
- CI remoto obligatorio;
- reconciliar roadmap/issues/feature ledger;
- roles canónicos;
- DTO auth seguro;
- Data Truth Contract para dashboards.

**Resultado:** “done”, “verde”, “rol” y “KPI real” vuelven a tener significado único.

---

## 5. Fase O1 — Lifecycle + aprobación + Production Release (P0)

OC-010–024.

Entregables:

- `ProjectEvent[]`;
- commercial status real incluyendo won/lost;
- stage derivado;
- anticipo real;
- DesignRevision;
- Approval;
- ProductionRelease;
- stale detection;
- ChangeOrder.

**Resultado:** siempre sabemos qué se vendió, qué se aprobó y qué revisión se fabricó.

---

## 6. Fase O2 — Producción física pieza→mueble (P0)

OC-030–034 + `docs/production-flow-v2.md`.

### Antes de Armado

```text
Corte → CNC → Enchape
```

seguimiento por pieza física/ruta.

### Armado y después

```text
Armado → QC → Empaque → Carga → Instalación
```

seguimiento por mueble/unidad/bulto.

**Resultado:** CNC y scans dejan de depender de un status demasiado grueso por línea de
mueble.

---

## 7. Fase O3 — Materiales + QC (P1)

OC-050–062.

- requirements desde BOM liberado;
- reservas;
- shortage;
- PO/receiving ligado a need-by/project;
- material-ready con evidencia;
- QualityIssue;
- rework/scrap;
- QC gates.

**Resultado:** materiales y calidad forman parte del job, no módulos paralelos.

---

## 8. Fase O4 — Instalación y closeout (P1)

OC-070–074.

- InstallationJob;
- visitas;
- crews;
- field issues;
- punch list;
- client sign-off/closeout.

**Resultado:** “installed” deja de significar artificialmente “todo terminó”.

---

## 9. Fase O5 — Job Costing (P1)

OC-080–084.

- CostBaseline;
- TimeEntry;
- material actual;
- other actuals;
- estimate vs actual;
- actual margin.

**Resultado:** el dueño sabe qué tipo de obra realmente gana dinero.

---

## 10. Trabajo transversal

### Site Survey

OC-040/041 puede avanzar en paralelo cuando haya capacidad: medidas de campo deben
diferenciar preliminar/levantada/aprobada/fabricación cuando aplique.

### Operational UX / Project Workspace

OC-090+:

- dashboards exception-first;
- proyecto/job como contexto transversal;
- navegación simplificada para talleres pequeños;
- navegación departamental para empresas medianas.

### Pilotos

No esperar a que termine todo Operational Core para probar. Empezar/continuar pilotos
desde ahora con lo ya funcional.

---

## 11. F129–F131 y CNC profundo

Siguen siendo features válidas:

- F129 joint drilling rules;
- F130 drilling DXF export;
- F131 visual drilling editor.

### Nueva regla de prioridad

Después de F128, **no desplazan automáticamente Operational Core**.

Se priorizan si:

1. un taller piloto real necesita la capacidad para operar;
2. desbloquean una venta/piloto concreto;
3. el costo es pequeño y completa una cadena ya usada;
4. producto decide explícitamente asumir el tradeoff.

F132 postprocesador SCM sigue postergado hasta máquina/software confirmados.

---

## 12. Lanzamiento y comercial

El trabajo histórico de F075–F077 sigue siendo importante:

- packaging/installable release;
- onboarding/demo data;
- pricing/landing/demo script.

No debe quedar eternamente detrás de features técnicas. La validación comercial es parte
del producto, no “trabajo para después de terminar”.

---

## 13. Features congeladas/condicionadas

Por defecto requieren demanda demostrada:

- SketchUp plugin;
- render premium backend;
- acabados extremadamente complejos;
- postprocesadores de marca;
- CAD libre;
- marketplace;
- forecasting/multi-planta avanzado.

El trigger es evidencia de cliente, no curiosidad técnica.

---

## 14. Anti-scope

- no Promob completo;
- no SketchUp interno;
- no contabilidad fiscal/nómina;
- no ERP horizontal;
- no CAM universal;
- no construir integraciones de máquina sin hardware real;
- no dashboards con proxies disfrazados de datos reales.

---

## 15. Métricas de éxito

### Fase piloto

- 3–5 talleres reales;
- cocina/proyecto típico cotizado sin Excel manual;
- al menos una obra atraviesa venta→producción→instalación;
- registrar fricciones reales;
- ninguna revisión equivocada fabricada por falta de gate;
- shortages visibles antes de corte;
- medir retrabajos y pendientes de instalación.

### 12 meses

- 15–30 talleres pagando como objetivo orientativo;
- MRR compatible con pricing validado;
- quote time <15 min en catálogo conocido;
- job margin real disponible;
- evidencia de reducción de errores/retrabajo.

---

## 16. Cómo se actualiza este roadmap

- narrativa/prioridad: este archivo;
- contrato de producto: `docs/prd-v2.md`;
- plan operativo: `docs/operational-core-v1.md`;
- ejecución futura: GitHub issues;
- implementación/historia: `feature_list.json` + código/tests;
- divergencias: `docs/documentation-sync-2026-08-21.md`.

Al cerrar una capacidad grande, actualizar roadmap y docs canónicos; no limitarse a
marcar un JSON `done`.
