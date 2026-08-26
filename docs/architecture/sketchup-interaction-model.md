# Modelo de Interacción SketchUp + Granete

> **Estado:** CANÓNICO  
> **Fecha:** 2026-08-24  
> **ADR Relacionado:** [ADR-0001](../adr/0001-sketchup-manufacturing-ownership.md), [ADR-0002](../adr/0002-parametric-furniture-library-architecture.md)  
> **Documento de Estrategia:** [sketchup-granete-strategy.md](../sketchup-granete-strategy.md)  
> **Resolución Material-Aware:** [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md)
> **Invariante Central:** **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

---

## 1. Modelo Mental Canónico

El modelo mental de interacción en Granete for SketchUp sigue el flujo:

```text
Biblioteca de Muebles  ──(Inserción)──►  Canvas 3D (SketchUp Viewport)  ──(Selección)──►  Inspector Contextual
         ▲                                                                                          │
         └───────────────────────────(Edición Paramétrica In-Place)─────────────────────────────────┘
```

1. **Biblioteca (Catalog):** El diseñador explora definiciones de muebles paramétricos (`FurnitureDefinition`), configura cotas iniciales con validación interactiva ligera y solicita la inserción en el modelo.
2. **Canvas 3D (Viewport de SketchUp):** La extensión actúa como **renderer/adaptador**, creando entidades geométricas agrupadas en el espacio 3D e inyectando metadata semántica inmutable.
3. **Inspector Contextual:** Al hacer clic o seleccionar una entidad en el canvas, un `SelectionObserver` detecta la metadata y rehidrata dinámicamente el panel HTML con los parámetros activos del mueble, permitiendo edición en vivo.
4. **Edición Paramétrica In-Place:** Al modificar parámetros o acabados en el inspector, Granete (`@granete/domain` / backend) vuelve a resolver la estructura completa y Ruby consume el DTO para reconstruir la geometría interna del grupo **sin alterar su identidad, posición ni rotación global**. El orden material → espesor → geometría se define en [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md).

---

## 2. Fronteras de Responsabilidad (Boundary)

| Responsabilidad | SketchUp (Ruby / Webview) | Granete (`@granete/domain` / Backend) |
|---|---|---|
| **Interacción y Viewport** | Selección, transformaciones 3D, navegación de cámara | Observador pasivo de transformaciones |
| **Dibujo / Rendering** | Creación de grupos, caras y asignación de materiales | Desacoplado de APIs de dibujo |
| **Lógica Paramétrica** | *Ninguna* (Cero cálculo de holguras o fórmulas) | **Fuente de verdad única** (evaluación de fórmulas, slots y piezas) |
| **Metadata Semántica** | Almacena y lee diccionarios de atributos | Define esquemas de metadata y envelopes |
| **Mecanizado y Perforaciones** | No calcula ni almacena perforaciones manuales | Deriva mecanizados industriales con trazabilidad |
| **Validación de Preflight** | Muestra feedback visual (badges / alertas) | Ejecuta validación de colisiones y capacidades CNC |
| **Catálogo de Muebles** | Presenta catálogo y captura inputs | Provee definiciones y reglas constructivas |

---

## 3. Jerarquía Estructural de 3 Niveles en SketchUp

Cada mueble insertado se estructura en una jerarquía estricta de grupos con metadata semántica:

```text
[Grupo Nivel 1: FurnitureInstance]
  │  Dictionary: com.granete.sketchup_extension
  │  Payload: { kind: "furnitureInstance", instanceRef: "inst-123", furnitureDefinitionId: "kitchen-base-standard", parameters: { ... } }
  │
  ├── [Grupo Nivel 2: ComponentInstance (Lateral Izquierdo)]
  │     │  Payload: { kind: "componentInstance", slotRef: "left_side", componentDefinitionId: "panel_lateral" }
  │     └── [Entidad Nivel 3: PartInstance (Pieza Física)]
  │           Payload: { kind: "partInstance", partRef: "part-01", role: "left_side", dimensionsMm: [18, 570, 720] }
  │
  ├── [Grupo Nivel 2: ComponentInstance (Entrepaño Ajustable)]
  │     │  Payload: { kind: "componentInstance", slotRef: "shelf_1", componentDefinitionId: "shelf" }
  │     └── [Entidad Nivel 3: PartInstance (Pieza Física)]
  │           Payload: { kind: "partInstance", partRef: "part-02", role: "shelf", dimensionsMm: [564, 570, 18] }
  │
  └── [Grupo Nivel 2: ComponentInstance (Puerta)]
        │  Payload: { kind: "componentInstance", slotRef: "door_1", componentDefinitionId: "door" }
        └── [Entidad Nivel 3: PartInstance (Pieza Física)]
              Payload: { kind: "partInstance", partRef: "part-03", role: "door", dimensionsMm: [596, 18, 716] }
```

### Beneficios de la Jerarquía
- **Selección de Nivel 1 (Furniture):** Un clic simple en el viewport selecciona el mueble completo para moverlo o editar sus parámetros globales en el inspector.
- **Selección de Nivel 2/3 (Component / Part):** Doble clic permite hacer drill-down a componentes individuales (ej. cambiar el material de una puerta específica o verificar el tamaño de un entrepaño).

---

## 4. Separación de Niveles de Preflight

Granete divide la validación en dos niveles claramente delimitados:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Preflight Interactivo Ligero (UX Gating en Cliente)      │
│    • Validación síncrona inmediata en el diálogo HTML.      │
│    • Comprueba límites de parámetros (min, max, step).       │
│    • Valida reglas de catálogo simples (ej. max entrepaños).│
│    • Da feedback visual instantáneo (warning badges).       │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Al solicitar liberación / sync)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Preflight de Manufactura Completo (Authoritative Domain) │
│    • Validación asíncrona rigurosa en @granete/domain.      │
│    • Detección de colisiones de perforaciones (DRILLING).   │
│    • Verificación de capacidades de máquina CNC y perfiles.  │
│    • Trazabilidad de revisión (bomFingerprint / revId).     │
│    • Gate formal para emitir ProductionRelease.             │
└──────────────────────────────┘
```

---

## 5. Resolución de Assets (`AssetResolver`)

Los componentes 3D (tiradores, bisagras, patas, guías de cajón) no utilizan rutas de archivo locales fijas:
- El dominio referencia el asset mediante `AssetReference` / `assetId`.
- En SketchUp, el `AssetResolver` traduce el `assetId` a:
  1. **Caché local** de la extensión si el archivo `.skp` ya fue descargado.
  2. **Bundle empaquetado** de recursos de fábrica.
  3. **Descarga remota** desde la API de Granete si el asset no está en caché.
- Si el archivo 3D `.skp` no está disponible, el builder genera automáticamente una representación geométrica volumétrica simplificada de respaldo (*fallback*).

---

## 6. Proveedor de Catálogo Pluggable (`CatalogProvider`)

La extensión implementa un contrato polimórfico para obtener el catálogo de muebles:

- **`StaticCatalogProvider`:** Definiciones locales empaquetadas con la extensión. Sólo desarrollo/tests o fallback **explícito** (inyectado al construir el provider); nunca se usa en producción como sustituto silencioso del catálogo remoto.
- **`RemoteCatalogProvider`:** Consulta el endpoint REST `GET /api/furniture/definitions` del servidor de Granete utilizando los puertos `Transport::Adapter` (HTTP) y `Auth::Provider` (sesión). La respuesta es el **catálogo real del taller autenticado**: el backend proyecta los mismos `modules` que la app React edita bajo `/api/catalog/modules` al envelope compartido de furniture (forma `contracts/pilotFurnitureCatalog.json`; adaptador `internal/api/furniture_catalog.go`). Se traduce a la forma interna en un único punto del provider. Expone además `all_presets` (medidas comerciales de cada mueble) y `last_source` (`remote|unauthenticated|license_blocked|error|local`) + `last_license_blocked` para que la UI distinga cargado/vacío/error/sin sesión/licencia bloqueada.

El cambio entre proveedores locales y remotos es transparente para el diálogo HTML y el controlador de la extensión. Cuando el catálogo remoto no está disponible, el provider devuelve un catálogo vacío y reporta el motivo — **no** sustituye muebles genéricos.

### 6.1 Sesión y licencia (implementado)

- El usuario inicia sesión desde la pestaña **Estado** con su cuenta del taller; el login viaja con `client: sketchup-extension`.
- El backend emite un **JWT de extensión de 30 días** marcado con claim `client`; el middleware lo restringe a **solo lectura** (GET + refresh) y revalida usuario/rol/activo contra la DB en cada request, así que desactivar el usuario revoca la sesión al instante.
- La sesión se persiste en `~/Library/Application Support/Granete/sketchup_extension_session.json` (fuera del RBZ; sin credenciales incrustadas). No se usan preferencias de SketchUp para estado estructurado: `read_default` evalúa strings con aspecto de contenedor y corrompe JSON.
- `GET /api/furniture/definitions` exige **licencia activa por usuario** (`users.license_plan`/`license_expires_at`, gestionada por el admin con `PUT /api/admin/users/{id}/license`); sin licencia la extensión muestra el bloqueador con instrucciones y la biblioteca queda vacía (sin catálogo de respaldo).

### 6.2 Layout resuelto — inserción implementada, paridad material pendiente

La identidad de un mueble no alcanza para materializarlo: el catálogo de
definiciones proyecta identidad/parámetros, y la **composición real**
(estructura + componentes del módulo + agregados + herrajes visibles) se
resuelve en el servidor en el momento de la inserción:

```text
Mueble creado en Granete React (Module + Structure + Components + Agregados)
        ↓  GET /api/furniture/definitions/{definitionId}/layout?widthMm=&heightMm=&depthMm=
Resolved Furniture Layout (backend Go, engine/layout.go)
        • components[]: cada tablero con slotId, nombre, AABB (translationMm =
          min corner en marco taller X=ancho/Y=fondo/Z=alto, dimensionsMm),
          L/W/T y color por rol (misma paleta que el preview 3D web)
        • hardware[]: cada herraje con preview shape/size/projection/color
          resuelto a caja world-space anclada a la cara de su tablero host
        ↓  RemoteCatalogProvider#resolved_layout (nil ⇒ fallback genérico)
FurnitureBuilder.render_resolved_components (adaptador visual puro)
        ↓
FurnitureInstance completa en SketchUp (jerarquía de 3 niveles + metadata)
```

Reglas del contrato:

- **La resolución del endpoint vive en Go** (`internal/domain/engine/layout.go`) y
  Ruby **nunca** compone: sólo transforma cajas pre-horneadas. La paridad con la
  semántica TS es un contrato verificable, no una afirmación sobre el estado actual.
- Las fórmulas admiten `W/H/D`, `PW/PH/PD`, `T`, `B` (zoclo), `HW` e `i`. Hoy Go
  usa el espesor nominal del componente antes de adjuntar el material; [#402](https://github.com/tiagofur/muebleria/issues/402)
  debe hacer que el `MaterialBoard` seleccionado determine `T` antes de fórmulas,
  poses, anchors y AABB, según [el contrato material-aware](material-aware-furniture-resolution.md).
- `widthMm/heightMm/depthMm` de query sobreescriben las cotas del módulo (el
  diálogo las edita libremente); 404 definición desconocida, 400 medidas
  inválidas, 422 composición no resoluble (error explícito), 403 sin licencia.
- Módulos legados (sin estructura, `BoardParts` planos) se apilan por índice:
  completitud visual sin inventar posiciones.
- El mismo endpoint alimenta `estimatedPartCount`/`estimatedHardwareCount` de
  cada definición en `GET /api/furniture/definitions` (contador "piezas" real
  del diálogo; nunca más el guess `2 + entrepaños + puertas`).
- Herrajes **cost-only** (sin `previewShape` válido) no se materializan —
  paridad con `resolveHardwarePlacement` (VH-09).

### 6.3 Elección de materiales por rol (captura implementada, deuda P0)

El plugin permite elegir el tablero por rol antes de insertar, con el mismo
modelo de elecciones que la app web (`OptionChoices = { [optionGroupCode]:
materialId }`; el `optionRole` de cada componente ES el código del grupo):

- **Catálogo** (`GET /api/furniture/definitions`): el envelope agrega
  `materials` (tableros activos con `materialId/code/name/previewColor/
  imageUrl/thicknessMm/grain`) y cada definición lleva `materialRoles:
  [{role, label, optionIds}]` — roles presentes en su composición; `optionIds`
  = la lista curada del `OptionGroup(code==role, kind="board")` si existe, o
  todos los materiales activos como fallback. El `revisionId` (y ETag) cubre
  también `materials`.
- **Selector** (dialog): una lista por rol en configurador e inspector
  (`renderMaterialSelectors`), default = primera opción; viaja al backend en
  el payload de insert/update como `materialChoices: {ROL: materialId}`.
- **Resolución**: Ruby reenvía `?choice.ROL=<materialId>` — el token de
  extensión es **read-only (GET)**. El DTO ya lleva identidad/visual reales y
  una elección desconocida o inactiva produce **422**; sin embargo, hasta #402
  Go adjunta el material después de calcular geometría con espesor nominal.
  Además, Go hace lookup directo mientras TS permite `ZOCLO`, `PUERTA*` y
  `FRENTE_CAJON` como fallbacks de `FRENTE`;
  [#403](https://github.com/tiagofur/muebleria/issues/403) cierra ese drift.
- **Visual**: el builder pinta cada grupo con materiales de SketchUp
  namespaced (`Granete · <nombre>`, color desde `materialColorHex` /
  `colorHex` de herrajes) vía `Model::MaterialApplier` — mismo color que el
  preview 3D de la app web.


### 6.4 Actualización de acabado y atomicidad

El cambio de un material role solicita primero un layout completo y sólo después llama
al builder. `FurnitureBuilder#update_furniture` conserva `instanceRef`, ejecuta
`clear! + rebuild + metadata` dentro de una operación y aborta ante excepción. Esto es
la base correcta, pero el rollback real, la preservación del transform exterior y la
propagación a todos los componentes normales/agregados deben probarse en
[#404](https://github.com/tiagofur/muebleria/issues/404). Un layout genérico/offline es
preview no autoritativo y nunca manufacturing truth.
