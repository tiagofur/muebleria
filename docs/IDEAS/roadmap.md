# Roadmap — Muebles CAD/CAM

> **Propósito**: Orden de entrega real. Complementa el PRD (visión) y
> `feature_list.json` (tareas atómicas). Un agente **no** debe saltar horizontes
> sin que el usuario lo pida.

Ver también: [`docs/product-map.md`](product-map.md) (mapa mental).

---

## Principio de entrega

```
Valor del taller primero  →  diseño espacial después  →  CAD 3D / CNC completo
```

1. **Núcleo matemático** (despiece correcto)  
2. **Catálogos + comercial + producción sin 3D** (usar el producto en un taller real)  
3. **Diseño espacial 2D/3D** (los 4 modos del PRD)  
4. **CAM profesional** (DXF capas, maquinaria)

El PRD §6 hablaba de “Fase 2 = 3D”. En la práctica se **reordenó**: primero el
pipeline de taller usable (formulario + BOM + nesting + precios), después el
lienzo espacial. El motor de dominio ya está listo para alimentar ambos.

---

## Horizonte A — Núcleo de dominio (✅ hecho)

| ID | Feature | Resultado |
|----|---------|-----------|
| F001 | Monorepo pnpm | Workspaces, typecheck, build |
| F002 | Tipos dominio | Module, CutPiece, Material, Room, Project… |
| F003 | Fórmulas despiece | Base / wall / tall / drawer |
| F005 | BOM | Agrupación + tapacantos + hojas |
| F006 | Nesting + CSV | Guillotine + export optimizer |
| F008 | Multi-módulo kitchen | BOM consolidado de cocina |
| F009 | Storage ports | JSON local + tests |

**Criterio de salida**: un módulo con W/H/D/T/B/g produce piezas correctas y se puede nestear/exportar **sin UI**.

---

## Horizonte B — App de taller usable (✅ casi; cierra con F020+)

Shell de 3 módulos (Eje A del product-map), sin CAD:

| ID | Feature | Estado |
|----|---------|--------|
| F004 / F007 | Web demo + pipeline BOM/nesting UI | ✅ |
| F010 | Save/load proyecto en web | ✅ |
| F011 | Sidebar Ingeniería / Presupuestos / Producción | ✅ |
| F012–F016 | Modal + catálogos (tableros, cintillas, herrajes) | ✅ |
| F017–F018 | Clientes + proyectos | ✅ |
| F019 | Motor de precios | ✅ |
| **F020** | **PDF cotización comercial** | ⏳ siguiente |
| F021 | Vincular proyecto → pantalla Producción (un solo flujo) | pendiente |
| F022 | Cotizaciones versionadas (borrador / enviada / aprobada) | pendiente |
| F023 | Persistencia unificada (menos keys sueltas de localStorage) | pendiente |

**Criterio de salida**: el taller carga catálogo, arma proyecto, cotiza en PDF y manda a nesting/export sin Excel manual.

**NO incluir en este horizonte**: Babylon, DXF CNC, room editor, walkthrough.

---

## Horizonte C — Diseño espacial (Modos 1–2 lite)

Cuando el pipeline B esté sólido:

| Tema | Descripción | PRD |
|------|-------------|-----|
| Entrada “Diseño” desde Proyecto | Abrir proyecto en flujo de modos | ideas / product-map |
| Modo 1 Habitación 2D | Muros, puertas, ventanas, medidas | PRD §2 Modo 1 |
| Modo 2 lite (sin WebGL full) | Colocar módulos en planta 2D o lista espacial simple + params | PRD §2 Modo 2 |
| Command undo/redo de diseño | Historial sobre el store del proyecto | PRD §4.3 |
| Zustand project store unificado | Un solo estado de proyecto para UI | architecture |

**Criterio de salida**: se dibuja una L de cocina en planta y se genera BOM real.

---

## Horizonte D — Presentación 3D + CAM profesional

| Tema | Descripción | PRD |
|------|-------------|-----|
| Viewport3DManager | Babylon/Three desacoplado de React | PRD §4.2 |
| Modo 2 full 3D | Snapping, gizmos, catálogo drag | PRD §2 |
| Modo 3 Presentación | Estilos globales, explosionada, presupuesto live | PRD §2 |
| Modo 4 UI split | BOM + nesting 2D interactivo (evolucionar ProductionScreen) | PRD §2 |
| PDF producción completo | Portada + BOM + planos de tablero | PRD §5.2 |
| DXF por capas | Contorno, ranura, bisagra, tarugo | PRD §5.3 |
| Web Worker nesting | Mover nesting pesado off-main-thread | PRD §5.1 |
| apps/desktop Electron | Shell delgado | architecture |
| backend-go | Multiusuario, Postgres | architecture |

---

## Mapeo PRD §6 (histórico) → este roadmap

| PRD §6 original | Realidad del repo |
|-----------------|-------------------|
| Fase 1 Core | Horizonte A ✅ (+ parte de fórmulas en UI) |
| Fase 2 3D + paneles | **Partido**: paneles/catálogo/comercial = Horizonte B; 3D = D |
| Fase 3 Nesting + Modo 4 | Nesting core = A/B ✅; UI Modo 4 rica = C/D |
| Fase 4 DXF / CNC | Horizonte D |

Si un agente cita “Fase 2 del PRD = Babylon ya”, **está desactualizado**. Usar este archivo.

---

## Reglas para planificar features nuevas

1. Una sola feature en `in_progress` (`feature_list.json`).
2. Toda feature nueva debe declarar **horizonte** (A/B/C/D) en la descripción o `phase`.
3. No mezclar en un mismo PR: CRUD comercial + viewport 3D.
4. Tests del dominio viajan con la feature de dominio; UI no “deja tests para después”.
5. Si el PRD y este roadmap chocan en **orden**, gana el roadmap. Si chocan en **fórmulas/datos**, gana el PRD §3–5.

---

## Próxima acción recomendada (agentes)

1. Completar **F020** (PDF cotización).  
2. Proponer **F021–F023** en Horizonte B (cierre de flujo taller).  
3. Solo después, explorar Horizonte C con `/sdd-explore` o feature de room 2D.
