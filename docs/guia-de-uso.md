# Guía de uso — Muebles

> Manual para el usuario final del taller: vendedores, ingeniería, producción
> y administración. Paso a paso, sin jerga de código. Para setup técnico ver
> `README.md`; para reglas de producto ver `docs/prd.md`.

---

## 1. ¿Qué es Muebles?

Muebles es el sistema del taller para **cotizar, diseñar y producir** mobiliario
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

Roles y qué ven:

| Rol | Para quién | Qué hace |
|-----|-----------|---------|
| Admin | dueño / sistemas | todo + usuarios + ajustes |
| Ingeniero | técnica | catálogos, muebles, estructuras, acabados |
| Vendedor | comercial | cotizaciones, clientes, vitrina (costos según config) |
| Producción | fábrica | cola y órdenes de producción |
| Gerente de ventas | comercial | cotizaciones + dashboard |

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
   ven en el 3D.
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
click para **ver**, botón **Editar** para el modal, **Desactivar** para sacar
sin perder historia.

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

## 9. Producción

Con la cotización **aceptada**:

1. **Producción** (o "Abrir en Producción" desde la cotización): la cola de
   órdenes.
2. **Abrir orden**: hub con Resumen, Módulos, Piso (avance de fábrica),
   Despiece, Herrajes, Vistas, Optimización y Documentos.
3. **Documentos** concentra los exports: pack completo (Optimizer +
   etiquetas + hojas de armado + elevaciones), plan de corte oficial
   (Optimizer), listas de herrajes, etiquetas, etc.
4. El banner de la orden avisa si el diseño cambió después del último pack.

## 10. Vitrina y clientes

- **Vitrina:** catálogo comercial por fotos, sin costos, para mostrar al
   cliente. Desde el detalle: "Usar en cotización".
- **Clientes:** lista con búsqueda; los vendedores ven su cartera según
   titularidad.

## 11. Administración

- **Usuarios** (solo admin): aprobar registros, asignar roles, desactivar.
- **Ajustes:** margen/MO/moneda defaults, y si el vendedor ve costos.

## 12. Tips rápidos

- Duplicá cotizaciones y muebles en vez de arrancar de cero.
- El buscador `Cmd/Ctrl + K` llega a todo.
- En Proyectar, "Sacar del plano" no borra el mueble de la cotización.
- Todo lo que desactivás se puede reactivar: no hay que borrar para ordenar.
