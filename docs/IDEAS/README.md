# Muebles CAD/CAM

Sistema de **catálogos, cotización y producción** para talleres de carpintería,
con motor paramétrico de despiece (BOM + nesting) y visión de diseñador 3D.

**Hoy**: app web (Vite + React) con tres módulos de taller — Ingeniería,
Presupuestos y Producción.  
**Visión**: flujo CAD de 4 modos (Habitación → Diseño → Presentación →
Producción) + export CAM/CNC. Ver [`docs/product-map.md`](docs/product-map.md).

---

## Documentación para agentes (orden de lectura)

1. [`docs/product-map.md`](docs/product-map.md) — mapa mental (obligatorio)
2. [`docs/roadmap.md`](docs/roadmap.md) — horizontes A–D
3. [`PRD.md`](PRD.md) — visión, fórmulas, datos
4. [`docs/architecture.md`](docs/architecture.md) — paquetes y boundaries
5. `feature_list.json` — backlog

---

## Stack

| Capa | Tecnología | Ubicación | Estado |
|------|-----------|-----------|--------|
| Dominio / Lógica | TypeScript puro | `packages/domain` | Activo |
| UI compartida | React | `packages/ui` | Parcial |
| Shell web | **Vite + React** | `apps/web` | Activo |
| Shell desktop | Electron | `apps/desktop` | Futuro |
| Export / nesting | TypeScript | `packages/excel` | Activo |
| Persistencia | TypeScript (JSON) | `packages/storage` | Activo |
| Backend | Go + Postgres | `backend-go` | Futuro |

## Requisitos

- **Node.js** >= 20
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Go** >= 1.22 (solo para backend-go)
- **Docker** (solo para Postgres local)

## Inicio rápido

```bash
# Instalar dependencias
pnpm install

# Construir todos los paquetes
pnpm build

# Iniciar dev server web
cd apps/web && pnpm dev

# Iniciar backend Go (requiere .env.local)
cd backend-go && ./dev.sh
```

## Comandos principales

```bash
pnpm test         # Tests en todos los workspaces
pnpm typecheck    # Type-checking en todo el monorepo
pnpm build        # Build completo
pnpm lint         # Linting
```

## Arquitectura

Ver [`docs/architecture.md`](docs/architecture.md) para la estructura de paquetes, boundaries y flujo de datos.  
Ver [`PRD.md`](PRD.md) para el dominio completo del producto.  
Ver [`docs/conventions.md`](docs/conventions.md) para estándares de código.  
Ver [`docs/design.md`](docs/design.md) para el sistema de diseño UI/UX.
