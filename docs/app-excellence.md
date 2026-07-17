# App Excellence — Plan de producto

**Producto:** Muebles (cotización + ingeniería + producción de taller)  
**Fecha:** 2026-07-17  
**Estado:** plan vivo (documentación; no es un sprint de implementación único)  
**Fuentes:** `docs/prd.md`, issues abiertos, WIP en `feat/presets-measure-100`, Judgment Day 2026-07-17

---

## 1. Norte de excelencia

La app ya cierra el loop **catálogo → mueble → cotización → export Optimizer**.  
Excelencia = que cada rol del taller complete su trabajo **más rápido, con menos errores caros y con una vista compartida de la realidad del proyecto**.

| Rol | Trabajo excelente |
|-----|-------------------|
| **Ventas** | Cotizar en minutos, mostrar al cliente *cómo queda*, PDF/precio confiable, plantillas de cocina |
| **Ingeniería** | Diseñar una vez (estructura + componentes + presets), validar, reutilizar |
| **Producción** | Cola clara, etiquetas, m², lista de corte rica, export a nesting/máquinas sin reescribir |

**Principio:** no competir con CAD/CAM pesado. Ser la **herramienta operativa del taller** que habla el idioma del Excel y del Optimizer, y suma layout simple + export de producción.

---

## 2. Estado actual (síntesis)

### Hecho y sólido

- Catálogos, grupos de opciones, BOM resuelto, snapshot de precios  
- Roles RBAC (vendedor / ingeniero / producción / gerente / admin)  
- Export Optimizer + herrajes + etiquetas + resumen m²  
- Estructuras, componentes, presets de medida, vitrina, PDF cotización  
- Preview 3D en progreso (módulo + corrida lineal de cotización)

### Issues (GitHub — canónico)

**META:** [#132 App Excellence](https://github.com/tiagofur/muebleria/issues/132) · JD: `docs/judgment-day-wip-3d-2026-07-17.md` · PRD §6.7

#### Ola A — Bugs Judgment Day (estabilizar WIP 3D)

| # | Título | Sev |
|---|--------|-----|
| [#125](https://github.com/tiagofur/muebleria/issues/125) | API round-trip espacial Component/instancias (JD-C1/W8) | CRITICAL |
| [#126](https://github.com/tiagofur/muebleria/issues/126) | Paridad fórmulas Go PH/PW/PD/T/i (JD-C2) | CRITICAL |
| [#127](https://github.com/tiagofur/muebleria/issues/127) | ProjectsScreen sin structures/components (JD-C3) | CRITICAL |
| [#128](https://github.com/tiagofur/muebleria/issues/128) | Poses: fallback por eje + lateral_derecho (JD-W1/W2) | ALTO |
| [#129](https://github.com/tiagofur/muebleria/issues/129) | Preview 3D ejes / fallback / ghosts / dims (JD-W3–W6) | ALTO |
| [#130](https://github.com/tiagofur/muebleria/issues/130) | Color preview material validar / no pisar (JD-W7/S3) | MEDIO |
| [#131](https://github.com/tiagofur/muebleria/issues/131) | Suspects JD: H ambiguo, ids, rotate 0 | MEDIO |

#### Ola B+ — Features excelencia

| # | Título | Ola |
|---|--------|-----|
| [#133](https://github.com/tiagofur/muebleria/issues/133) | Layout simple de cocina (muros + placements) | B P0 |
| [#134](https://github.com/tiagofur/muebleria/issues/134) | Pack producción ZIP | C |
| [#135](https://github.com/tiagofur/muebleria/issues/135) | Estimación de pliegos (sin nesting) | C |
| [#136](https://github.com/tiagofur/muebleria/issues/136) | Modo presentación cliente | D |
| [#137](https://github.com/tiagofur/muebleria/issues/137) | Comparar escenarios A/B | D |
| [#138](https://github.com/tiagofur/muebleria/issues/138) | Alertas cambio precio material | D |
| [#139](https://github.com/tiagofur/muebleria/issues/139) | Checklist de instalación | D |
| [#140](https://github.com/tiagofur/muebleria/issues/140) | Duplicar cotización con otro frente | D |
| [#141](https://github.com/tiagofur/muebleria/issues/141) | QR en etiquetas | D |
| [#142](https://github.com/tiagofur/muebleria/issues/142) | Import resultado nesting | E |

#### Icebox previo (horizonte)

| # | Título |
|---|--------|
| [#112](https://github.com/tiagofur/muebleria/issues/112) | META horizonte H01–H12 (cerrado en issues) |
| [#108](https://github.com/tiagofur/muebleria/issues/108) | Versionado de estructuras |
| [#109](https://github.com/tiagofur/muebleria/issues/109) | Parámetros de medida a nivel proyecto |
| [#110](https://github.com/tiagofur/muebleria/issues/110) | Plantillas de proyecto (después de #133) |
| [#111](https://github.com/tiagofur/muebleria/issues/111) | CNC/DXF — **solo documentar** hasta demanda real |

El horizonte H01–H12 está **cerrado**; el WIP actual refina paneles + 3D + color de material.

### Deuda / gaps de producto

1. **Layout de cocina real:** hoy la vista 3D de cotización es una **corrida lineal** (`layoutProjectRun`), no muros ni reordenamiento manual.  
2. **Plan de corte nativo:** no hay nesting 2D en app; el camino es **export Excel → optimizador externo** (correcto para ahora).  
3. **CNC / máquinas:** documentado (#111), **no implementar** hasta demanda real.  
4. **Plantillas de proyecto / params de obra:** #110, #109.  
5. **Paridad TS↔Go en fórmulas espaciales/compuestas:** riesgo de BOM distinto cliente vs servidor (ver Judgment Day).

---

## 3. Capas de excelencia (por persona)

### 3.1 Ventas — “cerrar el sí del cliente”

| Capacidad | Prioridad | Notas |
|-----------|-----------|--------|
| Cotización + PDF/Excel comercial | ✅ hoy | Mantener legible y confiable |
| Vista 3D de la cotización | 🔧 WIP | Corrida lineal; luego layout de muros |
| **Layout simple de cocina** (muros + colocar/reordenar) | **P0 producto** | Ver §5 |
| Plantillas de proyecto (“cocina 3 m”) | P1 | #110 |
| Comparar 2 opciones de material/frente | P2 | Misma cotización, dos escenarios |
| Enlace de propuesta / PDF con foto 3D | P2 | Export estático o captura |
| CRM liviano (seguimiento, próximo contacto) | P3 | No ERP |

### 3.2 Ingeniería — “diseñar una vez, reutilizar siempre”

| Capacidad | Prioridad | Notas |
|-----------|-----------|--------|
| Estructuras + componentes + presets | ✅ | Consolidar modelo components-only |
| Preview 3D del mueble | 🔧 WIP | Convención de ejes / poses |
| Editor de medidas paramétricas claras | P1 | Variables PW/PH/PD/T documentadas en UI |
| Versionado de estructuras | P2 | #108 |
| Librería de reglas de taller (bisagras por alto…) | P2 | Fase 4 PRD |
| Checklist de “listo para vitrina” | P2 | Imagen, presets, BOM ok |

### 3.3 Producción — “cortar y armar sin ambigüedad”

| Capacidad | Prioridad | Notas |
|-----------|-----------|--------|
| Cola accepted → export → produced | ✅ | |
| Etiquetas + encintado + m² + cut-list rica | ✅ | |
| **Export Excel Optimizer** (único plan de corte *ahora*) | **P0** | Mantener + tests fixture |
| Resumen de pliegos estimado (sin nesting) | P1 | Heurística m² / pliego catálogo |
| Import resultado nesting (consumo real) | P2 | PRD Fase 5 |
| **Metadatos CNC / DXF / post-procesadores** | **Doc only** | #111 · ver §4 |
| Pack de producción (ZIP: Optimizer + herrajes + etiquetas PDF) | P1 | Un click para el taller |

---

## 4. Plan de corte y máquinas (política explícita)

### 4.1 Ahora (implementar / mantener)

```
Cotización accepted
  → ProductionCutRow[] (domain)
  → Plantilla_Optimizer.xlsx (packages/excel)
  → software de nesting / corte del taller (externo)
```

- **No** nesting 2D embebido.  
- **No** G-code / post-procesador de marca.  
- Mejoras permitidas: códigos de pieza, nombres de material alineados al taller, empaquetado de exports, validaciones VAL/EXP del PRD.

### 4.2 Futuro (solo documentar — no implementar aún)

| Etapa | Entregable | Dependencias |
|-------|------------|--------------|
| F1 | Modelo de metadatos por pieza resuelta (agujeros, contorno, cara, tool path abstracto) | #111, núcleo compuesto maduro |
| F2 | Export piloto **DXF** o JSON rico por pieza (sin marca de máquina) | F1 + validación en taller |
| F3 | Post-procesadores CNC por marca (bajo demanda real del usuario) | F2 + hardware real del taller |
| F4 | Plan de corte *interno* opcional (nesting) | Solo si el Optimizer externo deja de bastar |

**Decisión de producto:** el Optimizer Excel sigue siendo la **fuente de verdad de corte** hasta que un piloto CNC demuestre valor medible.

---

## 5. Layout de cocina simple (muros + muebles) — primer slice

### 5.1 Objetivo de usuario

> El vendedor (o el dueño) dibuja **muros simples**, **arrastra** muebles de la cotización, los **reordena** y ve **cómo queda la cocina** — sin CAD, sin islas complejas v1.

### 5.2 Alcance v1 (simple a propósito)

**Incluye**

- Planta 2D editable (SVG/canvas): muros rectos (segmentos con largo en mm).  
- Colocar items de la cotización sobre un muro (anclar a pared + offset mm).  
- Reordenar a lo largo del muro (drag o flechas).  
- Altura de instalación: **piso** (base) vs **muro** (altos) con default por categoría.  
- Vista 3D que lee **posiciones persistidas** (no solo corrida lineal automática).  
- Validaciones blandas: solape, sobresale del muro (warning, no bloqueo total al inicio).

**No incluye (v1)**

- CAD libre, curvas, techos, ventanas paramétricas.  
- Detección automática de L/U desde plano importado.  
- Render fotorrealista / materiales PBR.  
- Física, colisión perfecta, instalación eléctrica/agua.  
- Multi-ambiente completo (baño + living) — un **espacio** por proyecto basta.

### 5.3 Modelo de dominio propuesto (borrador)

```ts
// Conceptual — no implementado aún
interface ProjectSpace {
  id: string;
  name: string; // "Cocina"
  walls: Wall[];
}

interface Wall {
  id: string;
  lengthMm: number;
  // optional: angleDeg or next-wall join for L/U simple
}

interface ProjectItemPlacement {
  itemId: string;       // ProjectItem.id
  instanceIndex: number; // qty > 1
  wallId: string;
  offsetMm: number;     // along wall from start
  elevation: 'floor' | 'wall';
  // optional later: rotateYDeg, depthOffsetMm
}
```

- `ProjectItem` **sigue** siendo la línea comercial (módulo, qty, opciones, preset).  
- El placement es **capa de presentación de obra**, no redefine el BOM.  
- Si no hay placement → fallback a `layoutProjectRun` (comportamiento actual).

### 5.4 UX v1

1. En detalle de cotización: pestaña **“Plano”** junto a lista de muebles.  
2. Toolbar: Añadir muro · Seleccionar · Mover · (Zoom).  
3. Panel: lista de ítems sin colocar + ítems en muro.  
4. Botón **Vista 3D** usa placements si existen.  
5. Copy en español de taller: “Así queda la corrida”, no jerga CAD.

### 5.5 Criterios de aceptación (slice)

- [ ] Crear 2–3 muros (L simple) y colocar ≥ 3 módulos de la cotización  
- [ ] Reordenar dos bases en el mismo muro y ver cambio en 2D y 3D  
- [ ] Persistencia API + local sin perder placements al recargar  
- [ ] Cotización sin plano sigue funcionando (fallback lineal)  
- [ ] UI no calcula BOM; domain solo valida geometría de placement  

---

## 6. Roadmap recomendado (olas)

### Ola A — Estabilizar lo que ya se construyó (antes de features nuevas)

1. Cerrar Judgment Day del WIP 3D / paneles (mappers espaciales, props de ProjectsScreen, paridad fórmulas Go).  
2. Convención de ejes 3D + tests.  
3. Pack de producción (un export multi-archivo opcional).  

### Ola B — Ventas + layout simple (§5)

1. Domain `ProjectSpace` + placements.  
2. Plano 2D mínimo.  
3. 3D lee placements.  
4. Plantillas de proyecto (#110) encima del layout.

### Ola C — Producción “taller listo”

1. Mejoras Optimizer (si el proveedor cambia columnas → capa excel aislada).  
2. Estimación de pliegos / merma visible en cola.  
3. Documentar contrato CNC (#111) con ejemplos; sin código de máquina.

### Ola D — Inteligencia de taller (PRD Fase 4)

1. Reglas (bisagras, correderas).  
2. Módulos más paramétricos.  
3. Params de obra (#109).  

### Ola E — Ecosistema (cuando haya demanda)

1. Import nesting real.  
2. DXF / metadatos CNC.  
3. Offline dual / desktop empaquetado (#38 si sigue vivo en docs).

---

## 7. Ideas nuevas (backlog de valor)

Priorizadas por **impacto en dinero / errores** vs complejidad.

| Idea | Issue | Rol | Complejidad |
|------|-------|-----|-------------|
| Plano de cocina simple (§5) | [#133](https://github.com/tiagofur/muebleria/issues/133) | Ventas | Media |
| Pack producción ZIP | [#134](https://github.com/tiagofur/muebleria/issues/134) | Producción | Baja |
| Estimación pliegos | [#135](https://github.com/tiagofur/muebleria/issues/135) | Producción | Media |
| Plantillas de cocina | [#110](https://github.com/tiagofur/muebleria/issues/110) | Ventas | Media |
| Modo presentación | [#136](https://github.com/tiagofur/muebleria/issues/136) | Ventas | Baja |
| Comparar escenarios A/B | [#137](https://github.com/tiagofur/muebleria/issues/137) | Ventas | Media |
| Alertas precio material | [#138](https://github.com/tiagofur/muebleria/issues/138) | Gerente | Baja–media |
| Checklist de instalación | [#139](https://github.com/tiagofur/muebleria/issues/139) | Producción | Baja |
| Duplicar cotización con otro frente | [#140](https://github.com/tiagofur/muebleria/issues/140) | Ventas | Baja |
| QR en etiquetas | [#141](https://github.com/tiagofur/muebleria/issues/141) | Producción | Media |
| Import nesting real | [#142](https://github.com/tiagofur/muebleria/issues/142) | Producción | Media |
| CNC DXF (doc only) | [#111](https://github.com/tiagofur/muebleria/issues/111) | Producción | Alta |
| Composiciones / import proveedor / calendario / multi-moneda | — (sin issue aún) | varios | varía |

---

## 8. Qué no hacer (anti-scope de excelencia)

- Convertir la app en AutoCAD / SketchUp / Cabinet Vision.  
- Nesting 2D “porque sí” mientras el Optimizer externo funcione.  
- CNC de marca sin pieza real del taller y prueba de campo.  
- Inventario / stock / facturación electrónica (ERP).  
- Features de ingeniería que rompan el export Optimizer.

---

## 9. Métricas de “ya es excelente”

| Métrica | Objetivo orientativo |
|---------|----------------------|
| Tiempo cotización cocina típica (6–10 módulos) | &lt; 15 min (con plantilla: &lt; 5) |
| Errores de export bloqueados antes de corte | 100 % de casos VAL/EXP |
| Uso de vista plano/3D en cotizaciones accepted | &gt; 50 % (cuando exista layout) |
| Re-trabajo por despiece mal armado | Tendencia a bajar mes a mes |
| Un solo camino de corte documentado | Optimizer Excel (hasta CNC real) |

---

## 10. Próximo paso operativo sugerido

1. **Ola A:** cerrar #125–#127 (CRITICAL), luego #128–#130; re-judge 3D.  
2. **Ola B:** implementar #133 (layout cocina).  
3. **Ola C:** #134 pack ZIP · #135 pliegos; #111 permanece icebox documentado.  
4. Cuando #133 esté listo → #110 plantillas + #136 modo presentación.

---

## 11. Referencias

- `docs/prd.md` — dominio y anti-scope  
- `docs/architecture.md` — boundaries  
- GitHub #112 META, #108–#111 icebox  
- WIP preview: `packages/ui/src/preview3d/project3dLayout.ts` (corrida lineal actual)
