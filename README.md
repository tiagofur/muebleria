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
pnpm --filter apps/web dev            # UI en localhost
```

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
