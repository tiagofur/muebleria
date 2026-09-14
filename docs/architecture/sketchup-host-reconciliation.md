# SketchUp Host Reconciliation — Design Working Copy vs archivo SKP

> **Estado:** IMPLEMENTADO — reconciliación, restauración individual, save-awareness y gates fail-closed
> **Ámbito:** Granete for SketchUp, Design Working Copy, FurnitureInstance, cotización design-first
> **Relacionados:** Project Design Digital Thread, #388, #389, #390, #391, #702, #718, #679

## 1. Problema

Granete mantiene correctamente la intención de diseño en el servidor antes de que el archivo `.skp` sea necesariamente guardado en disco.

Caso reproducible:

1. abrir un Design conectado en SketchUp;
2. colocar y confirmar tres muebles;
3. cada confirmación sincroniza sus `FurnitureInstance` al `DesignWorkingCopy`;
4. cerrar SketchUp y descartar/no guardar los cambios del archivo;
5. reabrir el `.skp` anterior.

El servidor conserva los tres items del Working Copy, pero el archivo local no contiene sus entidades. Si la UI deriva `placed` únicamente de la presencia del `furnitureInstanceId` en el Working Copy, muestra falsamente esos módulos como ya colocados.

Esto no es pérdida de identidad empresarial: el servidor conserva la intención. Es una divergencia entre **intención de diseño server-side** y **presencia física en el host abierto**.

## 2. Tres verdades que no deben confundirse

Para cada `FurnitureInstance` existen tres preguntas distintas:

1. **Project membership** — ¿la instancia activa pertenece al Project?
2. **Design intent** — ¿el `DesignWorkingCopy` contiene un item para esa instancia?
3. **Host presence** — ¿el archivo SKP actualmente abierto contiene exactamente una entidad raíz gestionada con ese `furnitureInstanceId`?

Ninguna implica automáticamente las otras.

En particular:

```text
Working Copy contiene FI-123
≠
este archivo SKP contiene físicamente FI-123
```

La UI nunca debe volver a etiquetar una unidad como `placed` usando sólo la pregunta 2.

## 3. Fuente de identidad y escaneo local

La identidad sigue siendo `FurnitureInstance.id` / `furnitureInstanceId`.

Para comprobar presencia local se reutiliza el escaneo existente de muebles gestionados (`ManagedFurniture.locate`):

- 0 entidades raíz con el ID → ausente del archivo;
- 1 entidad raíz → presencia local única;
- >1 entidades raíz → duplicado local, estado inválido que falla cerrado.

`Sketchup::Entity#persistent_id`, nombre, índice, posición o geometría nunca se usan para deducir identidad empresarial.

## 4. Estados derivados de reconciliación

La lista de módulos debe derivar un estado compuesto usando Project + Working Copy + host scan.

### `unplaced`

```text
FurnitureInstance active
Working Copy: no item
SKP: 0 entities
```

Acción: colocar normalmente.

### `pending_confirmation`

```text
FurnitureInstance active
Working Copy: no item
SKP: exactamente 1 entity
```

La geometría está localmente colocada pero todavía no confirmada al servidor.

Acción: confirmar/cancelar según el flujo actual.

### `present_synced`

```text
FurnitureInstance active
Working Copy: item presente
SKP: exactamente 1 entity
```

Éste es el único estado que la UI puede presentar como **Puesto / Sincronizado**.

### `missing_local`

```text
FurnitureInstance active
Working Copy: item presente
SKP: 0 entities
```

Significa: **“Granete espera este mueble en el diseño, pero falta en este archivo SketchUp.”**

Causas comunes:

- el usuario cerró sin guardar el SKP después de sincronizar;
- abrió una copia/versión antigua del mismo archivo;
- una edición externa eliminó geometría sin sincronizar;
- corrupción o pérdida de metadata local.

Nunca convertir automáticamente este estado a `unplaced` y nunca borrar silenciosamente el Working Copy.

### `duplicate_local`

```text
SKP: >1 entities con el mismo furnitureInstanceId
```

Falla cerrado y deriva al flujo de resolución de duplicados existente.

### `terminal_or_orphan_local`

Una entidad local apunta a una instancia inexistente/removed/cancelled o ajena al binding actual.

No debe tratarse como unidad válida del diseño. Reutilizar las reglas existentes de lifecycle/orphan/duplicate en lugar de inventar identidad nueva.

## 5. Recuperación `missing_local` — Restaurar en este archivo

La acción principal para `missing_local` es:

**Restaurar en este archivo**

La recuperación NO crea una nueva FurnitureInstance y NO vuelve a escribir el Design Working Copy.

Precondiciones server/host:

1. binding exacto sigue válido;
2. FurnitureInstance existe, pertenece al Project y está `active`;
3. Working Copy actual contiene exactamente el item de esa FurnitureInstance;
4. host scan confirma 0 entidades con ese ID;
5. no hay otra mutación del host ni restauración concurrente para esa identidad;
6. la FurnitureDefinition necesaria puede resolverse de forma canónica;
7. parámetros/material choices/transform provienen del item exacto del Working Copy.

Flujo conceptual:

```text
Working Copy item FI-123
      ↓ read authoritative item
resolve canonical furniture/layout
      ↓
insert local SketchUp entity
      ↓
stamp SAME furnitureInstanceId = FI-123
      ↓
apply exact transform/material choices/parameters
      ↓
readback host scan == exactly 1
      ↓
present_synced
```

El servidor ya contiene la intención correcta, por lo que esta operación es **local rehydration**, no una nueva mutación comercial/design del servidor.

Antes de insertar se repiten las lecturas de binding, FurnitureInstance, Working Copy y host; después se verifica
la metadata exacta y que exista una sola raíz. Si cualquiera de esas autoridades cambia durante la operación,
se revierte únicamente la raíz recién insertada. Un retry que encuentra una raíz exacta ya válida es un no-op
`present_synced`, nunca crea una copia.

Si la inserción local falla, el Working Copy permanece intacto y el estado continúa `missing_local`.

## 6. Nunca auto-borrar el servidor al abrir un SKP antiguo

Cuando Working Copy contiene una unidad y el archivo no, Granete no puede asumir que la intención correcta es eliminarla del diseño.

El archivo puede ser simplemente una copia anterior.

Por tanto está prohibido:

```text
open SKP
→ entity missing
→ auto-delete Working Copy item
```

Una futura acción explícita “Quitar del diseño” puede reutilizar el lifecycle/sync normal, pero debe ser una intención consciente del usuario y no forma parte de la recuperación automática.

## 7. Gates comerciales y de publicación

Un diseño con cualquiera de estos estados:

- `missing_local`;
- `duplicate_local`;
- `pending_confirmation`;
- identidad local incompatible;

NO está visualmente reconciliado.

Por tanto debe fallar cerrado para acciones que prometen una representación coherente del diseño, incluyendo como mínimo:

- `Emitir cotización` design-first;
- publicación de DesignRevision / manifest cuando aplique;
- cualquier future production/release preflight que dependa del modelo visible.

El mensaje debe explicar el número de unidades que requieren resolución, por ejemplo:

> “Granete espera 3 muebles que no están presentes en este archivo. Restauralos o resolvé la divergencia antes de emitir la cotización.”

No basta con que CommercialProjection sea `current`: la proyección comercial prueba la verdad server-side, no la presencia de la geometría en el host.

## 8. Prevención — estado de guardado del archivo

La recuperación anterior es obligatoria incluso si añadimos prevención, porque el usuario puede abrir una copia antigua.

Además, Granete debe hacer visible cuando el servidor ya recibió cambios que todavía necesitan quedar durables en el archivo local.

Después de una confirmación/sync exitosa que modifica el modelo:

- mostrar estado `Cambios en Granete · guardá el archivo SketchUp` mientras el modelo permanezca modificado/no confirmado como guardado;
- limpiar el aviso únicamente desde `Sketchup::ModelObserver#onPostSaveModel(model)`, después de un save real;
- no afirmar “todo guardado” por el mero éxito del PUT server-side.

El estado vive sólo en memoria y queda ligado al objeto modelo y al snapshot completo de su binding. El observer
permanece activo aunque el diálogo esté cerrado; el único `AppLifecycleObserver` de la extensión lo vuelve a
enlazar al crear, abrir o activar otro modelo, sin polling. Una mutación sincronizada posterior vuelve a mostrar
el aviso.

No se requiere impedir programáticamente que el usuario cierre SketchUp. SketchUp puede seguir mostrando su diálogo nativo de guardar/cancelar/no guardar; Granete añade claridad y recuperación segura si el usuario elige no guardar.

## 9. Reconciliación al abrir/refrescar

Al conectar, reabrir o refrescar un Design, construir un `HostReconciliation` para el Project/Design exactos:

```text
server FurnitureInstances
+ exact DesignWorkingCopy
+ scan de entidades raíz gestionadas en el SKP activo
= per-instance reconciliation state
```

La reconciliación debe ser determinista y side-effect free hasta que el usuario elija una acción de recuperación.

No depende de #679. El futuro event-driven sync puede disparar nuevos refresh/reconciliations, pero no sustituye el host scan.

## 10. UX propuesta

En la lista de módulos:

```text
Base 2 puertas      Puesto
Alacena 80          Falta en este archivo   [Restaurar]
Cajonera 3 cajones  Falta en este archivo   [Restaurar]
Torre horno         Pendiente confirmar
```

`Restaurar todos` es una mejora opcional posterior, no parte del DoD central. Si se implementa en otro cambio,
sólo podrá procesar items `missing_local` que pasen todos los guards y deberá reportar parciales sin ocultarlos.

## 11. Pruebas mínimas

### Reproducción exacta del bug

1. Working Copy contiene FI-A/FI-B/FI-C.
2. Modelo reabierto no contiene ninguna de esas entidades.
3. La lista muestra las tres como `missing_local`, nunca `already_placed`.

### Restauración

- restore FI-A mantiene el mismo `furnitureInstanceId`;
- usa parámetros/materiales/transform del Working Copy;
- no crea FurnitureInstance;
- no ejecuta PUT del Working Copy;
- scan posterior encuentra exactamente 1;
- doble click/retry no crea duplicado.

### Guards

- >1 entidad → duplicate y no restore;
- FurnitureInstance terminal → fail closed;
- binding cambia durante restore → descartar/fallar;
- Working Copy cambia antes de restore → refetch/conflict;
- definition unavailable → `recovery_blocked`, servidor intacto.

### Comercial/publicación

- `missing_local` bloquea Emitir cotización antes de llamar #717;
- al restaurar individualmente los faltantes y reconciliar limpio, Q1 vuelve a habilitarse;
- CommercialProjection server-side no se altera por la restauración local.

### Save awareness

- confirmación server-side + modelo modificado → aviso de guardado;
- save real → aviso limpiado;
- reopen de archivo anterior → reconciliación detecta la divergencia aunque no exista checkpoint local reciente.

## 12. Invariantes

1. El servidor no interpreta ausencia de geometría local como intención de borrado.
2. Recuperar no crea business identity nueva.
3. Sólo `present_synced` equivale a “Puesto”.
4. Working Copy y SKP pueden divergir temporalmente, pero la divergencia es visible y bloquea decisiones que requieren coherencia visual.
5. El `.skp` sigue sin ser la fuente de verdad empresarial; el host scan sólo prueba presencia local.
6. No se necesita parsear el binario SKP en backend.
7. #679 puede mejorar frescura, pero esta reconciliación sigue siendo necesaria incluso con sync event-driven.
