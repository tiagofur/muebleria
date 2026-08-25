# Modelo de Interacción SketchUp + Granete

> **Estado:** CANÓNICO  
> **Fecha:** 2026-08-24  
> **ADR Relacionado:** [ADR-0001](../adr/0001-sketchup-manufacturing-ownership.md), [ADR-0002](../adr/0002-parametric-furniture-library-architecture.md)  
> **Documento de Estrategia:** [sketchup-muebles-strategy.md](../sketchup-muebles-strategy.md)  
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
4. **Edición Paramétrica In-Place:** Al modificar parámetros en el inspector, `@muebles/domain` recalcula la estructura y Ruby actualiza la geometría interna del grupo **sin alterar su posición ni rotación global en el espacio**.

---

## 2. Fronteras de Responsabilidad (Boundary)

| Responsabilidad | SketchUp (Ruby / Webview) | Granete (`@muebles/domain` / Backend) |
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
│    • Validación asíncrona rigurosa en @muebles/domain.      │
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

- **`StaticCatalogProvider`:** Provee las definiciones locales de respaldo empacadas con la extensión (solo offline; deprecado como fuente).
- **`RemoteCatalogProvider`:** Consulta el endpoint REST `GET /api/furniture/definitions` del servidor de Granete utilizando los puertos `Transport::Adapter` (HTTP) y `Auth::Provider` (sesión). La respuesta es el artefacto de intercambio compartido `contracts/pilotFurnitureCatalog.json` (fuente de verdad: `@muebles/domain/pilotFurnitureCatalog`), traducido a la forma interna en un único punto del provider. Expone además `all_presets` (modelos listos del taller) y las banderas `last_source`/`last_license_blocked` para la UI.

El cambio entre proveedores locales y remotos es transparente para el diálogo HTML y el controlador de la extensión.

### 6.1 Sesión y licencia (implementado)

- El usuario inicia sesión desde la pestaña **Estado** con su cuenta del taller; el login viaja con `client: sketchup-extension`.
- El backend emite un **JWT de extensión de 30 días** marcado con claim `client`; el middleware lo restringe a **solo lectura** (GET + refresh) y revalida usuario/rol/activo contra la DB en cada request, así que desactivar el usuario revoca la sesión al instante.
- La sesión se persiste en `~/Library/Application Support/Granete/sketchup_extension_session.json` (fuera del RBZ; sin credenciales incrustadas). No se usan preferencias de SketchUp para estado estructurado: `read_default` evalúa strings con aspecto de contenedor y corrompe JSON.
- `GET /api/furniture/definitions` exige **licencia activa por usuario** (`users.license_plan`/`license_expires_at`, gestionada por el admin con `PUT /api/admin/users/{id}/license`); sin licencia la extensión muestra el bloqueador con instrucciones y sirve el catálogo local de respaldo.
