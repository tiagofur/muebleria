# ODD — #784: Autodescubrimiento de roles y asignación de defaults iniciales

- Issue: #784 (`[P1][SU-UX-4] Design defaults, inheritance and contextual Inspector`).
- Autorización: prompt del owner 2026-09-30 ("planeamos... separamos en partes y hacemos nuestros planes de G-ODD").
- Lane: ODD. Estado: COMPLETED.
- Base: `main` (`29b5fa84`).
- Branch: `feat/784-role-discovery-empty-defaults`.

## 1. Contexto y Problema

Cuando el Inspector no tiene nada seleccionado y el modelo está vinculado a un diseño, se activa el **Design Inspector** para configurar acabados globales.

Sin embargo, si el diseño no tiene defaults configurados previamente en el backend (`authoringDefaults.materialChoices = {}`):
1. `renderBody()` en `granete-design-inspector.js` itera exclusivamente sobre `Object.keys(state.defaults)`. Al estar vacío, solo muestra el texto *"Sin defaults configurados todavía"*, sin filas, sin botones y sin forma de configurar ningún rol por primera vez (callejón sin salida / dead end).
2. En `dialog.html`, el badge del card tiene hardcodeado `<span class="status-badge pending">Lectura</span>` heredado de la fase R1, lo cual es falso y confunde al usuario haciéndole creer que la pantalla es de solo lectura.

## 2. Objetivo

1. **Eliminar el badge engañoso "Lectura"** en el card del Design Inspector.
2. **Autodescubrir los roles disponibles:**
   - De los muebles ya presentes en el diseño (`state.inheritanceSummary` / `inheritanceItems`).
   - De las definiciones de la biblioteca de catálogo activa (`window.GraneteUI.library.getDefinitions()`).
3. **Renderizar roles sin default asignado:**
   - Mostrar el rol (ej. *Frentes*, *Estructura*, etc.).
   - Estado: *"Sin default asignado"* en lugar de ocultar la fila.
   - Botón **`[Asignar]`** o **`[Configurar]`** que abre el selector de materiales de Granete (`openMaterialPicker`).
4. **Permitir la asignación inicial:**
   - Al elegir un material, se registra en `state.draft[role]`.
   - Se muestra el footer con **`[Descartar]`** y **`[Aplicar]`**.
   - Al hacer clic en **Aplicar**, se ejecuta `applyDraft()` -> `apply_design_defaults` al backend, persistiendo el default y habilitando el botón posterior de *Rollout* ("Aplicar a muebles existentes…").

---

## 3. Tareas Técnicas

- [x] **T1. Limpieza de UI en `dialog.html`:**
  - Remover el badge estático `<span class="status-badge pending">Lectura</span>` y cambiar a `<span class="status-badge">General</span>`.
- [x] **T2. Inyección de descubrimiento de roles en `dialog.html`:**
  - En la inicialización de `window.GraneteUI.designInspector.init`, exponer un helper `getAvailableRoles()` que extraiga la lista unificada de roles desde el catálogo activo.
- [x] **T3. Lógica de autodescubrimiento en `granete-design-inspector.js`:**
  - Crear función `discoveredRoles()` que unifique los roles de `state.defaults`, `state.draft`, `state.inheritanceSummary` y los roles del catálogo (`deps.getAvailableRoles`).
  - Actualizar `renderBody` para iterar sobre esa lista combinada.
  - Para roles sin default fijado ni borrador, renderizar valor con estilo atenuado (*"Sin default asignado"*) y botón `[Asignar]`.
- [x] **T4. Suite de pruebas JS (`test/js/granete_design_inspector_test.js`):**
  - Caso 1: Diseño sin defaults pero con roles en catálogo -> se renderizan las filas con *"Sin default asignado"* y botón `[Asignar]`.
  - Caso 2: Asignar un rol vacío genera borrador local, activa footer `[Aplicar]` y actualiza la vista.
  - Caso 3: Diseño sin defaults pero con muebles en `inheritanceSummary` -> incluye los roles de los muebles.
  - Caso 4: Descartar borrador devuelve el rol a *"Sin default asignado"*.
- [x] **T5. Verificación proporcional:**
  - Ejecutar suite Node.js de pruebas de la extensión (32 suites de test JS pasando).
  - Comprobación de integridad con Ruby unit tests (`design_inspector_bridge_test.rb`, `granete_design_inspector_js_test.rb`).
  - RuboCop 283 archivos sin ofensas.

---

## 4. Criterios de Aceptación y Evidencia

1. [x] Al abrir el Inspector con un diseño conectado que no tiene defaults previos, se listan los roles pertinentes en vez de quedar en un mensaje estático sin opciones.
2. [x] Cada rol sin default ofrece un botón para seleccionar un material del catálogo (`[Asignar]`).
3. [x] El badge "Lectura" ya no se muestra de forma engañosa (reemplazado por "General").
4. [x] Toda la suite de pruebas unitarias existente continúa pasando sin regresiones (44 tests en `granete_design_inspector_test.js`, 100% suites JS y Ruby pasando).

