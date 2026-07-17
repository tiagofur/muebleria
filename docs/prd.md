# PRD — Sistema de Cotización y Producción de Muebles

**Producto:** Muebles (nombre de trabajo; renombrable)  
**Estado:** MVP **implementado** · Etapa 3 multi-usuario **implementada** (F034–F041) · backlog post-E3 en GitHub (#87–#90) / F042–F045  
**Última revisión de alcance:** 2026-07-15  
**Autor:** Producto + dominio de taller  
**Fuentes de dominio:** `Plantilla_Muebles.xlsx`, `Plantilla_Optimizer.xlsx`  
**Audiencia:** dueño/operador del taller (usuario principal) y agentes de implementación  

> **Cómo seguir desde cualquier máquina:** leé `feature_list.json` (tareas `pending` de menor id) y los issues abiertos en GitHub. El harness (`AGENTS.md`, `./init.sh`) está orientado al producto Muebles.

---

## 1. Resumen ejecutivo

Hoy el trabajo de cotizar y mandar a producción depende de Excel: copiar módulos, recalcular medidas a mano, buscar costos con VLOOKUP y armar un segundo archivo para el optimizador de corte. Eso es lento y genera errores caros (mal corte, mal precio, material incorrecto).

**Qué construimos:** una aplicación de escritorio (Electron) y web (React) que comparte la misma UI y la misma lógica de dominio, para:

1. Mantener catálogos de **materias primas, cantos, herrajes y accesorios** (se dan de alta una vez).
2. Definir **muebles/módulos reutilizables** con su despiece: piezas de tablero y líneas de herraje **roladas** (interior, frente, bisagra, corredera…).
3. Definir **grupos de opciones** (ej. “Interiores”, “Frentes”, “Bisagras”, “Correderas”) con las alternativas permitidas y su precio de catálogo.
4. Armar **cotizaciones** eligiendo muebles del catálogo + opciones (color interior, color frente, bisagra, etc.) — **sin recrear el mueble por cada presupuesto**.
5. **Calcular el precio** resolviendo cada pieza/herraje según las opciones elegidas.
6. **Exportar** el Excel de producción en el formato exacto de `Plantilla_Optimizer.xlsx`.

**Qué NO es (por ahora):** un CAD 3D, un nesting 2D propio, un ERP, ni multi-taller en la nube.

**Éxito del producto:** el mueble se diseña una vez; la cotización solo elige cantidad y opciones; el precio y el export salen sin reescribir el despiece ni pelearse con fórmulas.

---

## 2. Problema y oportunidad

### 2.1 Problema actual

| Dolor | Consecuencia en el taller |
|-------|---------------------------|
| Despiece manual en Excel | Errores de medida, cantos mal marcados, IDs inconsistentes |
| Costos por VLOOKUP y celdas copiadas | Precio mal calculado; márgenes invisibles |
| Misma grilla para tablero y herraje (`HERRAJE` como truco) | Confusión; export de corte contamina con filas no cortables |
| Cintilla ligada al nombre del tablero | No modela “frente premium con canto 2 mm y cuerpo con 0.5 mm” |
| Módulos con medidas hardcodeadas | Cada variación = copiar 15 filas y recalcular |
| Dos archivos desalineados (cotización vs optimizer) | Nombres de material distintos → fallo en producción |
| Sin validaciones de negocio | Se puede cotizar con material inexistente o ML de canto absurdo |

### 2.2 Oportunidad

El Excel ya define el **lenguaje del negocio**. La app debe:

- **Preservar** el contrato de salida del Optimizer (compatible con el flujo actual de corte).
- **Mejorar** el modelo interno (separar catálogos, piezas, herrajes, cotización).
- **Automatizar** cálculos y validaciones que hoy son disciplina humana.

### 2.3 Por qué importa

Un error de 10 mm o un canto mal asignado no es un bug de UI: es tablero botado, retraso y margen destruido. La app es una **herramienta de precisión operativa**, no un CRUD genérico.

---

## 3. Visión y principios de producto

### 3.1 Visión

> De la idea del mueble al Excel de corte y a la cotización confiable, sin reescribir el despiece ni pelearse con fórmulas.

### 3.2 Principios (no negociables)

1. **Dominio primero, UI después.** Los cálculos viven en un motor puro, testeable, sin React.
2. **Una sola fuente de verdad.** Catálogos y BOM; la cotización y el export se derivan.
3. **Compatibilidad de salida.** El export Optimizer debe poder usarse en el flujo actual sin pasos manuales raros.
4. **Prevenir errores caros.** Validar antes de exportar; bloquear estados inválidos.
5. **DRY real.** Mismos componentes y misma lógica en web y desktop.
6. **Progresivo.** MVP útil en semanas; paramétricos/nesting después.
7. **Auditable.** Toda cifra de cotización debe poder rastrearse a fórmula + datos de entrada.
8. **Local-first (MVP).** Trabajar sin depender de internet; datos del taller en máquina local.
9. **API-Ready (Persistencia desacoplada).** Diseñar el acceso a datos mediante interfaces (Repository Pattern) desde el inicio, de modo que en la Etapa 2 sea trivial cambiar la persistencia de archivos JSON locales por una API HTTP sin afectar las capas de dominio o de presentación.
10. **Paridad multiplataforma (Cálculos en backend en Etapa 2).** Al migrar al esquema cliente-servidor con backend en Go, las fórmulas y validaciones de negocio se migrarán al servidor para garantizar consistencia total entre todas las plataformas (desktop, web y futuras apps móviles).

### 3.3 Anti-principios

- No clonar la UI del Excel celda por celda.
- No mezclar filas de herraje en el export de corte.
- No calcular costos en componentes de presentación.
- No inventar “features de ERP” antes de cerrar el loop cotizar → exportar.

---

## 4. Usuarios y trabajos a realizar (JTBD)

### 4.1 Usuario primario: operador / dueño de taller

Persona que cotiza, define módulos, elige materiales y manda a cortar.

| Job | Momento | Resultado esperado |
|-----|---------|-------------------|
| Actualizar precios de tablero/herraje | Llega lista de proveedor | Precios nuevos sin romper proyectos viejos (política de snapshot, ver §10) |
| Armar o ajustar un módulo | Nuevo diseño o variante | Explosión correcta en minutos |
| Cotizar un proyecto | Cliente pide presupuesto | Precio de venta + desglose confiable en &lt; 15 min para un proyecto típico |
| Mandar a producción | Cotización aceptada | Archivo Optimizer listo, solo piezas de tablero |
| Revisar herrajes a comprar | Antes de armar | Lista de herrajes agregada por proyecto |

### 4.2 Usuario secundario (futuro)

Ayudante de taller que solo exporta / imprime cut-list. Fuera de MVP de permisos; misma app, flujo acotado.

### 4.3 Escenarios de éxito (narrativos)

**Escenario A — Cotización rápida**  
Tiago arma un proyecto con 1 gabinete 1 puerta + 1 cajonera 4 cajones, cambia el frente a un melamina premium, ve el precio actualizado al instante, exporta cotización mental/resumen y exporta Optimizer.

**Escenario B — Cambio de precio**  
Sube el m² de “Arauco Blanco”. Los proyectos en borrador recalculan; los cerrados/aceptados conservan el snapshot de costos de cuando se cerraron (política explícita).

**Escenario C — Error evitado**  
Intenta exportar con una pieza sin material o con largo 0: la app bloquea y lista el error exacto (módulo, pieza, campo).

---

## 5. Estado actual del dominio (plantillas)

### 5.1 `Plantilla_Muebles.xlsx`

| Hoja | Rol |
|------|-----|
| Resumen y Cotización | Proyecto, cliente, costos agregados, margen, MO, precio final |
| Explosión y Despiece | BOM plano: piezas + herrajes, IDs de módulo/pieza |
| Configuración Costos | Tableros $/m², cintillas $/ML (por nombre material), herrajes $/u |

**Fórmulas de referencia (contrato de cálculo v1):**

```
m²_pieza     = cantidad × largo_mm × ancho_mm / 1_000_000
ML_canto     = cantidad × ((L1+L2)×largo_mm + (A1+A2)×ancho_mm) / 1000
costo_mat    = si herraje → qty × costo_unit
               si tablero → m² × costo_m²
costo_canto  = ML × costo_ml_asociado
costo_elem   = costo_mat + costo_canto
costo_directo = Σ materiales_tablero + Σ herrajes + Σ cantos
precio_venta  = (costo_directo × factor_margen) + mano_obra_fija
```

En la plantilla de ejemplo: `factor_margen = 1.35`, `mano_obra_fija = 1200` (MXN).

### 5.2 `Plantilla_Optimizer.xlsx`

Contrato de **salida de producción** (una hoja `Plantilla`):

| Columna | Campo | Notas |
|---------|--------|------|
| A | Cantidad | Entero &gt; 0 |
| B | Largo | mm |
| C | Ancho | mm |
| D | Descripción | Nombre / código de pieza |
| E | Materia Prima | Debe existir en catálogo del optimizador/taller |
| F | veta | 0 o 1 |
| G–J | Largo 1, Largo 2, Ancho 1, Ancho 2 | Flags de cubrecanto (0/1) |

Solo piezas de **tablero**. Sin herrajes. Sin costos.

### 5.3 Módulos de ejemplo en la plantilla

- `MOD-GAB-01` — Gabinete 1 puerta 300×720×590 mm  
- `MOD-CAJ-01` — Cajonera 4 cajones 500×720×590 mm  

Sirven como **casos de aceptación** del motor de dominio y del export.

---

## 6. Alcance

### 6.1 En alcance — MVP (v1) — **HECHO**

| # | Ítem | Estado |
|---|------|--------|
| 1 | Catálogos: materiales, cantos, herrajes/accesorios | Hecho (F006, F020) |
| 2 | Grupos de opciones configurables | Hecho (F007) |
| 3 | Muebles plantilla con roles / slots de opción | Hecho (F008, F021) |
| 4 | Cotizaciones: módulo × qty + opciones (sin redespiece) | Hecho (F009, F022) |
| 5 | Motor resolución BOM + costos + precio | Hecho (F003) |
| 6 | Explosión consolidada resuelta | Hecho |
| 7 | Export Optimizer 1:1 | Hecho (F004, F010) |
| 8 | Persistencia + web + packages compartidos | Hecho (F001, F005). **Desktop Electron:** adapters listos; host empaquetado pendiente → #38 / F032 |
| 9 | Validaciones que bloquean cotizar/export | Hecho |
| 10 | Datos semilla (MOD-GAB-01, MOD-CAJ-01, catálogos) | Hecho (F011) |

### 6.2 En alcance — v1.1 (corto plazo post-MVP)

| Ítem | Estado | Tracking |
|------|--------|----------|
| Snapshot de costos al “cerrar” cotización | Hecho | F012 |
| Export / lista de compra de herrajes | Hecho | F013 |
| Canto: grupo EDGE o mapeo material→canto default | Hecho | F027 |
| Duplicar módulo / proyecto | Hecho | F015 |
| Merma % por material en costo | Hecho | F014 |
| Opciones a nivel **proyecto** + override por línea | **Hecho** | [#35](https://github.com/tiagofur/muebleria/issues/35) · F029 |
| PDF o Excel de cotización comercial (simple) | **Hecho (Excel)** | [#36](https://github.com/tiagofur/muebleria/issues/36) · F030 — XLSX cliente; PDF opcional futuro |

### 6.2b Mejoras de producto abiertas (no bloquean MVP)

| Ítem | Tracking |
|------|----------|
| Pantalla Ajustes (defaults globales margen/MO) | [#37](https://github.com/tiagofur/muebleria/issues/37) · F031 |
| Desktop Electron host empaquetado | [#38](https://github.com/tiagofur/muebleria/issues/38) · F032 |
| UX grillas: atajos teclado (tab/enter) | [#39](https://github.com/tiagofur/muebleria/issues/39) · F033 |

### 6.3 Fuera de alcance (explícito)

| Ítem | Por qué se difiere |
|------|--------------------|
| Nesting 2D / optimización de pliegos | Ya existe flujo Optimizer externo |
| CAD / dibujo 3D / renders fotorealistas | No resuelve el dolor principal; layout **simple** de cocina está en alcance de excelencia (ver §6.7) |
| Módulos paramétricos completos | Alto valor, alta complejidad; Fase 4 del roadmap |
| Cloud sync multi-dispositivo completo | Etapa 2 en curso parcial (hay auth multi-usuario; falta sync real) |
| Inventario y stock | ERP; no MVP |
| CNC directo / post-procesadores de marca | Futuro documentado; ver §6.7.2 y issue CNC |
| Multi-moneda compleja | Plantilla es MXN; un default basta |
| App móvil nativa | Web responsive en MVP; nativa en Etapa 2 |

### 6.4 Decisiones de producto ya tomadas (v1)

| Tema | Decisión |
|------|----------|
| Plataformas | Web React + Desktop Electron |
| Paridad UI | Componentes compartidos (`packages/ui`) |
| Lógica | Motor de dominio compartido (`packages/domain`) |
| Export producción | Formato `Plantilla_Optimizer.xlsx` |
| Muebles | Plantillas reutilizables; **no** se recrean por cotización |
| Opciones en cotización | Grupos de opciones (interiores, frentes, bisagras, correderas…) |
| Medidas de pieza en MVP | Fijas en el módulo (paramétrico = fase posterior) |
| Moneda default | MXN (configurable después) |
| Unidades | mm para piezas; m² y ML para agregados |
| Offline MVP | Sí (local-first) |

### 6.5 Etapa 2 — Centralización y Multiplataforma (Go + Postgres)

| Ítem | Estado |
|------|--------|
| 1. Backend Go (REST, auth, CRUD) | **Hecho** (F024, F026) — `backend-go/` |
| 2. Postgres normalizado | **Hecho** (F024) |
| 3. Cálculos en el servidor (paridad TS↔Go) | **Hecho en gran parte** (engine, cut rows, hardware list, snapshot, validaciones; ver issues cerrados #7–#10) |
| 4. Sync multi-dispositivo / “guardar en servidor del taller” como única fuente | **Parcial** — la web ya trabaja contra API; falta hardening de offline/local-first dual y clientes adicionales |
| 5. App móvil nativa | **No iniciado** |

Auth multi-usuario (registro + aprobación admin + roles) está en F026.

---

### 6.6 Etapa 3 — Roles de producto y RBAC (F035+)

Multi-usuario con **puestos de taller**, no solo labels de cuenta.

#### 6.6.1 Roles

| Código | Nombre UI | Notas |
|--------|-----------|--------|
| `admin` | Admin | Usuarios, todo el sistema |
| `gerente_ventas` | Gerente de ventas | Portafolios de todos; asigna owner; delete proyecto |
| `vendedor` | Vendedor | Solo su portafolio (F034); sin ABM catálogo; sin export producción |
| `ingeniero` | Ingeniero | Catálogos + muebles plantilla; export producción |
| `produccion` | Producción | Cola de fabricación (F038); export corte/herrajes |
| `user` | Sin puesto | Cuenta aprobada sin rol de trabajo hasta asignación admin |

Migración legacy: `disenador` → `ingeniero`, `carpintero` → `produccion`.

#### 6.6.2 Matriz mínima (API + UI)

| Capacidad | admin | gerente | vendedor | ingeniero | produccion | sin puesto |
|-----------|:-----:|:-------:|:--------:|:---------:|:----------:|:----------:|
| Admin usuarios | ✓ | — | — | — | — | — |
| ABM catálogo / módulos | ✓ | — | — | ✓ | — | — |
| Clientes CRM | ✓ | ✓ | propio | — | — | — |
| Cotizaciones mutar | ✓ | ✓ | propio | — | — | — |
| Eliminar cotización | ✓ | ✓ | — | — | — | — |
| Export Optimizer / herrajes | ✓ | ✓ | — | ✓ | ✓ | — |
| Ver todos los owners | ✓ | ✓ | — | ✓ | ✓ | — |
| Asignar owner | ✓ | ✓ | — | — | — | — |

Mutaciones denegadas → **403**. Filas fuera de portafolio (vendedor) → **404** (sin filtrar por existencia).

Features dependientes: F036 produced/reopen, F037 dashboard gerente, F038 cola producción, F039 costos ocultos, F040 imágenes, F041 exports ingeniero.

#### 6.6.3 Nav por rol

Sidebar filtrada por `navIdsForRole` (domain). Deep-link denegado redirige a Inicio con mensaje en español de taller. Guest local sigue con acceso completo (sin RBAC de API).

#### 6.6.4 Workflow de estado (F036)

`draft → quoted → accepted → produced`

| Acción | Quién |
|--------|--------|
| Avanzar draft → quoted/accepted | Vendedor (propio), gerente, admin |
| Marcar **produced** (click, sin export previo) | Admin, gerente, ingeniero, producción |
| Reabrir → draft (limpia snapshot) | Solo gerente / admin |
| Eliminar cotización | Solo gerente / admin |

Precios congelados en `quoted` / `accepted` / `produced` (`priceSnapshot`). Export Optimizer y herrajes en **accepted** y **produced** (reimpresión).

#### 6.6.5 Home por rol (F037+)

| Rol | Home |
|-----|------|
| `gerente_ventas` / `admin` | Totales del período + tabla **Por responsable** (`ownerUserId`, nombre, puesto) |
| `vendedor` | Resumen de su portafolio (sin desglose de otros) |
| `produccion` | **Listos para fabricar** (F038): accepted → export corte/herrajes → marcar produced |


#### 6.6.6 Costos al vendedor (COST-01 / F039 + COST-02 / F044)

Por defecto el rol `vendedor` (y `user` sin puesto) **no** recibe ni ve en UI: `costPerM2`, `costPerUnit`, `costPerMl`, `board_price`, costo directo, factor de margen, desglose de costos. **Sí** ve precio de venta. Admin / gerente / ingeniero / producción ven la estructura de costos del taller.

**COST-02 (F044):** en Ajustes del taller, el flag `vendedorCanViewCosts` (default `false`) permite que vendedor/user vean la misma estructura de costos cuando está activo. Persistido en servidor (`GET`/`PUT /api/settings`); la redaction de API y el `showCosts` de UI usan el mismo criterio.

#### 6.6.7 Exports de producción (F041)

Roles `ingeniero`, `produccion`, `gerente_ventas` y `admin` pueden exportar Optimizer y lista de herrajes en proyectos **accepted** o **produced**. `vendedor` no. Cotización comercial (cliente) es independiente.

#### 6.6.8 Backlog post–Etapa 3 (issues)

| Ítem | Issue · feature |
|------|-----------------|
| Subida de imagen materiales/herrajes | [#87](https://github.com/tiagofur/muebleria/issues/87) · F042 |
| Pulir vitrina / home por rol | [#88](https://github.com/tiagofur/muebleria/issues/88) · F043 |
| Flag taller vendedor ve costos | [#89](https://github.com/tiagofur/muebleria/issues/89) · F044 |
| PDF cotización comercial | [#90](https://github.com/tiagofur/muebleria/issues/90) · F045 |

### 6.7 App Excellence (post-horizonte H01–H12)

Plan vivo: **`docs/app-excellence.md`**.  
Judgment Day WIP 3D (2026-07-17): **`docs/judgment-day-wip-3d-2026-07-17.md`**.

#### 6.7.1 Plan de corte (política)

| Ahora | Futuro (solo documentado hasta demanda real) |
|-------|-----------------------------------------------|
| `ProductionCutRow[]` → `Plantilla_Optimizer.xlsx` → nesting/corte **externo** | Metadatos por pieza → DXF/JSON → post-procesadores CNC de marca → nesting interno opcional |

El Optimizer Excel sigue siendo la **única** salida de plan de corte implementada. No hay nesting 2D embebido ni G-code en producto.

#### 6.7.2 CNC / máquinas

- Tracking base: issue de metadatos CNC/DXF (horizonte icebox).  
- Etapas F1–F4 en `docs/app-excellence.md` §4.  
- Implementar solo con demanda real del taller y prueba de campo.

#### 6.7.3 Layout simple de cocina (en alcance de excelencia)

- **Sí:** muros rectos, colocar/reordenar ítems de cotización, elevación base/alto, 3D desde placements.  
- **No (v1):** CAD libre, import de plano automático, renders fotorrealistas, islas complejas.  
- Fallback si no hay plano: corrida lineal actual (`layoutProjectRun`).

#### 6.7.4 Deuda técnica inmediata (Judgment Day)

Bugs de paridad API/Go y 3D de cotización se trackean como issues `bug` etiquetados desde el JD del 2026-07-17. Cerrarlos antes de construir el layout de cocina encima del preview.

---


## 7. Modelo de dominio (producto)

### 7.0 Idea central: catálogo vs cotización

Hay **dos momentos** distintos. Mezclarlos es lo que hace lento y propenso a error al Excel.

| Momento | Qué se hace | Qué NO se hace |
|---------|-------------|----------------|
| **Maestro (una vez)** | Alta de materiales, herrajes, cantos; grupos de opciones; diseño del mueble (piezas, medidas, roles) | No se habla del cliente |
| **Cotización (cada presupuesto)** | Elegir muebles × qty + opciones (interior, frente, bisagra…) | No se redibujan piezas ni se copian módulos |

```
[Catálogos]  →  [Grupos de opciones]  →  [Muebles plantilla]
                                              │
                                              ▼
                                    [Cotización: elijo mueble + opciones]
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                   Precio (resuelto)    Despiece resuelto     Export Optimizer
```

**Sí: creás el mueble una vez y en cada cotización solo lo elegís** (más cantidad y acabados/herrajes de los grupos). Eso es requisito de producto, no optimización opcional.

### 7.1 Entidades

> [!NOTE]
> **Identificadores (IDs):** Para asegurar paridad y fácil migración a Postgres en la Etapa 2, todos los campos `id` deben implementarse como UUIDs inmutables en la base de datos/almacenamiento local. El campo `code` es una clave lógica/visual administrada por el usuario con validación de unicidad.

```
MaterialBoard
  id (UUID), code, name, thicknessMm?, grainDefault?, costPerM2, wastePercent?,
  defaultEdgeBandId?,   # FK a EdgeBand (link por id — NUNCA por nombre)
  notes, active

EdgeBand (Canto / Cintilla)
  id (UUID), code, name, thicknessMm?, costPerMl, notes, active

Hardware
  id (UUID), code, name, unit (piece|set|meter), costPerUnit, notes, active

# --- Grupos de opciones (configurador de cotización) ---

OptionGroup
  id (UUID), code, name            # ej. INTERIOR, FRENTE, BISAGRA, CORREDERA
  kind: board | hardware | edge
  required: boolean         # si true, la cotización no cierra/exporta sin elegir
  optionIds[]               # ids de MaterialBoard | Hardware | EdgeBand según kind

# --- Mueble plantilla ---

EdgeAssignment
  side: L1 | L2 | W1 | W2
  enabled: boolean

BoardPart
  id (UUID), code?, description
  quantity, lengthMm, widthMm
  grain: 0 | 1
  edges: EdgeAssignment[4]
  optionRole: OptionGroup.code   # ej. INTERIOR | FRENTE
  # materialId opcional solo como default de diseño / preview; en cotización gana la opción elegida

HardwareLine
  id (UUID), quantity, descriptionOverride?
  optionRole: OptionGroup.code   # ej. BISAGRA | CORREDERA | FIJO?
  hardwareId?                    # solo si optionRole es "fijo" o como default

Module (mueble reutilizable)
  id (UUID), code, name
  externalDims? { width, height, depth }
  baseLaborCost?                 # costo opcional de mano de obra de fabricación por módulo (default 0)
  boardParts[]
  hardwareLines[]
  requiredOptionGroups[]         # subset de grupos que este mueble pide (derivable de roles)
  notes

# --- Cotización ---

Project
  id (UUID), name, clientName, currency, createdAt, updatedAt, status
  marginFactor, laborFixedCost, notes
  items: ProjectItem[]
  # v1.1 opcional: projectLevelChoices { INTERIOR: materialId, FRENTE: materialId, ... }

ProjectItem
  id (UUID), moduleId, quantity
  optionChoices: { [optionGroupCode]: catalogItemId }
  # ej. { INTERIOR: "mat-blanco", FRENTE: "mat-nougat", BISAGRA: "hw-blum", CORREDERA: "hw-500" }

# Resolución (calculado)
ResolvedBom
  boardParts with concrete materialId + edgeBandId
  hardwareLines with concrete hardwareId
  → QuoteBreakdown + ProductionCutRow[]
```

### 7.2 Separaciones críticas respecto al Excel

| Excel actual | Modelo de app |
|--------------|---------------|
| Una fila “HERRAJE” en la misma tabla | `HardwareLine` separada |
| Canto = VLOOKUP por nombre de tablero | `EdgeBand` como entidad; asignación en pieza |
| Material hardcodeado en cada fila del despiece | Pieza con **rol** (`INTERIOR`/`FRENTE`); material se elige en cotización |
| Bisagra fija en el módulo | Línea con rol `BISAGRA` + grupo de opciones |
| Headers merge de módulo en medio del sheet | `Module` plantilla reutilizable |
| Cotización = copiar filas del catálogo | `ProjectItem` = módulo + `optionChoices` |
| Optimizer = otro archivo manual | Generador de `ProductionCutRow[]` ya resuelto → xlsx |

### 7.3 Identificadores y trazabilidad

- Todo módulo tiene `code` único (ej. `MOD-GAB-01`).
- Toda pieza de tablero genera un `partId` estable dentro del módulo (ej. `MOD-GAB-01-P01`).
- Toda línea de herraje: `...-H01`.
- En proyecto, las instancias conservan referencia a `moduleId` + índice/id de ítem para poder re-exportar y auditar.

### 7.4 Políticas de costo (v1)

1. **Borrador (`draft`):** siempre recalcula con catálogo actual.
2. **Cerrada (`quoted` / `accepted` / `produced`) — v1.1+:** congela precios unitarios usados (snapshot). Reabrir a `draft` (gerente/admin) limpia el snapshot. `produced` no exige export previo (F036).
3. **Merma:** MVP = 0% o campo opcional simple en material; no nesting.
4. **IVA:** fuera de precio final MVP salvo flag simple “mostrar IVA X%” en v1.1.

---

## 8. Flujos principales

### 8.1 Flujo feliz — cotizar y producir

```
MAESTRO (raro / cuando cambia el taller)
1. Alta catálogos (materiales, cantos, herrajes)
2. Definir grupos de opciones (Interiores, Frentes, Bisagras, Correderas…)
3. Crear / editar mueble plantilla (piezas con rol INTERIOR/FRENTE, herrajes con rol BISAGRA/CORREDERA…)

COTIZACIÓN (cada cliente)
4. Nuevo proyecto → agregar muebles del catálogo × cantidad
5. Elegir opciones solo de los grupos permitidos (interior, frente, bisagra…)
6. El sistema resuelve BOM + calcula precio
7. Revisar desglose / explosión resuelta
8. Exportar Optimizer.xlsx (materiales ya resueltos)
9. (v1.1) Lista de herrajes / PDF cotización
```

### 8.1.1 Ejemplo de resolución

Mueble `MOD-GAB-01` tiene:

- Costados, piso, entrepaño, manguetes → rol `INTERIOR`
- Puerta → rol `FRENTE`
- 2× bisagra → rol `BISAGRA`

En cotización el usuario elige:

- Interiores: Arauco Blanco ($160/m²)
- Frentes: Vesto Nougat ($290/m²)
- Bisagras: Blum cierre lento ($45/u)

El motor asigna esos ítems a cada pieza/línea del rol, multiplica por qty del ítem de proyecto, y suma costos. **No se crea un mueble nuevo “Gabinete blanco/nougat”.**

### 8.2 Flujo — cambio de precio de material

```
1. Editar costo m² del material
2. Proyectos draft se recalculan al abrir/refrescar
3. Usuario revisa impacto en cotizaciones abiertas
```

### 8.3 Flujo — export bloqueado por error

```
1. Usuario pide export
2. Motor valida BOM del proyecto
3. Si hay errores: lista accionable (módulo, pieza, campo, mensaje)
4. Si ok: genera xlsx y guarda/descarga
```

---

## 9. Requisitos funcionales

Cada requisito tiene ID estable para trazabilidad a tests y features.

### 9.1 Catálogos

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| CAT-01 | CRUD de materiales (tablero) | Crear/editar/desactivar; campos mínimos: código, nombre, costo/m² |
| CAT-02 | CRUD de cantos | Crear/editar/desactivar; código, nombre, costo/ML |
| CAT-03 | CRUD de herrajes | Crear/editar/desactivar; código, nombre, unidad, costo unitario |
| CAT-04 | Unicidad de códigos | No dos entidades activas del mismo tipo con el mismo `code` |
| CAT-05 | Soft-delete / desactivar | No borrar si está referenciado; desactivar y ocultar en pickers por defecto |
| CAT-06 | Semilla inicial | Datos de ejemplo alineados a la plantilla (Arauco, Maderado, MDF 3mm, herrajes demo) |

### 9.1b Grupos de opciones

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| OPT-01 | CRUD de grupos de opciones | code, name, kind (board\|hardware\|edge), required |
| OPT-02 | Asignar miembros al grupo | Solo ítems del kind correcto (tablero en Interiores, herraje en Bisagras) |
| OPT-03 | Grupos semilla | Interiores, Frentes, Bisagras, Correderas (nombres editables) |
| OPT-04 | Picker en cotización | Solo muestra opciones del grupo; no el catálogo entero sin filtrar |
| OPT-05 | Grupo vacío o sin elección | Bloquea precio “final”/export si `required` y el mueble usa ese rol |

### 9.2 Módulos (muebles plantilla)

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| MOD-01 | CRUD de módulos | code, name, notas, dims externas opcionales |
| MOD-02 | Piezas de tablero con rol de opción | qty, L, A, veta, 4 flags canto, `optionRole` (INTERIOR/FRENTE/…) |
| MOD-03 | Asignar canto | MVP: flags + canto default o grupo EDGE v1.1 |
| MOD-04 | Herrajes del módulo con rol | quantity + `optionRole` (BISAGRA/CORREDERA) o hardware fijo |
| MOD-05 | Duplicar módulo | Copia profunda con nuevo code sugerido |
| MOD-06 | Preview de costo del módulo | Requiere un set de opciones de ejemplo o defaults; no inventar precios sin resolución |
| MOD-07 | Casos de referencia | MOD-GAB-01 y MOD-CAJ-01 como plantillas + un set de choices que reproduzca la plantilla Excel |
| MOD-08 | Reutilización | El mismo `moduleId` puede usarse en N cotizaciones sin clonar definición |
| MOD-09 | Categorías Jerárquicas | Clasificar muebles en hasta 3 niveles de categorías creadas por el usuario |

### 9.3 Proyectos y cotización

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| PRJ-01 | CRUD de proyectos | nombre, cliente, fecha, notas, status |
| PRJ-02 | Agregar ítems de módulo × cantidad | qty ≥ 1; elige de catálogo de muebles, no crea mueble nuevo |
| PRJ-03 | Elegir opciones por ítem | UI muestra solo grupos requeridos por ese mueble; valores solo del grupo |
| PRJ-04 | Factor de margen y MO fija editables por proyecto | Defaults configurables globalmente |
| PRJ-05 | Resolución de BOM | Cada pieza/herraje queda con material/hardware concreto según `optionChoices` |
| PRJ-06 | Cálculo de desglose | Materiales / herrajes / cantos / directo / venta a partir del BOM resuelto |
| PRJ-07 | Explosión consolidada | Piezas y herrajes con qty × ítem y material ya resuelto |
| PRJ-08 | Totales por material / herraje | Agrupados post-resolución |
| PRJ-09 | Cambio de opción recalcula | Cambiar frente de Nougat a otro color actualiza precio sin tocar el módulo maestro |
| PRJ-10 | Dos ítems del mismo mueble, distintas opciones | Permitido (ej. 1 gabinete blanco + 1 gabinete roble) |
| PRJ-11 | Selector categorizado | Modal para agregar ítems filtra los módulos usando la jerarquía de categorías |

### 9.4 Validaciones (prevención de errores)

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| VAL-01 | Pieza tablero: L y A &gt; 0 | Bloquea guardado/export con mensaje claro |
| VAL-02 | Material obligatorio en pieza tablero | Idem |
| VAL-03 | Herraje: qty &gt; 0 y hardware existente | Idem |
| VAL-04 | Flags de canto solo 0/1 | Modelo tipado booleano/0|1 |
| VAL-05 | Export sin piezas de corte | Error: “no hay piezas de tablero para exportar” |
| VAL-06 | Material inactivo referenciado | Warning o bloqueo configurable; default bloqueo en export |
| VAL-07 | Nombres/códigos vacíos | Rechazar en catálogo y módulo |

### 9.5 Export e import

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| EXP-01 | Export Optimizer | Columnas A–J como plantilla; solo board parts |
| EXP-02 | Multiplicar cantidades de proyecto | qty_pieza × qty_ítem_proyecto |
| EXP-03 | Nombre de materia prima exportado | Usar el nombre/código acordado del catálogo (configurable: `name` vs `code`) |
| EXP-04 | Orden de filas estable | Determinista (por módulo, luego part code) |
| EXP-05 | No incluir herrajes en Optimizer | Verificado por test de fixture |
| EXP-06 | Desktop: diálogo guardar archivo | Electron FS |
| EXP-07 | Web: descarga del .xlsx | Browser download |
| EXP-08 (v1.1) | Export lista de herrajes | CSV/XLSX simple |
| IMP-01 (nice) | Importar cut-list o plantilla demo | Sembrar datos de prueba |

### 9.6 Persistencia y multiplataforma

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| PER-01 | Guardar/abrir proyecto | Sin pérdida de datos |
| PER-02 | Catálogos persistentes | Globales a la instalación/usuario |
| PER-03 | Misma lógica en web y desktop | Tests de domain idénticos |
| PER-04 | UI compartida | Packages UI; shells delgados |
| PER-05 | Backup simple | Copiar archivo de datos / export JSON del workspace |

### 9.7 UX / usabilidad

| ID | Requisito | Criterio de aceptación |
|----|-----------|------------------------|
| UX-01 | Navegación clara | Catálogos / Módulos / Proyectos / (Ajustes) |
| UX-02 | Edición tabular eficiente | Teclado: tab, enter, atajos básicos en grillas |
| UX-03 | Feedback de totales siempre visible | En módulo y proyecto |
| UX-04 | Mensajes de error accionables | “Dónde / qué / cómo corregir” |
| UX-05 | Confirmación en borrados destructivos | Módulo/proyecto |
| UX-06 | Español UI | Etiquetas en español del taller (tablero, canto, herraje, despiece, cotización) |

---

## 10. Requisitos no funcionales

| ID | Área | Requisito |
|----|------|-----------|
| NFR-01 | Exactitud | Cálculos de m², ML y costos deterministas; tests golden con plantilla |
| NFR-02 | Performance | Proyecto de 50 módulos / ~2000 piezas: recálculo &lt; 200 ms en máquina media |
| NFR-03 | Confiabilidad | Escritura atómica de persistencia; no corromper archivo a mitad de save |
| NFR-04 | Testabilidad | Domain 100% unit-testeable sin DOM ni Electron |
| NFR-05 | Mantenibilidad | Monorepo; boundaries claros domain / ui / excel / storage / apps |
| NFR-06 | Seguridad básica | Sin secretos en repo; datos locales del usuario no se suben sin acción explícita |
| NFR-07 | Observabilidad dev | Logs de export/validación en desktop (nivel debug) |
| NFR-08 | Accesibilidad base | Focus visible, labels, contraste razonable (no WCAG AAA en MVP) |
| NFR-09 | i18n | UI es-ES/es-MX de taller; código y docs técnicas de ingeniería en inglés salvo docs de producto orientadas al usuario |
| NFR-10 | Versionado de archivo | Formato de persistencia versionado (`schemaVersion`) para migraciones |

---

## 11. Arquitectura de producto (alto nivel)

> Detalle técnico fino se define post-PRD en design/architecture. Aquí solo lo que el producto exige.

```
┌─────────────────────────────────────────────┐
│  apps/web (React)     apps/desktop (Electron)│
│         └──────── shells delgados ──────────┘
│                      │
│              packages/ui  (componentes)
│                      │
│              packages/domain (cálculos, validación, BOM)
│                      │
│         ┌────────────┼────────────┐
│         ▼            ▼            ▼
│   packages/excel  packages/storage  (ports)
│   (Optimizer IO)  (JSON/SQLite/fs)
└─────────────────────────────────────────────┘
```

### 11.1 Reglas de boundary

- `domain` no importa React, Electron, ni filesystem.
- `ui` no implementa fórmulas de costo.
- `excel` solo serializa DTOs de producción/cotización.
- `apps/*` cablean adapters (download vs dialog.save).

### 11.2 Stack propuesto (dirección, no dogmático)

- TypeScript, React, Vite
- Electron (shell)
- Monorepo (pnpm workspaces o equivalente)
- Tests: Vitest (domain primero)
- Excel: SheetJS o ExcelJS (decidir en design por preservación de formato)

### 11.3 Relación con el harness actual del repo

El repositorio contiene hoy un **ejemplo didáctico** (Notes CLI en Python + harness de agentes). **No es el producto.** Tras aprobar este PRD se debe:

1. Re-orientar `AGENTS.md`, `feature_list.json`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md` al producto Muebles.
2. Retirar o archivar el demo Notes cuando empiece la implementación real.
3. Conservar las **buenas ideas del harness**: una feature a la vez, tests para cerrar, progress en disco, leader/implementer/reviewer.

Eso se hace **después** del PRD, no antes: el PRD define el “qué”; el harness define el “cómo construimos”.

---

## 12. Pantallas (MVP)

| Pantalla | Propósito | Elementos clave |
|----------|-----------|-----------------|
| Home / Proyectos | Lista de cotizaciones | Buscar, nuevo, abrir, estado |
| Proyecto / Cotización | Elegir muebles + opciones | Líneas de mueble, pickers por grupo, totales en vivo |
| Editor de mueble | Plantilla BOM | Piezas con rol, herrajes con rol, preview |
| Grupos de opciones | Configurar alternativas | Interiores / Frentes / Bisagras / Correderas… |
| Catálogo materiales | ABM tableros | Tabla + form |
| Catálogo cantos | ABM cintillas | Tabla + form |
| Catálogo herrajes | ABM herrajes | Tabla + form |
| Ajustes | Defaults | margen default, MO default, path de datos |

Wireframes detallados: fuera de este PRD; se pueden bajar en fase de design UX si hace falta.

---

## 13. Reglas de cálculo detalladas (contrato v1)

### 13.1 Área y cantos

Para cada pieza de tablero:

```
areaM2 = qty * lengthMm * widthMm / 1_000_000

edgeMl = qty * (
  (L1 + L2) * lengthMm +
  (W1 + W2) * widthMm
) / 1000
```

donde L1,L2,W1,W2 ∈ {0,1}.

### 13.1b Resolución previa al costo

```
para cada BoardPart del módulo:
  material = catalog.board( optionChoices[part.optionRole] )
  # error si falta choice y el grupo es required

para cada HardwareLine del módulo:
  hardware = catalog.hardware( optionChoices[line.optionRole] )
           | line.hardwareId fijo si no usa grupo
```

Sin resolución no hay precio confiable ni export.

### 13.2 Costos de línea (sobre BOM resuelto)

```
boardCost = areaM2 * material.costPerM2 * (1 + material.wastePercent/100)
edgeCost  = edgeMl * edgeBand.costPerMl
hardwareCost = qty * hardware.costPerUnit

lineCost = boardCost + edgeCost   # para piezas tablero
         | hardwareCost           # para herrajes
```

### 13.3 Agregados de proyecto

```
materialsCost = Σ boardCost
edgeTotal     = Σ edgeCost
hardwareTotal = Σ hardwareCost
directCost    = materialsCost + edgeTotal + hardwareTotal
laborModular  = Σ (item.quantity * (module.baseLaborCost || 0))
salePrice     = (directCost * marginFactor) + laborModular + laborFixedCost
```

Donde `laborModular` es la suma del costo de mano de obra base de fabricación de cada módulo por la cantidad de veces que se instancie en la cotización. Si un módulo no tiene asignado `baseLaborCost`, se asume 0 y se calcula únicamente el costo fijo `laborFixedCost` a nivel proyecto.

### 13.4 Paridad con plantilla demo

Se incluirá un test de aceptación que cargue los datos de `MOD-GAB-01` + `MOD-CAJ-01` y compare totales con la plantilla recalculada (valores `data_only` o reimplementación de las mismas fórmulas). Cualquier divergencia intencional (ej. merma) debe documentarse.

### 13.5 Canto: mejora respecto al Excel

**Problema Excel:** el costo de canto se busca por el **nombre** del material del tablero (VLOOKUP frágil).

**Contrato app (F027):**

1. En cotización, si existe opción de grupo `EDGE` elegida → usa ese `edgeBandId`.
2. Si no, usa `material.defaultEdgeBandId` (FK explícita al `EdgeBand`).
3. Si hay flags de canto activos y no hay ni override ni `defaultEdgeBandId` → **error de resolución**.
4. **Nunca** se resuelve canto por coincidencia de `name` material ↔ canto.
5. En el ABM de material: selector de cintilla default + botón **Crear cintilla** (alta rápida y link automático).

---

## 14. Export Optimizer — contrato exacto

### 14.1 Filas

- Una fila por `BoardPart` expandida por cantidades de proyecto.
- Si un módulo se instancia 2 veces y una pieza tiene qty 1 → export qty 2 (o qty_pieza × qty_módulo).

### 14.2 Mapeo de campos

| Optimizer | Origen app |
|-----------|------------|
| Cantidad | qty consolidada |
| Largo | lengthMm |
| Ancho | widthMm |
| Descripcion | part.description o part.code (preferencia configurable; default description) |
| Materia Prima | material.exportName (default material.name) |
| veta | grain |
| Largo 1..Ancho 2 | edges flags |

### 14.3 Criterios de aceptación del export

- [ ] Abre en Excel/LibreOffice sin error.
- [ ] Encabezados fila 1–2 compatibles con la plantilla (Material / Cubrecanto merge si se preserva formato; mínimo headers de datos en fila 2).
- [ ] Un optimizador humano puede copiar/usar el archivo como hoy.
- [ ] Test automatizado compara fixture de salida.

**Nota de implementación:** preservar formato visual de la plantilla (merges, anchos) es deseable; la **corrección de datos** es obligatoria. Si hay tradeoff, ganan los datos.

---

## 15. Métricas de éxito

| Métrica | Baseline (Excel) | Meta MVP |
|---------|------------------|----------|
| Tiempo para cotizar 2 módulos tipo plantilla | alto / propenso a error | &lt; 15 min incluyendo ajustes de material |
| Errores de export (material/canto/medida) | frecuentes al copiar | 0 en flujo validado |
| Paridad de costo vs plantilla demo | n/a | 100% dentro de tolerancia |
| Reutilizar un módulo en nuevo proyecto | copiar filas | &lt; 1 min |
| Confianza del usuario | baja en fórmulas ajenas | usuario usa la app en un trabajo real |

Métricas subjetivas se validan con uso real del dueño del taller (aceptación de producto).

---

## 16. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Formato Optimizer del proveedor cambia | Export inválido | Capa `excel` aislada + tests de fixture + versión de export |
| Nombres de material no coinciden con el optimizador | Corte mal etiquetado | Campo `exportName` / catálogo alineado al taller |
| Scope creep (CAD, nesting, ERP) | No se entrega valor | Este PRD como frontera; features nuevas pasan por cambio de alcance |
| Harness Notes confunde agentes | Implementan la app equivocada | Reescritura de AGENTS/docs post-PRD |
| Cálculo distinto al Excel “de memoria” | Desconfianza | Golden tests + panel de desglose auditable |
| Electron + web duplican lógica | Bugs divergentes | Monorepo + domain tests compartidos |
| Parametrización dimensional pedida demasiado pronto | Complejidad | Medidas fijas en v1; paramétricos en fase 4 |
| Demasiados grupos de opciones mal modelados | UX confusa | Empezar con 4 grupos semilla; roles explícitos en piezas |

### 16.1 Complejidad de “grupos de opciones” (estimación)

| Capa | Complejidad | Notas |
|------|-------------|--------|
| Modelo de datos (OptionGroup + roles en piezas) | **Media-baja** | Pocas entidades; muy testeable |
| Motor de resolución + costo | **Media** | Corazón del dominio; golden tests |
| UI catálogo + grupos + roles en editor de mueble | **Media** | Forms y grillas |
| UI cotización (pickers por grupo) | **Media-baja** | Si el modelo está bien, la UI es simple |
| Reglas avanzadas (dependencias: corredera solo si hay cajón; color X implica canto Y) | **Alta** | **Fuera de MVP** |
| Opciones a nivel proyecto + override por línea | **Media** | v1.1 |
| Paramétrico dimensional (ancho libre) | **Alta** | Fase aparte |

**Veredicto de producto:** grupos de opciones es la pieza que hace que el sistema valga la pena y **entra en MVP**. No es un CAD ni un rule-engine: es “slots + catálogo filtrado + resolución”. Complejidad controlable si no metemos dependencias entre opciones en v1.

---

## 17. Roadmap por fases

### Fase 0 — Alineación — **HECHA**

- [x] Análisis de plantillas
- [x] PRD + modelo catálogo/grupos/cotización
- [x] Aprobar / operar bajo este PRD (en uso como contrato de producto)
- [x] Re-orientar harness del repo al producto (`AGENTS.md`, `feature_list.json`, docs)
- [x] Design técnico (paquetes, schema, stack — ver `docs/architecture.md`, `docs/technical_design.md`)

### Fase 1 — Fundación — **HECHA** (F001–F005)

- [x] Scaffold monorepo TS
- [x] `domain`: tipos + option groups + resolución BOM + costos + golden test
- [x] `excel`: writer Optimizer + tests
- [x] Storage local versionado

### Fase 2 — MVP usable — **HECHA** (F006–F011)

- [x] UI catálogos + grupos de opciones
- [x] UI muebles (roles en piezas/herrajes)
- [x] UI cotización + resumen
- [x] Export desde UI (web; desktop adapters)
- [x] Datos semilla

### Fase 3 — Endurecer para el día a día — **PARCIAL**

- [x] Snapshot de cotización (F012)
- [x] Lista de herrajes (F013)
- [x] Merma % (F014)
- [x] Duplicar módulo / proyecto (F015)
- [x] Cintilla default por material (F027)
- [x] Veta heredada del material (F028)
- [ ] Opciones a nivel proyecto + override (#35 / F029)
- [ ] Export cotización comercial (#36 / F030)
- [ ] Mejoras UX grilla / atajos (#39 / F033)
- [ ] Pantalla Ajustes (#37 / F031)

### Fase 4 — Inteligencia de taller — **NO INICIADA**

- Módulos paramétricos (gabinete N, cajonera N)
- Reglas de taller (bisagras por alto, corredera por fondo)
- Etiquetas / códigos de pieza avanzados

### Fase 5 — Ecosistema (opcional) — **NO INICIADA**

- Import resultado nesting (consumo real de pliegos)
- Cloud backup / multi-dispositivo completo
- Integraciones CNC

### Fase UI design system — **HECHA** (F016–F023)

- Tokens, layout sidebar, modales, toasts, catálogos/cards, dashboard.

### Segunda Etapa (Fase 6+) — Backend Go + Postgres — **AVANZADA**

- [x] Fundación backend Go + Postgres (F024)
- [x] Auth, roles, aprobación admin (F026)
- [x] Categorías jerárquicas de muebles (F025)
- [x] Motor de cálculo / generadores en Go (paridad con TS)
- [ ] Desktop Electron empaquetado (#38 / F032)
- [ ] Sync multi-dispositivo / offline dual robusto
- [ ] Clientes móviles

---

## 18. Criterios de aceptación del MVP (Definition of Done de producto)

El MVP se considera exitoso cuando **todas** se cumplen. **Estado a 2026-07-15: cumplido** (validado vía features F001–F011 + tests golden/export).

1. [x] Existen catálogos de materiales, cantos y herrajes editables.
2. [x] Existen grupos de opciones (al menos Interiores, Frentes, Bisagras, Correderas) con miembros configurables.
3. [x] Se crean muebles plantilla `MOD-GAB-01` y `MOD-CAJ-01` con piezas/herrajes **rolados** (no hace falta un mueble por color).
4. [x] En una cotización se **reutilizan** esos muebles, se eligen opciones solo del grupo, y el precio sale del BOM resuelto.
5. [x] El mismo mueble en dos líneas con distinto frente produce dos precios y dos materiales en export, sin clonar el módulo maestro.
6. [x] Se exporta un `.xlsx` Optimizer con materia prima ya resuelta y sin herrajes.
7. [x] Falta de opción requerida o medida inválida bloquea export con mensaje claro.
8. [x] Tests automatizados cubren resolución + costos + export.
9. [x] Ciclo real sin Excel manual: catálogo → grupos → mueble → cotización → export.

**Pendiente post-MVP (no bloquea DoD):** opciones de proyecto (#35), cotización comercial (#36), Ajustes (#37), Electron empaquetado (#38), atajos de grilla (#39).

---

## 19. Preguntas abiertas (resolver en revisión de PRD)

Priorizadas. Las no resueltas no bloquean el inicio de design si se elige el **default** indicado.

| # | Pregunta | Default propuesto / Decisión tomada |
|---|----------|-------------------|
| Q1 | ¿Canto por arista con material de canto distinto, o un canto por pieza? | Un canto por pieza en MVP; 4 flags on/off |
| Q2 | ¿Al cerrar cotización se congelan precios? | Sí en v1.1; MVP solo draft recalculable |
| Q3 | ¿Persistencia JSON monolítico o SQLite? | JSON versionado en MVP; Postgres en Etapa 2 |
| Q4 | ¿Nombre comercial de la app? | “Muebles” temporal |
| Q5 | ¿IVA en precio? | No en MVP |
| Q6 | ¿Opciones solo por línea de mueble, o también a nivel proyecto (mismo interior para todo)? | Por línea en MVP; nivel proyecto en v1.1 |
| Q7 | ¿Importador desde `Plantilla_Muebles.xlsx` completo? | Nice-to-have; semilla manual/JSON aceptable |
| Q8 | ¿Un solo “workspace” de taller o multi-empresa? | Un workspace local |
| Q9 | ¿MDF de fondos / respaldos usan grupo propio o van fijos en el mueble? | Fijos o rol `INTERIOR` según taller; default: rol configurable por pieza |
| Q10 | ¿Dependencias entre opciones (ej. corredera 500 solo si fondo ≥ 500)? | No en MVP |
| Q11 | ¿Grupos de opciones en MVP? | **Sí — aprobado por producto** (ver §7.0, §16.1) |
| Q12 | ¿Dónde vive el motor de cálculo en la Etapa 2? | **En el Backend (Go)**. Para evitar inconsistencias de precios entre clientes (desktop, web y mobile) al actualizar fórmulas. |
| Q13 | ¿Cómo se calcula la mano de obra? | **Opcional por módulo** (`baseLaborCost` en el catálogo) + cargo fijo general por proyecto (`laborFixedCost`). |
| Q14 | ¿Se permiten frentes multitono en un mismo mueble? | **No**. Todos los frentes de un mismo módulo son monotono (mismo color elegido en la cotización). |

---

## 20. Glosario

| Término | Significado |
|---------|-------------|
| Tablero | Panel (melamina, MDF, etc.) medido en mm; costo por m² |
| Canto / cintilla / cubrecanto | Cinta de borde; costo por metro lineal (ML) |
| Veta | Orientación de grano; 0/1 en export |
| Explosión / despiece | Lista de piezas y herrajes que componen un módulo |
| Módulo / mueble plantilla | Definición reutilizable (gabinete, cajonera…); **no** se recrea por cotización |
| Grupo de opciones | Conjunto de alternativas elegibles en cotización (Interiores, Frentes, Bisagras…) |
| Rol / optionRole | Etiqueta en una pieza o herraje que la une a un grupo (ej. pieza → INTERIOR) |
| Resolución | Asignar material/herraje concreto a cada línea del BOM según opciones elegidas |
| Proyecto / cotización | Muebles elegidos + opciones + cantidades para un cliente |
| Optimizer | Proceso/archivo de nesting/corte externo |
| Herraje | Bisagras, correderas, jaladeras, tornillos, etc. |
| BOM | Bill of Materials — lista de materiales |
| Snapshot | Precios congelados al cerrar una cotización |

---

## 21. Anexos

### 21.1 Mapa Excel → producto

| Concepto Excel | Producto |
|----------------|----------|
| Configuración Costos / Tableros | Catálogo `MaterialBoard` |
| Configuración Costos / Cintillas | Catálogo `EdgeBand` |
| Configuración Costos / Herrajes | Catálogo `Hardware` |
| Explosión (filas pieza) | `BoardPart` |
| Explosión (filas HERRAJE) | `HardwareLine` |
| Header de módulo mergeado | `Module` |
| Resumen y Cotización | `Project` + `QuoteBreakdown` |
| Plantilla_Optimizer | Export `ProductionCutRow[]` |

### 21.2 Ejemplo de línea de despiece (gabinete)

| Campo | Valor ejemplo |
|-------|----------------|
| Descripción | Costado Derecho |
| Cantidad | 1 |
| Largo | 720 |
| Ancho | 590 |
| Material | ARAUCO BLANCO |
| Veta | 0 |
| Cantos | 1/1/1/1 |
| ID | MOD-GAB-01-P01 |

### 21.3 Historia de este documento

| Versión | Fecha | Cambio |
|---------|-------|--------|
| 1.0 | 2026-07-15 | PRD inicial a partir de plantillas y objetivos de app web+Electron |
| 1.1 | 2026-07-15 | Catálogo reutilizable + grupos de opciones (interiores/frentes/bisagras/correderas); cotización = mueble + choices, no redespiece |

---

## 22. Próximo paso recomendado

1. **Revisar y aprobar** este PRD (marcar defaults de §19 que no gusten).
2. **Adaptar el harness** del repo (AGENTS, feature_list, architecture) al producto Muebles — archivar Notes CLI.
3. Escribir **design técnico** (schema de persistencia, monorepo, librería Excel, plan de features ordenadas).
4. Implementar **Fase 1** empezando por `domain` + golden tests (valor máximo, riesgo mínimo).

Este orden evita construir la app equivocada con el arnés del demo, y evita discutir Electron antes de tener el contrato de cálculo y export cerrado.
