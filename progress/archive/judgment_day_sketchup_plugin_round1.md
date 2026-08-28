# Judgment Day — Granete for SketchUp (ronda 1)

**Estado:** 🏁 **100% COMPLETADO** — 23 de 23 ítems resueltos y verificados  
**Fecha:** 2026-08-25  
**Rama:** `main`  
**Alcance:** 101 archivos versionados del plugin, integración de catálogo/layout, contratos de dominio y documentación canónica.

---

## Resumen de Progreso de Correcciones

| Bloque | Total | Terminados | Pendientes |
|---|---:|---:|---:|
| **Críticos confirmados** (`JD-SU-001` a `JD-SU-005`) | 5 | 5 | 0 |
| **Críticos sospechosos** (`JD-SU-006` a `JD-SU-007`) | 2 | 2 | 0 |
| **Contradicciones de severidad** (`JD-SU-008` a `JD-SU-010`) | 3 | 3 | 0 |
| **Backlog e información** (`JD-SU-011` a `JD-SU-023`) | 13 | 13 (`JD-SU-011` al `JD-SU-023`) | 0 |
| **Total** | **23** | **23** | **0** |

---

## Ledger de Hallazgos y Estado de Resolución

### 1. Críticos confirmados por ambos jueces

| ID | Ubicación principal | Hallazgo | Estado | Detalle de la resolución |
|---|---|---|:---:|---|
| **JD-SU-001** | `resources/material_selector.html:755-757` | El selector usa `id`, pero producción entrega `materialId`. No rehidrata la selección vigente y Aplicar termina enviando `undefined`. | ✅ **TERMINADO** | Normalizado `(mat.materialId \|\| mat.id)` y `(mat.grain \|\| mat.grainDefault)`. Rehidratación bidireccional probada y verificada. |
| **JD-SU-002** | `resources/dialog.html:3124` | El selector ofrece alcance “Valor por defecto de la obra”, pero el callback ignora `payload.scope`. | ✅ **TERMINADO** | Implementada Opción B (alcance en memoria de sesión `projectDefaultMaterials`). Los nuevos muebles insertados en la sesión heredan el acabado por defecto del rol. |
| **JD-SU-003** | `ui/dialog_controller.rb:117` | Si no encuentra el `instanceId`, cae en `selection.first`; el builder limpia y reconstruye potencialmente otro grupo. | ✅ **TERMINADO** | Eliminado el fallback inseguro a `selection.first`. Si no coincide la entidad exacta, la actualización falla de forma cerrada con mensaje explicativo. |
| **JD-SU-004** | `library/catalog_provider.rb:327` | Los errores de layout remoto se convierten en `nil`; insert/update usan layout genérico y degradan geometría. | ✅ **TERMINADO** | Creada `LayoutResolutionError`. Errores HTTP 401/403/422/500 detienen la mutación de forma fail-closed y notifican el error al diálogo sin destruir el modelo con cajas. |
| **JD-SU-005** | `resources/material_selector.html:832` | Datos del catálogo entran en `innerHTML` sin escape dentro de un HtmlDialog con token Bearer. | ✅ **TERMINADO** | Implementadas funciones de escape HTML (`escapeHtml`), validación estricta de color (`sanitizeColor`) y sanitización de URLs (`sanitizeUrl`) en todas las vistas del selector. |

---

### 2. Críticos sospechosos — reportados como severos por un solo juez

| ID | Ubicación | Hallazgo | Estado | Detalle de la resolución |
|---|---|---|:---:|---|
| **JD-SU-006** | `resources/dialog.html:3129` | La ventana flotante no queda vinculada al mueble/contexto que la abrió; un cambio de selección o pestaña puede redirigir el acabado. | ✅ **TERMINADO** | `renderMaterialSelectors` captura el contexto (`inspector` vs `configurator`, `instanceId`, `definitionId`) y `OptionSelectorBridge` lo propaga. Al aplicar, se actualiza la entidad específica independientemente de la selección activa. |
| **JD-SU-007** | `ui/dialog_controller.rb:230-239` | El observer queda ligado al modelo activo al abrir el diálogo y no hay reenganche explícito al cambiar de documento de SketchUp. | ✅ **TERMINADO** | Creado `AppModelObserver < ::Sketchup::AppObserver` con `onNewModel`, `onOpenModel`, `onActivateModel` y método `rebind_model` que reconecta el `SelectionObserver` al nuevo documento y refresca el diálogo. |

---

### 3. Contradicciones de severidad

| ID | Ubicación | Juez A | Juez B | Hallazgo | Estado | Detalle de la resolución |
|---|---|---|---|---|:---:|---|
| **JD-SU-008** | `ui/dialog_controller.rb:170` | CRITICAL | WARNING | El selector ignora `materialRoles.optionIds`, muestra materiales no elegibles y el diálogo puede reemplazarlos silenciosamente. | ✅ **TERMINADO** | `OptionSelectorBridge` extrae `optionIds` de la definición o `allowedMaterialIds` del payload del diálogo y filtra la lista para mostrar únicamente acabados permitidos para ese rol. |
| **JD-SU-009** | `transport/http_adapter.rb:62` | WARNING | CRITICAL | Se permite login por HTTP no-local, exponiendo email, contraseña y tokens en tránsito. | ✅ **TERMINADO** | `HttpAdapter` define `LOCAL_HOSTS` (`localhost`, `127.0.0.1`, `::1`, `*.local`, `*.internal`, `*.localhost`) y fuerza automáticamente `https://` en endpoints remotos no locales. |
| **JD-SU-010** | `resources/material_selector.html:851-858` | WARNING | CRITICAL | Las categorías, breadcrumbs y tarjetas no son operables por teclado; falta navegación direccional y semántica accesible. | ✅ **TERMINADO** | Agregados roles ARIA (`role="button"`, `role="option"`, `aria-pressed`, `aria-selected`, `aria-current`), `tabindex="0"`, focus visible, eventos `Enter`/`Space`, navegación direccional 2D por flechas (`ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`) y atajo `Escape` para cerrar. |

---

### 4. Información y backlog resuelto

| ID | Tipo | Hallazgo | Estado | Detalle de la resolución |
|---|---|---|:---:|---|
| **JD-SU-011** | WARNING | La UI anuncia éxito y muta estado antes del ACK de Ruby; no hay rollback ni rehidratación en error. | ✅ **TERMINADO** | Eliminado el toast prematuro en `onMaterialChoiceApplied`; `onUpdateResult` coordina el feedback y, en caso de fallo, rehidrata los parámetros y acabados confirmados de `selectedInstance` con rollback visual. |
| **JD-SU-012** | WARNING | Eliminar actúa sobre `selection.first` sin validar identidad ni pedir confirmación. | ✅ **TERMINADO** | `handle_delete` valida la existencia y pertenencia del `instanceId` contra el store de metadatos semánticos de Granete y rechaza eliminar entidades no verificadas; la UI requiere doble confirmación y envía el payload de identidad. |
| **JD-SU-013** | WARNING | El catálogo queda cacheado hasta login/logout y el ETag omite cambios exclusivos de `materialCategories`. | ✅ **TERMINADO** | En `backend-go`, `workshopCatalogRevisionID` incluye `MaterialCategories` en el cálculo de ETag; en Ruby, `HttpAdapter` soporta headers personalizados y `RemoteCatalogProvider` implementa revalidación condicional `If-None-Match` con soporte para HTTP 304. |
| **JD-SU-014** | WARNING | El cache de texturas colisiona por basename y descarga URLs sin allowlist, límite, content-type ni escritura atómica. | ✅ **TERMINADO** | `TextureCache` utiliza hash SHA-256 de URL para evitar colisiones de nombre, valida extensiones (`.jpg`, `.jpeg`, `.png`, `.webp`), verifica `Content-Type` de imagen, aplica límite máximo de 10 MB y realiza escritura atómica con archivo temporal en la misma carpeta. |
| **JD-SU-015** | WARNING | El token de 30 días se persiste sin permisos explícitos ni reemplazo atómico. | ✅ **TERMINADO** | `SessionProvider#write_value` crea carpetas con permisos `0700`, escribe archivos temporales con permisos estrictos `0600` (solo lectura/escritura para el usuario actual) y los reemplaza atómicamente con `File.rename`. |
| **JD-SU-016** | WARNING | La ventana de materiales rompe el sistema visual del diálogo principal, tiene contraste insuficiente, estados incompletos y no responde bien al ancho mínimo admitido. | ✅ **TERMINADO** | Armonizados tokens de color y contraste con `dialog.html` (WCAG AAA), agregadas media queries responsivas (`<= 900px`, `<= 740px`), incorporado botón de reinicio de filtros en el estado vacío y normalizados estilos de foco y botones. |
| **JD-SU-017** | WARNING | README y copy prometen fallback local/offline, pero el wiring de producción devuelve catálogo vacío. | ✅ **TERMINADO** | `Application.new` inyecta explícitamente `fallback_provider: Library::StaticCatalogProvider.new` en el `RemoteCatalogProvider` de producción, permitiendo al usuario explorar y modelar módulos estándar cuando trabaja offline o sin sesión iniciada. |
| **JD-SU-018** | WARNING | El pipeline de assets de herrajes no se usa en producción; los herrajes resueltos terminan como cajas genéricas. | ✅ **TERMINADO** | `DialogController` inyecta `AssetLoader.new` en el `FurnitureBuilder` de producción; `FurnitureBuilder#render_resolved_hardware` consulta y carga la definición de componente SKP real del herraje mediante `load_asset_instance` antes de caer en la caja genérica. |
| **JD-SU-019** | WARNING | Metadata persiste `projectRef` y `sourceRevisionRef` constantes, sin identidad real de obra/revisión. | ✅ **TERMINADO** | `Metadata::Store` resuelve `project_ref` dinámicamente desde el modelo activo (o su GUID/obra vinculada); `MetadataWriter` persiste `sourceRevisionRef` usando el `revisionId` o `version` de la definición del catálogo en lugar de un literal hardcodeado. |
| **JD-SU-020** | WARNING | El selector consulta `grainDefault`, pero el DTO entrega `grain`; muestra información técnica incorrecta. | ✅ **TERMINADO** (con JD-SU-001) |
| **JD-SU-021** | WARNING | El grid recrea y solicita todas las imágenes en cada filtro/navegación; falta carga diferida/virtualización para catálogos densos. | ✅ **TERMINADO** | `material_selector.html` implementa carga diferida (lazy-loading) mediante `IntersectionObserver` y atributo `data-src` con margen de precarga de 120px y desconexión segura en cada re-renderizado. |
| **JD-SU-022** | WARNING | Las pruebas no ejecutan el JavaScript real del HtmlDialog ni un round-trip Ruby↔JS de materiales. | ✅ **TERMINADO** | Creado arnés de pruebas JavaScript en `test/js/material_selector_roundtrip_test.js` y suite `MaterialSelectorJsRoundtripTest` en Ruby que ejecuta el JavaScript real de `material_selector.html`, prueba la inyección `initOptionSelector`, el renderizado, escape XSS, selección y el roundtrip completo bidireccional Ruby↔JS vía bridge. |
| **JD-SU-023** | SUGGESTION | El diálogo cambia automáticamente a Inspector y expone vocabulario interno; debe preservar contexto y usar lenguaje de taller. | ✅ **TERMINADO** | `onSelectionChange` respeta la pestaña activa del usuario (no fuerza el cambio si está explorando la biblioteca o configurando) y el copy adopta lenguaje de taller ("Medidas válidas", "Revisión técnica de taller pendiente", "Aprobado para fabricación"). |

---

## Verificación de Integración

- **Suites de pruebas:** 128 unit tests en Ruby, 976 aserciones, 3 boundary tests; tests de backend Go en `internal/api` 100% pasando — 0 fallos, 0 errores.
- **Linters:** RuboCop 100% limpio (48 archivos inspeccionados, 0 ofensas).
- **Empaquetado:** RBZ determinista verificado (`dist/granete_for_sketchup.rbz`).
- **Instalación activa:** Sincronizado en `/Users/tiagofur/dev/carpinteria/muebles/apps/sketchup-extension/` y `/Users/tiagofur/Library/Application Support/SketchUp 2026/SketchUp/Plugins/`.
