# Mega Presentation Hardening — cierre de auditoría (2026-08-28)

Los hallazgos P0/P1 de la auditoría previa a la demo quedaron corregidos en la
rama `fix/audit-pre-demo`. La política de sesión cambió respecto del plan
inicial: el access token es finito por **18 horas** y no se renueva de forma
proactiva. La validación runtime en navegador y la limpieza de datos demo
quedaron pendientes por límites operativos explícitos, no se presentan como
evidencia ejecutada.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Sesión web | JWT de acceso finito por 18 h. No hay refresh proactivo: renovarlo antes del vencimiento convertiría una sesión de jornada en una sesión renovable indefinidamente. |
| Revocación | Cada request autenticado sigue revalidando usuario activo, membresía y organización en el servidor. Un `401` de negocio expira la sesión local; los endpoints `/auth/` conservan su UX propia. |
| Sincronización entre pestañas | `BroadcastChannel` sólo reduce la ventana stale: anuncia un guardado exitoso y la otra pestaña recarga al volver a estar visible. No ofrece concurrencia optimista ni evita todos los lost updates. |
| Limpieza demo | No se ejecutó. Requiere `pg_dump`, revisión de los conteos exactos y confirmación explícita inmediatamente antes de cualquier borrado. |

## Hallazgos corregidos

| Hallazgo | Causa raíz | Corrección y estado | Commits y evidencia |
|---|---|---|---|
| **P0-1 — sesión corta y errores 401 engañosos** | El TTL de 15 minutos interrumpía trabajo real. Los `401` de endpoints de negocio no convergían en una expiración de sesión y podían terminar presentados como errores de conexión. | **Corregido.** TTL de 18 h y guard global de `fetch`: ante el primer `401` productivo del token vigente ejecuta `markSessionExpired()`. Excluye `/auth/` y deduplica ráfagas. Sin scheduler ni refresh proactivo. | `af278f9`, `ab6a7a0`. Tests de middleware/auth y `auth401`; el guard incluye los fetch productivos y preserva el flujo de login. |
| **P0-2a — fórmula `B` divergente en BOM Go** | El resolver Go no propagaba `baseClearance` a `expandComponentInstances`; `B` valía `0`, mientras TypeScript usaba la altura del zócalo. | **Corregido.** Go calcula el tratamiento de base efectivo, propaga el clearance y llena `evalDims.B`. | `4272aa4`. Fixture compartido `designBomPrice.json` con `plinth_board`, `B=100` y fórmula `widthFormula: "B"`; suites Go y TS del contrato. |
| **P0-2b — cotización aceptable con opciones de zócalo incompletas** | Un módulo insertado desde Proyectar podía quedar sin elección efectiva `ZOCLO`/`FRENTE`; la aceptación lanzaba `ResolutionError`, sin feedback, y dejaba abierto el diálogo. | **Corregido.** El gate valida la regla de fallback, quick-add/modal siembran `ZOCLO` cuando corresponde, las transiciones capturan el error sin mutar el estado y el diálogo cierra en `finally`. | `e1beccf`, `55e170f`. Tests de helpers/seeding y transición fallida con toast y estado intacto. |
| **P0-2c — “Abrir en Producción” terminaba en un dead-end** | La ruta recibía un proyecto aceptado, pero la cola filtraba proyectos sin `materialsRelease` y lo mostraba como inexistente. | **Corregido.** El workspace consulta también la lista sin filtrar y muestra una guía accionable hacia Almacén; sólo un ID realmente ausente conserva “Orden no encontrada”. | `a838bdb`, `f01b876`. Tests de componente para proyecto aceptado sin liberación, proyecto fuera de etapa e ID desconocido. |
| **P0-2d — “Demo plantilla” resolvía un despiece vacío** | El seed persistía `MOD-GAB-01` como módulo plano, sin `structure_id` ni composición, pero el motor resuelve el BOM compuesto. | **Corregido.** El seed y el upgrade convierten el gabinete al contrato `EST-GAB-01` + componentes; el item conserva elecciones resolubles. | `1c1c71d`, `31cc72f`. Test Go de composición, upgrade flat→composed y resolución de BOM con al menos una pieza y sin error. |
| **P0-3 — pestañas con catálogos stale** | Cada pestaña mantenía un snapshot completo y no recibía señal de mutaciones hechas en otra pestaña. | **Mitigado para demo.** Un guardado exitoso emite por `granete-catalog`; la otra pestaña queda marcada stale y recarga al volver a visible. Si la recarga falla, conserva el flag para reintentar. | `e60eaff`. Tests con dos canales/instancias, visibilidad, reintento y orden de saves. Solución completa diferida a #443. |
| **P1-4 — doble guardado creaba duplicados** | `patch()` lanzaba fan-outs concurrentes; dos saves podían leer el mismo snapshot y hacer `POST` de la misma entidad. | **Corregido.** Los saves se serializan por instancia y cada save encolado relee el catálogo actual; un fallo libera la cadena. | `bbf440b`, complementado por `e60eaff`. Tests de doble creación rápida: un solo `POST` y orden preservado. |
| **P1-5 — PUT de proyecto devolvía 500 por UUID inválido** | `customer_id` e IDs anidados vacíos/malformados llegaban a columnas UUID en SQL y terminaban como error interno. | **Corregido.** El handler valida los IDs requeridos después de los gates de ownership y devuelve `400` con mensaje claro. | `e9ba809`, `8a2d7c9`. Tests de payload mínimo, UUID vacío/malformado y preservación de semántica de autorización. |
| **P1-6 — toasts idénticos se apilaban** | Cada fallo añadía una notificación nueva aunque coincidieran tipo y mensaje. | **Corregido.** Un toast activo idéntico renueva su timer en lugar de duplicarse. | `bbf440b`, complementado por `e60eaff`. Tests de deduplicación y renovación. |

## Evidencia automatizada registrada

- Contrato BOM compartido: escenario de zócalo `B=100` consumido por Go y
  TypeScript.
- API/auth/storage: suites Go focalizadas; los commits de API registran además
  `go test ./...` verde.
- Web/UI: tests de interceptor 401, stores, transición de cotización,
  sincronización cross-tab y estados de Producción. Los commits registran las
  suites Vitest correspondientes y typecheck del slice de Producción.
- No se sustituye evidencia runtime por tests unitarios: son capas distintas.

## Verificación runtime y limpieza

La re-verificación en navegador de los repros exactos quedó **bloqueada** porque
la app local exige credenciales válidas. No se creó, cambió ni restableció
ninguna cuenta para forzar el acceso. Por lo tanto, este cierre no afirma haber
reproducido en runtime el logout por token inválido, el cálculo del módulo con
zócalo, la aceptación desde Proyectar, la guía de Producción, el despiece demo
ni el doble-click de Guardar.

La limpieza demo tampoco se ejecutó. El próximo intento debe, en este orden:

1. generar y verificar un `pg_dump` en `/tmp`;
2. mostrar los candidatos y conteos exactos que serían eliminados;
3. pedir confirmación explícita en ese momento;
4. ejecutar la limpieza sólo tras esa confirmación;
5. verificar conteos y las vistas Home, Cotizaciones e Ingeniería.

## Seguimiento fuera de alcance

- [#442](https://github.com/tiagofur/muebleria/issues/442): paridad completa
  de tratamiento de base en Go, incluida síntesis `ZOCLO-AUTO`, filtros y
  overrides efectivos.
- [#443](https://github.com/tiagofur/muebleria/issues/443): persistencia por
  entidad con versión/ETag, `If-Match` y conflicto explícito. Es la solución de
  corrección para lost updates; `BroadcastChannel` queda como señal de frescura.
- [#444](https://github.com/tiagofur/muebleria/issues/444): regresión visual
  determinista del canvas WebGL real.
- [#27](https://github.com/tiagofur/muebleria/issues/27): se reutiliza como
  antecedente del picker buscable de clientes/catálogos; no se duplicó el
  alcance.

El trabajo de este hardening se agrupa en
[#441](https://github.com/tiagofur/muebleria/issues/441).
