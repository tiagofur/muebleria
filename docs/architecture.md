# Arquitectura — Contrato de calidad

> Los agentes revisores evalúan código contra este archivo.
> Si un criterio no está aquí, no es un requisito de arquitectura.

## Principios

1. **Dominio primero.** Los cálculos (BOM, costos, validaciones) viven en
   `packages/domain`. No importa React, Electron, ni fs. Es puro TypeScript,
   100% testeable con Vitest sin DOM.

2. **UI no calcula.** Los componentes en `packages/ui` consumen resultados
   del dominio; no implementan fórmulas de m², ML ni precios.

3. **Excel es un adaptador de salida.** `packages/excel` solo serializa DTOs
   de producción (`ProductionCutRow[]`). No conoce el modelo de dominio
   completo, solo la forma de datos que necesita para el xlsx.

4. **Storage es un puerto (Repository Pattern).** `packages/storage` define interfaces (puertos) para guardar y cargar catálogos, módulos y proyectos. Las aplicaciones (UI y shells) interactúan únicamente con estas abstracciones, desacoplándose de la implementación física. En la versión local, implementa escritura atómica (tmp + rename).

5. **Apps son shells delgados.** `apps/web` y `apps/desktop` cablean adapters
   (download de browser vs diálogo Electron) y componen paquetes. Sin lógica
   de dominio propia.

## Estructura de paquetes

```
packages/
  domain/     → tipos, motor de resolución, cálculos, validaciones
  ui/         → componentes React compartidos (sin lógica de negocio)
  excel/      → writer del Optimizer.xlsx (SheetJS / ExcelJS)
  storage/    → persistencia JSON versionada (local-first)
apps/
  web/        → shell React + Vite
  desktop/    → shell Electron
```

## Flujo de datos (solo lectura)

```
Catálogos (storage)
  │
  ├── Módulos plantilla (domain: Module, BoardPart, HardwareLine)
  │
  └── Cotización (domain: Project + ProjectItem + optionChoices)
            │
            ▼  resolveBom()
      ResolvedBom (material concreto por pieza)
            │
            ├── calcProjectBreakdown() → QuoteBreakdown (costos, precio)
            └── generateCutRows()     → ProductionCutRow[]
                                               │
                                        excel/optimizerExport()
                                               │
                                        Optimizer.xlsx
```

## Reglas de boundary (no negociables)

| Paquete | Puede importar | No puede importar |
|---------|---------------|-------------------|
| `domain` | solo stdlib TS | react, electron, fs, xlsx |
| `ui` | domain, react | electron, fs, xlsx |
| `excel` | xlsx lib, domain types | react, electron |
| `storage` | fs (Node), domain types | react, electron, xlsx |
| `apps/*` | todo lo anterior | lógica de dominio directa |

## Errores en el dominio

Las funciones que pueden fallar lanzan `DomainError` con mensaje accionable:

```typescript
class DomainError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
  }
}

class ValidationError extends DomainError {}
class ResolutionError extends DomainError {}
```

La UI captura y muestra el `message` + `context` (módulo, pieza, campo).
Nunca propaga stack traces al usuario final.

## Arquitectura Cliente-Servidor (Go + Postgres) - Implementada

El sistema soporta una arquitectura multi-usuario centralizada con las siguientes características:

1. **Adaptador de Almacenamiento HTTP:**
   Implementamos `APIWorkspaceRepository` en `packages/storage` que implementa la interfaz `WorkspaceRepository` y realiza llamadas HTTP REST al backend en Go.
2. **Motor de Dominio en Go:**
   Las fórmulas y lógica de cálculo financiero fueron replicadas en Go en el backend (`backend-go/internal/domain/engine`) asegurando total correspondencia de precios.
3. **Persistencia Relacional en Postgres:**
   El backend en Go mapea las entidades usando UUIDs nativos y llaves foráneas para integridad relacional sobre las tablas `users`, `customers`, `material_boards` y `projects`.
4. **Seguridad y CORS:**
   El tráfico está protegido mediante autenticación JWT y middleware de CORS configurado en el servidor Go.

## Qué NO hacer

- No calcular costos en componentes de presentación.
- No mezclar filas de herraje en el output del Optimizer.
- No hardcodear materiales en el módulo plantilla (deben ser roles).
- No escribir el archivo de workspace a mitad de operación.
- No añadir dependencias externas a `domain` (debe quedar puro).
