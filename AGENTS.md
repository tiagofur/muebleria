# AGENTS.md — Mapa de navegación

> Este archivo es el **punto de entrada** para cualquier agente que trabaje
> en este repositorio. Es un **mapa**, no un manual. Lee solo lo que necesites
> cuando lo necesites. El detalle vive en `docs/`.

---

## 0. Proyecto en una mirada

**Muebles** es un sistema de cotización y producción para talleres de
carpintería: catálogos (materiales, cantos, herrajes), módulos reutilizables,
cotizaciones con grupos de opciones, y export al optimizador de corte
(`Plantilla_Optimizer.xlsx`).

| Capa | Dónde | Notas |
|------|--------|--------|
| Dominio puro TS | `packages/domain` | Fórmulas, BOM, validaciones — sin React/fs |
| UI compartida | `packages/ui` | React; **no calcula** dominio |
| Excel / storage | `packages/excel`, `packages/storage` | Export Optimizer; repos JSON |
| Shells | `apps/web`, `apps/desktop` | Vite+React; Electron (delgado) |
| Backend Etapa 2 | `backend-go/` | Go + Postgres; API HTTP |

**Producto y requisitos** → `docs/prd.md` (dominio completo).  
**Contexto UI Impeccable** → `docs/PRODUCT.md` (register `product`; no copiar marca ajena).  
**UI/UX tokens y patrones** → `docs/design.md` (el loader de Impeccable lo usa como DESIGN).

---

## 1. Antes de empezar (siempre)

```bash
./init.sh
```

Si falla → **para**. Resuelve el entorno antes de tocar código.

Luego:
1. Lee `progress/current.md` — ¿hay una sesión activa?
2. Lee `feature_list.json` — toma la tarea `pending` de menor id.

### Comandos del día a día

| Acción | Comando |
|--------|---------|
| Gate local / bootstrap | `./init.sh` |
| Tests (todos los workspaces) | `pnpm test` |
| Typecheck monorepo | `pnpm typecheck` |
| Build monorepo | `pnpm build` |
| Tests de un paquete | `pnpm --filter @muebles/<pkg> test` |
| Backend Go (dev) | `cd backend-go && ./dev.sh` (carga `../.env.local`) |
| Postgres local | `docker compose up -d` (puerto **5445**) |

Detalle de niveles de verificación → `docs/verification.md`.

---

## 2. Mapa del repositorio

| Recurso | Qué contiene | Cuándo leerlo |
|---------|-------------|---------------|
| `feature_list.json` | Tareas con estado (pending / in_progress / done / blocked) | Al empezar |
| `progress/current.md` | Estado de la sesión activa | Al empezar |
| `progress/history.md` | Bitácora de sesiones anteriores | Si necesitas contexto histórico |
| `docs/prd.md` | Producto, usuarios del taller, dominio, fórmulas, anti-scope | Antes de dominio o producto |
| `docs/PRODUCT.md` | Contexto Impeccable (register, personality, anti-refs) | Setup del skill UI; no reemplaza el PRD |
| `docs/architecture.md` | Paquetes, boundaries, flujo de datos | Antes de crear archivos |
| `docs/conventions.md` | Estilo, nombres, tests, errores, tipos | Antes de escribir código |
| `docs/design.md` | **Sistema de diseño UI/UX**: tokens CSS, tipografía, colores HSL, iconos (Lucide), patrones (modal, sidebar, toast, lista→detalle) | **OBLIGATORIO** antes de tocar UI (también es el DESIGN de Impeccable) |
| `.agents/skills/impeccable/` | Skill de craft UI (audit, polish, critique, live, …) | Solo trabajo frontend / UX |
| `.impeccable/live/config.json` | Live mode: shell Vite `apps/web/index.html` | Antes de `$impeccable live` |
| `docs/technical_design.md` | Decisiones técnicas de implementación | Cuando el diseño de solución no está claro |
| `docs/verification.md` | Cómo demostrar que funciona | Antes de declarar `done` |
| `CHECKPOINTS.md` | Criterios del revisor | Para auto-evaluarte |
| `.agents/skills/` | Cómo actuar según tu rol (leader / implementer / reviewer) | Lee tu rol |
| `README.md` | Stack, env vars, arranque backend | Setup / ops |
| `Plantilla_Muebles.xlsx` | Fuente de dominio: fórmulas, datos de referencia | Golden test |
| `Plantilla_Optimizer.xlsx` | Contrato de salida del export | Tests de fixture |

### Layout del monorepo (fuente de trabajo)

```
muebles/
├── apps/web/          # shell React + Vite
├── apps/desktop/      # shell Electron
├── packages/domain/   # lógica de negocio pura
├── packages/ui/       # componentes React compartidos
├── packages/excel/    # export Optimizer
├── packages/storage/  # persistencia (puertos + JSON local)
├── backend-go/        # API Go + Postgres (Etapa 2)
├── docs/              # prd, architecture, conventions, design, verification
├── progress/          # sesión activa + reviews
├── feature_list.json  # backlog con estados
└── init.sh            # gate de entorno + tests
```

---

## 3. Reglas duras

- **Una sola feature a la vez.** `init.sh` rechaza más de un `in_progress`.
- **No `done` sin tests verdes.** Ejecuta `./init.sh` o `pnpm test` (y `pnpm typecheck` si tocaste tipos) antes de cerrar.
- **Tests van con la feature.** No dejes “tests después” ni PRs solo de tests para comportamiento nuevo.
- **Documenta en `progress/current.md`** mientras trabajas, no al final.
- **Si no sabes algo**, busca en `docs/` antes de inventarlo.
- **Deja el repo limpio** al cerrar (ver `docs/verification.md §Verificación final`).
- **Antes de tocar UI/UX** (componentes `.tsx`, archivos `.css`, layouts, estilos inline), lee `docs/design.md` completo. No inventes colores, espaciados, sombras ni patrones de interacción — todos están definidos ahí.
- **UI no calcula dominio.** Fórmulas y validaciones de negocio viven en `packages/domain` (o backend Go cuando aplique), no en React.
- **pnpm only** en el monorepo JS. No npm/yarn.
- **Nunca commits de `.env` / `.env.local`.** Solo `.env.example`.
- **Código e identificadores en inglés; copy de UI en español** (salvo que el archivo ya use otro idioma de forma consistente).
- **No copies sistemas de diseño ajenos al root** (`PRODUCT.md` / `DESIGN.md` de Impeccable u otros). El producto del taller es `docs/prd.md`; la UI del taller es `docs/design.md`.
- **Nunca ejecutes SQL destructivo** (`DROP SCHEMA`, `DROP DATABASE`, `TRUNCATE`, `DELETE` sin `WHERE`) sobre Postgres, ni siquiera "para resetear y aplicar migraciones". Eso borra datos reales del usuario de forma irreversible. Las migraciones nuevas son aditivas (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) y se aplican al arrancar el server sin tocar datos existentes. Si un reset es estrictamente necesario, **para y pedí confirmación explícita al usuario primero**, y ofrecé hacer un `pg_dump` de respaldo antes.

### Calidad al cerrar (mínimo)

1. `pnpm test` (o `./init.sh`) verde  
2. Si cambió TS: `pnpm typecheck` verde  
3. Si cambió Go: tests/`go test` del paquete tocado + server arranca con env válido  
4. Evidencia en `progress/` según el skill del rol  

---

## 4. Tu rol en esta sesión

Lee el skill de tu rol antes de hacer cualquier otra cosa:

| Rol | Archivo | Cuándo |
|-----|---------|--------|
| Orquestador / líder | `.agents/skills/leader/SKILL.md` | Eres el agente principal coordinando trabajo |
| Implementador | `.agents/skills/implementer/SKILL.md` | Te pidieron implementar una feature concreta |
| Revisor | `.agents/skills/reviewer/SKILL.md` | Te pidieron revisar trabajo del implementador |
| UI craft (Impeccable) | `.agents/skills/impeccable/SKILL.md` | Rediseño, audit, polish, critique, live de frontend |

Si no te indicaron un rol, actúa como **implementador**.

### Impeccable (solo UI)

1. Arranque de sesión UI: `node .agents/skills/impeccable/scripts/context.mjs`  
   Debe imprimir `docs/PRODUCT.md` + `docs/design.md`. Si dice `NO_PRODUCT_MD`, no inventes marca: arreglá el contexto.
2. Register por defecto: **product** (app de taller, no landing).
3. **No** regeneres paleta con `palette.mjs` mientras existan tokens en `docs/design.md` / CSS del repo.
4. **No** toques dominio, export Optimizer ni `backend-go` con este skill.
5. Live: config en `.impeccable/live/config.json` → shell `apps/web/index.html`. Dev server Vite en `apps/web`.

---

## 5. Cómo evoluciona este mapa

Si encontrás una contradicción entre este archivo y el código, una regla
insuficiente, o un workaround repetido:

1. Preferí corregir la **fuente de verdad** (`docs/*`, skills, scripts).
2. Actualizá este mapa solo si el cambio es de **navegación** (dónde mirar, qué es obligatorio).
3. No conviertas este archivo en un manual largo: el costo de leerlo en cada sesión debe seguir bajo.
