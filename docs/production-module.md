# Módulo Producción — Workspace de fábrica

**Producto:** Muebles (cotización + ingeniería + producción de taller)  
**Estado:** **Fases 0–4 implementadas en main** (META #214 cerrado 2026-08-06)  
**Fecha:** 2026-08-06  
**Audiencia:** producto, implementadores, revisores, agentes  
**Alcance de este doc:** contrato de producto + baseline. Siguiente iteración: polish UX (no features bloqueantes).

---

## 0. Respuesta corta (leé esto primero)

| Pregunta | Respuesta canónica |
|----------|--------------------|
| ¿Qué es Producción? | Un **workspace de fábrica** separado de diseño/cotización, para generar documentación y archivos de corte/CNC/armado **sin editar el diseño**. |
| ¿Quién lo usa? | Roles `produccion`, `ingeniero`, `gerente_ventas`, `admin` (mismos gates de export que el PRD). **No** el flujo diario del vendedor. |
| ¿Se edita el proyecto desde Producción? | **NO.** Diseño, medidas, opciones, muros y placements son **solo lectura**. Cambios de diseño → volver a Proyectos/Cotización. |
| ¿Qué “verdad” de corte usamos hoy? | `ProductionCutRow[]` → **`Plantilla_Optimizer.xlsx`** → nesting/corte **externo**. |
| ¿Hay nesting 2D nativo? | **No como fuente de verdad de corte** en v1–v2 del módulo. Sí: estimación de pliegos, preview visual, import de nesting real. |
| ¿Dónde vive el plan de issues? | §10 Roadmap + issues GitHub. **META: [#214](https://github.com/tiagofur/muebleria/issues/214)** |

**Docs relacionados (no reemplazan este):**

| Doc | Relación |
|-----|----------|
| `docs/prd.md` §6.6–6.7 | RBAC, exports, política Optimizer/CNC |
| `docs/app-excellence.md` §3.3–4 | Capas de excelencia producción; **este doc es el detalle del workspace** |
| `docs/perfect-app-roadmap.md` | Visión UX general; Producción aquí se especializa |
| Issues históricos cerrados | #134 pack ZIP · #135 pliegos · #141 QR · #142 import nesting |

---

## 1. Problema que resuelve

### 1.1 Dolor actual

La pantalla de **proyecto/cotización** concentra:

- diseño de cocina (muros, placements, 3D),
- precios y opciones comerciales,
- y **comandos de fábrica** (Optimizer, herrajes, etiquetas, pack, produced).

Eso abruma a **dos roles distintos**:

| Rol | Necesita | Le sobra / confunde |
|-----|----------|---------------------|
| Vendedor / proyectista | Cotizar, presentar, ajustar diseño | CSV, nesting, etiquetas de pieza, “marcar producido” |
| Producción / oficina técnica | Despiece, elevaciones, pliegos, exports, pack | Editores de medidas, grupos de opciones, precio de venta |

Un error de interpretación en este límite **no es cosmético**: es tablero mal cortado o un pack desalineado con lo que el cliente firmó.

### 1.2 Resultado de producto

> **Un proyecto `accepted` (o `produced`) se abre en Producción como una Orden de trabajo de fábrica:** vistas de solo lectura + generación de documentos y archivos ejecutables para corte, encintado, armado e instalación.

---

## 2. Principios no negociables

Estas reglas **no admiten interpretación laxa**. Si un PR las viola, se rechaza.

### R1 — Separación de modos

| Modo | Pantalla / nav | Mutaciones permitidas |
|------|----------------|------------------------|
| **Diseño / cotización** | Proyectos | Items, opciones, layout, status de venta (`draft`→`quoted`→`accepted`) |
| **Producción** | Nav **Producción** | Exports, packs, docs, notas de taller, estados de fábrica, `produced` (según RBAC) |

### R2 — Solo lectura del diseño en Producción

Desde Producción **está prohibido**:

- cambiar medidas, presets, cantidades de ítems,
- cambiar opciones de material/herraje de la cotización,
- editar `kitchenLayout` (muros, placements, free-place),
- editar catálogos o módulos plantilla.

**Permitido:** regenerar exports, descargar pack, imprimir PDFs, importar nesting, anotar taller, marcar estados de piso / `produced`.

### R3 — Fuente de verdad de corte (política vigente)

```
Proyecto accepted|produced
  → ProductionCutRow[] (domain, resuelto)
  → Plantilla_Optimizer.xlsx (packages/excel)
  → software de nesting / sierra del taller (externo)
```

- El Optimizer Excel **sigue siendo** el contrato de plan de corte implementado.
- Nesting visual en app **no reemplaza** al Optimizer hasta decisión de producto explícita (fase posterior + demanda real).
- Ver también `docs/prd.md` §6.7 y `docs/app-excellence.md` §4.

### R4 — Congelación al aceptar

Al pasar a `accepted`:

- precios quedan en `priceSnapshot` (ya PRD),
- el BOM/export de producción se deriva del snapshot resuelto,
- si el diseño cambia después, el producto **debe** dejar claro que hay que re-validar / re-exportar (evolución: versión de OP — ver §8).

### R5 — Un pack = una foto coherente

Todo lo que sale en un **Pack de producción** de una descarga debe corresponder a **la misma resolución de BOM** (mismas piezas, mismos materiales, misma versión de OP). No mezclar Optimizer viejo con elevaciones nuevas.

### R6 — UI copy en español de taller; código en inglés

Identificadores: `ProductionOrder`, `cutRows`, etc.  
Copy: “Pack de producción”, “Elevación muro A”, “Pliegos estimados”, etc.

### R7 — UI no calcula dominio

Fórmulas, cut-list, estimación de pliegos, validaciones de export: `packages/domain` (+ Go cuando aplique). React solo presenta y dispara exports.

---

## 3. Estado actual (baseline 2026-08)

Inventario **ya implementado** (no reabrir issues cerrados como “nuevo trabajo” sin delta):

| Capacidad | Estado | Referencia |
|-----------|--------|------------|
| Cola producción (`accepted` → export → `produced`) | ✅ | `ProductionQueue`, F038 |
| Workspace Producción (nav + hub OP + rutas) | ✅ PROD-0.1/0.3 | `#215` `#217` · `ProductionWorkspace` |
| Desacople exports de fábrica del chrome de cotización | ✅ PROD-0.2 | `#216` · chrome primary + Más sin exports de fábrica (solo nav a hub) |
| Módulos + planta/3D read-only en hub | ✅ PROD-0.4 | `#218` · tabs `modulos` / `vistas` |
| Elevaciones PDF por muro | ✅ PROD-1.1 | `#219` · `buildProductionElevations` + PDF |
| Pack ZIP ampliado | ✅ PROD-1.2 | `#220` · carátula + elevaciones + despiece |
| Despiece / herrajes / documentos UI | ✅ PROD-1.3–1.4 | `#221` `#222` |
| Export Optimizer.xlsx | ✅ | PRD EXP-*, `packages/excel` |
| Export herrajes | ✅ | F041 |
| Etiquetas de pieza + encintado | ✅ | F046 |
| Pack ZIP (Optimizer + herrajes + etiquetas [+ pliegos en resumen]) | ✅ | **#134** |
| Estimación de pliegos (heurística, no nesting) | ✅ | **#135** |
| QR en etiquetas | ✅ | **#141** |
| Import CSV resultado nesting | ✅ | **#142** |
| Vista tablero / cut rows en cola (board view) | 🔧 parcial | `ProductionBoardView` |
| Acciones de fábrica también en pantalla de proyecto | ⚠️ mezcla de modos | `ProjectsScreen` / detalle |
| Elevaciones PDF por muro con medidas | ❌ | Roadmap Fase 1 |
| Workspace Producción multi-pantalla (hub + vistas) | ❌ | Roadmap Fase 0 |
| Preview visual de nesting de pliegos | ❌ | Roadmap Fase 2 |
| CSV cut-list genérico | ❌ | Roadmap Fase 2 |
| Estados de piso (cortado/encintado/armado) | ❌ | Roadmap Fase 3 |
| CNC / DXF por pieza | 📄 doc / demanda | **#111** (open) |

**Conclusión:** el **pipeline de archivos** está maduro. Falta el **workspace de fábrica** (IA, vistas de taller, documentación espacial, optimización visible).

---

## 4. Usuarios y trabajos (JTBD)

### 4.1 Oficina técnica / producción

| Job | Momento | Resultado |
|-----|---------|-----------|
| Abrir obra lista para fabricar | Cliente aceptó | Orden en cola, checklist de listo |
| Entender qué cortar | Antes de sierra | Despiece por material + códigos de pieza |
| Entender cómo va en obra | Antes de armar/instalar | Elevaciones por muro + lista de módulos |
| Mandar a corte | Día de producción | Optimizer / pack / CSV sin reescribir Excel |
| Etiquetar piezas | Post-corte | PDF etiquetas con QR |
| Cerrar obra en taller | Fin de fabricación | `produced` + (futuro) estados intermedios |

### 4.2 Vendedor (fuera del núcleo de Producción)

| Job | Dónde lo hace |
|-----|----------------|
| Diseñar y cotizar | **Proyectos** |
| Presentar al cliente | Presentación / Proyectos |
| “Ya firmó → a fábrica” | CTA **Enviar / Ver en Producción** (si rol y status lo permiten) |

El vendedor **no** necesita la jungla de exports en el día a día (RBAC ya restringe; la UI debe reforzarlo con IA limpia).

---

## 5. Arquitectura de información (IA)

### 5.1 Menú lateral

```
Producción                          ← sección de nav (no sub-tab de un proyecto de diseño)
├── Cola de trabajo                 ← listado de OPs / proyectos accepted|produced
└── (al abrir una obra)
    ├── Resumen (hub)
    ├── Módulos                     ← listado read-only de ítems de la obra
    ├── Despiece                    ← cut-list rica
    ├── Herrajes
    ├── Vistas                      ← planta / elevaciones / 3D read-only
    ├── Optimización                ← pliegos estimados + preview + import
    ├── Documentos                  ← PDFs generados / regenerar
    └── Exports                     ← Optimizer, CSV, pack ZIP, (futuro CNC)
```

**Nombre de nav:** `Producción` (ya existe entrada para cola).  
**No** llamar a este workspace “Proyecto” para no confundir con diseño.

### 5.2 Navegación desde Proyectos

En detalle de proyecto `accepted` | `produced`:

- CTA primaria de fábrica: **“Abrir en Producción”** (navega al hub de esa obra en el workspace Producción).
- Exports de fábrica (Optimizer, herrajes, etiquetas, pack): **solo en Producción** — no en chrome ni en **Más** de cotización. En cotización queda como máximo la nav al hub.
- En `draft` | `quoted`: **no** mostrar el workspace de fábrica como destino principal; copy: “Disponible al aceptar la cotización”.

### 5.3 Modelo mental: Proyecto vs Orden de producción

| Concepto | Definición en este producto |
|----------|----------------------------|
| **Proyecto / cotización** | Entidad comercial + diseño (`Project`). Editable en modo diseño según status. |
| **Orden de producción (OP)** | Vista de fábrica sobre un proyecto en status fabricable. **v0:** OP = el mismo `Project` en contexto Producción. **v1 (recomendado):** snapshot/versión explícita (`productionRevision` o entidad `ProductionOrder`) para no cortar con BOM desactualizado. |

Hasta que exista `ProductionOrder` versionada, el hub de Producción **debe** mostrar:

- status del proyecto,
- fecha de aceptación si existe,
- advertencia si se regenera export después de cambios (si el sistema puede detectarlo).

Detalle de versión → issue de dominio en Fase 0/1 del roadmap.

---

## 6. Pantallas — especificación funcional

Cada pantalla define: **propósito**, **datos**, **acciones**, **prohibiciones**, **criterios de aceptación**.

### 6.0 Cola de trabajo

**Propósito:** ver qué obras entran / están / salieron de fábrica.

**Datos:** proyectos visibles por RBAC con status `accepted` | `produced` (filtros existentes de cola).

**Acciones:**

- Abrir hub de la obra.
- Accesos rápidos a pack / Optimizer (opcionales; no sustituyen el hub).
- Marcar `produced` (RBAC).

**Prohibido:** editar items o layout desde la cola.

**Aceptación:**

- [ ] Lista clara con cliente, obra, status, señales de “pack generado” / “nesting importado” cuando existan.
- [ ] Un click abre el **hub**, no el editor de cotización.
- [ ] Roles sin permiso de producción no ven la sección (comportamiento actual de cola se mantiene o se endurece).

---

### 6.1 Hub / Resumen de la orden

**Propósito:** sala de control de una obra en fábrica.

**Bloques obligatorios:**

1. **Identidad:** nombre proyecto, cliente, status, fechas relevantes.
2. **Totales de fábrica:** m² tablero, ML canto, #piezas, #módulos, conteo herrajes (sin forzar precio de venta al rol producción si la política de costos lo oculta — ver PRD F039).
3. **Checklist “listo para cortar”** (lectura + estado derivado):

| Check | Significa |
|-------|-----------|
| BOM / cut-list válido | Se pueden generar `ProductionCutRow[]` sin error de validación |
| Materiales resueltos | Nombres de material alineados a catálogo/snapshot |
| Layout presente (si aplica) | Hay kitchen layout con placements **o** se declara obra “solo corrida lineal / sin muros” |
| Optimizer generable | Export EXP no bloqueado |
| Pack descargable | Al menos Optimizer (+ resto best-effort como #134) |

4. **Acciones primarias (máx. 1–2 visibles):**  
   - **Generar / descargar Pack de producción**  
   - **Abrir Optimización** o **Documentos**

**Prohibido:** formularios de edición de cotización.

**Aceptación:**

- [ ] En &lt; 5 segundos se entiende si la obra está lista para cortar.
- [ ] No hay botones de “Editar módulo / opciones / muros”.
- [ ] Enlace explícito “Ver cotización / diseño” que **sale** del workspace Producción hacia Proyectos (solo lectura o edición según status/rol).

---

### 6.2 Módulos (listado de muebles)

**Propósito:** inventario de lo que se fabrica, por ítem de proyecto.

**Datos por fila:** código/nombre módulo, cantidad, medidas efectivas, material interior/frente resumido, muro/placement si existe, link a elevación.

**Acciones:** filtrar, buscar, abrir ficha read-only del módulo (despiece de ese módulo + 3D).

**Prohibido:** cambiar qty, preset, opciones.

---

### 6.3 Despiece (cut-list de producción)

**Propósito:** lista de partes de tablero lista para taller y para validar el Optimizer.

**Agrupaciones:** material → espesor → módulo (configurables).

**Columnas mínimas (contrato de UI):** código pieza, módulo, material, L, A, espesor, cantos (4 lados o resumen), qty, grano si aplica.

**Acciones:** exportar vista (CSV en Fase 2), copiar, filtrar “solo frentes”, etc.

**Prohibido:** editar dimensiones a mano en esta vista (la verdad es el BOM resuelto).

**Aceptación:**

- [ ] Misma población de piezas que alimenta el Optimizer (salvo filas no cortables ya excluidas por EXP-05).
- [ ] Códigos estables entre despiece, etiqueta y (futuro) pliego.

---

### 6.4 Herrajes

**Propósito:** picking list y PDF de herrajes (reutilizar export existente).

**Aceptación:** paridad con export de herrajes actual; presentación en contexto Producción.

---

### 6.5 Vistas (planta · elevaciones · 3D)

**Propósito:** documentación espacial de armado/instalación — **no** diseñador.

| Vista | Contenido | Edición |
|-------|-----------|---------|
| Planta | Muros + módulos con códigos | ❌ |
| Elevación por muro | Alzado frontal: módulos, anchos, altos, línea de zócalo/tope, cotas de corrida | ❌ |
| 3D | Orbit / pan / zoom; sin gizmos de move/resize de diseño | ❌ manipulación de layout |

**Aceptación elevación:**

- [ ] Una elevación por muro con nombre (ej. “Muro A — 3200 mm”).
- [ ] Cada módulo muestra código y ancho; altura de instalación distinguible (base vs alto).
- [ ] Módulos unplaced: sección “Sin colocar” (no inventar posiciones en elevación).
- [ ] Exportable a PDF (Fase 1).

**Referencias de mercado (inspiración, no clon):** Mozaik Multi-Print / elevaciones; Cabinet Vision Report Center — nosotros priorizamos **legibilidad de taller** sobre CAD completo.

---

### 6.6 Optimización

**Propósito:** contestar “¿cuántos pliegos?” y “¿cómo se ven / se consumieron?” sin mentir que es el nesting de la sierra si no lo es.

**Capas (obligatorio etiquetar en UI):**

| Capa | Nombre UI | Qué es | Qué no es |
|------|-----------|--------|-----------|
| L0 | **Pliegos estimados** | Heurística m² × (1+merma) / área pliego catálogo (#135) | Nesting real |
| L1 | **Preview de tableros** | Visualización de un plan (simulado o importado) | Sustituto del Optimizer export |
| L2 | **Import nesting** | CSV real del software de corte (#142) | Edición del diseño |
| L3 | Nesting nativo app | Solo si producto lo habilita más adelante | Default actual |

**UI debe decir** en L0:  
`Estimado — nesting real en software de corte` (copy ya usado).

**Aceptación preview (Fase 2):**

- [ ] Canvas por pliego a escala con piezas etiquetadas.
- [ ] % aprovechamiento y restos cuando los datos existan.
- [ ] No se presenta como “plan de corte oficial” si la fuente es estimación.

---

### 6.7 Documentos

**Propósito:** generar e historiar PDFs de taller.

**Paquete documental objetivo (Fase 1+):**

| # | Documento | Consumidor |
|---|-----------|------------|
| 1 | Carátula OP | Jefe de taller |
| 2 | Elevaciones por muro | Armado / instalación |
| 3 | Lista de módulos | Armado |
| 4 | Despiece por material | Corte |
| 5 | Herrajes | Armado / compras |
| 6 | Etiquetas | Post-corte |
| 7 | (opc) Imágenes de pliegos | Corte |
| 8 | (futuro) Hojas de armado por tipo de módulo | Armado |

Los PDFs pueden vivir sueltos y/o dentro del **Pack ZIP** ampliado.

---

### 6.8 Exports

**Propósito:** archivos máquina/oficina.

| Export | Estado | Notas |
|--------|--------|-------|
| Optimizer.xlsx | ✅ | Contrato `Plantilla_Optimizer.xlsx` |
| Herrajes | ✅ | |
| Etiquetas PDF | ✅ | QR #141 |
| Pack ZIP | ✅ | Ampliar contenido en Fase 1 sin romper #134 |
| CSV cut-list genérico | Roadmap | Columnas documentadas en el issue |
| DXF / JSON CNC | #111 | Bajo demanda; no bloquear el módulo |

**RBAC:** igual que PRD F041 — `vendedor` no exporta producción.

---

## 7. Pack de producción — contrato de contenido

### 7.1 Pack actual (#134) — baseline

ZIP con, cuando generables:

- Optimizer.xlsx  
- lista de herrajes  
- etiquetas  
- (resumen de pliegos según implementación actual)

### 7.2 Pack de taller ampliado (objetivo Fase 1)

Mismo ZIP **más**, cuando existan generadores:

- PDF carátula OP  
- PDF elevaciones (1 archivo multi-página o 1 por muro)  
- PDF despiece  
- (opcional) PNG/PDF de preview de pliegos  

**Reglas:**

- Best-effort: si falla un anexo no crítico, el pack puede generarse con los núcleos (Optimizer) y listar omisiones en UI.
- Nombre de archivo estable: `pack-produccion-{proyecto}.zip` (patrón actual).
- Una sola resolución de BOM por descarga (R5).

---

## 8. Decisiones de dominio (para no interpretar mal)

| ID | Decisión | Default hasta issue de dominio |
|----|----------|--------------------------------|
| D1 | ¿Entidad `ProductionOrder` separada? | **v0+v1 parcial:** sigue siendo `Project` + `production` state (`revision`, fingerprints). No hay entidad OP separada aún; basta para stale-export. |
| D2 | ¿Producción parcial (solo un ambiente)? | **v1 UI:** filtro por `KitchenSpace` en hub (vistas). Export Optimizer sigue siendo obra completa. |
| D3 | ¿Quién crea la OP? | Automática al existir proyecto `accepted` visible en cola; no hay wizard aparte en v0. |
| D4 | ¿Re-export después de editar diseño en accepted? | Permitido técnicamente hoy; UI debe **advertir** regenerar pack. v1: bump de revision. |
| D5 | Nesting nativo | **Fuera** hasta demanda + decisión explícita; no sneaky-scope en PRs de UI. |
| D6 | Post-procesador CNC de marca | Solo con hardware real del usuario (#111). |

---

## 9. Anti-alcance (explícito)

**No es parte de este módulo (salvo issue futuro aprobado):**

- CAD libre, render fotorrealista, CRM, ERP de stock completo.
- Edición de diseño “un poquito” desde Producción.
- G-code de marca sin piloto.
- Reemplazar el Optimizer externo sin decisión de producto.
- Multi-taller / multi-empresa.
- App móvil nativa (paperless tablet es icebox Fase 4).

---

## 10. Roadmap e issues

Convención de tracking:

- **META** = épica del módulo.
- Cada issue de fase tiene: problema, solución, aceptación, fuera de alcance, link a **este doc** (`docs/production-module.md` §X).
- Al cerrar un issue: comentar evidencia + actualizar tabla §3 y checklist del META.

### 10.1 Mapa de fases

```
Fase 0  Separación de workspace (IA + hub + desacople de diseño)
   │
   ▼
Fase 1  Documentación de taller (elevaciones PDF + pack ampliado + despiece UI)
   │
   ▼
Fase 2  Optimización visible + CSV (preview tableros, exports genéricos)
   │
   ▼
Fase 3  Piso de taller + CNC doc (estados, link #111)
   │
   ▼
Fase 4  Excelencia (assembly sheets, paperless, what-if merma, OP parcial)
```

### 10.2 Issues GitHub (canónico)

| Fase | Código | Título corto | Issue | Depende de |
|------|--------|--------------|-------|------------|
| — | **PROD-META** | META: Módulo Producción — workspace de fábrica | **[#214](https://github.com/tiagofur/muebleria/issues/214)** | — |
| 0 | PROD-0.1 | Shell Producción: nav, rutas, hub por proyecto | **[#215](https://github.com/tiagofur/muebleria/issues/215)** ✅ | META |
| 0 | PROD-0.2 | Desacople: acciones de fábrica fuera del flujo de diseño | **[#216](https://github.com/tiagofur/muebleria/issues/216)** ✅ | 0.1 |
| 0 | PROD-0.3 | Hub OP: checklist listo-para-cortar + totales fábrica | **[#217](https://github.com/tiagofur/muebleria/issues/217)** ✅ | 0.1 |
| 0 | PROD-0.4 | Read-only: módulos + 3D/planta en contexto Producción | **[#218](https://github.com/tiagofur/muebleria/issues/218)** ✅ | 0.1 |
| 1 | PROD-1.1 | Elevaciones PDF por muro con medidas y códigos | **[#219](https://github.com/tiagofur/muebleria/issues/219)** ✅ | 0.4, layout cocina |
| 1 | PROD-1.2 | Pack ZIP ampliado (carátula + elevaciones + despiece) | **[#220](https://github.com/tiagofur/muebleria/issues/220)** ✅ | 1.1, #134 |
| 1 | PROD-1.3 | Pantalla Despiece producción (cut-list rica dedicada) | **[#221](https://github.com/tiagofur/muebleria/issues/221)** ✅ | 0.1 |
| 1 | PROD-1.4 | Pantalla Herrajes + Documentos (regenerar PDFs) | **[#222](https://github.com/tiagofur/muebleria/issues/222)** ✅ | 0.1 |
| 2 | PROD-2.1 | Preview visual de tableros / pliegos | **[#223](https://github.com/tiagofur/muebleria/issues/223)** ✅ | #135, 0.1 |
| 2 | PROD-2.2 | Export CSV cut-list genérico | **[#224](https://github.com/tiagofur/muebleria/issues/224)** ✅ | 1.3 |
| 2 | PROD-2.3 | Optimización UI unificada (L0+L1+L2 import #142) | **[#225](https://github.com/tiagofur/muebleria/issues/225)** ✅ | 2.1, #142 |
| 3 | PROD-3.1 | Estados de piso por módulo (cortado → armado) | **[#226](https://github.com/tiagofur/muebleria/issues/226)** ✅ | 0.3 |
| 3 | PROD-3.2 | Advertencia / revision de OP al re-exportar | **[#227](https://github.com/tiagofur/muebleria/issues/227)** ✅ | 0.3, D1 |
| 3 | PROD-3.3 | CNC metadatos / DXF (piloto) | **[#111](https://github.com/tiagofur/muebleria/issues/111)** ✅ JSON pilot | demanda real |
| 4 | PROD-4.1 | Hojas de armado PDF por módulo | **[#239](https://github.com/tiagofur/muebleria/issues/239)** ✅ | 3.1 |
| 4 | PROD-4.2 | Modo paperless de piso (tablet) | **[#240](https://github.com/tiagofur/muebleria/issues/240)** ✅ | 3.1 |
| 4 | PROD-4.3 | What-if merma en Optimización | **[#241](https://github.com/tiagofur/muebleria/issues/241)** ✅ | 2.3 |
| 4 | PROD-4.4 | OP filtrable por ambiente (KitchenSpace) | **[#242](https://github.com/tiagofur/muebleria/issues/242)** ✅ | multi-space |
| 4 | — | Nesting nativo como verdad de corte | **No** (D5) | demanda |

### 10.3 Definición de “fase hecha”

| Fase | Hecha cuando |
|------|----------------|
| 0 | Se puede completar el flujo accepted → hub → pack **sin** usar el editor de diseño; exports de fábrica no son el centro de Proyectos. |
| 1 | Un jefe de taller puede imprimir elevaciones + despiece + pack coherente. |
| 2 | Se ve preview de pliegos y se exporta CSV; import nesting se gestiona en Optimización. |
| 3 | El piso puede marcar avance; CNC solo si #111 avanza con hardware real. |
| 4 | Assembly sheets + paperless piso + what-if merma + filtro por ambiente. Nesting nativo **no** requerido. |

### 10.4 Cierre META (#214)

**Cerrado:** 2026-08-06 — workspace de fábrica usable de punta a punta sin editar diseño.

| PR | Fase | Issues |
|----|------|--------|
| #234 | 0 | #215–#218 |
| #236 | 1 | #219–#222 |
| #237 | 2 | #223–#225 |
| #238 | 3 | #226–#227, #111 |
| #243 | 4 | #239–#242 |

**No bloquean cierre (explícito / demanda futura):**

- Nesting nativo como fuente de verdad de corte (D5)
- DXF / post-procesador CNC de marca (después del pilot JSON #111)
- App móvil nativa / offline PWA
- Optimizer export parcial por ambiente

**Polish (iteración post-META, en main vía PR):**

- Tabs del hub sticky + scroll horizontal en mobile
- Chrome: pack primary a full-width en phone; copy de cola/hub más claro
- Optimización: leyenda L0/L1/L2 en español de taller
- Tablas con scroll touch; márgenes PDF algo más generosos

**Aún útil con obra real (feedback de taller, no bloqueante):**

- Smoke manual con proyecto accepted multi-ambiente
- Ajustes finos de PDF según impresora del taller


### 10.5 Orden histórico (ya ejecutado)

1. PROD-0.1 → 0.3 → 0.2 → 0.4  
2. PROD-1.1–1.4  
3. PROD-2.1–2.3  
4. PROD-3.1–3.3  
5. PROD-4.1–4.4  

---

## 11. Criterios globales de aceptación del módulo

El módulo Producción se considera **sólido (Fase 0+1)** cuando:

1. Un usuario `produccion` completa **cola → hub → pack → produced** sin abrir el editor de cotización.
2. Un usuario `vendedor` no se ve inundado de comandos de fábrica en el diseño diario.
3. Las elevaciones PDF coinciden con el layout del proyecto accepted (mismos módulos y códigos).
4. El Optimizer del pack es el mismo conjunto de piezas que el despiece de Producción.
5. La UI nunca presenta estimación de pliegos como nesting de máquina.
6. Tests cubren: gates RBAC, generación pack, (nuevos) generadores PDF de elevación, no regresión Optimizer.

---

## 12. Glosario

| Término | Significado aquí |
|---------|------------------|
| **OP** | Orden de producción — vista de fábrica de un proyecto fabricable |
| **Cut-list / despiece** | Piezas de tablero resueltas (`ProductionCutRow` y derivados) |
| **Optimizer** | Excel `Plantilla_Optimizer.xlsx` para el software de corte del taller |
| **Pack** | ZIP con el conjunto coherente de archivos de una OP |
| **Elevación** | Vista frontal de un muro con módulos y cotas |
| **Pliego** | Tablero/plancha de material de catálogo |
| **Nesting** | Empaquetado 2D de piezas en pliegos (hoy: externo) |
| **Solo lectura de diseño** | Sin mutar items/opciones/layout |

---

## 13. Cómo usar este doc en PRs

1. Todo PR del módulo debe citar: `docs/production-module.md` + issue `PROD-x.y` / número GitHub.  
2. Si el PR toca política de corte/CNC, alinear con §2 R3 y `prd.md` §6.7.  
3. Si se propone nesting nativo o edición desde Producción → **issue de producto primero**, no sneak.  
4. Actualizar §3 baseline al cerrar capacidades.

---

## 14. Historial

| Fecha | Cambio |
|-------|--------|
| 2026-08-06 | Creación: visión workspace, reglas, pantallas, pack, roadmap. Issues #214–#227 + enlace #111. Baseline #134/#135/#141/#142. |
| 2026-08-06 | **Fase 0 implementada** (PROD-0.1–0.4): shell, desacople, hub, módulos + vistas read-only. |
| 2026-08-06 | **Fase 1 implementada** (PROD-1.1–1.4): elevaciones PDF, pack ampliado, despiece/herrajes/documentos. |
| 2026-08-06 | **Fase 2 implementada** (PROD-2.1–2.3): preview tableros, CSV cut-list, UI optimización L0/L1/L2. |
| 2026-08-06 | **Fase 3 implementada** (PROD-3.1–3.3): floor status, OP revision/stale, CNC pilot JSON (#111). |
| 2026-08-06 | **Fase 4 implementada** (PROD-4.1–4.4): assembly sheets, paperless piso, what-if merma, scope por ambiente. Nesting nativo sigue fuera (D5). |
