# Diseño Técnico — Especificación de Ingeniería (Fase 0)

Este documento especifica la estructura técnica de datos, interfaces y herramientas para la implementación de la **Etapa 1 (Local-First)** y prepara la integración futura de la **Etapa 2 (Go + Postgres)**.

---

## 1. Esquema de Datos del Workspace (JSON)

El almacenamiento local se estructurará en un único archivo JSON centralizado (`workspace.json`). Toda la data se organiza bajo UUIDs como claves de referencia para facilitar la migración a base de datos relacional.

### 1.1 Estructura TypeScript del Esquema

```typescript
export interface WorkspaceSchema {
  readonly schemaVersion: number; // Incrementable para migraciones futuras
  readonly catalog: CatalogSchema;
  readonly projects: readonly ProjectSchema[];
}

export interface CatalogSchema {
  readonly materials: readonly MaterialBoardSchema[];
  readonly edges: readonly EdgeBandSchema[];
  readonly hardware: readonly HardwareSchema[];
  readonly optionGroups: readonly OptionGroupSchema[];
  readonly modules: readonly ModuleSchema[];
}

export interface MaterialBoardSchema {
  readonly id: string; // UUID v4
  readonly code: string; // Único, ej. "TAB-ARA-BLA-15"
  readonly name: string; // Ej. "Arauco Blanco 15mm"
  readonly thicknessMm: number; // Ej. 15
  readonly grainDefault: boolean; // Si tiene veta por defecto
  readonly costPerM2: number; // Costo en MXN
  readonly wastePercent?: number; // % merma default (ej. 10)
  /** FK EdgeBand — default canto for this board (never by name). */
  readonly defaultEdgeBandId?: string;
  readonly notes?: string;
  readonly active: boolean;
}

export interface EdgeBandSchema {
  readonly id: string; // UUID v4
  readonly code: string; // Ej. "CAN-BLA-05"
  readonly name: string; // Ej. "Canto Blanco 0.5mm"
  readonly thicknessMm: number; // Ej. 0.5
  readonly costPerMl: number; // Costo por metro lineal en MXN
  readonly notes?: string;
  readonly active: boolean;
}

export interface HardwareSchema {
  readonly id: string; // UUID v4
  readonly code: string; // Ej. "HER-BLU-BIS"
  readonly name: string; // Ej. "Bisagra Blum Cierre Lento"
  readonly unit: "piece" | "set" | "meter";
  readonly costPerUnit: number;
  readonly notes?: string;
  readonly active: boolean;
}

export interface OptionGroupSchema {
  readonly id: string; // UUID v4
  readonly code: string; // Ej. "INTERIOR" | "FRENTE" | "BISAGRA"
  readonly name: string; // Ej. "Melamina de Interiores"
  readonly kind: "board" | "hardware" | "edge";
  readonly required: boolean;
  readonly optionIds: readonly string[]; // Array de UUIDs de MaterialBoard, EdgeBand o Hardware
}

export interface EdgeAssignmentSchema {
  readonly side: "L1" | "L2" | "W1" | "W2";
  readonly enabled: boolean;
}

export interface BoardPartSchema {
  readonly id: string; // UUID v4
  readonly code?: string; // Código de pieza, ej. "MOD-GAB-01-P01"
  readonly description: string; // Ej. "Costado Derecho"
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly grain: 0 | 1;
  readonly edges: readonly EdgeAssignmentSchema[]; // Siempre 4 posiciones
  readonly optionRole: string; // Vincula a OptionGroupSchema.code (ej. "INTERIOR")
}

export interface HardwareLineSchema {
  readonly id: string; // UUID v4
  readonly quantity: number;
  readonly descriptionOverride?: string;
  readonly optionRole: string; // Vincula a OptionGroupSchema.code (ej. "BISAGRA")
  readonly hardwareId?: string; // Fijo si no es opción (ej. tornillos de ensamblaje)
}

export interface ModuleSchema {
  readonly id: string; // UUID v4
  readonly code: string; // Único, ej. "MOD-GAB-01"
  readonly name: string;
  readonly externalDims?: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly baseLaborCost?: number; // Mano de obra base para este mueble, default 0
  readonly boardParts: readonly BoardPartSchema[];
  readonly hardwareLines: readonly HardwareLineSchema[];
  readonly notes?: string;
}

export interface ProjectSchema {
  readonly id: string; // UUID v4
  readonly name: string;
  readonly clientName: string;
  readonly currency: string; // Default "MXN"
  readonly marginFactor: number; // Ej. 1.35
  readonly laborFixedCost: number; // Costo de mano de obra del proyecto
  readonly status: "draft" | "quoted" | "accepted";
  readonly items: readonly ProjectItemSchema[];
  readonly notes?: string;
  readonly createdAt: string; // ISO String
  readonly updatedAt: string; // ISO String
}

export interface ProjectItemSchema {
  readonly id: string; // UUID v4
  readonly moduleId: string; // UUID de ModuleSchema
  readonly quantity: number;
  readonly optionChoices: { readonly [optionGroupCode: string]: string }; // Map de OptionGroup.code -> catalogItemId (UUID)
}
```

---

## 2. Abstracción de Almacenamiento (Repository Pattern)

Para cumplir con el principio **API-Ready**, el frontend interactuará únicamente con un "puerto" (interfaz). 

### 2.1 Definición de la Interfaz del Puerto (`WorkspaceRepository`)

```typescript
export interface WorkspaceRepository {
  // Inicialización y carga atómica del workspace completo
  load(): Promise<WorkspaceSchema>;
  save(workspace: WorkspaceSchema): Promise<void>;

  // Métodos específicos útiles para evitar lecturas/escrituras masivas innecesarias
  getCatalog(): Promise<CatalogSchema>;
  saveCatalog(catalog: CatalogSchema): Promise<void>;
  
  getProjects(): Promise<readonly ProjectSchema[]>;
  saveProject(project: ProjectSchema): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}
```

### 2.2 Estrategias de Implementación (Adapters)

* **Adaptador Local (`JSONFileStorage` - Etapa 1):** 
  Lee/escribe el archivo `workspace.json` localmente.
  - Implementa **escritura atómica**: escribe un archivo temporal (`workspace.json.tmp`) y lo renombra (`fs.renameSync`) para evitar corrupción ante fallos de energía.
* **Adaptador API (`HttpApiStorage` - Etapa 2):**
  Implementa la misma interfaz ejecutando peticiones `fetch()` a la API del backend de Go.

---

## 3. Configuración del Monorepo y Dependencias

Utilizaremos **pnpm workspaces** para aislar boundaries y agilizar la compilación.

### 3.1 Estructura del Workspace (`pnpm-workspace.yaml`)

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 3.2 Paquetes y su Stack de Dependencias

1. **`packages/domain`**
   - *Responsabilidad:* Tipos del dominio, motor de cálculo (m², ML, precios), validaciones.
   - *Dependencias:* Ninguna (TypeScript puro).
   - *Testing:* `vitest`.
2. **`packages/storage`**
   - *Responsabilidad:* Interfaces de repositorio y adaptador de archivo local (`JSONFileStorage`).
   - *Dependencias:* `uuid` para generación de IDs. Node `fs`/`path` en su implementación de servidor/escritorio.
3. **`packages/excel`**
   - *Responsabilidad:* Serializar despiece resuelto a Excel.
   - *Justificación de Selección:* Se elige **`exceljs`** porque permite configurar anchos de columnas, bordes y colores específicos requeridos por `Plantilla_Optimizer.xlsx`, superando las limitaciones de la versión comunitaria de SheetJS.
   - *Dependencias:* `exceljs`.
4. **`packages/ui`**
   - *Responsabilidad:* Componentes visuales puros de React (formularios, tablas, editores).
   - *Dependencias:* `react`, `lucide-react` (iconos).
5. **`apps/web` (Vite + React)**
   - *Responsabilidad:* SPA web que usa `HttpApiStorage` o mock de LocalStorage.
6. **`apps/desktop` (Electron + React)**
   - *Responsabilidad:* Shell de escritorio que inyecta `JSONFileStorage` usando APIs nativas de Node a través del puente IPC.

---

## 4. Contrato IPC (Electron ↔ React)

En la app de escritorio, la UI de React corre en un proceso Renderer aislado por seguridad, mientras que Electron corre en el proceso Main (con acceso a `fs` y diálogos nativos). El canal de comunicación se restringe en un archivo `preload.js` usando `contextBridge`.

### 4.1 Definición de Canales IPC

```typescript
export interface ElectronAPI {
  // Almacenamiento local del workspace
  loadWorkspace: () => Promise<WorkspaceSchema>;
  saveWorkspace: (workspace: WorkspaceSchema) => Promise<void>;
  
  // Guardado nativo de Excel
  showSaveDialog: (options: { defaultPath: string }) => Promise<string | undefined>;
  writeExcelFile: (filePath: string, buffer: ArrayBuffer) => Promise<void>;
}
```

---

## 5. Alineación con Principios del PRD

| Decisión Técnica | Principio PRD Relacionado | Beneficio de Diseño |
|------------------|---------------------------|---------------------|
| UUIDs en local | 9. API-Ready | Facilita la transición a Postgres eliminando colisiones de llaves. |
| `WorkspaceRepository` | 9. API-Ready | Desacopla la UI de la base de datos o almacenamiento físico. |
| Cálculos en `packages/domain` | 1. Dominio primero | Permite portar el motor completo a Go en la Etapa 2 fácilmente sin tocar vistas. |
| Librería `exceljs` | 3. Compatibilidad de salida | Asegura la fidelidad estética y estructural con el flujo de Optimizer. |

---

## 6. Especificación de Backend Go + Postgres (Etapa 2)

El backend en Go proporciona una API REST segura sobre Postgres para soportar sincronización y cálculo financiero de cotizaciones de forma centralizada.

### 6.1 Estructura del Backend Go
El código sigue las convenciones de diseño idiomático de Go organizadas en la carpeta `backend-go/`:
- `cmd/server/main.go`: Punto de entrada del servidor.
- `internal/api/`: Controladores, enrutamiento y middleware de CORS y autenticación JWT.
- `internal/auth/`: Lógica de hashing de contraseñas (bcrypt) y generación de tokens JWT.
- `internal/storage/`: Pool de conexiones y repositorios estructurados para manipulación de Postgres.
- `internal/domain/engine/`: Equivalente en Go del motor de cálculo financiero del monorepo TS.

### 6.2 Esquema de Base de Datos (Postgres)
Las tablas principales creadas a través de archivos de migración son:
- **`users`**: Almacena credenciales seguras (email, password_hash y tokens).
- **`customers`**: Datos del cliente (nombre, email, teléfono, dirección, notas y bandera active).
- **`material_boards`**: Registra código, nombre, dimensiones físicas (ancho, largo y espesor en Mm), precio de venta por hoja, porcentaje de merma y notas.
- **`projects`**: Registra nombre, cliente (id y nombre), moneda, factor de margen, mano de obra, estado (draft/quoted/accepted), marca de tiempo y el snapshot JSON del desglose financiero.

### 6.3 Autenticación y Adaptación en el Frontend
El frontend se integra con este backend a través de la pantalla de login ([LoginScreen.tsx](file:///Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/auth/LoginScreen.tsx)) y un adaptador HTTP ([apiWorkspaceRepository.ts](file:///Users/tiagofur/dev/carpinteria/muebles/packages/storage/src/apiWorkspaceRepository.ts)), inyectando el encabezado `Authorization: Bearer <token>` en todas las peticiones a la API del servidor.
