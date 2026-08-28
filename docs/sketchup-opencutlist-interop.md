# OpenCutList Interoperability Validation (#417 / SU-ENT-4)

> **Estado:** EVIDENCIA DE VALIDACIÓN (2026-08-28)
> **Tracking:** #417, #413 · **Fuente de host:** `sketchup-native-entity-model.md` §18, ADR-0004 §13
> **Regla de autoridad:** `resultado OpenCutList = conveniencia de interoperabilidad; BOM Granete = resultado manufacturero autoritativo.` Este documento registra compatibilidad observada, nunca una dependencia de producto.

---

## 1. Entorno validado

| Componente | Versión |
|---|---|
| SketchUp | 2026.2 (26.2.242) macOS, Ruby 3.2.2 |
| OpenCutList | **7.1.0** (`ladb_opencutlist`, Extensión habilitada, carga al inicio) |
| Granete for SketchUp | RBZ `5fb741e9…` (contenido idéntico al `src/` de `main` al momento de la corrida) |
| TestUp | 2.5.4 (CI JSON reporter) |

## 2. Método

La suite `TC_OpenCutListInteropSmoke` (test-only, nunca runtime) construye con el
builder instalado el gabinete canónico de #417:

- **FI-A** — BODY 16 / FRONT 18 / BACK 6, puerta + agregado cajonero (3 frentes) + herraje visible;
- **FI-B** — misma `FurnitureDefinition`, FRONT re-resuelto a white 16 (rebuild nativo).

Guarda ambos en un `.skp`, lo **reabre** (`Sketchup.open_file` — la representación
sobrevive al formato de archivo) y ejecuta el camino síncrono público de
OpenCutList — `Ladb::OpenCutList::CutlistGenerateWorker.new.run`, exactamente el
código que corre su comando de UI — sin diálogos y sin explotar muebles.

Unidades: el modelo analizado se fuerza a decimal mm
(`LengthFormat = Length::Decimal` + `LengthUnit = Length::Millimeter`; en SU 2026
`Length#to_s` sólo respeta la combinación, no `LengthUnit` solo).

## 3. Resultados observados (corrida final: 28/28 tests, 968 assertions)

Evidencia completa: `progress/opencutlist_smoke_F190.json` y
`progress/host_smoke_F190_testup_ci.json`.

- **Tableros reconocidos como partes:** los 20 tableros (10 por mueble, ambos
  muebles) aparecen como partes sólidas con dimensiones finales auto-orientadas
  correctas — p. ej. lateral `688 × 544 × 16 mm`, puerta `596 × 459 × 18 mm`,
  fondo `600 × 720 × 6 mm`. Sin errores; un tip esperado
  (`no_typed_materials`, materiales sin tipo OCL asignado).
- **Espesor por rol:** cada nombre de pieza reporta exactamente el espesor del
  material Granete de su rol — 16/18/6 — incluyendo la divergencia deliberada
  FI-A/FI-B (`Puerta` 18 y 16; cada frente de cajón 18 y 16). La interpretación
  de espesor viaja por la **geometría local**, no por metadatos OCL.
- **Materiales:** un grupo por material Granete visible (`Granete · MDF Blanco
  16` con 14 partes, `Granete · Roble Macizo 18` con exactamente los 4 frentes
  de FI-A, `Granete · HDF Fondo 6` con 2). Los herrajes caen en sus propios
  grupos de material y NO contaminan los grupos de tablero.
- **Anidamiento:** OCL desciende la jerarquía nativa (mueble → tablero) sin
  necesitar explosión. Cada tablero es una parte porque su `ComponentDefinition`
  contiene la geometría sólida local; el mueble top-level no aparece como parte
  (comportamiento correcto para un contenedor sin caras propias).
- **Convenciones necesarias encontradas:**
  - **Selección:** si algo queda seleccionado, el worker analiza sólo la
    selección en vez del modelo — el smoke limpia la selección antes de
    analizar (en uso manual: deseleccionar o seleccionar lo que se quiere
    listar).
  - **Unidades:** el reporte usa las unidades del modelo; para mm decimales se
    requieren `LengthFormat` decimal + `LengthUnit` milímetro.
  - **Nombres:** los nombres de instancia en español (`Lateral Izquierdo`,
    `Frente Cajón 1`, …) llegan a OCL como `entity_names` — nombres semánticos
    útiles, no requeridos para el reconocimiento.
- **Partes vs instancias:** V1 genera definiciones únicas por instancia, así que
  cada ocurrencia es una parte propia (`count=1`). Dos muebles con piezas del
  mismo autorado (`gab-drawer-front`) siguen siendo partes separadas; OCL no
  colapsa por nombre de definición duplicado.

## 4. Limitaciones conocidas

- Materiales Granete se crean con color/textura para render; OCL los tipa como
  `unknown` hasta que el usuario asigne tipo OCL (sheet good, etc.). No es un
  defecto de interop ni se corrige desde Granete: tipar materiales de terceros
  es decisión del usuario en OCL.
- OCL 7.1.0 escribe su propio diccionario de atributos en las definiciones que
  analiza (p. ej. `uuid` de `DefinitionAttributes`); es metadata del plugin en
  entidades host, no identidad Granete, y el namespace
  `com.granete.sketchup_extension` nunca se mezcla.
- Sin claim sobre otras versiones de OCL ni sobre Windows: la evidencia vale
  para 7.1.0 en SketchUp 2026.2 macOS.

## 5. Límite de autoridad (negativo, enforceado)

- El boundary test del repositorio prohíbe los términos `opencutlist`, `ladb`,
  `cutlist`, `bom`, etc. en `apps/sketchup-extension/src/` — ninguna lógica de
  compatibilidad OCL puede contaminar el runtime (negative proof de #417).
- Las assertions del smoke comparan la lectura de OCL contra la verdad del
  fixture Granete (dimensiones/espesores/roles), nunca al revés: si OCL y el BOM
  Granete divergieran, gana Granete y se documenta la diferencia.
- Outputs de manufactura (BOM/canto/CNC) no se generan ni validan vía OCL (#354
  es dueño de esos goldens).
