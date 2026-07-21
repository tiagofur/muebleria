# Mapa de producto — qué es este proyecto (para agentes)

> **Leé este archivo ANTES de tocar código, inventar pantallas o planificar features.**  
> Resume la verdad del producto en una página. El detalle vive en `PRD.md`.

---

## 1. En una frase

**Muebles** unifica catálogos técnicos, cotización comercial y preparación de
fabricación (despiece + nesting + export) para talleres de carpintería.
La visión a largo plazo incluye un diseñador paramétrico 3D en 4 modos;
**eso NO es lo que se está construyendo hoy de punta a punta**.

---

## 2. Dos ejes que NO son lo mismo

Los agentes se confunden cuando mezclan **navegación de la app** con **flujo de
diseño dentro de un proyecto**. Son ortogonales.

### Eje A — Módulos de la aplicación (shell / menú lateral)

Es la estructura **actual** de `apps/web` y la del taller del día a día:

| Módulo UI (hoy) | Alias en ideas | Propósito | Usuario principal |
|-----------------|----------------|-----------|-------------------|
| **Ingeniería** | Catálogos / Biblioteca | Tableros, cintillas, herrajes, (futuro) estructuras y plantillas | Admin / diseñador técnico |
| **Presupuestos** | Gestión comercial | Clientes, proyectos, cotizaciones, precios, PDF comercial | Vendedor / diseñador |
| **Producción** | Producción / Taller | Despiece, BOM, nesting, export CSV/PDF/DXF de corte | Taller |
| *(futuro)* **Diseño** | Diseño (4 modos) | Entrar a un proyecto y trabajar en planimetría/3D/presentación | Diseñador frente al cliente |

```
Sidebar (siempre visible)
├── Ingeniería     → catálogos (no es “modo 1 del CAD”)
├── Presupuestos   → clientes / proyectos / cotizaciones
├── Producción     → BOM + nesting + export (puede vivir sin 3D)
└── [Diseño]       → solo cuando se abre un proyecto (futuro)
```

### Eje B — Los 4 modos de diseño (dentro de un proyecto)

Definidos en el **PRD**. Son el flujo CAD/CAM cuando el usuario está **dentro
de un proyecto de diseño**, no pestañas del menú principal:

```
Proyecto abierto
  1. HABITACIÓN   → muros, puertas, ventanas, tomas
  2. DISEÑO       → catálogo de módulos + paramétrico (+ 3D a futuro)
  3. PRESENTACIÓN → estilos, presupuesto en vivo, vista cliente
  4. PRODUCCIÓN   → BOM, nesting, PDF/DXF (misma lógica que el módulo Taller)
```

**Regla de oro para agentes:**

- Si la tarea es catálogo, cliente, cotización o CRUD → es **Eje A**.
- Si la tarea es dibujar muros, snappoints 3D, gizmos, walkthrough → es **Eje B**.
- El **motor de despiece/BOM/nesting** se reutiliza en Eje A (Producción) y en
  Eje B (Modo 4). Vive en `packages/domain` + `packages/excel`.

---

## 3. Qué está construido HOY (verdad del repo)

| Capa | Estado | Dónde |
|------|--------|--------|
| Dominio paramétrico (gabinetes base/alto/torre/cajones) | ✅ | `packages/domain` |
| BOM + lista de corte | ✅ | `packages/domain` |
| Nesting guillotine + export CSV | ✅ | `packages/excel` |
| Storage JSON (puertos + adapters) | ✅ | `packages/storage` |
| Shell web 3 módulos (Ingeniería / Presupuestos / Producción) | ✅ | `apps/web` |
| CRUD tableros, cintillas, herrajes | ✅ | Ingeniería |
| CRUD clientes y proyectos | ✅ | Presupuestos |
| Motor de precios | ✅ | `packages/domain` pricing |
| PDF cotización comercial | ⏳ F020 | pendiente |
| Habitación 2D (Modo 1) | ❌ | no empezado |
| Viewport 3D / Babylon | ❌ | no empezado |
| DXF CNC por capas | ❌ | no empezado |
| Electron desktop | ❌ | no empezado |
| Backend Go multiusuario | ❌ | no empezado |

Fuente de verdad del progreso por feature: **`feature_list.json`**.

---

## 4. Flujo de negocio (cómo lo usa el taller)

Orden real de valor, aunque la UI permita entrar por cualquier módulo:

```
1. Ingeniería     Cargar catálogo (tableros, tapacantos, herrajes)
2. Presupuestos   Crear cliente → proyecto → armar módulos → cotizar
3. Producción     A partir del proyecto aprobado: despiece → nesting → export
```

El **Diseño 4 modos** (visión) se inserta entre 2 y 3 cuando exista:

```
Cliente → Proyecto → [Habitación → Diseño → Presentación] → Producción
```

Hasta entonces, el “diseño” es **paramétrico por formulario** (W/H/D/T/B/g +
tipo de módulo), no un canvas CAD.

---

## 5. Qué documento leer según la tarea

| Si vas a… | Leé primero | Luego |
|-----------|-------------|--------|
| Entender el producto | **este archivo** | `PRD.md` §1–2 |
| Planificar features | `docs/roadmap.md` | `feature_list.json` |
| Tocar fórmulas / BOM / nesting | `PRD.md` §3 y §5 | `packages/domain`, `packages/excel` |
| Tocar UI | `docs/design.md` | `docs/PRODUCT.md` |
| Crear archivos / paquetes | `docs/architecture.md` | `docs/conventions.md` |
| Cerrar sesión / git | `docs/git-workflow.md` | `docs/verification.md` |
| Ideas aspiracionales | `docs/ideas.md` (inspiración) | **no** como spec de implementación |

---

## 6. Anti-patrones de agentes (errores frecuentes)

1. **Tratar el PRD §2 (4 modos) como si fuera el menú lateral actual.**  
   Hoy el menú es Ingeniería / Presupuestos / Producción.

2. **Asumir Next.js / App Router** porque aparece en un boceto de ideas.  
   Stack real: **pnpm monorepo + Vite + React** en `apps/web`.

3. **Meter lógica de despiece en React.**  
   Solo en `packages/domain` (y export en `packages/excel`).

4. **Empezar Babylon/3D antes de cerrar el pipeline comercial-taller.**  
   Ver `docs/roadmap.md`: el 3D es horizonte posterior, no bloqueante del valor actual.

5. **Usar `docs/ideas.md` como checklist de implementación.**  
   Es brainstorming de pantallas y stack aspiracional. La spec es el PRD + este mapa + `feature_list.json`.

6. **Crear un cuarto módulo “Modo 1 Habitación” en el sidebar sin proyecto.**  
   Habitación es un **modo dentro del proyecto**, no un item hermano de Clientes.

7. **Inventar stack o carpetas** (`/src/app`, Supabase, shadcn “porque ideas.md”).  
   Seguí `docs/architecture.md` y el monorepo existente.

---

## 7. Modelo mental del código

```
Usuario (taller)
    │
    ▼
apps/web  ── state routing ──► Ingeniería | Presupuestos | Producción
    │
    ├── packages/ui          (componentes; NO calcula dominio)
    ├── packages/domain      (tipos, fórmulas, BOM, kitchen, pricing)
    ├── packages/excel       (nesting, CSV optimizer, PDF futuro)
    └── packages/storage     (puertos + JSON local)
```

**Dependencias solo hacia adentro:** apps → packages → domain. Domain no importa UI.

---

## 8. Vocabulario canónico

| Término | Significa | No confundir con |
|---------|-----------|------------------|
| **Módulo de app** | Sección del shell (Ingeniería…) | Módulo de cocina |
| **Módulo de cocina** | Gabinete paramétrico (base, alto, torre…) | Item del sidebar |
| **Modo (1–4)** | Paso del flujo CAD dentro de un proyecto | Módulo de app |
| **Proyecto** | Trabajo de un cliente (módulos + estado) | Paquete npm |
| **Despiece** | Lista de piezas de corte calculadas | Nesting |
| **BOM** | Bill of materials consolidado | Un solo panel |
| **Nesting** | Acomodo 2D de piezas en tableros | Despiece |
| **Catálogo** | Biblioteca reutilizable (materiales…) | Módulos de un proyecto |

---

## Checklist rápido antes de implementar

- [ ] ¿Esto es Eje A (shell) o Eje B (modos de diseño)?
- [ ] ¿Existe feature en `feature_list.json` o es scope inventado?
- [ ] ¿La lógica va a `packages/domain` o se me fue a un `.tsx`?
- [ ] ¿Estoy leyendo `ideas.md` como inspiración o como orden de trabajo?
- [ ] ¿El horizonte de `docs/roadmap.md` permite esta feature ahora?

---

## Siguiente paso

1. Estado de features → `feature_list.json`  
2. Orden de fases → `docs/roadmap.md`  
3. Dominio y UX visionarios → `PRD.md`
