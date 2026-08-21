# Proyectar 3D — Roadmap vNext

**Estado:** ACTIVO para evolución de Proyectar  
**Fecha:** 2026-08-21  
**North Star:** `docs/proyectar-3d-north-star.md`  
**Meta GitHub:** #308

> Este roadmap traduce el North Star de Proyectar en olas implementables. Reutiliza
> issues existentes cuando ya describen trabajo válido; no duplica features sólo para
> cambiarles el nombre.

---

## 0. Regla de prioridad

Proyectar es uno de los tres pilares de Mueblería y puede avanzar en paralelo con
Operational Core cuando hay capacidad, pero no debe romper prioridades críticas de
verdad, seguridad, lifecycle o producción.

No necesitamos esperar a “terminar ERP” para mejorar Proyectar. Tampoco debemos usar
Proyectar como excusa para posponer gates operacionales críticos.

---

## 1. Issue map canónico

### Meta

- **#308** — Proyectar 3D vNext / North Star.

### Nuevos slices

| Ola | Issue | Objetivo |
|---|---|---|
| P3D-0 | **#309** | Workspace + biblioteca persistente muebles/materiales |
| P3D-1 | **#310** | Selección/manipulación 5★ |
| P3D-4 | **#311** | Environment authoring + multi-space 5★ |
| P3D-6 | **#312** | Performance budget + escena de referencia |
| P3D-7 | **#313** | Contract tests diseño→BOM→precio→producción |
| P3D-8 | **#314** | Benchmark de usabilidad; validación, no feature |

### Issues existentes reutilizados

| Área | Issue(s) | Rol en vNext |
|---|---|---|
| Drag de mueble al ambiente | #277 / F065 | inserción 5★ |
| Inspector contextual | #278 / F066 | propiedades 5★ |
| Materiales drag/apply | #279 / F067 | material workflow 5★ |
| Herrajes 3D | #280–#282 / F068–F070 | hardware UX |
| Ambient materials | #266 | piso/pared/room look |
| Presentación cliente | #260 | presentation 4★ |
| Agregados paramétricos/UI/3D/export | #294–#297 | aggregates 5★ |
| Multi-space producción | #254–#256 | evidencia de coherencia multi-space; no sustituye Proyectar UX |

Todos deben leer `docs/proyectar-3d-north-star.md` cuando se implementen.

---

## 2. P3D-0 — Workspace 3D y bibliotecas (#309)

### Modelo mental

```text
Biblioteca → Canvas → Inspector
```

### Entregables

- biblioteca lateral persistente de muebles;
- búsqueda;
- jerarquías;
- thumbnails;
- favoritos;
- recientes;
- “Mi taller”;
- estado de búsqueda/categoría preservado;
- material dock/library accesible;
- responsive behavior desktop/tablet.

### DoD

- usuario nuevo encuentra un módulo común sin conocer código;
- no sale de Proyectar para buscar el siguiente mueble;
- catálogo grande sigue usable;
- canvas conserva área útil;
- click/keyboard alternatives existen donde corresponda.

---

## 3. P3D-1 — Insert / Selection / Manipulation 5★ (#277 + #310)

### #277

Inserción desde catálogo/lista al canvas con ghost preview/snap/feedback.

### #310

Completa:

- selección jerárquica;
- multi-select;
- copy/paste;
- duplicate;
- align/distribute;
- nudge teclado;
- snap configurable;
- guías temporales;
- fit selection;
- offsets en mm;
- undo/redo por intención.

### DoD

Usuario puede insertar 3 muebles, duplicar, alinear y ajustar offsets con precisión sin
trabajar en world coordinates ni luchar con la cámara.

---

## 4. P3D-2 — Inspector + Materials 5★ (#278 + #279)

### Inspector #278

- zona estable contextual;
- ambiente/mueble/agregado/pieza/herraje;
- progressive disclosure;
- mm claros;
- modo avanzado sólo cuando aporta.

### Materials #279

- drag/apply;
- target highlight;
- scopes pieza / frentes mueble / proyecto;
- favoritos/recientes;
- undo;
- impacto en precio/BOM visible;
- stale flow cuando O1 exista.

### DoD

Cambiar material común debe sentirse instantáneo y siempre quedar claro qué scope se
modificó.

---

## 5. P3D-3 — Agregados + hardware (#294–#297 + #280–#282)

El usuario dice:

> “Añadir 3 cajones.”

No:

> “Crear tres ModuleAgregadoInstance.”

### Quality bar

- inserción simple;
- preview inmediata;
- cantidad/spacing/hardware/material configurables;
- stack automático;
- BOM correcto;
- drilling correcto;
- undo;
- selección visual del agregado;
- detalle técnico opcional.

---

## 6. P3D-4 — Environment Authoring + Multi-space 5★ (#311)

### Entregables

- muros editables con lenguaje dimensional;
- openings/obstáculos donde el dominio los soporte;
- views planta/perspectiva/frontal;
- fit room;
- switch de ambiente explícito;
- cámara por ambiente cuando aporte;
- piso/pared con #266;
- no mezclar geometrías de spaces;
- helpers no contaminan BOM/presentation.

### DoD

Usuario crea una cocina y cambia entre Cocina/Baño/Closet sin ambigüedad de ownership o
contexto.

---

## 7. P3D-5 — Presentation 4★ (#260)

### Objetivo

Separar edición de presentación al cliente.

### Entregables

- chrome cliente mínimo;
- multi-space claro;
- vistas limpias;
- capturas consistentes;
- materiales correctos;
- compartir/exportar sin herramientas del taller.

No convertir esto en renderer offline pesado salvo demanda real.

---

## 8. P3D-6 — Performance & Interaction Budget (#312)

### Entregables

- fixture de escena de referencia;
- React profiling;
- draw calls/triangles/textures;
- raycast cost;
- geometry rebuilds;
- long tasks;
- hardware objetivo documentado;
- caching/instancing/workers sólo donde métricas lo justifiquen.

### Regla

Ninguna feature visual puede degradar materialmente drag/orbit/selection en la escena de
referencia sin tradeoff explícito.

---

## 9. P3D-7 — Design → Business → Production 5★+ (#313)

### Casos canónicos

```text
Material change
→ BOM
→ quote breakdown
→ material requirement
```

```text
Design change after release
→ stale
→ approval/change order
→ new ProductionRelease
```

```text
Aggregate config
→ pieces/hardware/drilling
→ BOM
→ cut/CNC outputs
```

Contract fixtures prueban que Proyectar no es un silo y que React no duplica lógica de
negocio.

---

## 10. P3D-8 — Usability Benchmark (#314)

#314 es validación; no debe llevar `type:feature`. Cuando exista `type:validation`,
aplicarlo.

### Script

Usuario completa:

1. abrir Cocina;
2. encontrar bajo 600;
3. colocar;
4. duplicar/alinear;
5. editar dimensión;
6. añadir cajonera;
7. aplicar Roble a frentes;
8. cambiar piso;
9. cambiar ambiente y volver;
10. presentar;
11. verificar precio/BOM.

### Targets iniciales

- primer mueble <60 s;
- material común <15 s;
- agregado común <30 s;
- duplicar/alinear 3 unidades <30 s;
- cero necesidad de entender internals del BOM.

Los targets se recalibran con evidencia.

---

## 11. Definition of Done transversal

Cada issue debe cubrir según aplique:

- comportamiento observable;
- empty/error/loading;
- keyboard/a11y;
- domain tests;
- UI interaction tests;
- smoke real browser/WebGL para 3D;
- performance check si toca hot path;
- docs;
- consecuencias de BOM/precio/revision cuando la acción las tenga.

Screenshot/video es evidencia auxiliar, no sustituto de test.

---

## 12. Orden sugerido

1. **#309 P3D-0** — workspace/bibliotecas;
2. **#277 + #310** — insertion/manipulation;
3. **#278 + #279** — inspector/materials;
4. **#294–#297** — aggregates;
5. **#280–#282** — hardware según dependencia;
6. **#311** — environment/multi-space;
7. **#260** — presentation;
8. **#312** — performance hardening transversal (parte puede adelantarse);
9. **#313** — integration contracts (parte puede adelantarse);
10. **#314** — validation continua desde temprano, no sólo al final.

El orden puede cambiar si pilotos demuestran un bloqueo de mayor valor.

---

## 13. Dependencias con Operational Core

- stale/revision/release → #300 / O1;
- material requirements → #302 / O3;
- piece execution/CNC consequence → #301 / O2;
- data truth/CI → #299 / O0.

No inventar un segundo lifecycle provisional sólo para desbloquear UI.

---

## 14. Gobernanza

- North Star: `docs/proyectar-3d-north-star.md`;
- posicionamiento: `docs/proyectar-3d-competitive-position.md`;
- este documento: olas/issues;
- GitHub #308: meta;
- `feature_list.json`: ledger sólo cuando una feature entra a ejecución;
- `docs/design.md`: tokens/patrones visuales;
- código/tests: implementación real.

No crear otro roadmap paralelo de Proyectar.
