# Producción (estaciones) — Board de órdenes de trabajo por obra

**Fase:** 1 (v1 implementada) → **v2 aprobada JD 2026-08-18, pendiente**
**Nav implementado:** `production` · **Ruta:** `/production` · **Label UI:** Producción

> Alias histórico **deprecated:** `fabric` / `/fabrica`. La fuente ejecutable de rutas es `apps/web/src/routes.ts` → `NAV_PATHS`.
**Decisiones:** `docs/production-module.md` §8 D9 (claim) + D10 (board por obra)

---

## 0. Purpose

La pantalla daily-driver del piso: qué fabricar **por obra**, con la información
que importa a **cada estación** dentro de la card de la obra. El operador abre
su estación y responde, sin salir de la pantalla:

- *"¿Qué tableros me tienen que llegar para cortar esta obra — y me los surtieron?"*
- *"¿Cuánta cintilla de cada color necesito y cuántas piezas/lados van?"*
- *"¿Qué muebles armo de esta obra?"*

Modelo mental validado contra el mercado (MES industrial: *digital job packet*
+ verificación de material en el punto de uso; Mozaik/Cabinet Vision: cut lists
agrupadas por material por trabajo): **la unidad de trabajo es la obra**, no el
ítem suelto.

### v1 → v2 (qué cambió y por qué)

| | v1 (implementada) | v2 (aprobada) |
|---|---|---|
| Estructura | Lista plana de ítems de todas las obras mezcladas | Cards **por obra** (patrón ship-board de Embarques/Instalaciones) |
| Contenido | `obra · cliente · N muebles · está en X` | Bloque de **métricas del proceso** por estación (tableros/cintillas/muebles) |
| En progreso | No existe (solo avance one-tap) | **"Empezar [estación]"** = claim obra×estación (D9) |
| Surtido | Invisible | "✓ surtido por almacén" por material (picking ya persiste) |
| Batch | No | "Marcar los N" por obra |

v1 verificada en vivo el 2026-08-18: tab Corte con 3 filas idénticas
"Cocina Nellly · 1 mueble · Pendiente" — la misma obra repetida por ítem, sin
tableros ni agrupación. Score del critique: 22/40 (snapshot
`.impeccable/critique/2026-08-18T14-35-54Z__packages-ui-src-production.md`).

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full | Todas las estaciones + toggle Métricas |
| gerente_produccion | ✅ full | Todas las estaciones + toggle Métricas |
| produccion | ✅ sus sectores | Solo estaciones asignadas (unrestricted legacy = todas) |
| almacen | ❌ | Vive en Compras/Almacén (sus sectores logísticos → Embarques/Instalaciones) |
| vendedor / user / guest | ❌ | Estado de Planta es su vista (read-only) |

**Estaciones de esta pantalla:** `cutting` · `edge_banding` · `assembly` ·
`packaging`. Despacho e Instalación viven en sus pantallas propias
(`Embarques` / `Instalaciones`). `cnc` se suma cuando exista `machined`.

---

## 2. Screen structure (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│  PRODUCCIÓN                                       3 por hacer    │
│  (subtítulo actual)                                              │
├──────────────────────────────────────────────────────────────────┤
│  [Corte 3] [Encintado 0] [Armado 0] [Embalaje 0]   [Cola|Métricas]│
├──────────────────────────────────────────────────────────────────┤
│  TAB CORTE                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Cocina Nellly · Pin Test Customer        [▶ Empezar corte] │  │
│  │                                                            │  │
│  │ TABLEROS PARA ESTA OBRA                                    │  │
│  │  ● Melamina Blanca 18mm   4,2 m² · 23 piezas · ~2 planchas │  │
│  │    ✓ surtido por almacén                                   │  │
│  │  ● Roble Córdoba 18mm     2,1 m² · 11 piezas · ~1 plancha  │  │
│  │    ⚠ sin marcar en almacén                                 │  │
│  │                                                            │  │
│  │ MÓDULOS EN COLA (3)                                        │  │
│  │  MOD-GAB-01 ×1 · Pendiente              [Marcar cortado]   │  │
│  │  MOD-ALZ-02 ×2 · Pendiente              [Marcar cortado]   │  │
│  │                                          [✓ Marcar los 3]  │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Placard Martínez · María G.             [▶ Empezar corte]  │  │
│  │  … (misma estructura)                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Card "En curso"** (tras claim): borde/tinte brand + "En curso · empezó
14:32 · [operario]" + botón pasa a "Terminar corte" (finish + avance de los
ítems que falten, con confirmación).

---

## 3. Bloque de métricas por estación (el corazón de v2)

Todo derivado del dominio (`computeProductionTotals(cutRows)` del proyecto,
`estimateBoardSheets`, picking states) — **la UI no calcula** (R7).

| Estación | Bloque por obra | Fuente de datos | Estado |
|-----------|----------------|-----------------|--------|
| **Corte** | Tableros por acabado: nombre/código, espesor, m² netos, piezas, planchas estimadas + estado surtido del picking (✓ despachado / ⚠ sin marcar) | `ProductionTotals.materials` + `estimateBoardSheets` + `listPickingStates` | ✅ existe |
| **Encintado** | Cintillas por código: **ML**, espesor mm, **piezas**, **lados a encintar** (Σ L1+L2+W1+W2 × qty), swatch de color | `ProductionTotals.edges` (+ `pieces`/`sides` y `EdgeBand.previewColor` — **pendiente Fase 5.1**) | 🔧 falta dominio |
| **Armado** | Lista de muebles de la obra (código, nombre, qty, medidas si hay) — como hoy, agrupado por obra | `itemsWaitingForSector` + catálogo | ✅ existe |
| **Embalaje** | Módulos/cantidades a embalar de la obra | `itemsWaitingForSector` | ✅ existe |

**Surtido:** el picking de Compras/Almacén ya persiste por
`projectId × material` (`project_picking`). La fila del material en Corte (y la
cintilla en Encintado) muestra el estado — cierre del loop almacén→estación
**sin backend nuevo**.

---

## 4. En progreso — claim obra × estación (D9)

El sistema `ProductionActivity` (claim/pausa/reanudar/finish/daño) ya existe en
backend y storage client pero **ninguna pantalla lo llama** (dormido — por eso
Dashboard Producción lee "operarios activos 0" siempre).

- **"Empezar [estación]"** en la card → `POST /api/production/activity/claim`
  con `project_id + sector` (requiere **extensión aditiva**: `item_id` nullable
  o claim de obra — hoy el claim es por ítem).
- Card muestra "En curso · HH:MM · operario"; múltiples operarios = lista.
- **"Terminar"** = finish (+ avance pendientes con confirmación).
- Las duraciones reales (claim→finish) alimentan Dashboard Producción.

---

## 5. Acciones de avance

- Per-ítem: "Marcar [estado]" como hoy (`onAdvance(projectId, itemId, target)`
  → shell → server con scoping de estación + `FloorStatusEvent` F092).
- **Batch por obra:** "Marcar los N" avanza todos los ítems en cola de esa obra
  en esa estación (transacciones individuales auditadas, no un salto).
- Undo/rollback de avance: **pendiente de decisión** (hoy un tap erróneo no se
  revierte desde la UI — issue abierto del critique).

---

## 6. Métricas (toggle gerente/admin)

Sin cambios respecto a v1: tabla por sector (cola, operarios, hechos hoy,
tiempo prom. ponderado) + fila total (`summarizeFabricMetrics`). Con D9 activo,
"Operarios" y "Tiempo prom." pasan a ser datos reales (hoy siempre 0/—).

---

## 7. Data requirements

```ts
type FabricProjectCard = {
  projectId: string;
  projectName: string;
  customerLabel: string;
  items: readonly StationRow[];          // ítems en cola de ESTA estación
  totals?: ProductionTotals;             // por proyecto (corte/encintado)
  sheetEstimates?: SheetEstimate[];      // planchas estimadas por material
  picking?: ReadonlyMap<string, PickingStatus>; // surtido por material
  edgeBandColors?: ReadonlyMap<string, string>; // edgeId → previewColor
  activeClaim?: { startedAt: string; operatorName: string }; // D9
};
```

Reusar: `itemsWaitingForSector`, `PIPELINE_SECTORS`, labels ES,
`roleCanAdvanceStation`, `computeProductionTotals`, `estimateBoardSheets`,
`pickingKey`, claim/finish del storage client.

---

## 8. Pendientes de dominio/backend (Fase 5, `production-module.md` §10.5)

1. `ProductionEdgeTotal` += `pieces`, `sides` (lados a encintar) — aditivo.
2. `EdgeBand.previewColor` — aditivo (como `Hardware`), habilita swatches.
3. Claim obra×estación en Go (`item_id` nullable) + storage client.
4. (issue abierto) rollback/undo de avance.

---

## 9. Out of scope

- Edición de diseño desde esta pantalla (R2 — siempre solo lectura).
- Nesting nativo (D5). CNC hasta que exista `machined`.
- Gestión de stock (vive en Compras/Almacén; acá solo se MUESTRA el surtido).
