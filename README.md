# Muebles — Sistema de cotización y producción

Aplicación de escritorio (Electron) y web (React) para talleres de carpintería:
gestión de catálogos de materiales, definición de módulos reutilizables,
cotización con grupos de opciones y export directo al optimizador de corte.

> Ver `docs/prd.md` para el detalle completo del producto.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Lenguaje | TypeScript 5.x, strict |
| Monorepo | pnpm workspaces |
| Web | React + Vite (`apps/web`) |
| Desktop | Electron (`apps/desktop`) |
| Dominio | puro TS, sin dependencias UI (`packages/domain`) |
| Export | SheetJS / ExcelJS (`packages/excel`) |
| Storage | JSON local atómico (`packages/storage`) |
| Tests | Vitest |
| Backend | Go 1.25 + Postgres (`backend-go/`) — Etapa 2 |

---

## Backend Go (Etapa 2)

Servicio HTTP en `backend-go/` con Postgres para multi-usuario y paridad de
cálculo. La lógica de dominio se está migrando a Go (`internal/domain`).

### Variables de entorno (obligatorias en producción)

Ver `.env.example` para la lista completa. Para desarrollo local:

```bash
cp .env.example .env.local
# edita .env.local: JWT_SECRET="$(openssl rand -base64 48)"
cd backend-go && ./dev.sh     # sourcea ../.env.local y arranca el server
```

`dev.sh` carga `.env.local` (raíz del repo) y soporta subcomandos:
`serve` (default) | `build` | `admin reset-password --email …` | `test`.
Vite (frontend) carga `.env.local` solo al hacer `pnpm dev`, exponiendo
`VITE_API_BASE` a `session.ts`.

Destacados:

| Variable | Requerida | Notas |
|----------|-----------|-------|
| `JWT_SECRET` | **Sí** | ≥ 32 bytes. El server **se niega a arrancar** si falta o es muy corto. Generar con `openssl rand -base64 48`. |
| `DATABASE_URL` | Recomendada | Default apunta al Postgres local de docker-compose (:5445). |
| `CORS_ALLOWED_ORIGINS` | Recomendada | Allowlist separada por comas. Default: origins de dev de Vite. **Nunca `*` en prod.** |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | Opcional | Limita `/api/auth/login` y `/register` por IP. |
| `VITE_API_BASE` | Opcional | Sobreescribe el API base del frontend (default `http://localhost:8080/api`). |

### Cuenta admin

El backend **ya no crea el admin al arrancar** (el seed con credencial hardcodeada
fue removido). Provisioná o rotá la cuenta con el CLI dedicado:

```bash
cd backend-go
./dev.sh admin create         --email admin@mitaller.com
./dev.sh admin reset-password --email admin@mitaller.com
```

La contraseña se pide interactivamente (sin eco); en CI usa `ADMIN_PASSWORD`.

---

## Cómo arrancar

```bash
./init.sh
```

Si el monorepo aún no existe (Fase 0), el script corre en **modo bootstrap**:
verifica el harness y avisa que falta el scaffold. La primera feature
pendiente en `feature_list.json` es exactamente eso.

Cuando el monorepo esté scaffolded:

```bash
pnpm install
pnpm --filter @muebles/domain test   # tests del motor
pnpm test                             # todos los paquetes
pnpm --filter @muebles/web dev        # UI en localhost:5173
```

### Desktop Electron (dev)

Misma UI que web; el host solo aporta ventana + diálogo nativo de guardar (EXP-06).

```bash
# Terminal 1
pnpm --filter @muebles/web dev

# Terminal 2 (espera a Vite y abre Electron)
pnpm --filter @muebles/desktop dev:app
```

Detalle y smoke: `docs/verification.md` § Nivel 6.

---

## Estructura del repositorio

```
.
├── AGENTS.md                   # Punto de entrada para agentes (mapa corto)
├── CHECKPOINTS.md              # Criterios de "estado final correcto"
├── feature_list.json           # Alcance: una feature a la vez
├── init.sh                     # Verificación e inicialización del entorno
│
├── docs/
│   ├── prd.md                  # Producto: qué, por qué, fórmulas, requisitos
│   ├── architecture.md         # Cómo está estructurado el código
│   ├── conventions.md          # Estilo, nombres, tests, errores
│   └── verification.md         # Cómo demostrar que funciona
│
├── .agents/
│   └── skills/
│       ├── leader/SKILL.md     # Orquestador: descompone y coordina
│       ├── implementer/SKILL.md # Trabajador: implementa una feature
│       └── reviewer/SKILL.md   # Revisor: aprueba o rechaza
│
├── progress/
│   ├── current.md              # Sesión activa (estado vivo)
│   └── history.md              # Bitácora append-only de sesiones
│
├── Plantilla_Muebles.xlsx      # Fuente de dominio (fórmulas, datos de referencia)
├── Plantilla_Optimizer.xlsx    # Contrato de salida (formato de export de corte)
│
├── packages/                   # (se crea en F001)
│   ├── domain/                 # Motor: tipos, resolución BOM, costos, validaciones
│   ├── ui/                     # Componentes React compartidos
│   ├── excel/                  # Writer del Optimizer.xlsx
│   └── storage/                # Persistencia JSON local
│
├── apps/                       # (se crea en F001)
│   ├── web/                    # Shell React + Vite
│   └── desktop/                # Shell Electron
│
└── archive/
    └── notes-demo/             # Harness original (Python, referencia)
```

---

## Harness de agentes

Este repo implementa el patrón **Líder-Implementador-Revisor**:

| Pilar | Manifestación |
|-------|--------------|
| **El repositorio ES el sistema** | `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/`, `docs/` |
| **Orquestación multi-agente** | `.agents/skills/` (platform-agnostic SKILL.md) |
| **Supervisión y mejora** | `CHECKPOINTS.md`, `./init.sh` que corre tests reales |

Principios clave:
- **Divulgación progresiva:** `AGENTS.md` es un mapa, no un manual. Los detalles viven en `docs/`.
- **Una feature a la vez:** `init.sh` rechaza más de un `in_progress`.
- **Estado en disco:** `progress/current.md` y `history.md` sobreviven reinicios.
- **Verificación ejecutable:** `init.sh` corre los tests reales.
- **Anti teléfono-descompuesto:** subagentes escriben resultados en archivos, solo devuelven una referencia.
