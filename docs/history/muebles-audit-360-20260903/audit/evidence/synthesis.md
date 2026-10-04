# Síntesis ejecutiva — Granete 360°

Baseline: `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. Reporte analítico; ninguna modificación de producto ni escritura remota.

## ¿Estamos listos para la demo integral?

**NO.** Granete tiene una base operativa y de seguridad sustancial, pero NO está acreditada la demo integral. Además de los gaps Web↔SketchUp y DXF, la inspección confirmó autoridad alternativa de escritura: el PUT genérico puede reemplazar precio congelado y estado físico, y la UI puede anunciar éxito antes de persistir. Backup/restore también tienen caminos de falso éxito. OP-01/02/03 y OPS no fueron reproducidos en runtime; no se afirma fuga cross-tenant.

## Lo comprobado y lo que no prueba

- Autenticación Web, bootstrap, MFA y cambio de organización tienen pruebas de navegador reales y acotadas.
- Build Web, contratos generados y smoke estructural pasan.
- Backend de reconciliación exacta, publicación de revisiones y entidades físicas están implementados en el snapshot.
- Cotizaciones, catálogo, órdenes e instalación tienen superficies y cadenas de persistencia; su ensayo comercial completo sigue pendiente.

No confundir presencia de código, check verde, interfaz local y salida física validada. Las clasificaciones CONFIRMED static y CONFIRMED runtime tienen alcances diferentes.

## Camino más corto seguro

### Acordar y congelar el escenario
T01. Dos prospectos pueden usar fixtures separados; no inventar sus máquinas ni preferencias.
**Salida requerida:** Ficha firmada de escenario, SKU, medidas/material, roles, máquina/software y claims permitidos.

### Cerrar contratos e integridad en paralelo
T02/T03/T04/T06 con ownership existente. Contrato generado antes de consumidores.
**Salida requerida:** Pruebas de identidad/revisión y fallo parcial; ningún fallback productivo.

### Probar hardware y salida exacta
T05. Una pieza con operaciones conocidas; casos de todas las caras y rotación.
**Salida requerida:** Patrón SKU documentado, fixture esperado, hash DXF y readback del software real aprobado por operador.

### Ensayar los dos recorridos
T07. De cliente/cotización a instalación, con host y PostgreSQL reales; repetir desde fixture limpio.
**Salida requerida:** Grabación/logs con mismos IDs, revisiones y salida; tenant denial, stale, retry, undo y save-reopen.

### Pulir y congelar release de demo
T08/T09/T10. Sólo cambios que eliminen tropiezos observados; rerun tras cambiar SHA.
**Salida requerida:** Guion ejecutado dos veces, datos de reset y recuperación, build SHA fijo, sin blocker abierto del alcance.

## Prioridades

|Tarea|Prioridad|Demo/cliente/riesgo|Esfuerzo|Dependencias|
|---|---|---|---|---|
|T01 Fijar contrato de demo y fixtures verificables|DEMO BLOCKER|5/5/5|S|ninguna|
|T02 Cerrar continuidad exacta Quote/Design/Release en Web|DEMO BLOCKER|5/5/5|XL|T01|
|T03 Conectar autoría nativa segura y preservar geometría aceptada|DEMO BLOCKER|5/5/5|L|T01|
|T04 Bloquear salida productiva con perforaciones inferidas/incompletas|MVP BLOCKER|5/5/5|M|T01|
|T05 Unificar SKU/patrón y verificar DXF transformado|DEMO BLOCKER|5/5/5|L|T04|
|T06 Cerrar autoridad de mutación comercial, física y stock|MVP BLOCKER|5/5/5|L|T01|
|T07 Ensayar el flujo integral con navegador y host real|DEMO BLOCKER|5/5/5|M|T02, T03, T05, T06|
|T08 Mostrar éxito sólo después del commit|HIGH|4/4/4|M|T01|
|T09 Reconciliar documentación y guion comercial con main|HIGH|4/4/3|S|ninguna|
|T10 Eliminar falso éxito operacional y verificar piloto|HIGH|3/5/5|L|T01|

Los impactos son estimaciones ordinales, no resultados medidos. Primero integridad/seguridad, después continuidad y polish. Ver `data/synthesis.json` para evidencia, racional, plan de issues, tradeoffs y criterios de aceptación.

## Manual real, sin controles inventados

### Administrador / equipo
Ruta: `/users`. Estado: controles verificados estáticamente; recorrido completo pendiente.
1. Abrir Usuarios y comprobar el taller activo.
2. Elegir Invitar miembro; introducir identidad requerida y roles a asignar; revisar el alcance.
3. Enviar invitación y verificar su fila/estado; no afirmar que se creó una nueva cuenta global.
4. Para cambiar roles, abrir Modificar roles del miembro. Completar la confirmación de identidad cuando aparezca; si se cancela, revisar que nada cambió.
5. Para suspender, usar Suspender membresía y proporcionar motivo. No confundir suspensión del taller con deshabilitar cuenta global.
6. Para administrar catálogo abrir /modules, /materials o /hardware con permisos admin/ingeniero.
7. Tiendas/distribuidores: NOT IMPLEMENTED como recorrido completo acreditado en este snapshot; no inventar botón de configuración de red.
**Verificación pendiente:** Ejecutar invitación/aceptación/roles/suspensión con dos cuentas reales y verificar backend/RLS; los 17 auth tests no cubren todos estos pasos.

### Ventas / gerente de ventas
Ruta: `/customers → /quotes`. Estado: controles verificados estáticamente; recorrido completo pendiente.
1. En Clientes elegir Nuevo cliente. Introducir Nombre completo; Email, Teléfono y Dirección cuando correspondan. Guardar.
2. En Cotizaciones elegir Nueva cotización. Introducir Nombre y seleccionar Cliente; Guardar.
3. Abrir la cotización y agregar/configurar muebles desde el catálogo disponible. No inventar precios ni materiales ausentes.
4. Revisar cantidades, materiales y precio calculado. Un faltante de catálogo se corrige, no se oculta.
5. Enviar cotización y confirmar Enviar: la UI advierte que congela precios/diseño.
6. Aceptar sólo después de revisar: Aceptar cotización → Aceptar lleva el pedido a fábrica según el flujo actual.
7. Abrir en Producción cuando esté disponible. Esto no es la aprobación/release del nuevo DesignRevision de #395.
**Verificación pendiente:** Ejecutar create→quote→accept en navegador con PostgreSQL, comprobar persistencia tras reload, precio congelado y permisos de otro vendedor.

### Diseño / ingeniería
Ruta: `/quotes/:id y Proyectar; /modules/new/edit`. Estado: controles verificados estáticamente; recorrido completo pendiente.
1. Para editar catálogo abrir Muebles /modules; nuevo editor usa /modules/new/edit. Configurar sólo piezas/materiales disponibles y guardar.
2. En cotización en borrador abrir Proyectar mediante el control de la cotización.
3. Agregar/colocar muebles desde biblioteca; seleccionar para inspeccionar dimensiones/opciones disponibles. No tratar posiciones como nuevas identidades físicas.
4. Si la cotización está aceptada, respetar modo sólo lectura: en el ensayo guest Cocina López se abrió congelada.
5. Usar cámara Planta cuando el encuadre 3/4 o muros obstruyan la lectura. En tablet/móvil no presentar este editor hasta corregir canvas altura cero.
6. Para SketchUp usar la librería/conexión existente; verificar catálogo actualizado, servidor activo e identidad de proyecto antes de insertar.
7. NOT IMPLEMENTED como manual completo: edición interactiva de hardware/preflight y workspace React de reconciliación/release. No inventar esos controles.
**Verificación pendiente:** Ensayo real de inserción, selección, edición, undo/redo, save-reopen, publicación y misma FurnitureInstance en backend; pantalla desktop y responsive verificadas tras corrección.

### Producción / operador
Ruta: `/orders y /production`. Estado: controles verificados estáticamente; recorrido completo pendiente.
1. Abrir pedido desde Abrir en Producción o /orders.
2. Revisar pestañas resumen, módulos, piso, despiece, etiquetas, herrajes, vistas, optimización y documentos según ruta del hub.
3. Revisar piezas, materiales y faltantes antes de descargar cualquier pack.
4. Corte/CNC/enchape trabajan piezas/lotes; no declarar muebles armados porque terminó una pieza.
5. Seguir unidades físicas a partir de armado; respetar bloqueos por revisión stale.
6. No ejecutar despacho productivo hasta tener comando atómico validado; para ensayo usar datos aislados y verificar stock/picking después de cualquier error.
7. Para DXF, comprobar operaciones y readback del software exacto antes de fabricar. Un toast de descarga no aprueba salida física.
**Verificación pendiente:** Ejecutar orden→pieza→armado→QC→envío con PostgreSQL real, negativos de estado/revisión y rollback despacho. Labels exactos de acciones de piso requieren completar inspección/runtime del panel.

### Instalación / personal de producción autorizado
Ruta: `/installations/:projectId`. Estado: controles verificados estáticamente; recorrido completo pendiente.
1. Abrir la instalación correspondiente al proyecto.
2. Programar visita introduciendo Fecha de la visita y Crew de la visita; seleccionar Programar.
3. En visita programada elegir Iniciar.
4. Al finalizar elegir Completar, Resultado de la visita y notas; Guardar.
5. Registrar incidencias y pendientes con descripción, responsable, severidad y fecha cuando corresponda.
6. Las unidades se instalan desde En camino o escáner; no asumir que completar una visita instala automáticamente todas las unidades.
7. Resolver pendientes bloqueantes. Completar instalación cuando los checks lo permitan.
8. Introducir Nombre de quien firma la conformidad y elegir Registrar conformidad; luego Cerrar proyecto si está permitido.
**Verificación pendiente:** Ejecutar visita→incidencia→punch→signoff→close en navegador/DB, probar rechazo de blockers y persistencia tras reload.

## Demo playbook

### 1. Presentar problema: cotizar, diseñar y producir sin reconstruir datos.
Mostrar: Identidad del taller/cuenta.
Prueba: Login y tenant activo; no se promete red de distribuidores.
Gate: Login/session acotados verificados por 17 tests.

### 2. Clientes → Nuevo cliente → Nombre completo → Guardar.
Mostrar: Cliente persistido tras recarga.
Prueba: ID del cliente y tenant.
Gate: Real backend commercial rehearsal pending.

### 3. Cotizaciones → Nueva cotización → Nombre/Cliente → Guardar; agregar mueble del catálogo.
Mostrar: Cantidades/material/precio.
Prueba: Proyecto y líneas persistidos.
Gate: No presentar un precio sin catálogo válido.

### 4. Abrir Proyectar para colocar/inspeccionar mueble; usar cotización draft editable.
Mostrar: Biblioteca → canvas → selección.
Prueba: Layout del mismo proyecto.
Gate: Desktop only provisional; guest read-only exercised, editable full chain pending.

### 5. Mostrar revisión/identidad exactas y conectar el modelo de SketchUp por flujo disponible.
Mostrar: Mismo FurnitureInstance, no copia manual.
Prueba: Server IDs, revisión y binding persistentes.
Gate: BLOCKED: superficies #500–502/#395 y ensayo host pendientes; no simular este paso.

### 6. Insertar fixture verificado en SketchUp; seleccionar, inspeccionar material y herraje configurado.
Mostrar: Componente nativo/partes y metadatos; no drag de hardware inexistente.
Prueba: Undo/save-reopen y publicación preservan IDs.
Gate: Real host proof missing; rich hardware actions disabled.

### 7. Mostrar operaciones del herraje y piezas receptoras.
Mostrar: Cara, posición, diámetro, profundidad, orientación y conflictos.
Prueba: SKU/patrón y paridad Go/TS.
Gate: BLOCKED para inspección interactiva completa; no vender preview como implementación.

### 8. Exportar ejemplo verificado y revisar en software de máquina exacto.
Mostrar: Transformadas y todas las operaciones.
Prueba: Hash archivo + readback + aprobación operador.
Gate: BLOCKED hasta corregir DXF/patrón y disponer dossier.

### 9. Pedido → Producción: piezas, armado/unidades, envío.
Mostrar: Cambio de unidad de trabajo, bloqueos y stock.
Prueba: Persistencia, revisión autorizada y despacho atómico.
Gate: Failure injection y happy path completo pendientes.

### 10. Instalaciones → Programar → Iniciar → Completar visita; resolver pendientes, Registrar conformidad, Cerrar proyecto.
Mostrar: Resultado operacional, no sólo diseño bonito.
Prueba: Estados y eventos persistidos, blockers respetados.
Gate: Real browser/DB rehearsal pending.

## Scorecard

Escala ordinal 0–100 de preparación demostrable del área para el escenario solicitado, NO porcentaje de funcionalidades completas ni probabilidad de éxito. Son bandas de 25 puntos; un área amplia no hereda el score de una prueba estrecha.

|Área|Banda ordinal|Evidencia y límite|
|---|---|---|
|Web|50/100|Build y auth reales; recorrido comercial/producción completo pendiente.|
|Backend|50/100|CI/contratos y Foundation sólidos; despacho no atómico y validación media pendientes.|
|SketchUp|25/100|Ruby/RBZ pasan; host no ensayado y autoría/preflight deshabilitados.|
|Integration|25/100|Reconciliación backend no cierra UX Web↔SketchUp ni release nuevo.|
|Furniture|25/100|Catálogo/resolución e identidad física existentes; release/consumo inmutable no acreditados.|
|Hardware|25/100|Patrones parciales; SKU físico y edición nativa no acreditados.|
|Machining|25/100|DXF existe pero pierde agujeros rotados y no codifica profundidad individual.|
|Quotes|25/100|UI/lifecycle presentes; OP-01 permite sustitución de frozen snapshot y OP-03 éxito antes de commit; runtime negativo pendiente.|
|Design|25/100|Publicación backend presente; workspace/release exacto incompletos.|
|Production|25/100|Flujo pieza→unidad existe; generic PUT bypass estático y despacho separado impiden confiar en autoridad integral.|
|Installation|50/100|Panel, dominio y mutación bloqueada por fila presentes; ensayo real pendiente.|
|UX|25/100|Controles reales inspeccionados; revisión visual/responsive completa pendiente; estados engañosos conocidos.|
|Security|50/100|Gate A/auth-MFA reales; SEC8/9 y análisis por superficie no equivalen a certificación completa.|
|Reliability|25/100|No se acreditó recuperación: restore/backup toleran fallos y anuncian éxito; writers alternativos afectan integridad.|
|Tests|50/100|Checks amplios más 17 browser reales; cadena comercial+host+máquina sin prueba conjunta.|
|Documentation|25/100|Mapa extenso pero implementación actual contradice resúmenes canónicos.|
|Demo readiness|25/100|Bloqueos confirmados en integración, autoría y mecanizado; ensayo integral ausente.|

No promediar: demo y MVP tienen gates de integridad/seguridad; un bloqueo crítico no se compensa con muchas áreas verdes. Intervalos orientativos de ±25; nunca leer 50 como 50% implementado.

## UNKNOWN / NEEDS VERIFICATION

- **Ensayo comercial integrado**: Falta ejecución real cliente→cotización→diseño→release→SketchUp→manufactura→instalación con mismos IDs/revisiones. Próxima prueba: T07: navegador+PostgreSQL+SketchUp, fixture limpio, logs/redacted y evidencia de cada transición.
- **Máquinas y SKUs de los prospectos**: No se conocen modelo/control/software, SKU/patrón fabricante ni criterios de aceptación físicos. Próxima prueba: Dossiers #352/#353 y readback firmado por operador; sin eso no se ejecuta máquina.
- **Rendimiento representativo**: Build identifica tamaño; no mide FPS/latencia de datos reales ni traversal del host. Próxima prueba: Cold/warm load, React/network/DB y host profiling en equipo objetivo con fixture de volumen real.
- **Recuperación operacional**: Smoke estructural no valida despliegue, restore ni atención de incidencias. Próxima prueba: Deploy aislado, fallo controlado, restore con integridad y tiempos medidos, bundle diagnóstico redactado.
- **Instalación y producción completas**: Código y tests presentes no prueban el recorrido real de roles y persistencia. Próxima prueba: Browser+DB con estados permitidos/rechazados, stock rollback, punch/signoff y eventos.
- **Cobertura exhaustiva final**: La síntesis no convierte inventarios de 371 docs/204 ledger/100 PRs en auditoría vertical completa. Próxima prueba: Consultar matriz de cobertura raíz; revisar cada área faltante o consignar límite específico por fila, no omitir.

## Key Learnings:
1. Backend de reconciliación, UI local y validación de máquina son niveles distintos de prueba.
2. Un DXF exitoso puede omitir agujeros rotados y perder procedencia; jamás equivale a autorización física.
3. La persona instaladora no implica un rol instalador dedicado en ProductRole.

## Diagramas y matriz de integración

Los grafos offline en `data/synthesis.json` contienen nodos/aristas con estado por vínculo: dominio, cross-surface, machining y producción. Los vínculos PROPOSED no se presentan como existentes.

### Dominio real: identidad y snapshots

```text
User → Membership [CONFIRMED]: identidad global participa mediante membresía
Membership → Organization [CONFIRMED]: acceso/roles del taller
Organization → Project [CONFIRMED]: tenant scope
Project → FurnitureInstance [CONFIRMED]: ownership físico
Project → QuoteRevision [CONFIRMED]: snapshot comercial exacto
Project → DesignRevision [CONFIRMED]: snapshot diseño exacto
QuoteRevision → ReconciliationResult [CONFIRMED]: quoteRevisionId exacto
DesignRevision → ReconciliationResult [CONFIRMED]: designRevisionId exacto
FurnitureInstance → ReconciliationResult [CONFIRMED]: única clave de join
Project → InstallationJob en Project JSONB [CONFIRMED]: persistencia mutada con row lock
```

### Cross-surface: implementación frente a siguiente tramo

```text
React administración / catálogo / cotización → Go: identidad, resolve, revisiones [CONFIRMED]: API; contratos generados en ámbitos modernos
Go: identidad, resolve, revisiones → PostgreSQL tenant transactions / RLS [CONFIRMED]: persistencia y enforcement
Ruby: host e interacción → Go: identidad, resolve, revisiones [CONFIRMED]: device auth + GET layout/publicación
Ruby: host e interacción → Native ComponentInstance [CONFIRMED]: render nativo y metadatos
Go: identidad, resolve, revisiones → Reconciliación backend [CONFIRMED]: comparación exacta DT9
Reconciliación backend → Workspace React #500–502 [PROPOSED]: consumidor UX pendiente
Workspace React #500–502 → Release nuevo exacto #395 [PROPOSED]: aprobación/release pendiente
```

### Hardware → operación → salida: no una cadena cerrada

```text
Hardware SKU / patrón técnico → Go authoring: subset de perfiles [CONFIRMED]: subset compilado actual
Hardware SKU / patrón técnico → TS catálogo + joinery [CONFIRMED]: hardware.machining cuando existe
Fallback heurístico por nombre → data.patterns sin procedencia [CONFIRMED]: flags no viajan al export
TS catálogo + joinery → data.patterns sin procedencia [CONFIRMED]: proyección de patrones
data.patterns sin procedencia → DXF: capas/círculos [CONFIRMED]: rotadas omitidas; depth no en capa
DXF: capas/círculos → Readback máquina/software exacto [PROPOSED]: pendiente validación/corrección
```

### Operación: piezas convergen en unidades

```text
Cotización aceptada → Pedido / hub producción [CONFIRMED]: flujo comercial actual; NO equivale a #395
Pedido / hub producción → Corte / CNC / enchape: piezas [CONFIRMED]: trabajo de piso
Corte / CNC / enchape: piezas → Armado: convergencia [CONFIRMED]: convergencia de piezas
Armado: convergencia → QC / envío: unidad o bulto [CONFIRMED]: tracking físico
QC / envío: unidad o bulto → Instalación: visita + unidades [CONFIRMED]: En camino / escáner
Instalación: visita + unidades → Punch / conformidad / cierre [CONFIRMED]: gates y eventos con row lock
```

## Pruebas ejecutables complementarias

`data/defect-proofs.json` acredita tres hazards, no fixes: DXF rotado sin CIRCLE; flags reales de fallback eliminados; retry cliente de picking sin compensación con repositorio simulado. Ninguna es readback de máquina; picking no es prueba PostgreSQL.

## Síntesis final integrada — autoridad y recuperación

Granete tiene una base operativa y de seguridad sustancial, pero NO está acreditada la demo integral. Además de los gaps Web↔SketchUp y DXF, la inspección confirmó autoridad alternativa de escritura: el PUT genérico puede reemplazar precio congelado y estado físico, y la UI puede anunciar éxito antes de persistir. Backup/restore también tienen caminos de falso éxito. OP-01/02/03 y OPS no fueron reproducidos en runtime; no se afirma fuga cross-tenant.

### OP-01 — Generic project PUT accepts replacement/removal of frozen quote price

Handler preserves old snapshot only for produced transition with omitted snapshot; same-status quoted/accepted update can replace it. Storage deletes old quote_snapshots then inserts supplied payload, or none if omitted.

**Runtime:** UNKNOWN / NEEDS VERIFICATION — no operational proof was executed; only source and fixture inspection.

### OP-02 — Generic aggregate physical writer bypasses dedicated assembly/QC authority

Generic update writes client part_instances/module_units/production_release without dedicated gates. Web awaits advance endpoint, discards returned authoritative object and locally advances then persists entire project through patch.

**Runtime:** UNKNOWN / NEEDS VERIFICATION — no operational proof was executed; only source and fixture inspection.

### OP-03 — Quote status and metadata report success before rejected persistence

Project patch updates memory then starts unawaited save; changeProjectStatus immediately toasts accepted/frozen. Failure emits error but does not restore project. Metadata save has same success-before-save pattern.

**Runtime:** UNKNOWN / NEEDS VERIFICATION — no operational proof was executed; only source and fixture inspection.

OPS-02/03/04: restore tolera error y health timeout; backup puede omitir media; health mide liveness. OPS-01/12: toolchains Docker/CI difieren. Son hallazgos estáticos, no fallos de despliegue/restore observados.

### Lista final consolidada (sustituye títulos preliminares)

1. **T01 Fijar contrato de demo y fixtures verificables** — Acordar un mueble, SKU, materiales y salida exacta por prospecto; impide promesas no probadas. Impacto demo/cliente/riesgo 5/5/5; esfuerzo S.
2. **T02 Cerrar continuidad exacta Quote/Design/Release en Web** — Completar slices existentes y presentar diferencias por FurnitureInstance, no copiar datos entre pantallas. Es la principal promesa comercial. Impacto demo/cliente/riesgo 5/5/5; esfuerzo XL.
3. **T03 Conectar autoría nativa segura y preservar geometría aceptada** — Unificar interacción en host compartido; nil/stale/error no borra geometría válida. Un solo mueble end-to-end antes de ampliar edición. Impacto demo/cliente/riesgo 5/5/5; esfuerzo L.
4. **T04 Bloquear salida productiva con perforaciones inferidas/incompletas** — Propagar fallbackUsed/issues hasta exportación y distinguir preview geométrico de mecanizado autorizado. Debe preceder cualquier fabricación. Impacto demo/cliente/riesgo 5/5/5; esfuerzo M.
5. **T05 Unificar SKU/patrón y verificar DXF transformado** — Misma autoridad de patrón para Go, TS y export; fixture rotado/no rotado, todas las caras y profundidad; readback del software exacto. Impacto demo/cliente/riesgo 5/5/5; esfuerzo L.
6. **T06 Cerrar autoridad de mutación comercial, física y stock** — Consolidar raíz: el aggregate PUT no puede sustituir snapshots cerrados ni estados físicos/release; consumir la respuesta autoritativa de commands; despacho stock+picking atómico e idempotente. Son slices separados bajo un mismo principio, no una megaissue. Impacto demo/cliente/riesgo 5/5/5; esfuerzo L.
7. **T07 Ensayar el flujo integral con navegador y host real** — Conservar IDs, revisiones y artefactos desde cliente hasta instalación, repetir desde datos reiniciados y capturar negativas críticas. Impacto demo/cliente/riesgo 5/5/5; esfuerzo M.
8. **T08 Mostrar éxito sólo después del commit** — Esperar persistencia de quote/status/metadata; error o cancelación conservan estado honesto y permiten reintento seguro. No cerrar modal ni anunciar aceptación antes del servidor. Mantener resultado de comando físico en vez de recrearlo localmente. Impacto demo/cliente/riesgo 4/4/4; esfuerzo M.
9. **T09 Reconciliar documentación y guion comercial con main** — Actualizar snapshot de Gate A/DT y ledger, mantener Gate B futuro. Reduce trabajo duplicado y afirmaciones comerciales incorrectas. Impacto demo/cliente/riesgo 4/4/3; esfuerzo S.
10. **T10 Eliminar falso éxito operacional y verificar piloto** — Restore y backup deben fallar honestamente ante datos/media incompletos o health timeout; readiness debe distinguir dependencia DB. Alinear toolchains Docker/CI y ensayar build/restore aislados. Mantener SEC8/9, upload byte-validation y observabilidad en scopes existentes. Impacto demo/cliente/riesgo 3/5/5; esfuerzo L.

El manual explica controles existentes, no promete frozen snapshot o autoridad física completa. Verificar commit y revisiones es obligatorio; los nuevos gaps impiden recomendar uso productivo sin remediación.

## QV-01 y auditoría semántica documental

QV-01 confirma estáticamente orden transition/snapshot incorrecto; el historial vacío en cotización guest nueva lo corrobora. No es prueba de fallo QuoteRevision/DesignRevision backend. Rev1(cerrada) es pin de estructura, NO historial comercial. Se incorpora en T06 sin aumentar10prioridades.

`data/docs-semantic-audit.json`:371 filas con extractos/clasificación/contraste de familia y próxima prueba específica. Tres nuevos desajustes: onboarding de registro retirado, labels piloto viejos y README SketchUp de credenciales obsoleto. No son371 documentos certificados frase por frase.

## Ampliación semántica final — integración sin duplicar hallazgos

- T02: Incluir clone de plantilla multiespacio sin omitir campos de layout (FM-01) y separar historial legacy QV-01 de QuoteRevision/DesignRevision. Son scopes revisables separados, no una mega-feature. Evidencia: FM-01, QV-01.
- T03: Para la demostración Web de herrajes, conectar eventos reales del gizmo montado (FM-05); no confundir este defecto React con capabilities SketchUp. Verificar pointer→callback→modelo→undo en su propio scope. Evidencia: FM-05.
- T05: Corregir además identidad del cache de drilling: el key omite preset/opciones aunque resolveBom los consume; partId first-owner colapsa variantes (FM-03). Fixture con mismo módulo y distintos presets/materiales antes de exportar. Evidencia: FM-03.
- T06: Cerrar capability/ownership de technical-workflow legacy y override force_release sin razón requerida (EPS-F01). No atribuirlo a nuevo DesignRelease ni afirmar exploit cross-tenant. Evidencia: EPS-F01.
- T08: El guardado de plan de corte comparte feedback optimista: onSaveCutPlan void seguido de success inmediato. Consolidar esta clase con OP-03/WEB-04; preservar errores y borrador. Evidencia: OP-03, WEB-04, packages/ui/src/production/ProductionOrderOptimizationPanel.tsx:150-154.

R11 identifica interacción Web aparente; R12 pérdida de layout en plantillas. R02/R04 incorporan cache de variantes y autorización de workflow legacy. QV-01 conserva su registro canónico; no se recrea. Los scores ordinales no se reajustan con precisión inventada. No hubo pruebas nuevas ni cambios de producto en esta integración.

## Alcance temporal

Alcance temporal: este informe audita 316df57c. El readback posterior de main es 0eb53be6 (merge PR550/#394); esos cambios NO fueron auditados ni incorporados. Las conclusiones describen el snapshot, no el main actual. Evidencia: evidence/main-readback-final.json.

FM-02 delimita T01 (preset/encoding CSV acordados; no prometer editor arbitrario). FM-04 amplía T04/R02: preview PDF legacy encoge dimensiones de piezas; no confundir con el nesting optimizer moderno.

AUTH-CONTRACT-01 se integra como contract drift/R13 MEDIUM y follow-up separadoT10: /auth/me emite access expiry bajo nombre absoluto; efecto de cache sólo condicional a rehydrate. No logout, bypass ni fuga demostrados; no nuevo demo blocker.

FM-01 ampliado:3/3pruebas de funciones reales de dominio reproducen pérdida de6campos; PASS es defecto reproducido, no reparado. UI/store/API/DB/native no ejecutados. effective-permissions.json aporta41composiciones fuente por familia,244/244filas suplementarias vinculadas, ledger265mixto; separado de536predicadosrole-only y de pruebasruntime.

FM-03 ampliado: prueba pura1/1 reproduce large-door3tazas aisladas→2enordenA→B→3alrevertir. Mecanismo probado first-part-owner entrecustomDimsdistintos; preset/opciones no aislados. R02/T05 incorporan riesgo de orden; sinDXF/máquina/daño físico probado.

## Ocho listas Top10 completas

Cada lista tiene10entradas con evidencia o propuesta explícita. UX incorpora gizmo y plantillas; quick wins delimitan cancelación step-up, alcanceCSV y gizmo no operativo; oportunidades futuras parten de corregir integridad/historial antes de ampliar plantillas, comparación, trazabilidad y medición. No se aplaza seguridad ni se inventa ROI.
