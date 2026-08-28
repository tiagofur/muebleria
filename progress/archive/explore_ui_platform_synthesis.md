# Síntesis Apple HIG × Material 3 para Muebles

> **Resultado:** Muebles no necesita “verse mitad Apple y mitad Google”. Necesita una sola gramática propia: **Apple orienta la experiencia y el oficio; Material 3 estructura el sistema y su cobertura**. La identidad del taller aparece mediante superficies tonales por área, sin copiar materiales, iconos ni componentes de ninguna marca.
>
> **Alcance:** diagnóstico y dirección de diseño. No es una implementación ni una auditoría visual pantalla por pantalla.
>
> **Fecha de contraste:** 2026-08-18. Fuentes externas: únicamente documentación oficial vigente de Apple y Material Design.

## Decisión en una mirada

| Pregunta | Decisión para Muebles |
|---|---|
| ¿Qué aporta Apple? | Jerarquía, familiaridad, contenido primero, feedback proporcionado, precisión de interacción, menor modalidad, teclado y productividad de escritorio. |
| ¿Qué aporta Material 3? | Roles de color, tokens, estados completos, componentes sistemáticos, accesibilidad y layouts adaptativos por tamaño de ventana. |
| ¿Qué aporta Muebles? | Lenguaje visual propio del taller: preciso, calmado y operacional; color de proceso, datos legibles, unidades correctas y prevención de errores costosos. |
| ¿Cómo colorear cada área? | **Tinte ambiental de superficie completa**, no saturación completa: canvas, header y chrome reciben roles tonales del área; las superficies de trabajo permanecen neutrales o apenas teñidas. |
| ¿Qué no se mezcla? | Liquid Glass simulado + elevation Material; SF Symbols + Lucide; FAB/shapes expresivas de Google + chrome macOS; colores de área usados como estado; componentes Apple y Material copiados literalmente en la misma pantalla. |

## 1. Diagnóstico de la documentación actual

### Lo que ya está bien

`docs/PRODUCT.md` define correctamente el registro: una herramienta profesional usada durante horas, bajo presión y con errores potencialmente caros. Sus principios de tarea primero, prevención de errores, consistencia y progressive disclosure son la base correcta.

`docs/design.md` ya tomó la decisión conceptual adecuada: “ejecución Apple × sistema Material”. También contiene buenas restricciones de producto: una acción primaria por contexto, tokens, estados de interacción, jerarquía de elevación, densidad compacta, tablas para comparar, cards para contenido heterogéneo y copy específico de taller.

Esto coincide con la orientación actual de Apple hacia **jerarquía, armonía y consistencia**, y con su énfasis en controles reconocibles, estructura consistente y feedback claro ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)). También coincide con Material 3 al tratar estados, color y layouts como un sistema, no como decoración ([Material 3](https://m3.material.io/), [States](https://m3.material.io/foundations/interaction/states/overview)).

### Lo que debe corregirse o aclararse

1. **La regla de color de área contradice el objetivo actual.** `docs/design.md §3.2.1` limita el área al sidebar, item activo e icon-chip, y prohíbe explícitamente superficies completas. El resultado inevitable es que la identidad se corta al entrar al contenido. La nueva dirección debe reemplazar esa prohibición por una regla de **atmósfera tonal completa y restringida**.
2. **“Apple” se usa a veces como etiqueta para decisiones locales.** `translateY(1px)`, 150–250 ms o una sombra concreta pueden ser buenas decisiones de Muebles, pero no deben presentarse como mandatos Apple. Apple sí exige que botones personalizados tengan estado presionado y que el feedback sea claro; la traducción visual exacta pertenece al sistema local ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)).
3. **La formulación “claridad, deferencia, profundidad” quedó histórica.** La HIG actual enmarca el sistema con jerarquía, armonía y consistencia y hoy incluye Liquid Glass. Muebles debe conservar claridad y profundidad como principios propios, pero citar la HIG vigente sin fingir que una web app reproduce el material del sistema ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)).
4. **No está definida la cascada completa del tema por área.** Hay rampas, pero faltan roles como `area-canvas`, `area-chrome`, `area-container`, `on-area` y sus estados. Sin esos roles, cada pantalla inventará cuánto y dónde teñir.
5. **Falta separar densidad visual de tamaño de objetivo.** Un escritorio puede tener filas compactas y targets de mouse precisos; una superficie touch necesita targets mayores sin convertir todo el layout en una app móvil gigante. Apple distingue tamaños recomendados por plataforma y pide espacio suficiente entre controles ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)).
6. **La guía de pantallas es extensa, pero le falta una matriz transversal.** Botones, formularios, tablas, dialogs y toolbars están descritos por secciones; conviene agregar una tabla normativa que diga qué componente usar según tarea, jerarquía, dispositivo y nivel de interrupción.

## 2. Modelo coherente de fusión

### Capa A — Apple: comportamiento y oficio

Tomar de Apple:

- **Jerarquía antes que ornamento.** Importancia por posición, alineación, contraste y lectura; lo principal aparece primero y lo relacionado se agrupa. Apple recomienda ubicar lo importante según orden de lectura, alinear para facilitar escaneo y usar progressive disclosure ([Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- **Familiaridad y consistencia.** Una misma acción se reconoce y se comporta igual en toda la app. Esto valida la ambición de unificar vocabulario de botones, formularios, listas y estados ([Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)).
- **Feedback proporcional y cercano.** El estado debe mostrarse junto al objeto afectado; una confirmación ligera no merece un dialog y una pérdida irreversible sí puede interrumpir ([Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)).
- **Menor modalidad en escritorio.** Las pantallas grandes permiten mostrar más contenido en menos niveles y reducir dialogs, sin perder densidad confortable. Teclado, shortcuts y precisión del pointer son capacidades de primera clase ([Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)).
- **Entrada de datos que previene errores.** Preferir selección sobre tipeo cuando existe un conjunto conocido; validar dinámicamente; aceptar pegado/drag cuando simplifica la tarea ([Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data)).
- **Botones inequívocos.** Un botón inicia una acción inmediata, necesita un press state y el estilo más prominente se reserva para la acción más probable ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).
- **Direct manipulation solo cuando es real.** Reordenar, arrastrar o escanear puede ser directo; siempre con respuesta inmediata y alternativa por teclado/botón. No inventar gestos propios para acciones estándar ([Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)).

No tomar literalmente de Apple:

- Liquid Glass, vibrancy, SF Symbols, geometrías de hardware o titlebars de macOS.
- Valores `pt`, componentes nativos o convenciones exclusivas de AppKit/iOS trasladadas 1:1 a web.
- El mínimo visual de macOS como excusa para targets touch pequeños.

### Capa B — Material 3: arquitectura del sistema

Tomar de Material 3:

- **Roles semánticos de color.** Diseñar pares de superficie/contenido y containers tonales, en vez de asignar hex sueltos por componente ([Color roles](https://m3.material.io/styles/color/roles)).
- **Estados completos.** Enabled, disabled, hover, focused, pressed y dragged cuando aplique; Material recomienda dos indicadores visuales para estado y consistencia entre componentes ([States](https://m3.material.io/foundations/interaction/states/overview)).
- **Layout adaptativo, no “desktop encogido”.** Feed, list-detail y supporting pane son patrones canónicos que cambian entre breakpoints compact, medium y expanded ([Canonical layout examples](https://m3.material.io/foundations/layout/canonical-examples/overview)).
- **Catálogo de componentes como contrato.** Botones, text fields y dialogs deben compartir anatomy, estados, spacing, shape y accesibilidad ([Buttons](https://m3.material.io/components/buttons/guidelines), [Text fields](https://m3.material.io/components/text-fields/guidelines), [Dialogs](https://m3.material.io/components/dialogs/guidelines)).
- **Accesibilidad desde tokens y componentes.** Contraste, focus, labels, targets y significado redundante forman parte del sistema ([Accessible design](https://m3.material.io/foundations/accessible-design/overview)).
- **Motion tokenizado.** Usar motion para continuidad, transición y estado, no como coreografía. La expresividad es opcional; la herramienta no necesita adoptar todo M3 Expressive ([Material 3](https://m3.material.io/)).

No tomar literalmente de Material:

- Dynamic color derivado del wallpaper: destruiría la identidad por proceso y la predictibilidad operacional.
- FAB como CTA universal, navigation rail Android, elevación decorativa o cards para todo.
- La biblioteca de shapes y morphing de M3 Expressive en formularios/tablas profesionales.
- Componentes Android copiados visualmente dentro de un shell con lenguaje macOS.

### Capa C — Muebles: la decisión final

La regla de desempate propuesta:

1. **Si afecta comprensión, flujo o prevención de errores:** gana la necesidad del taller.
2. **Si afecta jerarquía, modalidad, feedback o interacción de escritorio:** orienta Apple.
3. **Si afecta tokens, variantes, estados, responsive o accesibilidad:** estructura Material 3.
4. **Si es identidad visual:** decide Muebles; ninguna plataforma se copia.

En una frase: **Apple define cómo se siente hacer el trabajo; Material define cómo el sistema evita excepciones; Muebles define cómo se ve y qué significa.**

## 3. Color por área aplicado a toda la pantalla

### Estrategia: “atmósfera tonal”, no “pantalla pintada”

El usuario tiene razón en el problema: el color no puede terminar en el menú lateral y el título. Pero la solución no es bañar cada área con un color saturado. Eso reduciría contraste, fatigaría durante ocho horas y competiría con estados de éxito, alerta y error.

Cada ruta debe declarar un `area-context` que alimenta una familia de roles:

| Rol | Uso | Intensidad recomendada |
|---|---|---|
| `area-canvas` | Fondo completo del `main`; garantiza continuidad del área | Casi neutro, tinte perceptible pero bajo |
| `area-chrome` | Page header, toolbar, tabs sticky y borde de transición | Un paso más visible que canvas |
| `area-container` | Selección, inspector contextual, resumen activo, empty-state | Tinte medio; nunca detrás de mucho texto sin validar contraste |
| `area-strong` | Icono, indicador activo, gráfico o acento contextual | Color de área accesible |
| `on-area` | Texto/icono sobre containers tonales | Tono oscuro derivado y verificado |
| `area-state-hover/pressed/focus` | State layers del contexto | Derivados del rol, no opacidades improvisadas |

Aplicación espacial:

```text
sidebar → identifica navegación
main canvas completo → mantiene la atmósfera del área
page header + toolbar → ancla la tarea actual
cards/tablas/formularios → superficie neutral para máxima legibilidad
selección/inspector/empty state → container tonal del área
status/error/success → colores semánticos globales, nunca color de área
```

### Asignación propuesta

| Área | Familia | Sensación | Rutas típicas |
|---|---|---|---|
| Ventas | Teal contenido | Relación, avance comercial, claridad | Dashboard comercial, Cotizaciones, Clientes, Vitrina |
| Ingeniería | Indigo | Precisión, estructura, profundidad técnica | Muebles, Estructuras, Componentes, Catálogos |
| Producción | Naranja taller | Actividad física, secuencia, atención operacional | Órdenes, Producción, Embarques, Instalaciones |
| Overview/config | Neutral tintado por brand | Visión transversal, administración | Estado de Planta, Usuarios, Ajustes |

Reglas duras:

- Primary action sigue siendo brand global. El color de área indica **lugar**, no prioridad de acción.
- Success/warning/danger/info indican **estado** y nunca cambian por área.
- Una card estándar no recibe fondo de área solo “para que haya color”. El área vive en el canvas; la card existe porque contiene una unidad de trabajo.
- Tablas conservan body neutral. Header, fila seleccionada, focus y summary pueden usar roles tonales.
- El significado siempre incluye texto/icono/forma; nunca solo color. Apple también pide no depender del color y asegurar variantes para apariencias y contraste ([Color](https://developer.apple.com/design/human-interface-guidelines/color), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)).
- Light, dark e increased-contrast requieren tokens propios; no invertir números automáticamente.
- Antes de fijar valores, validar contraste sobre **cada par foreground/surface**. No basta validar una rampa aislada.

## 4. Reglas concretas por componente

### Botones y acciones

- **Una primaria por nivel de contexto**, como ya exige `design.md`; si el header tiene la acción de ciclo de vida, la tab no repite otra primaria.
- Orden de jerarquía: `primary` → `secondary/outlined` → `ghost` → `icon`; `danger` expresa rol destructivo, no mayor prominencia por defecto.
- Los labels usan verbo + objeto. Icon-only solo para acciones universales y con tooltip/`aria-label`.
- Press, hover, focus-visible, disabled y loading son obligatorios. El press state puede ser cambio tonal + desplazamiento mínimo local; documentarlo como lenguaje Muebles, no como “estilo Apple”.
- Acciones frecuentes viven cerca del objeto o en toolbar; las infrecuentes y relacionadas van a “Más”. Apple recomienda elegir deliberadamente los items de toolbar y agruparlos por función ([Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)).
- No adoptar FAB: en desktop desconecta la acción de su contexto y rompe la gramática del header/toolbar.

### Formularios

- Agrupar por decisiones del usuario, no por estructura de base de datos: Identidad, Medidas, Costos, Producción.
- Campos numéricos muestran unidad en label/suffix y formatean sin destruir el valor en edición.
- Selección, autocomplete o picker antes que texto libre cuando el catálogo ya conoce las opciones.
- Validación inline al cambiar/blur según el tipo de dato; resumen de errores al guardar si hay varios. Error = qué pasó + cómo corregirlo.
- Labels persistentes; placeholder solo como ejemplo, nunca reemplaza label.
- Campos críticos incluyen hint corto y consecuencias; los obvios no acumulan texto auxiliar.
- Desktop: grids de dos columnas solo para campos relacionados y cortos; mobile: una columna y orden semántico.

### Cards, listas y tablas

- **Tabla** para comparación densa y multicolumna; **lista** para jerarquía/navegación; **card** para contenido heterogéneo, visual o una unidad accionable. Apple reconoce tablas multicolumna para productividad compleja ([Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)).
- No convertir filas en card apiladas en desktop. Preservar headers, alineación, sticky columns cuando aplique y números tabulares a la derecha.
- Selección de fila: background tonal de área + indicador no cromático; hover no debe confundirse con selected.
- Acciones de fila aparecen por contexto sin saltos de layout; teclado y touch deben poder descubrirlas.
- Evitar nested cards. Para supporting information usar pane, section o disclosure.
- En expanded width, favorecer list-detail/supporting pane sobre abrir dialogs para lectura o edición compleja; Material documenta ambos como layouts canónicos ([Canonical layout examples](https://m3.material.io/foundations/layout/canonical-examples/overview)).

### Navegación y organización

- Sidebar para áreas pares y estables; puede colapsar por ancho, pero la arquitectura de información no cambia de nombre según viewport.
- Mantener títulos únicos y el vocabulario del dominio: Cotizaciones, Ingeniería, Producción, Embarques.
- Agrupar por el flujo real del taller, no por tipo técnico de entidad. El color sigue esa misma taxonomía.
- En ventanas angostas: drawer/sidebar modal. En medium: rail/compact sidebar con labels accesibles. En expanded: sidebar + list-detail/supporting pane.
- Permitir ocultar la sidebar en escritorio para trabajo focal; Apple recomienda poder ocultarla cuando el contenido necesita espacio ([Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)).
- No usar color fijo en cada icono inactivo. El área se expresa en la superficie y selección; inactivos permanecen neutrales.

### Dialogs, drawers y panes

- Dialog solo para decisión breve, confirmación crítica o edición acotada que necesita preservar contexto.
- Inspector/pane para edición compleja, lectura comparativa o trabajo iterativo. Full-page workspace para tareas con múltiples secciones/tabs.
- Confirmación destructiva nombra objeto, consecuencia, reversibilidad y CTA específico.
- Orden visual: título → consecuencia/datos → acciones. Foco inicial seguro, trap, `Esc`, y devolución al trigger.
- Nunca usar dialog como navegación o para mostrar tablas extensas.
- La elevación distingue capas, pero no mezclar un dialog “Apple glass” con cards Material elevadas: un solo tratamiento de superficie Muebles.

### Motion y feedback

- 150–250 ms sigue siendo un buen rango local para controles, pero debe expresarse como token del producto.
- Motion explica: press, cambio de estado, expansión, reordenamiento o continuidad entre lista y detalle.
- Nada de entrada coreografiada, bounce, morphing ornamental ni blur ornamental.
- Operaciones largas: progreso con objeto y etapa; operaciones cortas: feedback inmediato y resultado cerca del objeto.
- `prefers-reduced-motion` cambia desplazamiento por crossfade/instantáneo sin perder feedback.

## 5. Desktop, touch y adaptación

No diseñar “una versión desktop” y “una versión touch” con dos sistemas. Diseñar una misma semántica con densidades y layouts adaptativos.

| Contexto | Navegación | Layout | Targets | Acciones |
|---|---|---|---|---|
| Compact/touch | Drawer o barra compacta contextual | Una columna; detail reemplaza list | ≥44×44 CSS px como baseline local | Visible; no depender de hover |
| Medium | Sidebar compacta | List-detail selectivo; formularios 1–2 col | Touch-safe | Toolbar reducida + overflow |
| Expanded/desktop | Sidebar persistente/ocultable | List-detail o supporting pane | Densidad mouse sin targets microscópicos | Toolbar + shortcuts + acciones de fila |

Reglas:

- Responsive es cambio de estructura, no solo reducción de font/padding.
- Hover mejora, nunca revela la única vía de acceso.
- Atajos aceleran acciones pero no las esconden.
- Bottom actions críticas se evitan en desktop: una ventana puede quedar parcialmente fuera de pantalla; Apple lo advierte para macOS ([Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- Touch en taller supone manos ocupadas, brillo variable y ruido: contraste, targets, confirmación visual y undo importan más que microdensidad.

## 6. Cambios necesarios en `docs/design.md`

### Prioridad 1 — Cambiar la regla de área

Reemplazar §3.2.1 por:

- taxonomía única de áreas y rutas;
- roles `area-canvas/chrome/container/strong/on-area`;
- matriz de uso por superficie;
- reglas light/dark/increased-contrast;
- ejemplos permitidos y prohibidos;
- contraste mínimo por par de tokens.

Eliminar la frase “Nunca pinta superficies completas”. Sustituirla por: **“El área tiñe el canvas y el chrome de la pantalla completa con baja cromaticidad; no rellena indiscriminadamente superficies de trabajo ni sustituye colores semánticos o brand.”**

### Prioridad 2 — Reescribir el ADN Apple × Material

- Actualizar Apple a jerarquía, armonía, consistencia, familiaridad, feedback y productividad de escritorio.
- Conservar claridad/contenido primero como principios de Muebles.
- Aclarar que Liquid Glass no se reproduce en web.
- Identificar qué reglas son decisiones locales (duración, translate, shadows), aunque estén inspiradas en principios de plataforma.

### Prioridad 3 — Agregar contratos transversales

1. Matriz de jerarquía de acciones y colocación.
2. Matriz card/list/table/pane/dialog.
3. Anatomía y estados de field, select, checkbox, switch, segmented control y date/number inputs.
4. Densidades desktop/touch separadas de target size.
5. Tabla de responsive por compact/medium/expanded y patrón canónico.
6. Matriz de color de área × superficie × estado.
7. Checklist de accesibilidad para light/dark/increased contrast.

### Prioridad 4 — Convertir la guía en documento verificable

Cada regla nueva debe incluir:

- intención;
- token/componente aplicable;
- ejemplo correcto;
- anti-ejemplo;
- criterio de QA observable.

Ejemplo de criterio: “Al cambiar de Ingeniería a Producción, el canvas y chrome cambian de familia tonal; cards y tabla conservan legibilidad neutral; primary, focus y estados mantienen significado global.”

## 7. Criterios de aceptación para el futuro diagnóstico visual

- [ ] Cada ruta tiene un área única y documentada.
- [ ] Canvas + header/chrome expresan esa área en toda la pantalla.
- [ ] Primary action no cambia de significado cromático entre áreas.
- [ ] Success/warning/danger/info nunca usan tokens de área.
- [ ] Cada pantalla tiene una sola acción primaria por nivel.
- [ ] Formularios agrupan decisiones y validan junto al campo.
- [ ] Tablas comparables siguen siendo tablas; cards no son el default.
- [ ] Expanded usa pane antes que modal para trabajo complejo.
- [ ] Compact no depende de hover y mantiene targets touch.
- [ ] Todos los controles cubren enabled/hover/focus/pressed/disabled/loading/error cuando aplica.
- [ ] Contraste se verifica por par foreground/surface en cada tema.
- [ ] Motion explica estado y tiene alternativa reduced-motion.
- [ ] Apple y Google aparecen como fuentes de principios, nunca como skins copiadas.

## 8. Conclusión

La mezcla correcta no es estética sino **operacional**. Apple aporta el estándar de claridad, jerarquía, familiaridad y respuesta que hace que una herramienta desaparezca durante el trabajo. Material 3 aporta la disciplina de roles, estados, componentes y adaptación que evita que cada pantalla sea una excepción. Muebles debe convertir ambos en una identidad propia: color de proceso sobre toda la atmósfera de la pantalla, superficies de trabajo calmadas, datos impecables y acciones colocadas donde ocurre la tarea.

El cambio documental más urgente es inequívoco: la prohibición actual de color de área en superficies completas debe reemplazarse por un sistema tonal de superficie completa, medido y semántico. Así la app puede sentirse coherente, bella y propia sin convertirse ni en un clon de Apple ni en una demo de Material.

## Fuentes oficiales consultadas

### Apple

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data)
- [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)
- [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

### Material Design 3

- [Material Design 3](https://m3.material.io/)
- [Color roles](https://m3.material.io/styles/color/roles)
- [States](https://m3.material.io/foundations/interaction/states/overview)
- [Accessible design](https://m3.material.io/foundations/accessible-design/overview)
- [Canonical layout examples](https://m3.material.io/foundations/layout/canonical-examples/overview)
- [Buttons](https://m3.material.io/components/buttons/guidelines)
- [Text fields](https://m3.material.io/components/text-fields/guidelines)
- [Dialogs](https://m3.material.io/components/dialogs/guidelines)

