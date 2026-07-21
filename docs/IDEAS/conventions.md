# Convenciones de Desarrollo — Muebles CAD/CAM

> **Última actualización**: 2026-07-20  
> **Mapa de producto**: [`docs/product-map.md`](product-map.md) · **Roadmap**: [`docs/roadmap.md`](roadmap.md)

Este documento define los estándares técnicos y de estilo. El monorepo ya
incluye `domain`, `excel`, `storage` y `apps/web` activos; no asumir “solo
types.ts”. Estado por feature: `feature_list.json`.

---

## 1. Estilo de Código y Nomenclatura

### 1.1 Variables y Funciones

- **Naming**: Usar `camelCase` para variables y funciones.
- **Claridad sobre brevedad**: Evitar abreviaciones excesivas
  (ej. `calculateSpellingList` en lugar de `calcSpl`).
- **Booleanos**: Deben empezar con prefijos como `is`, `has`, o `can`
  (ej. `hasGrain`, `isVisible`, `canExport`).

### 1.2 Tipado (TypeScript)

- Declarar tipos explícitos para todas las funciones, especialmente en
  `packages/domain`.
- Evitar `any`. Usar `unknown` cuando sea necesario y validar con type guards.
- Las interfaces del dominio deben ser explícitas
  (ej. `Dimension`, `Panel`, `Module`, `Room`).
- Preferir `interface` para objetos del dominio (son contractos).
- Usar `type` para uniones, tuplas y utilidades.

### 1.3 Nombres de archivos

- **kebab-case** para archivos: `part-dimension-calculator.ts`.
- **PascalCase** para componentes React: `ModuleCatalog.tsx`.
- Los tests van junto al archivo que prueban: `formulas.test.ts`.

## 2. Estructura del Monorepo

```
muebles/
├── apps/
│   ├── web/              # Vite + React shell
│   └── desktop/          # Electron shell
├── packages/
│   ├── domain/           # Lógica pura, constantes, tipos, fórmulas
│   ├── ui/               # Componentes React compartidos
│   ├── excel/            # Export optimizador (Plantilla_Optimizer.xlsx)
│   └── storage/          # Persistencia JSON local
├── backend-go/           # API Go + Postgres (Etapa 2)
├── docs/                 # Documentación técnica y de producto
├── progress/             # Seguimiento de sesiones y revisiones
└── feature_list.json     # Backlog con estados
```

### 2.1 Límites entre paquetes

```
packages/domain  →  (ninguna dependencia externa)
packages/ui      →  @muebles/domain  ✓
packages/storage →  @muebles/domain  ✓
packages/excel   →  @muebles/domain  ✓
packages/ui      →  React, Tailwind   ✓
apps/*           →  todos los paquetes ✓
```

Ver `docs/architecture.md` para detalle completo.

## 3. Geometría Paramétrica (Sistema W, H, D, T)

Para todas las funciones que manipulen dimensiones:

| Símbolo | Significado | Unidad típica |
|---------|-------------|---------------|
| **W** | Ancho (Width) | mm |
| **H** | Alto (Height) | mm |
| **D** | Profundidad (Depth) | mm |
| **T** | Espesor (Thickness) | mm |
| **B** | Zócalo (Base/Toe-kick) | mm |
| **g** | Holgura (Gap/Clearance) | mm |
| **k** | Kerf / espesor de disco | mm |

## 4. Gestión de Colores y Estilos

- Usar **exclusivamente** los tokens definidos en `docs/design.md`.
- Evitar valores hardcodeados de colores o espaciados en componentes.
- Los estilos se manejan con Tailwind CSS utility classes.
- Para estilos que no cubre Tailwind, usar CSS modules en `*.module.css`.

## 5. Pruebas Unitarias

### 5.1 Regla del éxito

Cualquier cambio en las fórmulas del motor de despiece (`packages/domain`)
**debe** estar acompañado por una prueba unitaria antes de ser considerado
"finalizado".

### 5.2 Golden Tests

Incluir ejemplos claros de cálculos manuales verificados contra el resultado
esperado (golden tests). Los valores de referencia pueden venir de:

- `Plantilla_Muebles.xlsx` (fórmulas validadas en Excel)
- Cálculos matemáticos documentados en `PRD.md`

### 5.3 Cobertura de estados

Cada componente o función debe probar:

| Estado | Ejemplo |
|--------|---------|
| Happy path | Valores típicos de entrada |
| Edge case | Dimensiones mínimas/máximas |
| Error | Material no soportado, dimensiones inválidas |
| Vacío | Lista vacía de módulos, catálogo sin resultados |

## 6. Comentarios y Documentación

- El código debe ser autoexplicativo.
- Los comentarios explican **"por qué"** se hace algo, no **"qué"** hace la función.
- Usar JSDoc para funciones de `packages/domain` que involucren cálculos
  matriciales o de geometría compleja.
- Los archivos grandes (> 400 líneas para screens, > 200 para utilidades) deben
  considerar extraer lógica a archivos más pequeños.

## 7. Commits y Git

- Seguir [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Commits atómicos: un solo cambio lógico por commit.
- Mensajes en inglés (el código es en inglés).
- **Nunca** commitear `.env`, `.env.local` ni secretos.
- Ver `docs/git-workflow.md` para el flujo completo.

## 8. Copy de UI

- Código e identificadores en **inglés**.
- Copy visible al usuario en **español** (salvo que el archivo ya use otro
  idioma de forma consistente).

## 9. Linter y Formatter

Este proyecto usa [Biome](https://biomejs.dev/) para linting y formato.
Correr antes de cada commit:

```bash
pnpm lint
```

## 10. Anti-patrones

| Anti-patrón | Alternativa |
|-------------|-------------|
| Lógica de negocio en componentes React | Extraer a `packages/domain` |
| `any` sin justificación | Usar `unknown` + type guard |
| Colores hardcodeados (#fff, #333) | Usar tokens CSS de `docs/design.md` |
| Archivos > 600 líneas | Extraer a subcomponentes o módulos |
| Tests solo en el último momento | Tests primero o junto con la implementación |
| Mezclar features en un commit | Commits atómicos por feature |
