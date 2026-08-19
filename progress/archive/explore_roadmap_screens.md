# Exploración — roadmap-screens: Producción v2 por obra

**Fecha:** 2026-08-18  
**Propósito:** validar el plan aprobado contra el producto y elegir el siguiente
slice sin romper la regla de una sola feature activa.

## Gate de entorno

`./init.sh` finalizó correctamente: dependencias, validación del backlog y las
suites del monorepo se ejecutaron en verde. La salida contiene warnings ya
conocidos de jsdom/Three y casos de error ejercitados por tests, sin fallos.

## Estado real del repositorio

- `feature_list.json` tiene 91 features y exactamente una `in_progress`:
  **F095 — Fase 5.1+5.2 (M3): métricas de encintado en dominio + color de
  cintilla + claim obra×estación**.
- `progress/current.md` registra F095 como iniciada y el árbol contiene cambios
  sin cerrar para esa misma feature (dominio TS, backend Go y migración aditiva
  `000058`). No son cambios libres que se deban mezclar con una segunda feature.
- No hay todavía una entrada de backlog para el board UI (Fase 2), los extras
  (Fase 3) ni el cierre de polish/critique (Fase 4). Las otras pendientes
  visibles son F077–F081, congeladas o de otra línea de producto.

**Conclusión operativa:** no se puede iniciar una feature nueva. La primera
unidad atómica implementable es la F095 ya tomada; se debe terminar, testear y
revisar antes de crear/tomar la siguiente entrada. Esto cumple la regla de
`AGENTS.md` y evita mezclar backend/dominio con la reestructuración visual.

## Validación de necesidad de producto

El plan es consistente con el propósito de Muebles: cerrar el circuito
Ingeniería → Almacén → Fábrica para que el operador fabrique una obra sin
reconstruir el despiece. No agrega un ERP ni nesting interno: reutiliza el
Optimizer/export existente y expone la información de ejecución en el punto de
uso. También respeta los límites de arquitectura: cálculos en `domain`, UI
consumidora de DTOs y shells/adapters para persistencia.

La evidencia del critique 2026-08-18 es congruente con la especificación:
`FabricScreen` lista ítems planos y por eso no comunica materiales, cintilla ni
progreso por obra; el claim existente no es invocado por una pantalla; el
dashboard muestra una métrica incompatible con la lista. El modelo de unidad de
trabajo "obra × estación" está documentado en
`docs/roadmap-screens/03-fabrica.md` y no contradice el pipeline por ítem:
claim mide trabajo, avance batch mueve los ítems auditables.

## Evaluación por fase aprobada

### Fase 1 — dominio y backend aditivos: necesaria y correctamente ordenada

1. **`ProductionEdgeTotal.pieces/sides` y `EdgeBand.previewColor`.** Es un
   prerequisito real de Encintado: ML solo no responde cuántas piezas ni cuántos
   lados se deben encintar, y el color del canto habilita identificación rápida.
   `sides = (L1 + L2 + W1 + W2) × quantity` coincide con el contrato de la
   pantalla. Debe permanecer aditivo y con round-trip TS/Go/storage/migración.
2. **Claim obra × estación.** Es necesario antes de mostrar “Empezar” y antes
   de que el dashboard prometa operarios/tiempos reales. `item_id NULL` es una
   extensión compatible de `production_activities`; terminar un claim de obra
   no debe mover ítems automáticamente. La separación evita que telemetría y
   transición de producción se confundan.

La F095 en curso refleja exactamente esos dos requisitos. Su cierre aún debe
probar handlers, cliente de storage y migración, además de las suites TS/Go;
la exploración no modifica ni da por aprobada esa implementación.

### Fase 2 — FabricScreen board por obra: es la pieza central, dependiente de F095

El board cumple el modelo mental del operario y reutiliza las fuentes correctas:
`computeProductionTotals`, `estimateBoardSheets`, `itemsWaitingForSector`,
estados de picking y el patrón por obra de Embarques/Instalaciones. La UI no
debe recalcular m², ML, piezas, lados ni planchas; necesita un modelo/selector
de datos de presentación derivado del dominio.

Alcance recomendado para la próxima feature atómica **después de cerrar F095**:

- crear una sola feature de backlog (propuesta: `F096 — FabricScreen v2 board
  por obra`);
- cards por obra para Corte, Encintado, Armado y Embalaje;
- claim/finish por obra × estación y avance batch auditado reutilizando el
  callback de avance existente;
- Corte muestra picking de tablero y Encintado el picking de la cintilla cuando
  exista una asociación material/canto persistida; no inventar stock ni un
  backend paralelo;
- estados vacíos, multioperario y permisos por sector; pruebas de modelo y
  pantalla.

El posible riesgo no bloqueante es la semántica de picking de cintilla: la
especificación afirma que el picking existente es `projectId × material`,
mientras que una `EdgeBand` no es necesariamente un `MaterialBoard`. Antes de
mostrar “surtido” para una cintilla, la feature UI debe verificar la clave real
o limitar el indicador al recurso que el almacén realmente despacha. No debe
usar casts de ids para simularlo.

### Fase 3 — extras: válidos, pero posteriores al board

1. **Dashboard honesto:** debe contar el mismo conjunto que lista, dar un
   estado propio a obras sin ítems y reemplazar emojis por Lucide, conforme a
   `docs/design.md`. Depende de que los claims de F095 estén activos en UI para
   que operarios/tiempos dejen de ser ceros engañosos.
2. **Surtido visible:** es correcto conectar el picking persistido, sin nueva
   lógica de inventario. Debe entrar junto al board o inmediatamente después,
   no como un sistema alterno de stock.
3. **Dirección/contacto en Instalaciones:** es una mejora independiente, útil
   para el instalador y de bajo riesgo, pero no debe retrasar el loop de
   fabricación por obra.

Estos tres cambios no deben agregarse a F095 ni adelantarse sobre el board.

### Fase 4 — polish y re-critique: correcto como cierre, no como sustituto

`$impeccable polish` y una nueva critique son apropiados una vez que la nueva
interacción exista. Antes de eso no podrían mejorar el score por el defecto
estructural principal. Al implementarse UI, deben respetarse tokens,
componentes/Lucide, foco visible, reduced motion, responsive estructural y
componentes extraídos si `FabricScreen` supera el presupuesto de 400–600 líneas.

## Orden de ejecución confirmado

1. **Completar y revisar F095** (única activa; dominio/backend, sin UI).
2. **Crear y ejecutar F096**: FabricScreen v2 board por obra, incluido wiring
   de claim y picking con la clave verificada.
3. Crear slices separados para dashboard/surtido/instalaciones, priorizando el
   dashboard y surtido que completen el flujo de fábrica.
4. Ejecutar polish y critique sobre el módulo resultante.

## Fuentes revisadas

- `docs/roadmap-screens/00-overview.md` — M3 y separación Ingeniería/Fábrica.
- `docs/roadmap-screens/03-fabrica.md` — contrato v2, métricas, claim y límites.
- `docs/roadmap-screens/05-implementation-phases.md` — baseline anterior y
  reglas de entrega por fases.
- `docs/production-module.md` — decisiones D9/D10 y roadmap de producción.
- `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md` — límites de
  producto, dominio/UI y convenciones.
- `feature_list.json`, `progress/current.md` y diff local — estado efectivo de
  F095 y exclusión de una segunda feature concurrente.
