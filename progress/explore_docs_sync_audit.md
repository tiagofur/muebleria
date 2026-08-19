# Auditoría de sincronización — diagnóstico UI/UX → fuentes de verdad

**Fecha:** 2026-08-19  
**Pregunta:** ¿los hallazgos de los tres `explore_ui_*.md` ya están incorporados en `docs/` para que agentes futuros sostengan el estándar?  
**Veredicto:** **parcialmente.** `docs/design.md` incorporó bien el contrato que correspondía a F100–F102, pero los diagnósticos completos siguen siendo backlog activo: hay contradicciones verificables con rutas/código y varios contratos transversales todavía no están escritos de forma suficiente.

## Evidencia revisada

- Diagnósticos: `progress/explore_ui_design_system_audit.md`, `progress/explore_ui_ux_flow_critique.md`, `progress/explore_ui_platform_synthesis.md`.
- Fuentes de verdad solicitadas: `docs/design.md`, `docs/PRODUCT.md`, `docs/architecture.md`, `docs/production-module.md`.
- Cambios recientes: F100 `72b0582`, F101 `b02fa83`, F102 `183e1cd` y cierre `573ebd7`.
- Código canónico de rutas: `apps/web/src/routes.ts` (`NAV_PATHS`). No se modificó código ni WIP.

## Lo que sí quedó actualizado (F100–F102)

| Cambio | Estado | Evidencia documental |
|---|---|---|
| F100 — atmósfera tonal por área | **Incorporado** | `docs/design.md` §3.2.1 define contexto, roles, superficies neutrales, AA y QA; ya no prohíbe teñir canvas/chrome. |
| F101 — frame y jerarquía de acciones | **Incorporado** | `docs/design.md` §4.1a exige `PageHeader`/`PageToolbar`, una primaria por nivel y overflow accesible. |
| F102 — tabs con semántica | **Incorporado** | `docs/design.md` §4.0a define exactamente dos familias, ARIA/teclado, estados y overflow responsive. |
| ADN Apple × Material | **Incorporado parcialmente** | `docs/design.md` §2.1 separa Chrome/movimiento (Apple) de estados/roles/a11y (M3), pero aún presenta algunos valores locales como si fueran prescripción de plataforma y no documenta explícitamente qué no se copia (p. ej. Liquid Glass). |

## Hallazgos P1

| Fuente / hallazgo | Estado | Dónde quedó / evidencia | Recomendación concreta |
|---|---|---|---|
| Auditoría + UX: color de área cortado antes del contenido | **Incorporado** | `docs/design.md` §3.2.1; F100 (`72b0582`) añade tokens, `data-area-context` y pruebas AA. | Mantener §3.2.1 como contrato; toda nueva pantalla debe consumir roles de área, nunca tintes locales. |
| Auditoría: contraste AA de texto, placeholder y warning | **Incorporado parcialmente** | §4.8 exige AA y placeholder ≥4.5:1; F100 prueba sólo los 16 pares de área. No hay contrato de `text-secondary-ui` vs muted decorativo ni prueba de warning/login. | Añadir roles legibles por superficie y test automático para texto, placeholders y semánticos; no declarar resuelto hasta migrar los valores fallidos. |
| Auditoría: modales paralelos sin contrato accesible único | **Incorporado parcialmente** | §4.3 y §4.8 ordenan dialog/focus trap/Esc/retorno de foco, pero no nombran `Modal`/`FullscreenDialog` como infraestructura única ni cubren los overlays existentes. | Documentar una matriz Modal / FullscreenDialog / Drawer, un único primitive obligatorio y plan de migración de excepciones. |
| Auditoría: escape hatch de tokens y hardcodes | **Incorporado parcialmente** | `docs/design.md` §8–9 exige tokens y detector; `docs/PRODUCT.md` también. La documentación no describe excepciones válidas (datos, escena 3D) ni hay gate que cubra CSS+TSX. | Definir política de excepción y un validador de tokens/literales que cubra CSS y `style={{…}}`. |
| Auditoría: formularios y controles sin anatomía/estados universales | **Incorporado parcialmente** | §3.5/§3.6.1 fija radio y matriz general; faltan contratos de `Field`, Input, Select, Textarea, Checkbox, loading/error y adopción. | Añadir §5.x de primitives de formulario con anatomía, estados, a11y y QA; después migrar CSS local. |
| Auditoría + síntesis: touch real <44px | **Pendiente** | §4.0 reconoce explícitamente que `--touch-min` sigue en 40px y dice migrarlo «al tocar CSS». | Convertir 44px en requisito ejecutable del token/QA; separar hit-area de tamaño visual. |
| Auditoría UX: IA canónica/navegación por JTBD | **Incorporado parcialmente** | `docs/design.md` §4.1 y `docs/production-module.md` §5 describen la reorg vigente, pero no el modelo propuesto de áreas de trabajo + obra transversal ni una tabla completa navId→path→roles→acción. | Resolver la IA como decisión de producto antes de cambiar nav; publicar una única matriz derivada de `NAV_PATHS` y RBAC. |
| UX: Producción tiene hubs/fuentes de verdad paralelos | **Incorporado parcialmente** | `docs/production-module.md` §5 y §10.5 describen M2 y la migración futura; no define aún el cierre de `Órdenes` ni una obra operativa unificada. | Convertir M2 en spec ejecutable: ownership de cada vista, condición para retirar Órdenes y no duplicar datos. |
| UX: rutas y IA documentadas no coinciden con código | **Pendiente** | `docs/design.md` §4.1/§6.7a–d y `docs/production-module.md` todavía dicen `/fabrica`, `/planta`, `/embarques`, `/instalaciones`; `apps/web/src/routes.ts` usa `/production`, `/plant-board`, `/shipments`, `/installations`. También persisten `fabric`/`production` y `embarques`/`shipments` mezclados. | Corregir docs contra `NAV_PATHS` y marcar aliases históricos sólo como legacy. Esta es la brecha más peligrosa para agentes futuros. |
| UX: esqueleto visual/acciones no universales | **Incorporado parcialmente** | F101 y §4.1a ya fijan `PageHeader`/`PageToolbar` y gramática; su alcance fue sólo Cotizaciones, Ingeniería y Producción. | Mantener la regla, inventariar pantallas restantes y prohibir aliases/headers locales al migrarlas. |

## Hallazgos P2

| Fuente / hallazgo | Estado | Dónde quedó / evidencia | Recomendación concreta |
|---|---|---|---|
| Auditoría: breakpoints fragmentados | **Incorporado parcialmente** | §4.0 define 639/640/900/1100/1280, pero conserva `cards-3: 1100px` pese a que el audit reportaba token/test en 1024 y no provee política de excepciones/container queries. | Elegir valores canónicos contra código, corregir drift y exigir justificación para cada breakpoint nuevo. |
| Auditoría: performance sin lazy por ruta | **Pendiente** | Ninguna fuente revisada define presupuesto de bundle, lazy routing o medición. | Documentar performance budget y patrón de lazy route + skeleton antes de implementarlo. |
| Auditoría: sin escala z-index | **Pendiente** | `docs/design.md` §3.3.1 define capas visuales L0–L4, no tokens ni orden z-index ejecutable. | Agregar `--z-*` y una tabla de apilamiento; migrar `9999`/valores locales. |
| Auditoría: elevación contradice la regla | **Pendiente** | §3.3.1 sigue diciendo L1 «borde + shadow-xs/sm», y a la vez prohíbe combinar borde + shadow-sm. | Elegir un tratamiento L1 único y actualizar primitives/documento juntos. |
| Auditoría: status badges duplicados | **Incorporado parcialmente** | §5.2 define vocabulario único y meta-chip neutral, pero la auditoría encontró familias locales aún existentes. | Cambiar el texto de «migran/se eliminan» por estado real + plan; migrar equivalentes antes de afirmar completitud. |
| Auditoría: motion con duraciones locales | **Incorporado parcialmente** | §3.6 define tokens y reduced motion, pero no existe inventario/criterio para reemplazar los valores locales. | Añadir regla de excepción y lint/QA para duraciones; migrar por componente. |
| Auditoría: drift `design.md` ↔ tokens/código | **Pendiente** | Persisten rutas obsoletas, botones apuntan a `catalogs.css` aunque F101 usa `common/buttons.css`, y breakpoints/targets contradicen ejecución. | Declarar `tokens.css` y `routes.ts` fuentes ejecutables; `design.md` debe contener intención, vínculo y estado `implemented/planned/deprecated`. |
| Auditoría: dark/increased contrast sin decisión | **Pendiente** | §3.2.1 correctamente dice que requieren feature dedicada, pero §3.2 aún afirma que HSL «prepara dark mode» sin decisión de producto. | Registrar decisión explícita: light/high-contrast hoy; dark sólo tras investigación de contexto nocturno. |
| UX: error/loading/feedback sin contrato único | **Incorporado parcialmente** | §4.4–4.7 nombra toast/empty/loading y §8 exige estados, pero no incluye `idle/success/error/stale`, retry ni regla de toast global. | Agregar contrato de estados de pantalla y mutación, incluidos retry/aria-live/último dato. |
| UX + síntesis: umbral modal → drawer → ruta | **Incorporado parcialmente** | §4.2.1 y §4.3 cubren tabla/card/modal/ruta, no drawer ni umbrales de complejidad/draft guard. | Escribir la matriz interrupción/complejidad: modal ≤4 campos/una decisión; drawer/pane; workspace para líneas/tabs/guardado progresivo. |
| UX + síntesis: responsive ergonómico | **Incorporado parcialmente** | §4.0, §4.8 y DoD §8 cubren smoke 390/768/1280 y touch, pero el requisito efectivo sigue 40px y no hay matriz compact/medium/expanded. | Completar tabla de adaptación por layout, navegación, targets y acciones; verificar visualmente al habilitar tooling. |
| Síntesis: cards/listas/tablas/panes como decisión normativa | **Incorporado parcialmente** | §5.3 decide cards vs tabla y §4.2 clasifica entidades; falta pane/list-detail y condiciones contra dialog. | Extender la matriz con lista, tabla, card, supporting pane, drawer y dialog, más criterios de QA. |

## Conclusión operativa

Los archivos `explore_ui_*.md` **no se pueden considerar completamente absorbidos**. Son evidencia histórica útil, pero el próximo agente debe tratar como autoridad actual únicamente a:

1. `docs/design.md` para F100–F102 y las reglas ya materializadas.
2. `apps/web/src/routes.ts` para paths reales hasta que los docs se sincronicen.
3. `docs/production-module.md` para el contrato de producto de Producción, verificando paths contra `NAV_PATHS`.

Prioridad documental inmediata: **sincronizar rutas/IDs de navegación y añadir una tabla canónica derivada de código.** Después: contrato de formulario/modal/drawer, contrastes ejecutables, targets 44px y estado real (planned/implemented) de cada primitive. Así los próximos agentes dejan de interpretar documentación aspiracional como hecho terminado.

skill_resolution: paths-injected
