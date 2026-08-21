# Proyectar 3D — Roadmap vNext

**Estado:** ACTIVO para evolución de Proyectar  
**Fecha:** 2026-08-21  
**North Star:** `docs/proyectar-3d-north-star.md`

> Este roadmap traduce el North Star de Proyectar en olas implementables. Reutiliza
> issues existentes cuando ya describen trabajo válido; no duplica features sólo para
> cambiarles el nombre.

---

## 0. Regla de prioridad

Proyectar es uno de los tres pilares de Mueblería y puede avanzar en paralelo con
Operational Core cuando hay capacidad, pero no debe romper las prioridades críticas de
verdad/lifecycle/producción.

Prioridad sugerida:

1. cerrar trabajo activo;
2. Operational Core O0/O1 cuando bloqueen verdad o seguridad;
3. Proyectar UX de alto impacto y bajo riesgo;
4. profundizaciones técnicas según pilotos/ventas.

No necesitamos esperar a “terminar ERP” para mejorar Proyectar. Tampoco debemos usar
Proyectar como excusa para posponer gates operacionales críticos.

---

## 1. Mapa de capacidades

### Ya existen issues útiles que se conservan

| Área | Issue(s) existente(s) | Rol en vNext |
|---|---|---|
| Drag de mueble al ambiente | #277 / F065 | base de inserción 5★ |
| Inspector contextual | #278 / F066 | base de propiedades 5★ |
| Materiales drag/apply | #279 / F067 | base de material workflow 5★ |
| Herrajes 3D | #280–#282 / F068–F070 | hardware UX |
| Ambient materials | #266 | piso/pared/room look |
| Presentación cliente | #260 | presentation 4★ |
| Agregados paramétricos/UI/3D/export | #294–#297 | aggregates 5★ |
| Multi-space producción | #254–#256 | referencia de coherencia multi-space; no sustituye Proyectar UX |

Estos issues deben leer `docs/proyectar-3d-north-star.md` cuando se implementen.

---

## 2. Ola P3D-0 — Workspace 3D y biblioteca persistente

### Objetivo

Hacer que Proyectar tenga un modelo mental inmediato:

```text
Biblioteca → Canvas → Inspector
```

con materiales siempre accesibles.

### Entregables

- shell de Proyectar optimizado para el editor;
- biblioteca lateral persistente de muebles;
- búsqueda;
- categorías jerárquicas;
- thumbnails;
- favoritos;
- recientes;
- biblioteca “Mi taller”;
- estado de categoría/búsqueda preservado;
- material dock/library integrado al workspace;
- responsive behavior documentado para desktop/tablet.

### DoD

- usuario nuevo encuentra un módulo común sin conocer código;
- no necesita salir de Proyectar para buscar el siguiente mueble;
- catálogo con cientos de módulos sigue usable;
- interacción no roba área crítica al canvas;
- keyboard/a11y básicos disponibles.

---

## 3. Ola P3D-1 — Insert / Selection / Manipulation 5★

### Reutiliza

- #277 para drag-insertion.

### Completa

- selección jerárquica;
- multi-select;
- copy/paste;
- duplicate;
- align/distribute;
- nudge teclado;
- snap configurable;
- guías temporales;
- fit selection;
- target feedback;
- undo/redo de intenciones completas.

### Regla

El usuario trabaja en lenguaje de taller/espacio, no en world coordinates.

### DoD

Un usuario puede insertar 3 muebles, duplicar, alinear y ajustar offsets con precisión
sin abrir formularios técnicos ni luchar con la cámara.

---

## 4. Ola P3D-2 — Inspector + Materials 5★

### Reutiliza

- #278 inspector;
- #279 materiales.

### Completa

- inspector único contextual para ambiente/mueble/agregado/pieza/herraje;
- progressive disclosure;
- scopes de material: pieza / frentes del mueble / proyecto;
- material favorites/recent;
- feedback de impacto en precio/BOM;
- stale flow si corresponde;
- undo de material.

### DoD

Cambiar un material común debe ser una acción de segundos y siempre quedar claro qué
scope se modificó.

---

## 5. Ola P3D-3 — Agregados + hardware de lenguaje humano

### Reutiliza

- #294 motor local de agregados;
- #295 UI;
- #296 jerarquía/visual 3D;
- #297 trazabilidad BOM/export;
- #280–#282 hardware.

### Objetivo

El usuario dice “añadir 3 cajones”, no “crear tres ModuleAgregadoInstance”.

### DoD

- agregar cajonera/puertas/entrepaños es directo;
- preview inmediata;
- cantidad/spacing/hardware/material configurables;
- BOM y drilling correctos;
- selección del agregado cuando ayuda;
- detalle técnico opcional, no requisito.

---

## 6. Ola P3D-4 — Environment Authoring + Multi-space 5★

### Objetivo

El ambiente debe sentirse tan sólido como los muebles.

### Entregables

- crear/editar muros con lenguaje dimensional claro;
- openings/obstáculos donde el dominio los soporte;
- quick views planta/perspectiva/frontal;
- fit room;
- switch de ambiente explícito;
- preservación razonable de cámara por ambiente;
- materiales de piso/pared;
- evitar mezcla accidental de spaces;
- room helpers no contaminan presentación/BOM.

### DoD

Usuario crea una cocina básica y cambia entre Cocina/Baño sin ambigüedad de qué objetos
pertenecen a qué ambiente.

---

## 7. Ola P3D-5 — Presentation 4★

### Reutiliza

- #260.

### Objetivo

Separar edición de venta/presentación.

### Entregables

- chrome de cliente mínimo;
- multi-space claro;
- capturas consistentes;
- vistas limpias;
- materiales correctos;
- comparación de opciones cuando aporte;
- compartir/exportar sin herramientas de taller visibles.

No convertir esto en renderer offline pesado salvo demanda.

---

## 8. Ola P3D-6 — Performance & Interaction Budget

### Objetivo

Hacer explícito el performance como requisito de producto, no optimización tardía.

### Entregables

- fixture de escena de referencia;
- métricas de draw calls/triangles/textures;
- profiling React;
- profiling raycast;
- tracking de geometry rebuilds;
- límites/alertas acordados;
- workers/caching/instancing sólo donde las métricas lo justifiquen;
- test de interacción sobre hardware objetivo de taller.

### DoD

No se acepta una feature visual que degrada materialmente drag/orbit/selection en la
escena de referencia sin tradeoff explícito.

---

## 9. Ola P3D-7 — Design → Business → Production 5★+

### Objetivo

Probar que Proyectar no es un silo.

### Casos canónicos

#### Cambio de material

```text
Material UI
→ design state
→ resolved BOM
→ quote breakdown
→ material requirement
```

#### Cambio después de release

```text
Design mutation
→ stale
→ approval/change-order cuando aplique
→ new ProductionRelease
```

#### Cambio de agregado

```text
Aggregate config
→ pieces/hardware
→ drilling
→ BOM
→ cut/CNC outputs
```

### DoD

Contract/integration tests demuestran que cambios visuales importantes producen las
consecuencias correctas sin duplicar lógica dentro de React.

---

## 10. Ola P3D-8 — Usability Benchmark

### Objetivo

Medir la matriz de estrellas con usuarios, no por opinión interna.

### Script canónico

Usuario debe completar:

1. abrir Cocina;
2. encontrar bajo 600;
3. colocar en muro;
4. duplicar y alinear;
5. editar dimensión;
6. añadir cajonera;
7. aplicar Roble a frentes;
8. cambiar material de piso;
9. cambiar de ambiente y volver;
10. presentar;
11. verificar precio/BOM.

### Métricas

- tiempo;
- errores;
- retrocesos;
- necesidad de ayuda;
- acciones innecesarias;
- puntos donde el usuario busca controles;
- percepción de confianza/facilidad.

### Quality targets iniciales

- primer mueble <60 s usuario nuevo;
- material común <15 s;
- agregado común <30 s;
- duplicar/alinear 3 unidades <30 s;
- ningún concepto de dominio interno necesario para terminar.

Los números se recalibran con evidencia.

---

## 11. Qué significa “terminar” cada ola

Cada issue debe incluir:

- comportamiento observable;
- estados vacíos/error/loading;
- keyboard/a11y si aplica;
- tests de dominio cuando hay reglas;
- tests UI de interacción;
- smoke en navegador real para WebGL/drag;
- screenshot/video sólo como evidencia auxiliar, no sustituto de test;
- performance check si toca hot path;
- docs actualizados.

---

## 12. Orden sugerido de implementación

Cuando haya capacidad específica para Proyectar:

1. **P3D-0 biblioteca/workspace** — cambia inmediatamente discoverability;
2. **#277 placement** + P3D-1 manipulation — núcleo físico;
3. **#278 inspector** + **#279 materials**;
4. **agregados #294–#297**;
5. environment/multi-space;
6. presentation;
7. performance hardening transversal;
8. integration contracts;
9. usability benchmark continuo.

Herrajes #280–#282 pueden entrar en P3D-2/3 según dependencia real.

---

## 13. Dependencias con Operational Core

No bloquear Proyectar por esperar todo Operational Core, pero respetar:

- stale/revision/release → O1;
- BOM/material requirements → O1/O3;
- part drilling/CNC consequences → O2;
- data truth → O0.

Cuando un issue de Proyectar necesita una pieza de Operational Core que aún no existe,
puede:

1. preparar UI/domain sin fingir persistencia;
2. crear dependency explícita;
3. no inventar un segundo lifecycle provisional.

---

## 14. Gobernanza

- North Star: `docs/proyectar-3d-north-star.md`;
- este documento: orden/olas;
- GitHub issues: ejecución;
- `feature_list.json`: ledger cuando la feature entra a ejecución;
- `docs/design.md`: tokens/patrones visuales;
- código/tests: implementación real.

No crear un tercer roadmap paralelo para Proyectar.
