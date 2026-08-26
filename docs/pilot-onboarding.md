# Granete — Guía de Onboarding de Talleres Piloto

> **Manual operativo de habilitación de clientes y talleres (F174 / #412).**
> Paso a paso para dar de alta una nueva organización, configurar su catálogo, invitar al equipo de carpintería y comenzar la primera cotización y producción.

---

## 1. Flujo General de Alta de un Taller

```text
[1. SuperAdmin]
Crea Organización en /platform ──> Clona Catálogo Base ──> Genera Invitación de Dueño
                                                                     │
[2. Dueño del Taller] <──────────────────────────────────────────────┘
Abre Enlace de Invitación ──> Define Contraseña ──> Ingresa al Taller
         │
         ├──> [3. Configuración Inicial] Ajusta Moneda, Márgenes, Estrategia Guillotina
         ├──> [4. Invitación de Equipo] Vendedores, Diseñadores, Operarios, Carpinteros
         ├──> [5. Asignación de Estaciones] Corte, CNC, Canteado, Armado, Almacén
         └──> [6. Primera Obra] Diseño 3D en Proyectar ──> Cotización PDF/WhatsApp ──> Producción
```

---

## 2. Paso a Paso Detallado

### Paso 1: Creación de la Organización y Clonación de Catálogo (SuperAdmin)

1. Inicia sesión como SuperAdmin y dirígete a **Plataforma** (`/platform`).
2. En la pestaña **Organizaciones**, haz clic en **"+ Nueva Organización"**.
3. Completa los datos:
   - **Nombre**: Nombre comercial del taller (ej. *Carpintería Roble Alto*).
   - **Slug**: Identificador único URL (ej. *roble-alto*).
   - **Catálogo Inicial**:
     - *Clonar catálogo base*: Crea una copia completa e independiente de tableros, cantos, herrajes y módulos plantilla para que el taller pueda personalizar sus propios precios sin afectar a nadie más.
     - *Vacío*: Para talleres que desean cargar su catálogo desde cero.
4. Haz clic en **"Crear Organización"**.

### Paso 2: Invitar al Dueño del Taller

1. Dentro de `/platform`, dirígete a la pestaña **Usuarios Globales** o dentro del menú del taller haz clic en **"Invitar Administrador"**.
2. Ingresa el correo electrónico del dueño del taller y asigna el rol `admin`.
3. El sistema generará un enlace seguro de invitación con token:
   - Haz clic en **"Copiar enlace para WhatsApp"** o envíaselo por correo.
   - El enlace tiene la forma: `https://app.granete.io/accept-invitation?token=inv_...`

### Paso 3: Aceptación y Registro del Dueño

1. El dueño abre el enlace de invitación en su navegador o teléfono móvil.
2. Si es su primera vez en la plataforma, ingresa su **Nombre completo** y crea su **Contraseña**.
3. Al hacer clic en **"Aceptar y Entrar"**, ingresa automáticamente al workspace de su taller con rol de Administrador.

### Paso 4: Ajustes del Taller (Workshop Settings)

En el menú lateral, dirígete a **Ajustes** (`/settings`):
- **Moneda**: Configura la moneda de cotización predeterminada (ej. `MXN`, `USD`, `BRL`, `UYU`).
- **Factor de Margen**: Margen comercial por defecto (ej. `1.35` para 35% de margen).
- **Costo Fijo de Mano de Obra**: Tarifa base estándar por proyecto.
- **Estrategia de Corte**: Preferencia del optimizador de corte (Guillotina por longitud o guillotine transversal).
- **Límites de Desperdicio y Espesores de Hoja de Sierra**: Configura el kerf de disco (ej. 3.2 mm o 4.0 mm).

### Paso 5: Invitar al Equipo y Asignar Roles

Dirígete a **Equipo** (`/team` o `/users`):
1. Haz clic en **"+ Invitar Miembro"**.
2. Ingresa el correo y marca los roles apropiados:
   - **Vendedor (`vendedor`)**: Crea clientes, elabora presupuestos, negocia y comparte cotizaciones PDF/WhatsApp.
   - **Diseñador (`disenador`)**: Modela en Proyectar 3D, ajusta medidas y herrajes, genera planos y despieces.
   - **Ingeniero (`ingeniero`)**: Revisa factibilidad técnica, asigna perfiles de máquina y valida log de ingeniería.
   - **Encargado de Almacén (`almacen`)**: Controla stock de tableros, cantos y herrajes, recepciona órdenes de compra y libera materiales.
   - **Operario de Taller / Carpintero (`carpintero`)**: Utiliza las pantallas de taller para registrar avance de piezas (Corte, Canteado, CNC, Armado y Control de Calidad).
   - **Instalador (`instalador`)**: Gestiona visitas en obra, verificación de medidas en sitio y checklist de entrega final.
3. Asigna las **Estaciones Físicas** a cada operario para que su interfaz se adapte al puesto de trabajo que ocupa en la planta.

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
4. Se inicia una sesión temporal auditada con un banner superior visible.
5. Al finalizar la asistencia, hace clic en **"Salir del soporte"** para regresar a la consola de plataforma sin dejar sesiones abiertas.
