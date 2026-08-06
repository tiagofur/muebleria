# Proyectar — plan SUPER 3D (área de diseño tipo Promob)

**Estado:** plan / producto — **sin implementación en este doc**  
**Fecha:** 2026-08-06  
**Rama de referencia:** `wip/jd-w3-lateral-rotation-fix`  
**Norte UX:** área de diseño de **Promob** (herramienta espacial amigable), no CAD pesado  
**Fuera de alcance ahora:** A×H×P libre (solo presets del mueble, decisión de producto)

---

## 1. Qué ya tenemos (base sólida)

| Capacidad | Estado |
|-----------|--------|
| Pantalla full **Proyectar** desde cotización | ✅ |
| Muros L + colocar / sacar / reordenar | ✅ |
| Drag 3D a lo largo del muro | ✅ |
| Propiedades estilo Promob: presets + acabados | ✅ |
| Zoclo / patas (`baseClearanceMm`) plan + override | ✅ |
| Persistencia `kitchenLayout` JSONB | ✅ |
| Presentar (cliente) separado de Proyectar | ✅ |

El problema ya no es “no hay diseño espacial”: es que el **viewport no se siente estudio profesional**.

---

## 2. Diagnóstico: por qué el 3D “no llena” el centro

### Lo que el usuario ve

```
┌ chrome Proyectar ─────────────────────────────┐
├ lista ─┬──────────────────────┬ inspector ────┤
│        │  hint de orbit/zoom  │              │  ← texto arriba del 3D
│        │  ┌────────────────┐  │              │
│        │  │  canvas ~380px │  │              │  ← altura FIJA
│        │  └────────────────┘  │              │
│        │  ████ negro vacío ██  │              │  ← resto del viewport
│        │  ████ (sin canvas) ██  │              │
└────────┴──────────────────────┴──────────────┘
```

### Causa técnica (evidencia)

| Pieza | Comportamiento actual |
|-------|------------------------|
| `.spatial-studio__viewport` | Flex column, fondo `#1a1c1e`, **sí** intenta crecer |
| `.module-scene-3d` | `flex: 1` dentro del viewport (bien) |
| `.module-scene-3d__hint` | Párrafo **encima** del canvas (robando alto) |
| **`.module-scene-3d__canvas-wrap`** | **`height: 380px` fijo** en `moduleScene3d.css` |

Ese `380px` es el default del preview embebido en **modales / editores de mueble**, no de un estudio fullscreen. En Proyectar el centro crece, pero el canvas **no**: el “área negra vacía” es el fondo del viewport sin canvas encima.

**Conclusión:** no hace falta un motor 3D nuevo. Hace falta un **modo layout de estudio** donde el canvas sea `flex: 1; height: 100%; min-height: 0` y el hint no compita por altura.

---

## 3. Visión producto: SUPER 3D Proyectar

> Al abrir **Proyectar**, el centro es **casi todo canvas 3D**: se siente herramienta de taller tipo Promob, no un modal con un preview chico.

### Principios (como Promob, a nuestra escala)

1. **El escenario es el protagonista** — lista e inspector son herramientas, no el show.  
2. **Chrome fino** — pocas acciones fijas; el resto en toolbars compactas.  
3. **Seleccionar → panel derecho** — medidas (presets), acabados, posición, zoclo.  
4. **Manipulación en el espacio** — drag muro, más adelante snap/esquinas.  
5. **Planta 2D al servicio del 3D** — mini-mapa o toggle, no pelear por el centro.  
6. **Cotización y BOM no se ensucian** — plano = obra/presentación; precio sigue en ítems.

### Anti-objetivos (no clonar Promob al 100 %)

- No multi-ambiente complejo v1  
- No islas / free place v1 (salvo decisión explícita)  
- No fotorrealismo PBR  
- No A×H×P libre sin preset (acordado)  
- No un segundo motor 3D paralelo a R3F  

---

## 4. Plan por partes (ordered slices)

Cada parte es entregable autónomo, testeable, idealmente PR &lt; 400 líneas cuando se implemente.

### Parte 0 — Viewport hero (P0 layout) 🔴

**Objetivo:** el 3D ocupa **todo** el alto y ancho del área central visible.

| Trabajo | Detalle |
|---------|---------|
| 0.1 | Modo estudio en CSS: `.module-scene-3d--studio` / `.spatial-studio__viewport .module-scene-3d__canvas-wrap` → `flex: 1; height: auto; min-height: 0` (sin 380px) |
| 0.2 | Canvas R3F con `resize` correcto al redimensionar paneles |
| 0.3 | Hint de orbit: **overlay** (esquina, dismissible o icono “?”), no bloque encima del canvas |
| 0.4 | Quitar huecos: sin gap que deje franja negra “muerta” |
| 0.5 | Chrome de Proyectar más bajo (densidad tipo toolbar) |

**Criterio de salida:** en desktop, el canvas toca casi de lista a inspector y de chrome a borde inferior; no hay banda negra vacía bajo el 3D.

**Esfuerzo estimado:** 0.5–1 día. **No toca dominio.**

---

### Parte 1 — Tooling de escena (chrome del estudio)

**Objetivo:** controles de cámara y vista **sobre** el 3D, no en un párrafo.

| Trabajo | Detalle |
|---------|---------|
| 1.1 | Toolbar flotante: órbita / pan / zoom, reset cámara, vistas (iso / frente / planta) |
| 1.2 | Toggle **planta 2D** (drawer o split inferior 25 %, no robando el hero por default) |
| 1.3 | Toggle contornos / rayos X reutilizando viewer chrome existente |
| 1.4 | Indicador de modo: “Arrastrar mueble” vs “Orbitar” (o auto: mueble = drag, vacío = orbit — ya casi está) |

**Criterio de salida:** se opera el 3D sin leer un wall of text; la planta es opt-in.

---

### Parte 2 — Lista + colocación más Promob

**Objetivo:** flujo “catálogo / cotización → escena” más fluido.

| Trabajo | Detalle |
|---------|---------|
| 2.1 | Lista colapsable / anchos redimensionables (o icon rail) |
| 2.2 | Doble click o drag-from-list → colocar en muro activo (hoy: botón Colocar) |
| 2.3 | Badge “sin colocar” + filtro solo sin colocar |
| 2.4 | Mini thumb / código dominante en lista |
| 2.5 | Click muro en 3D (raycast pared) para setear muro activo |

**Criterio de salida:** colocar 6 muebles en L en &lt; 3 min sin pelear con la UI.

---

### Parte 3 — Manipulación espacial (siguiente nivel)

**Objetivo:** moverse en la obra con menos inspector.

| Trabajo | Detalle |
|---------|---------|
| 3.1 | Snap a vecino en el mismo muro (gap 0 / 20 mm configurable) |
| 3.2 | Empujar al reordenar (re-pack al soltar drag) |
| 3.3 | Cambiar de muro con drop / menú contextual |
| 3.4 | Guías visuales: línea de muro, offsets en vivo mientras se arrastra |
| 3.5 | Undo local del plano (stack 20 comandos solo kitchenLayout) |

**Criterio de salida:** se puede armar corrida + reordenar casi solo con el mouse en el 3D.

---

### Parte 4 — Realismo de obra (sin BOM todavía)

**Objetivo:** la cocina se ve “instalada”.

| Trabajo | Detalle |
|---------|---------|
| 4.1 | Zoclo ya existe — pulir mesh (receso frontal tipo toe-kick, no caja llena) |
| 4.2 | Mesada / countertop simple opcional sobre corrida de bajos (solo visual) |
| 4.3 | Alacenas con altura de instalación editable (hoy fixed 1400) a nivel plano |
| 4.4 | Piso / pared con grid sutil (mm) |
| 4.5 | Suelo con color de material del proyecto (opcional, liviano) |

**Criterio de salida:** captura de Presentar se ve “cocina”, no “cajas flotando”.

---

### Parte 5 — Puente cotización ↔ Proyectar

**Objetivo:** el estudio no es un silo.

| Trabajo | Detalle |
|---------|---------|
| 5.1 | Al agregar ítem en cotización, deep-link “Colocar en Proyectar” |
| 5.2 | Totals / precio de línea en inspector (solo lectura, domain shell) |
| 5.3 | Presentar abre con el mismo plano (ya casi) + mensaje si hay sin colocar |
| 5.4 | Congelar plano al pasar a quoted (ya read-only) + copiar snapshot en versión |

---

### Parte 6 — Icebox (después de SUPER 3D usable)

- Islas / free place  
- Multi-ambiente  
- Import plano PDF/DXF  
- Zoclo como pieza real en BOM / patas como herraje automático  
- Luces / materiales PBR  
- Colaboración multi-usuario en el plano  

---

## 5. Orden de implementación recomendado

```
Parte 0 (viewport hero)     ← YA — desbloquea la sensación “SUPER 3D”
    ↓
Parte 1 (toolbar escena)
    ↓
Parte 2 (lista / colocación)
    ↓
Parte 3 (snap / undo / guías)
    ↓
Parte 4 (realismo obra)
    ↓
Parte 5 (puente cotización)
```

**Regla:** no arrancar Parte 3+ si el viewport sigue en 380px. Primero se ve grande, después se siente herramienta.

---

## 6. Criterios de aceptación del programa SUPER 3D

1. En un monitor 1080p, el canvas 3D ocupa **≥ 70 % del alto** de la ventana en Proyectar (aprox.).  
2. No hay banda negra vacía sistemáticamente bajo el canvas.  
3. Armar cocina en L con 6 muebles + zoclo en **&lt; 10 min**.  
4. Drag muro + presets + acabados sin salir de Proyectar.  
5. Cotización sin plano sigue funcionando (fallback lineal).  
6. Sin regresión de tests de kitchenLayout / studio.

---

## 7. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Romper previews 3D de módulo/componente al tocar CSS global | Solo overrides bajo `.spatial-studio` o clase `--studio` |
| R3F no redimensiona al maximizar | Forzar `invalidate` / `gl.setSize` en ResizeObserver del wrap |
| Sidebars se comen el centro en laptop | Sidebars colapsables; mínimo canvas `min-width` |
| Scope creep tipo CAD | Mantener anti-objetivos; una parte por PR |

---

## 8. Archivos que tocará la Parte 0 (cuando se implemente)

| Path | Rol |
|------|-----|
| `packages/ui/src/preview3d/moduleScene3d.css` | Hoy fija 380px — raíz del vacío negro |
| `packages/ui/src/projects/components/projectSpatialStudio.css` | Overrides studio / layout hero |
| `packages/ui/src/preview3d/FurnitureScene3D.tsx` | Hint overlay, clase `--studio`, resize |
| `packages/ui/src/projects/components/ProjectSpatialStudio.tsx` | Toolbar, props de modo estudio |

**No hace falta** tocar domain, Go ni migraciones para Parte 0–1.

---

## 9. Decisión pendiente (producto, no técnica)

Al implementar Parte 1, elegir default:

| Opción | Comportamiento |
|--------|----------------|
| **A (recomendada)** | Solo 3D hero; planta 2D en toggle inferior |
| **B** | Split 70/30 3D / planta siempre visible |

Recomendación: **A** (más Promob “escenario grande”).

---

## 10. Estado de este documento

- **Aprobado para planificación:** sesión 2026-08-06 (usuario: planear SUPER 3D, no codear).  
- **Siguiente acción de implementación (cuando se pida):** **Parte 0 — Viewport hero**.  
- Actualizar este doc al cerrar cada parte (checkbox mental o tabla de estado).

| Parte | Estado |
|-------|--------|
| 0 Viewport hero | ✅ done (`fillViewport` + CSS studio; canvas no longer 380px in Proyectar) |
| 1 Tooling escena | ✅ done (toolbar cámara/contornos/X-ray + planta mini toggle) |
| 2 Lista / colocación | ✅ done (filtros, colapsable, doble click, muro activo 3D, código dominante) |
| 3 Manipulación | ✅ done (snap wall drag, compactar muro, move wall, undo/redo plano) |
| 4 Realismo obra | ✅ done (toe-kick recess, mesada, wallCabinetZ, floor grid) |
| 4 Realismo obra | ⏳ pending |
| 5 Puente cotización | ⏳ pending |
| 6 Icebox | 🧊 |
