# Arquitectura del Sistema — Muebles CAD/CAM

> **Propósito**: Estructura de paquetes, límites entre capas y flujo de datos.  
> **Producto / flujo de usuario**: primero [`docs/product-map.md`](product-map.md).  
> **Orden de features**: [`docs/roadmap.md`](roadmap.md).

---

## 1. Estado actual (no inventes carpetas)

| Pieza | Estado |
|-------|--------|
| `packages/domain` | ✅ Fórmulas, BOM, kitchen, pricing, tipos |
| `packages/excel` | ✅ Nesting guillotine, CSV optimizer |
| `packages/storage` | ✅ Puertos + JSON adapters |
| `packages/ui` | ⚠️ Scaffold / uso limitado (UI vive mucho en `apps/web`) |
| `apps/web` | ✅ Shell Vite+React con 3 módulos |
| `apps/desktop` | ❌ No implementado |
| `backend-go` | ❌ No implementado |
| Viewport 3D / Babylon | ❌ Horizonte D |

---

## 2. Filosofía

Arquitectura **hexagonal / puertos-y-adaptadores** en monorepo pnpm.

**Regla cardinal**: el dominio no importa UI ni infraestructura. Las
dependencias apuntan **hacia adentro**.

```
  apps/web  ────┐
  apps/desktop ─┤
                 ├── packages/ui ──► packages/domain
  backend-go ───┤
                 └── packages/storage ──► packages/domain
                      packages/excel ──► packages/domain
```

---

## 3. Paquetes

| Paquete | Ruta | Responsabilidad | Dependencias |
|---------|------|-----------------|--------------|
| `@muebles/domain` | `packages/domain` | Tipos, fórmulas de despiece, BOM, kitchen, pricing, commands (tipos) | *Ninguna* |
| `@muebles/ui` | `packages/ui` | Componentes React compartidos | domain, React |
| `@muebles/excel` | `packages/excel` | Nesting 2D, export CSV/optimizer, (futuro PDF producción) | domain |
| `@muebles/storage` | `packages/storage` | Puertos de repositorio + adapters JSON | domain |

### 3.1 Shells

| App | Ruta | Tech | Rol |
|-----|------|------|-----|
| Web | `apps/web` | **Vite + React** | Shell principal (hoy) |
| Desktop | `apps/desktop` | Electron | Empaquetado (futuro) |
| Backend | `backend-go` | Go + Postgres | Multiusuario (futuro) |

**No es Next.js.** Bocetos en `docs/ideas.md` con App Router son aspiracionales
y **no** definen el monorepo.

### 3.2 Módulos de UI en `apps/web` (Eje A)

```
apps/web/src/
├── App.tsx                 # state routing: ingenieria | presupuestos | produccion
├── components/             # Sidebar, AppLayout, Modal…
├── design-system/          # tokens.css
└── modules/
    ├── ingenieria/         # Catálogos: tableros, cintillas, herrajes
    ├── presupuestos/       # Clientes, proyectos, cotización
    └── produccion/         # Despiece, nesting, export
```

Los **4 modos del PRD** (Habitación → Diseño → Presentación → Producción) se
implementarán **dentro del flujo de un proyecto**, no como reemplazo de este
sidebar. Ver product-map.

---

## 4. Boundaries

### 4.1 Imports

```
packages/domain  →  (sin infra/UI)
packages/ui      →  @muebles/domain, React  ✓
packages/ui      →  fs, fetch, localStorage  ✗
packages/storage →  @muebles/domain, JSON/fs  ✓
packages/excel   →  @muebles/domain  ✓
apps/*           →  todos los paquetes  ✓
backend-go       →  no importa TS; consume API cuando exista
```

### 4.2 La UI no calcula dominio

```typescript
// ✅
import { calculateBaseCabinet, generateBOM } from '@muebles/domain';

// ❌
const width = module.w - 2 * 18;
```

---

## 5. Flujo de datos (hoy)

```
Usuario
  │
  ▼
apps/web (React, state local / localStorage)
  │
  ├──► packages/domain   (cálculo síncrono en main thread)
  ├──► packages/excel    (nesting + CSV)
  └──► packages/storage  (cuando se usen repos; parte UI aún usa localStorage directo)
```

### 5.1 Flujo objetivo (Horizon C/D)

```
Usuario → apps/web → Zustand project store
                        │
                        ├── domain (despiece, validaciones, pricing)
                        ├── storage (persistencia)
                        ├── excel / workers (nesting pesado)
                        └── Viewport3DManager (syncScene, no React por mesh)
```

### 5.2 Viewport 3D (futuro)

Clase TS pura (`Viewport3DManager`), sincronizada por suscripción al store,
**no** un árbol de meshes en JSX por cada pieza. Ver PRD §4.2.

### 5.3 Nesting

Hoy corre en el hilo principal. Objetivo: Web Worker cuando el volumen o el 3D
lo exijan (PRD §5.1).

---

## 6. Organización del monorepo

```
muebles/
├── apps/
│   ├── web/                 # Vite + React (activo)
│   └── desktop/             # Electron (futuro)
├── packages/
│   ├── domain/src/
│   │   ├── types.ts
│   │   ├── formulas.ts
│   │   ├── kitchen.ts
│   │   ├── pricing.ts
│   │   └── index.ts
│   ├── ui/
│   ├── excel/
│   └── storage/
├── docs/
│   ├── product-map.md       # mapa de producto para agentes
│   ├── roadmap.md
│   ├── architecture.md      # este archivo
│   └── …
├── feature_list.json
├── progress/
├── init.sh
└── PRD.md
```

---

## 7. Decisiones técnicas clave

| Decisión | Elegida | Alternativa | Razón |
|----------|---------|-------------|-------|
| Shell web | Vite + React | Next.js App Router | Simplicidad monorepo, sin SSR de taller |
| Estado hoy | React state + localStorage | — | MVP shell; Zustand cuando el proyecto unificado lo pida |
| Estado objetivo | Zustand + Command undo/redo | Redux | PRD §4.3 |
| Motor 3D (futuro) | Babylon o Three imperativo | R3F para todo el CAD | Control de frame y diff de meshes |
| Nesting | Guillotine Best-Fit en `packages/excel` | Solo export a OptiCut | Valor offline inmediato |
| Persistencia | JSON / localStorage → ports storage | SQLite WASM | Migración limpia a backend-go |
| Estilos | CSS tokens (`docs/design.md`) | Copiar design systems ajenos | Producto de taller propio |
| Monorepo | pnpm workspaces | Nx/Turborepo | Suficiente al tamaño actual |
| Linter | Biome | ESLint+Prettier | Un solo toolchain |

Decisiones nuevas no obvias → registrar en `docs/technical_design.md`.
