# Guía de uso — Granete

> Manual para el usuario final del taller: vendedores, ingeniería, producción
> y administración. Paso a paso, sin jerga de código. Para setup técnico ver
> `README.md`; para reglas de producto ver `docs/prd-v2.md`.

---

## 1. ¿Qué es Granete?

Granete es el sistema del taller para **cotizar, diseñar y producir** mobiliario
a medida: catálogos de materiales y herrajes, muebles reutilizables,
cotizaciones con grupos de opciones, diseño del ambiente en 3D (Proyectar) y
export al optimizador de corte.

La app viene con datos de demostración (**Cocina López**, una cocina en L
completa) para explorar todo antes de cargar tus propios datos.

## 2. Primer arranque y sesión

- **Invitado (sin conexión):** en la pantalla de inicio, "Acceder sin
  conexión" abre un workspace local con el catálogo demo. Ideal para probar.
- **Con cuenta:** pedí registro a quien administra el sistema. Las cuentas
  nuevas quedan **pendientes de aprobación** — un admin las aprueba en
  Usuarios.
- **Salir:** botón "Salir" arriba a la derecha.

Roles y qué ven (los 8 roles canónicos de `contracts/roles.json`):

| Rol | Para quién | Qué hace |
|-----|-----------|---------|
| Admin | dueño / sistemas | todo + usuarios + ajustes |
| Sin puesto | cuenta aprobada sin área asignada | inicio y estado de planta; un admin le asigna roles |
| Vendedor | comercial | cotizaciones, clientes, vitrina (costos según config) |
| Gerente de ventas | comercial | cotizaciones + dashboard |
| Gerente de producción | planta | producción, órdenes, embarques + dashboard de producción |
| Ingeniero | técnica | catálogos, muebles, estructuras, acabados |
| Producción | fábrica | cola y órdenes de producción |
| Almacén | depósito | embarques, compras/almacén + dashboard de almacén |

## 3. El mapa de la app

Barra lateral izquierda, tres zonas:

- **TRABAJO:** Inicio (dashboard), Cotizaciones, Clientes, Vitrina, Producción.
- **INGENIERÍA:** Muebles, Estructuras, Componentes, Materiales, Cantos,
  Herrajes, Grupos, Acabados.
- **CONFIG:** Ajustes, Usuarios (solo admin).

Tip: `Cmd/Ctrl + K` abre el buscador rápido (navegación y cotizaciones
recientes).

## 4. Preparar el taller (una sola vez)

En **Ajustes**: margen de venta por defecto, mano de obra fija y moneda.
Estos defaults aplican a cotizaciones nuevas; no modifican las existentes.

## 5. Armar tu catálogo (ingeniería)

El orden recomendado — cada paso usa los anteriores:

1. **Materiales** (tableros): costo por m², espesor, veta, color de vista y
   canto por defecto.
2. **Cantos**: espesor y costo por metro lineal.
3. **Herrajes**: bisagras, correderas, jaladeras, patas, perfiles de zócalo…
   con unidad y costo. Los herrajes con forma de vista (jaladera, pata) se
   ven en el 3D. Para pares, juegos, sistemas de cajón e insertos ver la
   **§8c**.
4. **Grupos**: qué se puede elegir al cotizar (p. ej. FRENTE = melaminas de
   frentes) y qué miembros ofrece cada grupo. Un grupo puede ser obligatorio
   o opcional.
5. **Acabados**: materiales de presentación 3D (pisos, muros, mesadas) con
   categorías y fotos.
6. **Componentes**: piezas paramétricas reutilizables (costado, puerta,
   zócalo…) con fórmulas (`W`, `H`, `D`, `T`, `B`).
7. **Estructuras**: cuerpos compuestos de componentes.
8. **Muebles**: el producto vendible — estructura + componentes propios +
   medidas comerciales (presets) + foto de vitrina.

En cada lista: buscar, filtro de activos, y el patrón es siempre el mismo —
click para **ver**, botón **Editar** para editar, **Desactivar** para sacar
sin perder historia.

### 5.2 Duplicar para crear a partir de otro

**Para qué sirve.** Crear un componente, agregado, mueble, material, canto,
herraje, acabado, perfil o cotización nuevo partiendo de uno existente, con el
código y todas sus propiedades editables **antes** de guardarlo.

**Cuándo usarla.** Cuando necesitás una variante de una pieza o mueble que ya
armaste (por ejemplo, duplicar `MBOX-RES-M` para ajustar el código a
`MBOX-RES-E` y cambiar medidas, fórmulas o cantos) sin crear una copia `-COPY`
previa en el catálogo ni volver a cargar todo desde cero.

**Pasos.**

1. Abrí el ítem que querés tomar como base:
   - En **Componentes**, **Agregados**, **Muebles** o **Cotizaciones**, entrá
     al detalle del ítem y tocá **Más → Duplicar**.
   - En **Materiales**, **Cantos**, **Herrajes**, **Acabados**, **Perfiles de
     herraje** o **Perfiles de apertura**, tocá **Duplicar** en la fila de la
     tabla.
2. Se abre el formulario de creación **prellenado** con todo lo del ítem
   original:
   - En catálogos, el campo **Código** aparece desbloqueado y sugerido con
     `<CÓDIGO>-COPY`, y el **Nombre** con `<Nombre> (copia)`.
   - En **Cotizaciones**, se abre la ventana de nueva cotización prellenada con
     `<Nombre> (copia)`, cliente, margen, mano de obra y notas editables (los
     muebles y el plano 3D se copian automáticamente al guardar).
3. Editá el **Código**, el **Nombre** y cualquier otra propiedad que cambie, y
   tocá **Guardar**. Si tocás **Cancelar** (o salís sin guardar), no se crea
   ningún duplicado.

**Cómo saber que quedó bien.** Aparece el aviso de confirmación con el código
(o nombre) que elegiste y el nuevo ítem queda listado independiente del
original; si el código ya existía (incluso inactivo), el formulario te avisa y
se mantiene abierto para corregirlo sin perder tus cambios.

### 5.1 El zócalo desde la librería

Al crear o editar un mueble, en la pestaña General está **"Zócalo: ¿cómo
apoya en el piso?"**:

- **Automático según tipo de mueble (recomendado):** al cotizar, bajos y
  despensas salen con zócalo de melamina heredando el frente; alacenas sin
  zócalo. No tenés que hacer nada más.
- **Zócalo de melamina:** ese mueble siempre cotiza con zócalo de corte.
- **Perfil comprado / Patas:** siempre con perfil o patas.
- **Altura B:** solo si el mueble se aparta del default (100 mm). Entra en las
  fórmulas de pieza como `B`.

## 6. Cotizar

1. **Cotizaciones → Nueva cotización.** Nombre, cliente (o crearlo al vuelo),
   margen y MO propios si cambian.
2. **Agregar mueble:** buscá en el catálogo (con filtro por categoría),
   elegí el preset de medida y las opciones obligatorias. El mueble entra a
   la lista con su precio estimado.
3. **Choices por línea o del proyecto:** cada línea puede sobreescribir las
   opciones; el default del proyecto (botón de opciones de proyecto) baja a
   todas las líneas que no lo pisen.
4. **Plantillas:** guardá una cotización como plantilla o empezá una nueva
   "Desde plantilla".
5. Estados: **Borrador → Enviar (cotizado) → Aceptar**. Al aceptar se congela
   el diseño para producción.

## 7. Proyectar — el ambiente en 3D

Botón **Proyectar** dentro de una cotización. Tres zonas: lista de muebles a
la izquierda, vista 3D/planta al centro, inspector a la derecha.

- **Ambiente:** dibujá o importá los muros (hay importación de plano), y
  definí el zócalo por defecto del plano (altura), mesada visual, piso,
  muros y techo con materiales de Acabados (se pintan arrastrando desde la
  pestaña Materiales).
- **Muebles:** arrastrá cada unidad a un muro o al plano libre (islas). Se
  pueden arrastrar a lo largo del muro; los rellenos avisan colisiones.
- **Inspector (pestaña Mueble):** presets de medida, acabados y herrajes, y
  la **tarjeta Zócalo** (ver §8).
- **Inspector (pestaña Posición):** muro, corrimiento, piso/muro (colgado) y
  **altura del zócalo** de esa unidad con chips rápidos (default del plano,
  80/100/120/150).
- Click en cualquier parte del mueble — **incluido el zócalo en el 3D** — lo
  selecciona y abre el inspector.

## 8. Zócalos — la guía completa

La filosofía: **el zócalo es una sola decisión por mueble** ("¿cómo apoya en
el piso?"), con default automático. El sistema arma el resto.

### 8.1 Automático al cotizar (sin tocar nada)

Cuando agregás un **bajo o una despensa** a una cotización, el ítem ya nace
con zócalo de melamina a 100 mm heredando el acabado del frente. Las
**alacenas** nacen sin zócalo. El BOM y el 3D salen completos: pieza de corte
con canto frontal, o herraje en metro lineal, sin armar nada a mano.

### 8.2 Cambiar el tipo o el acabado (tarjeta Zócalo)

Seleccioná el mueble (en la lista o tocándolo en el 3D) → inspector → pestaña
**Mueble** → **"Zócalo (base del mueble)"**:

- **¿Cómo apoya en el piso?** — melamina / perfil comprado / patas / sin
  zócalo.
- Debajo aparece **solo el selector que corresponde**:
  - Melamina → material de tablero, default **"Igual que el frente"**.
  - Perfil → **los perfiles de TU catálogo** (ver 8.3).
  - Patas → las patas registradas en tu catálogo.
- La **altura** se ajusta en la pestaña **Posición** (chips o valor propio).

El 3D refleja el cambio al instante: melamina con su material, perfil como
fleja metálica del color del herraje elegido, patas visibles, "sin zócalo"
no dibuja nada.

### 8.3 Tus propios acabados de perfil (aluminio, bronce, negro, …)

La lista de perfiles **no es fija**: son herrajes de tu catálogo. Para sumar
uno nuevo:

1. **Herrajes → Nuevo**: código (p. ej. `HER-ZOC-ORO`), nombre, unidad
   **metro**, costo por unidad, tamaño de paquete (p. ej. barras de 4 m) y —
   opcional — color de vista (`previewColor`) para distinguirlo en el 3D.
2. **Grupos → ZOCLO_PERFIL → Editar** y agregá el nuevo herraje como miembro.
3. Listo: aparece en la tarjeta Zócalo de cada cotización para elegirlo.

El sistema trae tres de ejemplo (aluminio natural, bronce y negro) para que
veas el patrón; desactalos o editá sus precios como con cualquier herraje.

### 8.4 Qué pasa detrás (para los curiosos)

- **Melamina:** el motor genera la pieza sola (largo = ancho del mueble,
  alto = B, canto frontal). Si tu mueble ya tiene su propio componente de
  zócalo, se usa ese — no se duplica.
- **Vueltas laterales (automáticas):** el plano sabe qué hay a cada lado del
  mueble. Si un extremo queda a cielo abierto (no pega con otro mueble ni
  con el final del muro), el zócalo suma la vuelta lateral de ese lado —
  pieza de corte en melamina, o metros lineales extra si es perfil. Las
  islas llevan también la trasera. En el 3D las vueltas se ven como paneles
  reales, delgados al espesor del material y con la veta corrida a lo ancho
  del mueble.
- **Perfil:** se factura por metro lineal según el ancho (más las vueltas);
  la lista de compra redondea a barras completas.
- **Patas:** cantidad sugerida según el ancho (4 hasta 800 mm, +1 cada
  400 mm).
- La altura del **plano** (Posición) manda sobre la del módulo: lo que ves
  en 3D es lo que se cotiza.

## 8b. Config de fábrica — Construcción y uniones

**Quién:** administración o ingeniería de la fábrica. **Dónde:** Config →
pestaña Ingeniería y Producción → Construcción y uniones; y en Componentes →
Editar → pestaña Construcción para excepciones por pieza.

La política de construcción define cómo tu taller ensambla y perfora:
sistema por familia de unión (piso, techo, entrepaño, respaldo), cantidad de
fijaciones y márgenes. Se aplica a todos los muebles compatibles **sin editar
cada definición**.

### El ciclo: borrador → activar

1. **Editá** los valores que quieras (por ejemplo, entrepaños: 5 fijaciones,
   márgenes 35 mm).
2. **«Guardar borrador»** guarda esos valores **sin cambiar nada** de lo que
   la fábrica calcula hoy: un borrador incompleto o con errores también se
   puede guardar.
3. **«Activar política»** hace efectivo el borrador: el servidor lo valida
   con el mismo motor que perfora, y si algo no cuadra te lo dice con el
   detalle. Si valida, pasa a ser la política activa **en un solo paso** —
   nunca queda publicada por la mitad.

Mientras haya un borrador, el banner lo dice: *«Borrador guardado — no
gobierna la producción»*. Los cálculos y la producción siguen usando la
política activa hasta que actives.

### Excepciones por componente

En el editor de componente, la pestaña Construcción permite fijar valores
**específicos para esa pieza** (por ejemplo, este entrepaño usa 3 fijaciones
cuando la fábrica define 4). La etiqueta de procedencia te dice siempre de
dónde sale cada valor: **Biblioteca** (estándar Granete), **Fábrica**
(política general) o **Componente (Excepción)**. «Restaurar herencia» borra
la excepción y la pieza vuelve a heredar.

### Historial intacto

Activar una política nueva **no** cambia cotizaciones, diseños aprobados ni
releases de producción ya congelados: esos siguen con la política con la que
fueron creados. La política activada rige los cálculos nuevos.

### Dos fábricas, dos políticas (caso A/B)

Cada fábrica tiene su propia política sobre la misma biblioteca Standard:
la fábrica A puede definir 4 fijaciones por unión y la B 2, sin que Standard
cambie y sin copiar muebles. Este caso está documentado paso a paso en
`docs/manufacturing/factory-construction-ab-runbook.md` para soporte.

## 8c. Herrajes: pares, juegos, sistemas de cajón e insertos

Todo el alta de herrajes sale de un solo lugar: **Herrajes → «Nuevo»**. La
app pregunta **qué querés dar de alta** y muestra sólo lo que ese tipo
necesita — nada de secciones que no corresponden.

### 8c.1 Pieza simple

**Para qué sirve:** una bisagra, una corredera, un tirador, una pata — un
herraje que compra por unidad y se ve en el 3D.

**Pasos:** Herrajes → **Nuevo → Pieza**. Código, nombre, unidad (pieza,
juego o metro), costo, y opcionalmente su modelo 3D (pestaña de modelo:
subir un .skp o elegir uno existente). Guardar.

**Cómo saber que quedó bien:** aparece en la lista y se puede elegir desde
donde corresponda (zócalos, recetas, plantillas).

### 8c.2 Par izquierda/derecha

**Para qué sirve:** dos piezas que vienen espejadas — la galería, el
BOXCOVER y el BOXCAP de un cajón Merivobox. Se da de alta UNA vez y el
sistema dibuja cada lado con su pieza.

**Pasos:** Herrajes → **Nuevo → Par izquierda/derecha**.

1. Código y nombre; **precio del par** (el registro se vende completo).
2. **Diseño — un SKP por lado:** para cada lado, *Subir diseño* (archivo
   nuevo) o *Elegir existente*. Un lado sin diseño queda marcado como
   «pendiente» y se ve con la representación genérica hasta que lo subas.
3. **Offsets X/Y/Z:** dibujá la pieza en 0,0,0 en SketchUp y posicioná acá
   con los offsets, medidos desde el borde de cada lado. **Lo que ves es lo
   que se guarda.**
4. **Al abrir:** fija al mueble, viaja con el cajón o viaja con la puerta —
   es la declaración que el motor ya lee, no un efecto del nombre.
5. **Copiar al otro lado** copia los offsets del lado lleno al vacío —
   sólo al pulsarlo; nunca hay espejo automático.

**Cómo saber que quedó bien:** la fila muestra la marca «N piezas D/I/C» y,
al insertar el mueble, cada lado dibuja su pieza en su lado.

#### Cómo dibujar los SKP de un par (convención de autoría)

Dibujá **cada pieza como se ve montada en SU lado, mirando el mueble de
frente** (igual que la vista 3D de la web, donde el ancho del mueble
arranca a la izquierda de la pantalla):

1. **El origen del SKP es el punto de apoyo**: donde la pieza toca la
   pared o el lugar de montaje. Lo que dibujes alrededor del origen no se
   mueve; los offsets X/Y/Z del alta posicionan ese origen.
2. **Pieza izquierda:** la pared queda hacia la izquierda del origen y la
   pieza se extiende hacia la derecha (hacia adentro del mueble).
   **Pieza derecha:** la pared queda hacia la derecha del origen y la
   pieza se extiende hacia la izquierda.
3. **Altura** hacia arriba (eje azul, +Z). **Profundidad:** el frente del
   mueble hacia el eje verde positivo (+Y).
4. Dibujá con la plantilla en **milímetros** para que las medidas sean las
   reales.

Con esa convención, Granete dibuja cada pieza en su lado y con su
orientación correcta tanto en la web como en SketchUp — incluyendo el
espejado automático de piezas con mano cuando el mueble se refleja
(#1605). Si una pieza es **simétrica** (se ve igual espejada), podés ligar
el mismo SKP a ambos lados.

**Si tu par ya estaba subido y se ve invertido en SketchUp:** no hace
falta re-dibujar. Revisá contra esta convención qué archivo corresponde a
cada lado y, si están cruzados, re-ligalos en la ficha del juego o del
par (Editar → cada lado → *Cambiar*). Guardá y volvé a insertar.

### 8c.3 Insertos de un juego y su selector

**Para qué sirve:** los accesorios que se eligen por cajón dentro de un
juego ya creado — por ejemplo, el lateral superior del cajón E (galería,
BOXCOVER o BOXCAP). Cada uno es un par D/I que entra al **selector** del
juego; al cotizar se elige uno.

**Pasos (dos caminos):**

- Desde el juego: abrir el juego → sección **Insertos del juego** →
  **Añadir inserto**. Se crea ahí mismo y queda en el selector.
- Desde el alta: **Nuevo → Inserto para un juego** → elegir el juego →
  llenar el par como en 8c.2 → guardar.

En la sección **Insertos del juego** también está **Añadir existente**
(un herraje que ya está en el catálogo) y el **estado de cada opción**:
qué lados tienen diseño y cuáles están pendientes, con acceso directo para
corregirlos.

**Cómo saber que quedó bien:** al agregar el mueble a una cotización
aparece el selector con las opciones; el precio del inserto elegido sale
en la cotización por cajón.

### 8c.4 Juego simple y sus partes

**Para qué sirve:** un herraje que se monta como conjunto — bisagras con su
placa y brazo, correderas con su guía fija y móvil. Compra un juego, el
despiece dibuja cada parte.

**Pasos:** Herrajes → **Nuevo → Juego → Juego simple**.

1. **Plantilla:** la app trae plantillas de ejemplo (bisagra, corredera,
   cajón con manos) y podés guardar las tuyas con **Plantillas**.
2. Código, nombre y costo del juego. La vista previa nombra las partes que
   se van a crear.
3. Crear: quedan el juego y sus **partes** vinculadas (cada parte es un
   herraje del catálogo que no se compra por separado).

**Las partes después:** abrir el juego → sección **Partes de este juego**.
Cada parte tiene su propio «Al abrir» (fija al mueble, sale con el cajón,
abre con la puerta), su **lado** y sus **offsets** — editable desde la
misma tarjeta, sin salir del juego. **Crear parte nueva** y **Vincular
herraje existente** suman partes; **Quitar** las desvincula sin borrarlas.

**Cómo saber que quedó bien:** la lista agrupa las partes bajo el juego con
la marca «N partes de diseño», y el mueble dibuja cada parte en su lugar.

### 8c.5 Sistema de cajones por alturas

**Para qué sirve:** dar de alta un sistema tipo Merivobox completo — un
juego por altura Blum (N 85.5, M 108, K 146, E 209 mm) — de una vez, con
sus insertos y con el ensamble que los módulos eligen por bahía.

**Pasos:** Herrajes → **Nuevo → Juego → Sistema por alturas**.

1. Identidad del sistema: código, nombre, costo por juego, ancho y fondo.
2. **Alturas:** marcá las que querés incluir; cada altura pide el diseño
   del costado (fijo y móvil, por mano — subir o elegir).
3. **Insertos del cajón E** (opcional, podés añadirlos después): cada uno
   nace con su SKP por lado, sus offsets y su «Al abrir» — nada queda a
   medias.
4. **Elegibilidad:** elegís en qué grupo queda disponible el sistema para
   los módulos (el default es el grupo de sistemas de cajón). Si decidís
   omitirlo, la app te avisa que ningún módulo podrá elegirlo y hay que
   confirmar.
5. **Revisión:** la lista exacta de lo que se va a crear y el botón Crear.
   Si algo falla a mitad, no queda nada creado a medias: se corrige y se
   reintenta.

**Añadir una altura después** (el sistema ya existe): abrí cualquier juego
del sistema → sección **Sistema de cajones** → **Añadir altura**. Sólo
ofrece las alturas que faltan y agrega la variante al ensamble.

**Cómo saber que quedó bien:** en la cotización, cada bahía resuelve su
altura automáticamente (una bahía baja de 209 mm sale con el juego E; una
de 108 mm, con el M) y la cotización trae un juego por bahía.

### 8c.6 Agarres: estilos del taller y del proyecto

**Para qué sirve:** definir cómo se agarran las puertas y frentes — el
estilo (perfil, gola, jaladera) se define una vez y se aplica al proyecto.

**Pasos:**

- **Estilos del taller:** Ajustes → pestaña **Agarres**. Creás o editás
  cada estilo con su editor y su preview antes de usarlo.
- **En el proyecto:** el estilo elegido baja a las puertas del ambiente;
  cada mueble puede tener su excepción sin tocar el resto. La ficha del
  mueble muestra el **agarre efectivo y de dónde sale** (heredado del
  proyecto, excepción del mueble o valores congelados de la receta).

**Cómo saber que quedó bien:** la ficha del mueble nombra el estilo y su
procedencia; el despiece y la cotización traen el agarre elegido.

## 8d. SketchUp: llevar el diseño al modelo y publicar la biblioteca

**Para qué sirve:** ver el mueble real en SketchUp, con herrajes, y
entregar el diseño al taller desde ahí.

### 8d.1 Insertar el diseño en SketchUp

1. Instalá la extensión Granete (**Extensions → Abrir Granete**) e iniciá
   sesión con tu cuenta.
2. Abrí **Biblioteca** en el panel: trae los muebles de tu taller.
3. Insertá el mueble: el motor dibuja tableros, herrajes y aperturas.

**Cómo saber que quedó bien:** el footer del panel muestra la versión de la
extensión (`Granete para SketchUp · v…`) y la fila de sesión muestra la
versión **publicada** de la biblioteca (vN) a la que está anclado el panel.

### 8d.2 Aperturas (cajones y puertas que se abren)

Los cajones y las puertas con bisagras traen su cinemática: la tarjeta
**Apertura** del panel permite **Abrir** y **Cerrar** cada mueble (cajones
que salen, puertas que giran con sus bisagras). Es la misma receta que
cotiza — si el cajón abre en SketchUp, el despiece coincide.

**Cómo saber que quedó bien:** al abrir y cerrar, el cajón sale entero (con
su frente y su jaladera) y la puerta gira por sus bisagras — sin piezas
sueltas ni restos.

### 8d.3 Publicar una release y actualizar la biblioteca

**Para qué sirve:** los cambios de catálogo (herrajes nuevos, recetas,
grupos) no llegan solos a SketchUp: hay que **publicar** la versión, y el
panel se actualiza solo a esa versión publicada.

**Pasos:**

1. En la web, en la sección de catálogos, publicá la nueva versión del
   borrador de biblioteca (el botón dice «Publicar vX.Y.Z»).
2. En SketchUp, reiniciá SketchUp (cerrá y abrí de nuevo la aplicación): al
   arrancar de nuevo, el panel se actualiza **solo** a la última versión
   publicada. Sin conexión, el panel sigue con la versión anterior
   que tenía anclada — los diseños que insertes salen congelados con lo que
   esa versión contiene.

**Cómo saber que quedó bien:** la fila de sesión muestra la versión
publicada nueva (vN) y los herrajes nuevos aparecen al insertar.

> Cada cambio de catálogo exige publicar una versión nueva: SketchUp no ve
> la base de datos viva, ve la versión publicada (excepto el modo
> desarrollo de biblioteca, que es de ingeniería — ver su propia entrada
> cuando esté disponible).

## 9. Producción y Taller

Con la cotización **aceptada**:

1. **Órdenes** (o "Abrir en Producción" desde la cotización): la cola de
   órdenes de trabajo para planta.
2. **Abrir orden**: sala de control con pestañas especializadas:
   - **Resumen:** checklist técnico "listo para cortar" y totales de fábrica.
   - **Piso:** modo paperless para taller; escaneo continuo de piezas y módulos con lector USB, cámara o teclado para avanzar de estado (`cortado` → `encintado` → `armado` → `embalado`).
   - **Etiquetas:** selector dual para generar e imprimir tanto **Etiquetas de Piezas de Tablero** como **Etiquetas de Muebles / Bultos**, con preview en vivo, descarga ZPL térmico (Zebra) y PDF A4. Tanto el rol `ingeniero` como `produccion` pueden imprimirlas.
   - **Herrajes:** lista de compras y herrajes por mueble.
   - **Documentos:** pack ZIP maestro de producción (incluye Optimizer, herrajes, elevaciones, hojas de armado, cut-list CSV configurable y etiquetas de piezas y bultos).
   - Las vistas técnicas (Módulos, Despiece, Vistas/Elevaciones, Optimización) viven en **Ingeniería**; el **Control de Carga** (checklist de bultos para el flete con escaneo y % de carga — bloquea la salida hasta que el 100% esté a bordo) vive en **Embarques**, con el botón "Ver control de carga" desde la obra.
3. El banner de la orden avisa si el diseño cambió después del último pack.

## 10. Vitrina y clientes

- **Vitrina:** catálogo comercial por fotos, sin costos, para mostrar al
   cliente. Desde el detalle: "Usar en cotización".
- **Clientes:** lista con búsqueda; los vendedores ven su cartera según
   titularidad.

## 11. Administración

- **Usuarios** (solo admin): aprobar registros, asignar roles, desactivar.
- **Ajustes:** margen/MO/moneda defaults, y si el vendedor ve costos.

## 11b. Modo dev de biblioteca en SketchUp (sólo ingeniería)

**Quién:** administración e ingeniería. **Dónde:** SketchUp → menú
Extensiones → «Granete: alternar modo dev de biblioteca (borrador)» (en
SketchUp 2026 puede quedar dentro del submenú Granete).

**Para qué sirve.** Normalmente SketchUp trabaja con la **biblioteca
publicada**: lo último que se publicó como versión (release). Cada cambio de
catálogo — un herraje, una receta, un grupo — recién llega a SketchUp cuando
se publica una versión nueva y se sincroniza. El modo dev saltea ese paso:
con el modo encendido, SketchUp usa el **catálogo tal como está ahora**, con
los cambios sin publicar. Es para probar mientras armás el catálogo, sin
publicar una versión por cada ajuste.

**Cómo se usa.**

1. Elegí el ítem del menú. Un cartel confirma «Modo dev de biblioteca: ON».
2. Hacé tus cambios en el catálogo web y volvé a insertar el mueble en
   SketchUp: sale con lo que acabás de cambiar.
3. Cuando el catálogo quedó bien, **publicá una versión** y apagá el modo
   con el mismo ítem del menú («Modo dev de biblioteca: OFF»).

**Cómo saber si está encendido.** En el panel de Granete, en la tarjeta de tu
sesión, la fila Biblioteca dice **«Modo desarrollo»** en lugar del número de
versión.

**Quién puede.** Sólo usuarios con rol de administración o ingeniería. Si no
tenés ese rol, el menú responde «El modo dev de biblioteca es sólo para
administración e ingeniería. No se cambió nada.», y — mientras el taller
tenga una versión publicada — el servidor también rechaza resolver contra
el catálogo sin publicar.

**Qué tener en cuenta.**

- El modo queda guardado **en la computadora**, no en la cuenta. Si lo dejás
  encendido y después entra alguien sin permiso, Granete lo apaga solo, avisa
  y vuelve a la biblioteca publicada.
- Lo que insertás con el modo encendido sale de un catálogo que **todavía
  puede cambiar**. Usalo para pruebas, no para trabajos que van a producción.
- Mientras está encendido no se sincroniza la biblioteca publicada. Al
  apagarlo, SketchUp vuelve a la última versión que tenía sincronizada y se
  pone al día la próxima vez que lo abrís.
- La web no cambia: las vistas previas de la web siempre usan el catálogo
  actual.

## 12. Tips rápidos

- Duplicá cotizaciones y muebles en vez de arrancar de cero.
- El buscador `Cmd/Ctrl + K` llega a todo.
- En Proyectar, "Sacar del plano" no borra el mueble de la cotización.
- Todo lo que desactivás se puede reactivar: no hay que borrar para ordenar.
