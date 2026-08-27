# Production Flow v2 — De pieza a mueble completo

**Estado:** CANÓNICO para el modelo físico objetivo de producción  
**Fecha:** 2026-08-21

---

## 1. Decisión de producto

La producción no tiene una única granularidad desde el corte hasta la instalación.

> **Corte, CNC y Enchape trabajan piezas. Armado consume piezas terminadas y produce muebles/unidades completas. Desde Armado en adelante el seguimiento principal es por mueble/unidad/bulto.**

Ésta es una invariante física y debe reflejarse en dominio, UI, QR, métricas y API.

---

## 2. Fase A — producción por pieza

### Estaciones

1. Corte / seccionadora / sierra
2. CNC / mecanizado / perforado
3. Enchape / canteado / encintado

### Unidad de trabajo

`PartInstance` o equivalente: una pieza física específica de una unidad específica de un mueble.

No basta con `ResolvedBoardPart.quantity = 4`; para ejecución necesitamos poder distinguir cada copia cuando haga falta.

### Identidad recomendada

```text
Project
  └── ProjectItem (mueble/línea)
       └── Unit 1..N
            └── PartInstance
```

Campos conceptuales:

```ts
type PartInstance = {
  id: string;
  projectId: string;
  productionRevision: string;
  projectItemId: string;
  unitIndex: number;
  partCode: string;
  partDefinitionId?: string;
  materialId: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  requiredOperations: readonly PartOperation[];
};
```

---

## 3. Routing por pieza

No todas las piezas siguen la misma ruta.

Ejemplos:

```text
Lateral con perforaciones + canto
Cut → CNC → Edge → Ready for assembly

Piso sin CNC + canto
Cut → Edge → Ready for assembly

Trasera sin canto ni mecanizado posterior
Cut → Ready for assembly

Pieza producida por nesting CNC completo
CNC nesting → Edge → Ready for assembly
```

La ruta debe derivarse de los requerimientos reales de la pieza y configuración del taller.

### `PartOperation`

Tipos iniciales sugeridos:

```text
cut
cnc
edge_banding
inspection
```

Estados de operación:

```text
queued
in_progress
completed
blocked
rework
skipped
```

---

## 4. Corte

Corte es responsable de producir la geometría base de la pieza desde tablero.

Debe conocer:

- material/tablero;
- dimensiones de corte;
- veta;
- revisión;
- plan de corte;
- partCode;
- cantidad/instancias;
- siguiente estación.

Una pieza cortada no implica que todo el mueble esté “cortado”.

---

## 5. CNC

CNC trabaja piezas concretas y caras concretas.

Debe integrar gradualmente:

- `HardwareMachiningProfile`;
- drilling resolver;
- operaciones por cara;
- DXF/export específico;
- revisión/fingerprint;
- estado por pieza.

### Regla de seguridad

El output CNC siempre debe poder responder:

> ¿A qué `PartInstance`, proyecto, mueble, unidad y revisión pertenece este archivo/operación?

---

## 6. Enchape / canteado

La estación trabaja pieza por pieza y debe conocer:

- lados requeridos;
- código de canto;
- espesor;
- instrucciones;
- partCode / QR;
- revisión;
- siguiente estado.

Puede procesar una pieza aunque otras del mismo mueble sigan en CNC.

---

## 7. Ready for assembly

Una pieza llega a `ready_for_assembly` cuando todas sus operaciones requeridas están completas.

Un mueble/unidad está `assembly_ready` cuando:

- todas sus piezas obligatorias están ready;
- herrajes requeridos están disponibles cuando la regla de taller lo exija;
- no tiene blockers críticos;
- la revisión sigue siendo la liberada.

Override supervisor permitido sólo con razón y evento de auditoría.

---

## 8. Fase B — producción por mueble/unidad

Armado es el punto de convergencia.

### Unidad de trabajo

`ModuleUnitExecution` representa una unidad física de una línea de proyecto.

```text
ProjectItem quantity=3
  → Unit 1
  → Unit 2
  → Unit 3
```

Cada unidad puede terminar en tiempos distintos y tener su propio QR/bulto.

Estados recomendados:

```text
awaiting_parts
assembly
module_qc
packaged
loaded
installed
```

---

## 9. Armado

Entrada:

- set de `PartInstance` ready;
- herrajes/material auxiliar;
- planos/assembly sheet correctos;
- revisión vigente.

Salida:

> **mueble/unidad física completa**

Desde aquí, la pieza deja de ser la unidad principal de seguimiento, excepto para incidencias/retrabajos.

---

## 10. QC del mueble

QC verifica el conjunto, por ejemplo:

- escuadra;
- dimensiones principales;
- herrajes;
- puertas/cajones;
- acabado;
- identificación;
- revisión correcta.

Un fallo genera `QualityIssue` y puede reabrir una pieza o requerir refabricación.

---

## 11. Embalaje y bultos

Una unidad puede producir uno o varios bultos.

Conceptualmente:

```text
ModuleUnit
  └── Package 1..N
```

Cada bulto debe poder llevar:

- projectId;
- item/unit;
- packageIndex / totalPackages;
- revisión;
- destino/ambiente;
- QR.

El contrato QR existente debe evolucionar de forma backward-compatible.

---

## 12. Carga y embarque

Carga escanea bultos/unidades, no piezas sueltas salvo excepción.

Estados/logística sugerida:

```text
packaged
staged
loaded
shipped/delivered
```

El sistema debe poder detectar:

- bulto esperado no cargado;
- bulto duplicado;
- revisión incorrecta;
- unidad parcialmente cargada.

---

## 13. Instalación

Instalación trabaja muebles/unidades y visitas de campo.

`installed` significa que una unidad fue colocada, no necesariamente que el proyecto esté cerrado.

Proyecto cerrado requiere, según workflow:

- unidades instaladas;
- Field Issues resueltos o aceptados;
- Punch List cerrado;
- conformidad/sign-off.

---

## 14. Calidad y excepciones a nivel pieza

Aunque el flujo principal cambie a mueble desde Armado, una incidencia puede volver a pieza:

```text
QC detecta frente rayado
  ↓
QualityIssue
  ↓
Refabricate PartInstance
  ↓
Cut/CNC/Edge
  ↓
Rejoin ModuleUnit
```

La historia debe conservar el costo y el tiempo del retrabajo.

---

## 15. Relación con el modelo actual

Hoy `ItemFloorStatus`:

```text
pending → cut → edged → assembled → packaged → loaded → installed
```

vive a nivel `ProjectItem`. Es útil como resumen legacy pero mezcla dos granularidades.

### Migración propuesta

1. introducir ejecución por pieza para Cut/CNC/Edge;
2. mantener `floorStatus` como resumen derivado temporal;
3. introducir unidades físicas para Assembly+;
4. migrar estaciones y scans gradualmente;
5. deprecar mutaciones directas de `ProjectItem.floorStatus` cuando todos los consumidores estén adaptados.

### Estado de implementación (F136 / #301)

Pasos 1–3 implementados; 4–5 en curso con esta política de bridge:

- `floorStatus` se re-deriva desde piezas/unidades en cada avance físico
  (endpoints `POST /api/projects/{id}/parts/{partId}/advance`,
  `.../units/{unitId}/advance`, `.../rework`, `.../assembly-override`),
  dentro de una transacción con lock de fila (`SELECT … FOR UPDATE`) para que
  escaneos concurrentes no se pisen.
- Las mutaciones directas legacy (`floor-scan` y
  `PATCH .../items/{itemId}/floor-status`) responden `409` para líneas que ya
  tienen unidades físicas: desde ese punto la verdad es la unidad/pieza y el
  estado del item es derivado. Líneas sin unidades siguen el flujo legacy.
- El gate de armado bloquea también contra revisión liberada distinta
  (piezas/unidad de una revisión anterior); sólo un override supervisor
  auditado lo habilita.
- Generación: `PUT /api/projects/{id}/part-executions` persiste las
  instancias derivadas del BOM (la resolución vive en TS) tras validar
  server-side líneas/cantidades/revisión liberada; regenerar sobre avance
  físico existente exige `force` de supervisión y queda auditado.
- Escáner (móvil): QR de pieza (`pId`) completa la operación actual vía el
  endpoint de pieza; QR de unidad/bulto (`uId`) avanza la unidad por el
  gate server-side. Un bulto se identifica por multiplicidad (bulto/tot > 1)
  y al empaquetar se registra `package_count` en la unidad.
- Dashboards: `buildProjectFloorSummary` cambia a modo físico cuando hay
  ejecución generada — Corte/Enchape cuentan piezas, Armado+ cuenta
  unidades (las piezas en CNC cuentan como cola de Enchape, en tránsito).
- Costing de rework (OC-061): el endpoint de retrabajo acepta
  `material_cost`/`labor_minutes` y los registra en el payload de los
  eventos `quality_issue_reported`/`rework_started` para job costing.

---

## 16. Métricas correctas por estación

### Pieza

Corte/CNC/Enchape:

- queued pieces;
- completed pieces;
- WIP;
- blocked pieces;
- rework/scrap;
- tiempo por pieza/lote;
- throughput.

### Mueble

Armado/QC/Empaque/Carga/Instalación:

- units queued;
- units completed;
- packages;
- first-pass QC;
- loaded completeness;
- installation completion.

No calcular “piezas” multiplicando muebles por una constante.

---

## 17. Reglas de UI

### Operador de Corte/CNC/Enchape

Ve trabajo accionable por pieza/lote:

- código grande;
- material;
- dimensiones;
- operación;
- QR;
- revisión;
- siguiente paso;
- blockers.

### Armador

Ve unidades listas para armar y faltantes:

> GAB-04 unidad 2 — 8/9 piezas listas — falta FRENTE-01 en Enchape.

### Embarque

Ve bultos/unidades y completeness.

### Instalador

Ve unidades, ambiente, ubicación, planos, visitas, issues y punch.

> "Instalador" es la persona/estación, no un rol del sistema: la pantalla
> Instalaciones la trabajan usuarios con rol `produccion`,
> `gerente_produccion` o `admin` (no existe un rol `instalador` en
> `contracts/roles.json`).

---

## 18. Definition of Done de la migración física

- se puede saber dónde está cada pieza antes de armado;
- una pieza puede quedar en CNC sin marcar todo el mueble en CNC;
- Armado conoce exactamente qué piezas espera;
- cantidad >1 produce unidades físicas diferenciables;
- QR identifica nivel correcto;
- QC/rework puede refabricar una sola pieza;
- dashboards de Cut/CNC/Edge cuentan piezas reales;
- dashboards Assembly+ cuentan unidades/bultos reales;
- status legacy no contradice la verdad nueva.
