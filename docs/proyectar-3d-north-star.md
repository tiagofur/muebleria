# Proyectar 3D — North Star de experiencia

**Estado:** CANÓNICO para producto/UX de Proyectar  
**Fecha:** 2026-08-21  
**Audiencia:** producto, diseño, implementación, QA y agentes  
**Relacionado:** `docs/prd-v2.md`, `docs/design.md`, `docs/architecture.md`, `docs/operational-core-v1.md`

> Este documento define **qué tan bueno debe llegar a ser Proyectar** y qué significa
> competir con herramientas especializadas sin convertir Mueblería en un clon de Promob,
> SketchUp o un CAD generalista.

---

## 0. Posicionamiento — decisión cerrada

Mueblería **NO quiere ser “la alternativa barata a Promob”**.

El precio puede ser menor porque el producto, el mercado y la estructura comercial son
distintos, pero **precio no es el argumento principal de compra**.

La posición objetivo es:

> **La alternativa ideal para talleres y fabricantes pequeños/medianos que no necesitan
> toda la amplitud de Promob, pero sí necesitan una experiencia de diseño 3D excelente,
> fácil de aprender y conectada de punta a punta con cotización, BOM, materiales,
> producción, instalación y rentabilidad.**

Ganamos clientes por:

1. calidad;
2. facilidad de uso;
3. rapidez de trabajo;
4. confianza en los datos;
5. integración real diseño→producción;
6. menor fragmentación de herramientas;
7. UX moderna y específica del taller;
8. precio adecuado al nicho — **como consecuencia**, no como moat principal.

### Frase interna de producto

> **No somos un Promob más barato. Somos un sistema operacional completo para un nicho
> distinto, con un diseñador 3D de nivel profesional.**

---

## 1. Qué significa “competir con Promob”

No significa tener todas sus capacidades.

Significa que, para nuestro dominio objetivo —cocinas, closets, baños, oficinas y muebles
modulares/parametrizados de medidas controladas— un usuario experimentado pueda pensar:

> “Puedo diseñar este trabajo aquí con la misma confianza y facilidad que espero de una
> herramienta profesional.”

### 1.1 Competimos en experiencia para nuestro Job To Be Done

Debemos aspirar a nivel excelente en:

- encontrar un mueble;
- insertarlo;
- colocarlo;
- ajustar medidas;
- cambiar materiales;
- añadir agregados;
- configurar herrajes;
- copiar/repetir/alinear;
- navegar ambientes;
- presentar al cliente;
- mantener BOM/precio/producción conectados.

### 1.2 No competimos en amplitud CAD

No necesitamos igualar:

- modelado libre arbitrario;
- NURBS/superficies complejas;
- cualquier geometría imaginable;
- ecosistemas históricos de cientos de catálogos propietarios;
- todos los plugins de render/CAM del mercado;
- todos los CNC/postprocesadores;
- diseño de cualquier objeto no relacionado con muebles modulares.

Ésa no es una limitación vergonzosa: es una **frontera deliberada de producto**.

---

## 2. Referencia competitiva — aprender el modelo mental, no copiar la interfaz

La interfaz moderna de Promob separa explícitamente catálogos de módulos, catálogos de
materiales, herramientas de inserción, panel de propiedades y ambiente 3D. Sus catálogos
se organizan jerárquicamente para localizar módulos/materiales con rapidez.

Mueblería adopta las **ideas de interacción que son naturalmente buenas para este trabajo**:

- biblioteca persistente de muebles cerca del canvas;
- biblioteca/materiales accesibles durante diseño;
- inspector contextual del elemento seleccionado;
- ambiente 3D como centro de trabajo;
- jerarquías y grupos para evitar catálogos planos inmanejables;
- inserción directa y manipulación visual.

Pero no copia:

- skin;
- iconografía propietaria;
- layout exacto;
- terminología de marca;
- arquitectura de producto;
- workflows heredados que no benefician a nuestro nicho.

### Fuentes competitivas de referencia (consultadas 2026-08)

- Promob Support — Nueva interfaz: `https://suporte.promob.com/hc/es/articles/31112647876881-Nuevo-Promob-Nueva-Interfaz-Promob`
- Promob Support — Interfaz principal: `https://suporte.promob.com/hc/es/articles/31120626198801-Promob-Interfaz-principal-de-Promob`
- Promob Catalog — Módulos: `https://suporte.promob.com/hc/es/articles/31123664570001-Catalog-M%C3%B3dulos`
- Promob Catalog — Materiales: `https://suporte.promob.com/hc/es/articles/31123657181329-Catalog-Materiales`

---

## 3. North Star

> **Un carpintero/proyectista que conoce herramientas profesionales debe abrir Proyectar
> y, en diez minutos, sentir que no pierde nada esencial para diseñar una cocina modular
> normal — y que gana continuidad porque el mismo trabajo alimenta cotización,
> ingeniería y producción.**

### 3.1 Resultado observable

En una sesión típica el usuario debe poder:

1. crear/abrir un ambiente;
2. encontrar módulos sin recordar códigos;
3. arrastrar módulos al muro/piso;
4. ver preview y snap antes de soltar;
5. modificar ancho/alto/profundidad cuando el módulo lo permita;
6. aplicar materiales con feedback inmediato;
7. añadir cajones/puertas/entrepaños/agregados sin conocer el modelo interno;
8. configurar herrajes relevantes;
9. duplicar/alinear/distribuir muebles;
10. navegar varios ambientes sin perder contexto;
11. presentar al cliente;
12. volver a cotización/ingeniería sin reconstruir información.

---

## 4. Quality Target Matrix

Esta matriz define la **meta de producto**, no una afirmación del estado actual.

| Capacidad | Meta | Qué significa 5★ |
|---|---:|---|
| Encontrar mueble | ★★★★★ | búsqueda, jerarquías, favoritos, recientes, previews y navegación rápida |
| Insertar / drag al ambiente | ★★★★★ | gesto directo, preview fantasma, target claro, cancelación segura |
| Snap muro/piso/esquina | ★★★★★ | predecible, visual, preciso y sin geometría imposible |
| Cambiar dimensiones | ★★★★★ | inmediato, validado, constraints claros, mm precisos |
| Materiales | ★★★★★ | biblioteca clara, grupos, drag/apply, scopes y undo |
| Agregados | ★★★★★ | lenguaje de usuario; composición compleja escondida detrás de acciones simples |
| Herrajes | ★★★★★ | selección/configuración/placement suficiente para el nicho |
| Selección + contexto | ★★★★★ | siempre es obvio qué está seleccionado y qué acciones aplican |
| Undo/redo | ★★★★★ | toda acción de diseño relevante reversible y predecible |
| Mover/copiar/duplicar | ★★★★★ | rápido, con keyboard precision y acciones repetibles |
| Multi-selección / alinear | ★★★★★ | operaciones comunes en grupo sin hacks |
| Multi-ambiente | ★★★★★ | contexto explícito, sin mezclar geometrías de espacios distintos |
| Presentación cliente | ★★★★☆ | profesional, limpia, compartible/capturable, sin chrome de taller |
| Fotorrealismo | ★★★☆☆ | suficientemente atractivo para vender; no competir con render dedicado |
| CAD arbitrario/libre | ★★☆☆☆ | deliberadamente limitado |
| Parametrización ultra-compleja | ★★★☆☆ | suficiente para muebles de nuestro nicho, no rule-engine universal |
| Diseño → producción | ★★★★★+ | cambio de diseño actualiza BOM/precio y activa stale/release correctamente |

### 4.1 Interpretación de estrellas

- **1★:** existe pero frustra.
- **2★:** usable con aprendizaje/trabajo extra.
- **3★:** bueno y confiable.
- **4★:** muy bueno, profesional.
- **5★:** referencia del nicho; fluido y difícil de mejorar sin cambiar el job.
- **5★+:** ventaja estructural que conecta áreas, no sólo UX local.

---

## 5. Modelo mental de la interfaz

Proyectar debe reducir el sistema a tres preguntas permanentes:

> **¿Qué puedo insertar? → ¿Dónde estoy trabajando? → ¿Qué puedo cambiar?**

### 5.1 Layout conceptual

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Proyecto · Cocina López   Ambiente: Cocina   Undo Redo     Presentar      │
├─────────────────┬───────────────────────────────────────┬──────────────────┤
│ MUEBLES         │                                       │ PROPIEDADES      │
│ Buscar...       │                                       │                  │
│                 │                                       │ Selección actual │
│ Cocina          │              AMBIENTE                 │ Dimensiones      │
│ ▾ Bajos         │                 3D                    │ Materiales       │
│ ▾ Altos         │                                       │ Agregados        │
│ ▾ Torres        │                                       │ Herrajes         │
│                 │                                       │ Posición         │
│ Favoritos       │                                       │ Avanzado         │
│ Recientes       │                                       │                  │
├─────────────────┴───────────────────────────────────────┴──────────────────┤
│ MATERIALES / ACABADOS — grupos, favoritos, búsqueda, swatches            │
└────────────────────────────────────────────────────────────────────────────┘
```

No es un wireframe obligatorio pixel a pixel. Es el **modelo de información**.

---

## 6. Biblioteca persistente de muebles

### 6.1 Cambio de decisión respecto al roadmap anterior

La regla histórica “mejorar flujo actual; no barra tipo Promob” se reemplaza por:

> **Sí puede existir una biblioteca lateral persistente de muebles si mejora de forma
> demostrable la velocidad y comprensión. No debe ser un clon visual de Promob.**

La interacción es natural para el job y no pertenece a una marca.

### 6.2 Estructura

Ejemplo:

```text
MUEBLES
🔎 Buscar

Cocina
  Bajos
    Puertas
    Cajones
    Esquineros
    Especiales
  Altos
  Torres
  Islas

Closet
  Torres
  Cajoneras
  Entrepaños

Baño
Oficina

⭐ Favoritos
🕘 Recientes
```

### 6.3 Requisitos de excelencia

- búsqueda tolerante por nombre/código/tipo;
- categorías jerárquicas y breadcrumbs claros;
- thumbnail/preview reconocible;
- dimensiones/variantes principales visibles sin abrir detalle;
- favoritos;
- recientes;
- navegación teclado cuando sea útil;
- drag al canvas;
- click para insertar con target predecible como alternativa accesible;
- virtualización si el catálogo crece;
- preservar categoría/búsqueda al volver del canvas.

### 6.4 No hacer

- grid con 500 tarjetas sin jerarquía;
- exigir código para encontrar un mueble;
- abrir modal para cada inserción;
- esconder el catálogo detrás de navegación global cada vez;
- hacer thumbnails decorativos que no ayudan a reconocer el módulo.

---

## 7. Biblioteca de materiales

### 7.1 Debe ser una herramienta de trabajo permanente

Aplicar materiales es una acción de alta frecuencia. Debe estar disponible sin abandonar
el canvas.

### 7.2 Organización

```text
MATERIALES

Frentes
  Blanco mate
  Roble natural
  Nogal
  Negro

Interiores
  Blanco
  Gris

Cubiertas
  Piedra clara
  Granito oscuro

Ambiente
  Piso
  Pared
  Revestimiento

⭐ Favoritos
🕘 Recientes
```

No mezclar material de tablero cotizable con material ambiental si el dominio los separa.
La UI puede presentarlos juntos visualmente con categorías, pero el modelo sigue respetando
sus consecuencias distintas.

### 7.3 Aplicación por intención

Drag de material sobre un objeto debe resolver el target.

Después, cuando haya ambigüedad útil:

```text
Aplicar Nogal a:
● Todos los frentes de este mueble
○ Sólo esta pieza
○ Todos los frentes de la obra
```

La opción default debe corresponder al lenguaje real del usuario, no al nivel interno de
`BoardPart`.

### 7.4 Feedback

- target highlight durante drag;
- preview razonable antes de commit cuando sea posible;
- aplicación <150ms perceptuales;
- undo inmediato;
- indicar si el cambio afecta precio/BOM;
- si el proyecto está liberado, activar stale/revision flow en vez de mutar silenciosamente.

---

## 8. Inspector contextual

Debe existir **un lugar estable** donde el usuario entiende la selección.

### 8.1 Selección de mueble

Ejemplo:

```text
BAJO MESADA BM-600
600 × 720 × 580 mm

Dimensiones
Materiales
Agregados
Herrajes
Posición
Avanzado
```

### 8.2 Selección de pieza

```text
PUERTA IZQUIERDA
596 × 716 × 18 mm
Material
Cantos
Mecanizado
Herrajes relacionados
```

### 8.3 Selección de ambiente

```text
COCINA
Altura 2600 mm
Piso
Paredes
Revestimientos
Iluminación/presentación
```

### 8.4 Reglas

- misma zona, distinto contexto;
- secciones colapsables;
- mostrar sólo acciones válidas;
- progressive disclosure;
- mm editables con validación inmediata;
- propiedades avanzadas no dominan el flujo normal;
- no duplicar controles idénticos en canvas + inspector sin razón;
- selección debe sobrevivir cambios menores de panel/cámara cuando sea razonable.

---

## 9. Agregados — complejidad de dominio, simplicidad de usuario

Los agregados son una oportunidad de diferenciación.

El usuario **no debe necesitar entender**:

- sub-assemblies;
- local bounding boxes;
- component expansion;
- BOM internals;
- nesting de jerarquías.

Debe pensar:

```text
Agregar al mueble
+ Cajonera
+ Entrepaño
+ Puertas
+ Basurero extraíble
+ Zapatero
+ Canastilla
```

### 9.1 Ejemplo cajonera

```text
CAJONERA
Cantidad        3
Altura total    540 mm
Separación      3 mm
Corredera       Tandem
Frente          Roble natural
```

Internamente el sistema puede resolver N sub-ensambles, piezas, herrajes y drilling.
Externamente la acción debe sentirse como “añadir tres cajones”.

### 9.2 Quality bar

5★ requiere:

- inserción simple;
- preview inmediata;
- parámetros relevantes solamente;
- constraints claros;
- stack/distribution automático;
- herrajes derivados correctamente;
- BOM correcto;
- undo/redo;
- selección visual del agregado cuando sea útil;
- posibilidad de entrar al detalle técnico sólo cuando se necesita.

---

## 10. Placement y manipulación — debe sentirse físico

Ésta es un área donde no se acepta “funciona más o menos”.

### 10.1 Drag / insert

Durante la inserción:

- ghost preview;
- superficie candidata visible;
- verde/neutral si válido;
- peligro si colisión/bloqueo;
- snap de muro/piso/esquina;
- ESC cancela;
- drop commit atómico;
- no generar estado intermedio corrupto.

### 10.2 Movimiento

Operaciones objetivo:

- mover sobre muro;
- cambiar de muro;
- convertir/usar posición libre cuando aplica;
- offset numérico exacto;
- pegar a izquierda/derecha/esquina;
- centrar;
- alinear;
- distribuir;
- duplicar;
- copiar/pegar;
- multi-selección;
- nudge teclado configurable;
- snap configurable;
- guías temporales de distancia.

### 10.3 Lenguaje, no matemática 3D

El usuario no debería trabajar con:

```text
worldX/worldY/worldZ
quaternion
matrix
```

Debe trabajar con:

```text
Muro A
1250 mm desde esquina izquierda
sobre piso
centrado
50 mm de separación
rotar 90°
```

El engine hace la traducción geométrica.

---

## 11. Selección

La selección es la base de toda la UX del editor.

### 11.1 Requisitos

- highlight inequívoco;
- outline/overlay que no cambie material real;
- click vacío limpia selección;
- click objeto selecciona unidad correcta;
- drill-down pieza/agregado cuando el modo lo permite;
- Shift/Ctrl para multi-select conforme convención;
- selección sincronizada canvas ↔ árbol/lista ↔ inspector;
- no seleccionar accidentalmente objetos ocultos/behind walls sin intención;
- selección estable durante orbit/pan.

### 11.2 Jerarquía de selección

Default:

```text
FurnitureUnit
```

Modo detalle o acción específica:

```text
FurnitureUnit → Aggregate → Part / Hardware
```

No obligar al usuario a “cazar” una pieza pequeña cuando la intención normal es mover el
mueble completo.

---

## 12. Undo / Redo

5★ significa que el usuario puede experimentar sin miedo.

Debe cubrir al menos:

- insertar/eliminar;
- mover;
- rotar;
- cambiar dimensiones;
- cambiar material;
- añadir/quitar agregado;
- cambiar configuración de agregado;
- herraje/placement;
- multi-operaciones de alineación/distribución;
- cambios de ambiente relevantes.

### Regla

Un gesto del usuario = una intención = idealmente un command reversible.

Drag de 300 eventos pointermove no produce 300 entradas de history.

---

## 13. Multi-ambiente

Debe sentirse como trabajar en un proyecto con espacios explícitos, nunca como mezclar
geometrías.

### 13.1 Requisitos

- ambiente activo claramente visible;
- switch rápido Cocina/Baño/Closet/etc.;
- canvas scoped al ambiente cuando corresponde;
- vista global si existe debe ser explícita, no un accidente;
- furniture placement siempre pertenece a un space o a una política documentada;
- materiales ambientales por space;
- cámaras por ambiente opcionalmente preservadas;
- items no colocados claramente separados del espacio físico.

---

## 14. Ambiente 3D

El canvas es el **workspace**, no una preview decorativa.

### Debe incluir

- piso y muros confiables;
- openings/obstáculos cuando el producto los soporte;
- grid/guías bajo demanda;
- orbit/pan/zoom predecible;
- views rápidas útiles: perspectiva, frontal, planta, selección;
- fit selection / fit room;
- clipping/ocultación inteligente si una pared bloquea la tarea;
- navegación que no pelee con drag de muebles;
- modo presentación separado del modo edición.

### Cámara

No reinventar controles exóticos. El usuario debe poder entender cámara en segundos.

---

## 15. Presentación al cliente

Meta: ★★★★☆, no renderer dedicado.

Debe sentirse deliberadamente distinta del workspace de taller.

### Objetivos

- ocultar chrome técnico;
- usar materiales correctos;
- vistas limpias;
- navegación por ambientes;
- capturas de calidad;
- comparación de opciones cuando sea útil;
- datos comerciales opcionales;
- compartir/exportar con contexto correcto.

### No necesitamos

- ray tracing offline obligatorio;
- competir con Blender/Cycles;
- catálogo fotográfico perfecto para cada fabricante antes de validar mercado.

3★ de fotorrealismo puede ser suficiente si 5★ de facilidad + confianza vende más.

---

## 16. Integración diseño → negocio → producción

Éste es nuestro 5★+.

Una operación de diseño nunca debe quedar aislada.

Ejemplo: cambiar frente de Blanco a Nogal puede afectar:

```text
3D
↓
Resolved BOM
↓
Quote price
↓
Material requirement
↓
Production artifacts
```

Si la obra aún es editable, recalcula lo necesario.

Si la revisión ya fue aprobada/liberada:

```text
change
↓
stale revision
↓
approval/change order cuando aplique
↓
new ProductionRelease
```

**Nunca** modificar silenciosamente archivos de producción ya liberados.

---

## 17. Arquitectura técnica — React no es el objetivo ni la excusa

La capacidad objetivo es viable con React + R3F/Three.js si la arquitectura protege el
hot path.

### 17.1 Reglas

- React no debe rerenderizar la escena completa por cada input irrelevante;
- separar estado de dominio, estado UI y estado efímero de interacción;
- scene graph claro;
- selectors de estado finos;
- memo/caching de geometría y materiales;
- raycasting acotado;
- instancing donde ayude;
- workers para operaciones pesadas cuando corresponda;
- nunca usar Three.js scene como fuente canónica del proyecto;
- geometría derivada del dominio/estado, no al revés.

### 17.2 Scene graph conceptual

```text
Scene
├─ Environment
│  ├─ Floor
│  ├─ Walls
│  └─ Openings/Helpers
├─ FurnitureUnits
│  ├─ Unit
│  │  ├─ Boards
│  │  ├─ Aggregates
│  │  └─ Hardware
│  └─ ...
├─ InteractionLayer
│  ├─ Selection
│  ├─ Ghosts
│  ├─ Guides
│  └─ Gizmos
└─ PresentationEffects
```

Interaction overlays no deben contaminar materiales/BOM.

---

## 18. Performance Quality Bar

No optimizar por folklore; medir.

### Escena de referencia objetivo

Definir fixture estable con, como mínimo:

- 1 ambiente completo;
- 20–30 muebles;
- cientos de board parts;
- herrajes visibles relevantes;
- materiales/texturas reales;
- varias luces razonables;
- interacción de drag/selection.

### Métricas objetivo iniciales

En hardware objetivo de taller medio:

- interacción percibida sin stutter grave;
- pointer/drag feedback <100–150ms;
- mantener frame rate útil durante navegación;
- abrir proyecto sin bloqueo largo del main thread;
- cambios de material/dimensión sin reconstrucción global innecesaria.

No fijar 60 FPS como dogma para cualquier laptop, pero sí evitar UX que se sienta pesada.

### Profiling obligatorio cuando se toca hot path

Medir:

- React commits;
- draw calls;
- triangles;
- texture memory;
- raycast cost;
- geometry rebuilds;
- main-thread long tasks.

---

## 19. Estados y feedback del editor

Toda interacción compleja debe tener estado visible.

Ejemplos:

```text
idle
hovering-target
inserting-valid
inserting-invalid
dragging
resizing
multi-select
applying-material
blocked-stale
saving
error
```

No hacer depender el significado sólo de color.

---

## 20. Accesibilidad y alternativas

El 3D es visual por naturaleza, pero las acciones principales deben tener alternativa
usable cuando sea razonable:

- insertar por click además de drag;
- editar posición por campos numéricos;
- mover/nudge con teclado;
- lista/árbol sincronizado con canvas;
- labels/aria en toolbar/paneles;
- foco visible;
- no requerir precisión de pixel para tareas básicas.

---

## 21. UX para usuario nuevo vs experto

### Nuevo

Debe poder:

- encontrar módulo;
- insertarlo;
- moverlo;
- cambiar material;
- presentar;

sin leer manual.

### Experto

Debe ganar velocidad con:

- favoritos;
- recientes;
- búsqueda rápida;
- shortcuts;
- duplicate;
- multi-select;
- nudge;
- align/distribute;
- presets;
- repetición de última acción cuando sea apropiado.

No diseñar una app “fácil” que se vuelva lenta después de dos semanas.

---

## 22. Errores caros que Proyectar debe prevenir

- mueble fuera del ambiente sin intención;
- colisiones imposibles;
- medida fuera de constraint;
- cambio de material sin consecuencia de BOM/precio visible;
- cambio sobre revisión liberada sin stale;
- ambiente incorrecto activo;
- duplicado accidental;
- pieza/agregado editado creyendo que se editaba el mueble;
- material ambiental filtrándose a BOM;
- cambio de template maestro afectando silenciosamente una revisión congelada.

---

## 23. Principios de simplicidad

### Mostrar lenguaje del carpintero

Preferir:

- “3 cajones”
- “Pegado a muro A”
- “50 mm desde la esquina”
- “Roble en todos los frentes”

sobre:

- `aggregate instances`
- `anchorFace + relativePosition`
- `world transform`
- `optionRole override`

Los términos técnicos pueden existir en modo avanzado/documentación, no como precio de
entrada al producto.

---

## 24. Qué debemos intentar hacer mejor que soluciones mayores

No ganar por tener más botones.

Intentar ganar en:

1. **time-to-first-result**;
2. continuidad cotización↔3D;
3. cambios que actualizan negocio/producción;
4. facilidad de encontrar módulos/materiales;
5. agregados simples;
6. errores de revisión visibles;
7. menos modos y saltos mentales;
8. onboarding menor;
9. colaboración/centralización de datos;
10. integración con el resto del flujo del taller.

---

## 25. Tres pilares del producto

### Pilar A — Vender

```text
Cliente → Cotización → Proyectar → Presentación → Aprobación
```

### Pilar B — Fabricar

```text
Ingeniería → BOM → Materiales → Corte → CNC → Enchape → Armado → QC
```

### Pilar C — Operar

```text
Proyecto → Compras → Embarque → Instalación → Warranty → Costing
```

Proyectar es una pieza principal del Pilar A, no un “preview bonito”.

---

## 26. Definition of Great — Proyectar

No considerar Proyectar “excelente” hasta que una prueba de usuario real pueda completar
sin coaching significativo:

1. abrir Cocina;
2. buscar un bajo de 600;
3. insertarlo en Muro A;
4. duplicarlo;
5. alinear ambos;
6. cambiar ancho del segundo;
7. añadir cajonera;
8. cambiar frentes a Roble;
9. cambiar piso del ambiente;
10. navegar a otro ambiente y volver;
11. presentar al cliente;
12. verificar que cotización/BOM reflejan los cambios.

### Objetivos orientativos

- primer módulo colocado: <60 s para usuario nuevo;
- cambio de material: <15 s;
- añadir agregado común: <30 s;
- duplicar/alinear 3 unidades: <30 s;
- usuario no necesita entender conceptos internos del BOM;
- errores de target/constraint explican cómo corregirse.

Estos tiempos se validan con pilotos; no son una promesa comercial hasta medirlos.

---

## 27. Anti-scope explícito

No añadir para “parecernos a Promob”:

- herramienta que no resuelve un job observado;
- free-form geometry editor;
- node editor de reglas;
- render pipeline complejo sin demanda;
- configuraciones de fabricante sin cliente;
- 40 modos de cámara;
- UI llena de toolbars sólo porque existen en CAD clásicos;
- parámetros internos expuestos por comodidad del programador.

---

## 28. Fuente de verdad y relación con otros docs

| Concern | Autoridad |
|---|---|
| Qué producto somos | `docs/prd-v2.md` |
| Qué experiencia debe lograr Proyectar | **este documento** |
| Cómo implementarlo por olas/issues | `docs/proyectar-3d-roadmap-vnext.md` |
| Tokens/patrones visuales | `docs/design.md` |
| Arquitectura | `docs/architecture.md` |
| Lifecycle/stale/release | `docs/project-lifecycle.md` |
| Operational Core | `docs/operational-core-v1.md` |
| Estado implementado | código + tests |
| Backlog | GitHub issues |

Si una spec histórica de Proyectar contradice este North Star, conservarla como historia
pero no usarla como autoridad de producto futura.

---

## 29. Regla final

> **Proyectar debe ser fácil porque el sistema entiende muebles, no porque tenga pocas
> funciones.**

La complejidad debe existir en el dominio y desaparecer de la experiencia del usuario.
