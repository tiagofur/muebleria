# Granete — Guía de Onboarding de Talleres Piloto

> **Manual operativo de habilitación de clientes y talleres (F174 / #412).**
> Paso a paso para dar de alta una nueva organización, configurar su catálogo, invitar al equipo de carpintería y comenzar la primera cotización y producción.

---

## 1. Flujo General de Alta de un Taller

```text
[1. SuperAdmin]
Crea Organización en /platform ──> Clona Catálogo Base ──> "Entrar a taller"
(sesión de soporte auditada) ──> Invita al Dueño con rol Admin ──> Sale del soporte
                                                                     │
[2. Dueño del Taller] <──────────────────────────────────────────────┘
Abre Enlace de Invitación ──> Define Contraseña ──> Ingresa al Taller
         │
         ├──> [3. Configuración Inicial] Ajusta Moneda, Márgenes, Estrategia Guillotina
         ├──> [4. Invitación de Equipo] Vendedor, Ingeniero, Gerentes, Producción, Almacén
         ├──> [5. Asignación de Estaciones] Corte, CNC, Encintado, Armado, Embalaje,…
         └──> [6. Primera Obra] Diseño 3D en Proyectar ──> Cotización PDF/WhatsApp ──> Producción
```

### Roles del sistema (referencia rápida)

La aplicación sólo acepta los **8 roles canónicos** de `contracts/roles.json`
(validados por TS, Go y la base de datos; cualquier otro identificador es
rechazado). Éstos son los que se ofrecen al asignar:

| Rol (identificador) | Etiqueta en pantalla | Qué hace |
|---|---|---|
| `admin` | Admin | Dueño/gestión del taller: equipo, ajustes y todo el tablero. |
| `user` | Sin puesto | Acceso básico sin área asignada. |
| `vendedor` | Vendedor | Clientes, presupuestos y cotizaciones. |
| `gerente_ventas` | Gerente de ventas | Supervisa ventas y cierres comerciales. |
| `gerente_produccion` | Gerente de producción | Planifica la planta, avances y métricas de taller. |
| `ingeniero` | Ingeniero | Diseño 3D en Proyectar, catálogo técnico y planos. |
| `produccion` | Producción | Operarios de planta: registro de avance por estación. |
| `almacen` | Almacén | Stock de materiales, picking y despacho. |

Nombres de taller que **no** existen como rol y su equivalente canónico:

- **Diseñador / proyectista** → asigná `ingeniero`.
- **Operario / carpintero** → asigná `produccion` (+ sus estaciones, paso 5).
- **Encargado de almacén** → asigná `almacen` (+ sectores de materiales).
- **Instalador** → hoy no existe como rol; la pantalla Instalaciones la trabajan
  `produccion` y `gerente_produccion`.
- **Supervisor** → es una capacidad (override auditado de QC/armado), no un rol;
  la ejercen `admin` y los gerentes.

En talleres comerciales (tipo *Tienda comercial* o *Distribuidor*) el sistema
sólo acepta roles comerciales (`admin`, `user`, `vendedor`, `gerente_ventas`);
el backend rechaza cualquier otro.

---

## 2. Paso a Paso Detallado

### Paso 1: Creación de la Organización y Clonación de Catálogo (SuperAdmin)

1. Inicia sesión como SuperAdmin y dirígete a **Plataforma** (`/platform`).
2. En la pestaña **Organizaciones**, haz clic en **"+ Nueva Organización"**.
3. Completa los datos:
   - **Nombre del Taller / Negocio**: Nombre comercial del taller (ej. *Carpintería Roble Alto*).
   - **Slug**: Identificador único URL (ej. *roble-alto*).
   - **Tipo de Organización**: Fábrica / Taller, Tienda comercial o Distribuidor.
   - **Plan de Licencia** (y vencimiento opcional): Trial / Pro / Sin licencia.
   - **Clonar catálogo base desde (opcional)**: Crea una copia completa e
     independiente de tableros, cantos, herrajes y módulos plantilla para que el
     taller personalice sus propios precios sin afectar a nadie más. Dejar en
     *"-- Sin clonar (catálogo vacío) --"* para cargar el catálogo desde cero.
4. Haz clic en **"Crear Organización"**.

### Paso 2: Invitar al Dueño del Taller (vía sesión de soporte)

La consola de plataforma no emite invitaciones directamente: las invitaciones
pertenecen al taller y requieren sesión de administrador del taller. Para
invitar al dueño de un taller recién creado, el SuperAdmin entra temporalmente:

1. En `/platform` → pestaña **Organizaciones**, ubica la fila del taller nuevo y
   haz clic en **"Entrar a taller"**.
2. Escribí el **Motivo del acceso** (ej. *Alta de taller piloto — invitación al
   dueño*) y confirma con **"Iniciar Sesión y Entrar"**. Se abre una sesión de
   soporte auditada de 2 horas con rol de administrador efectivo; todas las
   acciones quedan registradas con tu usuario real y un banner superior visible.
3. Ya dentro del taller, dirígete a **Usuarios** (`/users`) y haz clic en
   **"+ Invitar Miembro"**.
4. Ingresá el correo del dueño y marcá únicamente el rol **Admin**.
5. Al generar la invitación, el sistema muestra **una sola vez** el enlace
   seguro: cópialo con **"Copiar enlace para WhatsApp"** o envíalo por correo.
   El enlace tiene la forma `https://app.granete.io/accept-invitation?token=<código>`.
6. Cerrá tu intervención con **"Salir del soporte"** en el banner superior para
   regresar a la consola sin dejar sesiones abiertas.

> El primer administrador también puede asignarse por CLI en instalaciones
> administradas (`go run ./cmd/admin create-org --name … --slug … --admin-email …`),
> pero ese comando exige un usuario ya existente; para pilotos usá el flujo de
> invitación anterior.

### Paso 3: Aceptación y Registro del Dueño

1. El dueño abre el enlace de invitación en su navegador o teléfono móvil.
2. Si es su primera vez en la plataforma, ingresa su **Nombre completo** y crea su **Contraseña** (mínimo 8 caracteres).
3. Al hacer clic en **"Aceptar invitación y entrar"**, ingresa automáticamente al workspace de su taller con rol Admin.

### Paso 4: Ajustes del Taller (Workshop Settings)

En el menú lateral, dirígete a **Ajustes** (`/settings`):
- **Moneda**: Configura la moneda de cotización predeterminada (ej. `MXN`, `USD`, `BRL`, `UYU`).
- **Factor de Margen**: Margen comercial por defecto (ej. `1.35` para 35% de margen).
- **Costo Fijo de Mano de Obra**: Tarifa base estándar por proyecto.
- **Estrategia de Corte**: Preferencia del optimizador de corte (Guillotina por longitud o guillotine transversal).
- **Límites de Desperdicio y Espesores de Hoja de Sierra**: Configura el kerf de disco (ej. 3.2 mm o 4.0 mm).

### Paso 5: Invitar al Equipo y Asignar Roles

El dueño (u otro Admin) dirígete a **Usuarios** (`/users`):
1. Haz clic en **"+ Invitar Miembro"**.
2. Ingresa el correo y marca los roles apropiados — sólo los 8 de la tabla de
   referencia rápida de la sección 1; el sistema rechaza cualquier otro:

   - **Vendedor (`vendedor`)**: Crea clientes, elabora presupuestos, negocia y comparte cotizaciones PDF/WhatsApp.
   - **Ingeniero (`ingeniero`)**: Modela en Proyectar 3D, ajusta medidas y herrajes, revisa factibilidad técnica y genera planos y despieces.
   - **Gerente de ventas (`gerente_ventas`)**: Supervisa el pipeline comercial y aprueba cierres.
   - **Gerente de producción (`gerente_produccion`)**: Planifica la producción, asigna perfiles de máquina y controla el avance de taller.
   - **Producción (`produccion`)**: Utiliza las pantallas de taller para registrar avance de piezas (Corte, CNC, Encintado, Armado, Embalaje) y control de calidad.
   - **Almacén (`almacen`)**: Controla stock de tableros, cantos y herrajes, recepciona órdenes de compra y libera materiales.
   - **Admin (`admin`)**: Gestión completa del taller (asignar con moderación).
   - **Sin puesto (`user`)**: Acceso básico sin área asignada.

   Una misma persona puede tener **varios roles a la vez** (ej. Vendedor +
   Ingeniero en talleres chicos): las capacidades se combinan por unión de
   permisos (ADR-0005).
3. **Estaciones Físicas**: los miembros con rol **Producción** o **Almacén**
   pueden además recibir estaciones/sectores (botón **"Estaciones"** en su
   fila) para que su interfaz se adapte al puesto que ocupan en la planta:
   - `produccion` → Corte, CNC, Encintado, Armado, Embalaje, Despacho, Instalación y sectores de almacén.
   - `almacen` → Herrajes, Tableros, Cintillas.

### Paso 6: Ejecución de la Primera Obra Piloto

1. **Crear Cliente y Proyecto**:
   - Ir a **Proyectos** -> **"+ Nuevo Proyecto"**.
   - Asignar el cliente y nombre de la obra (ej. *Cocina Moderna Depto 402*).
2. **Diseño en Proyectar 3D**:
   - Insertar módulos desde la biblioteca paramétrica.
   - Ajustar dimensiones, tiradores, bisagras y acabados.
3. **Cotización Comercial**:
   - Revisar el desglose de costos de materiales, cantos, herrajes y mano de obra.
   - Exportar cotización en PDF o generar mensaje preformateado para WhatsApp con un clic.
4. **Liberación a Producción**:
   - Al aceptar el cliente, cambiar estado a `Aceptado`.
   - Generar plan de corte 2D e imprimir etiquetas con código QR por pieza.
   - Registrar el progreso pieza a pieza en las estaciones de taller hasta el empaque e instalación final.

---

## 3. Soporte en Vivo a Talleres (Sesiones de Soporte)

Si un taller solicita asistencia técnica o resolución de dudas sobre un proyecto:
1. El SuperAdmin accede a `/platform` -> pestaña **Organizaciones**.
2. En la fila del taller correspondiente, hace clic en **"Entrar a taller"**.
3. Define el motivo de soporte (ej. *Asistencia en nesting de módulo especial*).
4. Se inicia una sesión temporal auditada de 2 horas con un banner superior visible.
5. Al finalizar la asistencia, hace clic en **"Salir del soporte"** para regresar a la consola de plataforma sin dejar sesiones abiertas.
