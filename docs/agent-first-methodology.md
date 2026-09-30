# Metodología Agent-First: organizar el repo para que el primer lector sea un agente

**Estado:** propuesta ratificable por el owner (2026-09-29). Destilada de lo
que Granete ya ejecutó (split del plugin SketchUp + contrato G-ODD) y anclada
en evidencia externa; es teoría + reglas + plan de adopción, no toca código.
El primer caso de aplicación formal es
`docs/backend-agent-first-refactor-plan-2026-09-27.md` (pendiente de issue).

**Tesis en una línea:** el primer lector y el primer escritor de este repo son
agentes de IA; los humanos son arquitectos de contexto, verificadores y
decididores. Agent-First (AF) es el conjunto de reglas de organización de
archivos, símbolos, contratos, docs y verificación que maximiza la efectividad
del agente **sin degradar** la calidad para humanos — porque casi todas sus
reglas son un subconjunto medible del clean code, no una alternativa.

---

## 1. División de trabajo que habilita

| Rol | Humano | Agente |
| --- | --- | --- |
| Define alcance, specs y aceptación | ✅ (issue, ODD/SDD) | propone borradores |
| Lee y navega el repo | auditador puntual | **primario** (grep + mapas) |
| Escribe código/docs/tests | excepción, pequeño | **primario** |
| Verifica (CI, tests, readback) | gate final e integración | ejecuta hasta verde |
| Decide (merge, publish, producto) | **exclusivo** | jamás |

Es la formalización de la etapa actual del proyecto: escribir código a mano
deja de ser el cuello de botella; definir bien y verificar rápido pasa a serlo.
El proceso G-ODD ya vigente en este repo (§7) formaliza esta división desde el
lado del proceso; la industria (agentic engineering, spec-driven development)
corrobora la misma dirección.

## 2. Genealogía: Granete ya ejecutó Agent-First antes de nombrarlo

Esta metodología no importa un modelo externo: **nombra y sistematiza lo que
este repo ya probó con escritura por agentes en producción.**

**El split del plugin SketchUp fue la primera ejecución.** `dialog.html`
(7.512 líneas) y `dialog_controller.rb` (3.766 líneas / 239 métodos) se
partieron en bridges y módulos por dominio — fases A–D, moves mecánicos,
`rake verify` verde en cada commit — y la Phase B de #848 (C4.1–C4.9) se
ejecutó módulo a módulo hasta el smoke en host real PASS y auditoría final
aceptada (2026-09-27).

**Su `apps/sketchup-extension/AGENTS.md` es el artefacto canónico AF** y el
patrón a replicar; cada pieza implementa principios de §4:

| Pieza del AGENTS.md del plugin | Principio |
| --- | --- |
| Mapa de bridges: interacción → dueño/no-dueño → "empieza aquí" → prueba focal | P3, P6 |
| Mapa JS por síntoma: "problema → módulo → prueba focal" | P2, P6 |
| Mandatory reading acotada + routing por tipo de trabajo | P1, P6 |
| Boundary de ownership no negociable + reglas de identidad | P3 (+ invariantes de raíz) |
| Plan obligatorio pre-código (14 puntos) + checklist cross-surface | P5, P6 |
| Verificación por comandos exactos; sin PASS simulado | P5, P7 |

**G-ODD es la mitad de proceso, también propia.** El contrato portátil
(`docs/demo/software-factory-human-start.md`) define lanes Direct / ODD / SDD
explícito, un writer por issue, reviewer fresco, niveles V0/V1/V2 y one-shot
con ronda de corrección única. No adoptamos SDD externo: en este repo SDD es
un lane bajo demanda explícita del humano *dentro* de G-ODD, y TDD es práctica
de verificación dentro de P5. La evidencia externa de §3 explica por qué esto
funciona; la práctica ya está validada aquí.

## 3. Base científica: hallazgo → regla de diseño

Cada regla de AF nace de un mecanismo medido, no de preferencia estética.

| # | Hallazgo | Fuente | Regla que lo explota |
| --- | --- | --- | --- |
| E1 | **Lost in the middle**: el rendimiento sigue una curva en U según la posición de la información; más contexto puede *empeorar* la respuesta | [Liu et al. 2023](https://arxiv.org/abs/2307.03172) (TACL 2024) | Contexto mínimo suficiente; info crítica al inicio/fin del artefacto; nunca "volcar el repo" |
| E2 | **Context rot**: en 18 LLMs el rendimiento degrada de forma desigual a medida que crecen los tokens de entrada | [Chroma Research 2025](https://github.com/chroma-core/context-rot) | Presupuesto de contexto por tarea; archivos y docs pequeños y autocontenidos |
| E3 | **Presupuesto de atención**: la capacidad de procesar contexto es finita; compaction y sub-agentes existen para protegerla | [Anthropic 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Unidades navegables: el agente carga lo justo por paso, no todo junto |
| E4 | **La interfaz agente-computadora (ACI) decide**: información concisa, salida simple y guardrails cambiaron el éxito en SWE-bench más que el modelo; quitar ACI en ablations derrumbaba la tasa | [SWE-agent, NeurIPS 2024](https://arxiv.org/abs/2405.15793) | El repo *es* la interfaz: nombres greppables, estructura predecible, linter/tests como guardrails de edición |
| E5 | **La localización es el cuello de botella** del trabajo a nivel repo; la recuperación iterativa supera al contexto gigante | [RepoCoder, EMNLP 2023](https://arxiv.org/abs/2303.12570) | Símbolos únicos y buscables; un grep debe bastar para encontrar al dueño de algo |
| E6 | **El feedback de ejecución corrige**: unit tests y resultados de ejecución mejoran significativamente la precisión del modelo | [Self-Debug, Chen et al. 2023](https://arxiv.org/abs/2304.05128) | Verificación de un comando, rápida y barata, en cada commit |
| E7 | **Un mapa compacto ahorra tokens**: tree-sitter + PageRank caben en un presupuesto de tokens y reemplazan leer archivos enteros | [Aider repo map](https://aider.chat/docs/repomap.html) | AGENTS.md por directorio como "repo map" humano+máquina: tabla de dominios→dueños→pruebas |
| E8 | **La spec en el centro** estabiliza la ejecución por agentes | G-ODD (contrato interno, en producción); corroborado por [Spec Kit](https://github.com/github/spec-kit) y [AGENTS.md](https://agents.md) | Issue aprobada + artefacto ODD único como autoridad de alcance; docs con disparador y audiencia explícitos |

Sobre la numerología (500 líneas, 60 métodos): los mecanismos E1–E5 son
evidencia; los números exactos son **heurísticas de ingeniería calibrables por
las métricas de §6**, no dogma. AF se define por sus mecanismos y sus métricas,
no por sus constantes.

## 4. Principios

### P1 — Presupuesto de contexto finito
La ventana grande no es gratis (E1, E2, E3). Cada tarea debe poder resolverse
leyendo **pocos archivos pequeños**, no pocos archivos enormes.

- Archivos de producción: presupuesto soft ~500 líneas (Go/TS/Ruby por igual);
  jamás multi-dominio aunque esté dentro del presupuesto.
- Funciones: una intención, legibles de una pantalla.
- Todo lo que un agente necesita para una tarea vive en ≤ ~1 pantalla de índice
  (AGENTS.md local) + los archivos dueños que éste apunta.

### P2 — Greppabilidad y unicidad de símbolos
El agente navega con búsqueda de texto, no con índices IDE (E4, E5).

- Un símbolo (función, método, ruta, test) tiene un nombre estable y único al
  menos dentro de su paquete; idealmente global.
- Prohibido: identificadores generados dinámicamente, reflexión que oculte el
  dueño de un comportamiento, o nombres que sólo difieren por convención
  implícita (ya cubierto por la invariante raíz "sin IDs derivados").
- El nombre de un archivo debe predecir su contenido: `design_publish.go`
  contiene publication de designs, y nada más.

### P3 — Un dueño por dominio
Cada capacidad del producto tiene exactamente un handler, un storage, un
domain y un test focal dueños (patrón ya probado en el split del plugin
SketchUp y propuesto para backend en el plan 2026-09-27).

- La raíz de composición (`RegisterRoutes`, `DialogController`) es una tabla
  corta que delega; nunca lógica.
- Interfaces dios prohibidas: partir por dominio embebido (`AuthStore`,
  `DesignStore`, …) con grupos de ~30–60 métodos.

### P4 — Contratos explícitos y generados
La única fuente de verdad vive en un artefacto y todo lo demás se genera
(OpenAPI → clientes TS/Go; fixtures de paridad cuando la regla vive en dos
runtimes). Sin drift manual ni "compatibilidad inferida" (invariante raíz).

### P5 — Verificación de un comando
El agente propone; la máquina decide (E4 guardrails, E6). Cada nivel de
verificación es **un solo comando** documentado y reproducible:

| Nivel | Comando | Tiempo esperado |
| --- | --- | --- |
| Por edit | linter/typecheck del paquete | segundos |
| Por commit | tests del paquete afectado (sin DB externa cuando sea posible) | < minutos |
| Por fase/PR | suite completa + CI | la que sea, pero **uno** |

- Verde por commit en refactors mecánicos; fail-closed: infra ausente es
  BLOCKED/NOT_RUN, nunca PASS (invariante raíz).

### P6 — Docs como sistema de navegación, no narración
Las docs son el "repo map" (E7) y la spec (E8); se escriben para ser
**buscadas**, no leídas de corrido.

- Cada doc declara disparador y audiencia en el header ("léeme cuando…").
- AGENTS.md raíz = mapa de entradas (ya existe); un AGENTS.md por directorio de
  app con la tabla `dominio → dueño → prueba focal` (el backend aún no tiene
  uno: Fase G del plan).
- Cada archivo nuevo empieza con header de contrato de 1–2 líneas: qué expone,
  quién lo consume.
- Prohibido: docs turísticas sin disparador, duplicar invariantes de la raíz
  (se referencian).

### P7 — Determinismo y reproducibilidad
Un agente necesita que el mismo comando dé el mismo resultado (y un humano
reviewer también): runtimes pinneados, seeds explícitas en tests flaky,
comandos versionados en docs, DBs de test desechables por contrato
`test-database-isolation.md`.

### P8 — Subconjunto de clean code, no su sustituto
Nombres descriptivos, bajo acoplamiento, alta cohesión, contratos: todo
principio humano sobrevive. AF agrega tres restricciones que el clean code
dejó implícitas: **presupuestos medibles de tamaño** (P1), **unicidad
greppable** (P2) y **verificación de un comando** (P5). Si una regla AF
empeora el código para humanos, está mal aplicada.

## 5. Anti-patrones (con la evidencia del propio repo)

El diagnóstico backend 2026-09-27 no es hipotético: los cinco archivos más
editados desde julio son exactamente los monolitos.

| Anti-patrón | Ejemplo real | Costo observable |
| --- | --- | --- |
| Archivo dios | `internal/api/handlers.go` 2.867 líneas, ~17 responsabilidades | 75 commits, review ruidosa, contexto caro para toda feature |
| Interfaz dios + stub espejo | `Store` 290 métodos; stub de 277 en `handlers_test.go` 4.375 líneas | "impuesto de feature": cada endpoint toca 3 archivos gigantes |
| Función de composición infinita | `RegisterRoutes` ~650 líneas / 281 rutas | 104 commits |
| Archivo multi-dominio | `storage/projects.go` 2.481 (CRUD + catálogo + eventos + JSONB) | 67 commits |
| Tipos de todos los agregados en uno | `domain/types.go` 1.082 | 78 commits |

Mecanismo del costo: cada feature atraviesa los monolitos → el agente debe
cargar archivos enormes (E1/E2), localizar dentro de ruido (E5) y el churn
genera conflictos entre writers. El split en dueños por dominio reduce el
blast radius por feature a 1 archivo por capa.

## 6. Métricas (la metodología es falsable)

Baseline congelada en el plan backend; estas métricas se miden antes/después y
los presupuestos se recalibran con ellas.

| Métrica | Cómo se mide | Qué demuestra |
| --- | --- | --- |
| Tamaño máximo de archivo prod | `wc -l` fuera de `generated/` | P1 |
| Blast radius por feature | archivos tocados por issue típica | P3 |
| Churn concentrado | % commits que tocan el top-5 archivos | anti-patrón dios |
| Costo de localización | archivos leídos hasta encontrar al dueño de un comportamiento | P2/P6 |
| Tiempo de ciclo | issue abierta → merge | beneficio integrado |
| Conflictos entre writers | rebases/merges con conflicto por PR | P3 |

## 7. Integración con lo existente (dos pilares propios, cero reemplazos)

AF es la mitad **estructura** del sistema agent-first de este repo; G-ODD es
la mitad **proceso**. Ambas son metodología propia, portátil (adapter
Gentle-AI nativo o repo manual) y ya probadas con escritura por agentes.

| Pieza | Rol bajo AF |
| --- | --- |
| G-ODD (lanes Direct/ODD/SDD explícito, un writer, reviewer fresco, V0/V1/V2) | Proceso: **quién** hace qué, con qué gates y evidencia |
| Esta metodología (AF) | Estructura: **cómo** son los artefactos que ese proceso lee y escribe |
| `AGENTS.md` raíz + `apps/sketchup-extension/AGENTS.md` | Índices de navegación ya vigentes; el del plugin es el patrón a replicar (§2) |
| `docs/conventions.md` | Ya fija presupuestos TS; AF los unifica por stack y añade Go |
| Invariantes de raíz (server authority, RLS, APIs generadas…) | Intocables; AF las referencia, jamás duplica |
| Plan backend 2026-09-27 | Segunda aplicación del patrón; primer piloto formal bajo la metodología nombrada |

SDD y TDD externos no sustituyen nada: SDD es aquí un lane bajo demanda
explícita del humano dentro de G-ODD; TDD es práctica de verificación dentro
de P5. Las referencias externas (Spec Kit, agentic engineering) son
corroboración de dirección, no autoridad.

## 8. Plan de adopción

1. **Ratificación (owner, sin issue):** aprobar este doc y sus presupuestos;
   ajustar cifras si el owner quiere otros umbrales.
2. **Piloto backend (issue + ODD, lane sustancial):** ejecutar el plan
   2026-09-27 tal cual (fases A–G, moves mecánicos, verde por commit). La
   primera ejecución fue el plugin; éste es el primer piloto formal bajo la
   metodología nombrada, con baseline y métricas ya definidas.
3. **Medición:** 2–4 semanas post-merge, medir §6 contra baseline; recalibrar
   presupuestos numéricos con datos, no con opinión.
4. **Extensión:** `packages/storage` y `apps/web` (auditar monolitos TS con el
   mismo método: diagnóstico de churn → plan de fases → moves mecánicos);
   headers de contrato en archivos nuevos como convención desde ya.
5. **Documentación:** docs nuevas nacen con disparador+audiencia (P6); índice
   de AGENTS.md por directorio completo al cerrar 4.

### 8.1 Regla de extracción al tocar (refactor incremental, desde ya)

Sin esperar al piloto: cada vez que un cambio autorizado toca un monolito,
la parte tocada emigra a su archivo dueño. El monolito queda correcto y verde
todo el tiempo y muere de inanición — strangler fig aplicado a archivos, o
"deja el campamento más limpio de lo que lo encontraste" (boy scout rule,
Clean Code) ejecutado como move verificado.

| Aspecto | Regla |
| --- | --- |
| Cuándo | El diff toca funciones/bloques de un archivo anti-patrón (§5) o sobre presupuesto (P1) |
| Hacia dónde | Archivo destino ya propuesto en el plan backend si aplica (`server.go`, `routes_auth.go`, `store_catalog.go`…); si no, el archivo dueño del dominio más cercano; si no existe, se crea con header de contrato |
| Cómo | Move mecánico tal cual: sin cambiar firmas, rutas, payloads ni mensajes; nombres de tests intactos |
| Presupuesto | Máx. **una** extracción por PR; sólo lo que el diff ya toca — nunca "ya que estoy, parto el archivo completo" |
| Contrato G-ODD | Commit separado `refactor(<dominio>): extraer <cosa> de <monolito>`, declarado en el plan de la issue/ODD como paso acotado, verde por commit. No es refactor oportunista: es esta regla ratificada por el owner (2026-09-29) |
| Exclusiones | Hotfix/freeze, ventanas de release, `generated/`, y cuando el bloque tocado no puede moverse sin cambio de comportamiento (entonces no se mueve; se registra como deuda) |
| Progreso | Sin ledger nuevo: `git log --follow` del monolito + métricas §6 re-medidas; el churn de §5 prioriza solo — los monolitos más tocados se parten primero |

Complemento que corta el crecimiento desde ya: **lo nuevo no entra a
monolitos**. Una función/handler/ruta nueva nace directamente en su archivo
dueño, aunque sus vecinos todavía vivan en el monolito; un monolito sólo
pierde líneas.

**No-goals permanentes:** no reescribir por moda (moves mecánicos o nada), no
big-bang de reestructura de paquetes, no relajar invariantes de raíz, no
duplicar catálogo/docs, no métricas inventadas (se miden o no se afirman).

## 9. Referencias

- [Lost in the Middle: How Language Models Use Long Contexts — Liu et al., arXiv:2307.03172 / TACL 2024](https://arxiv.org/abs/2307.03172)
- [Context Rot: How Increasing Input Tokens Impacts LLM Performance — Chroma Research 2025](https://github.com/chroma-core/context-rot)
- [Effective context engineering for AI agents — Anthropic, 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering — NeurIPS 2024, arXiv:2405.15793](https://arxiv.org/abs/2405.15793)
- [RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation — EMNLP 2023, arXiv:2303.12570](https://arxiv.org/abs/2303.12570)
- [Teaching Large Language Models to Self-Debug — Chen et al. 2023, arXiv:2304.05128](https://arxiv.org/abs/2304.05128)
- [Aider repository map (tree-sitter + PageRank)](https://aider.chat/docs/repomap.html)
- [GitHub Spec Kit — spec-driven development](https://github.com/github/spec-kit)
- [AGENTS.md — convención abierta](https://agents.md)
- [Strangler Fig Application — Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html) (§8.1); boy scout rule — *Clean Code*, Robert C. Martin

**Fuentes internas primarias** (la metodología se destila de ellas; las
externas arriba explican por qué funcionan):

- `apps/sketchup-extension/AGENTS.md` — artefacto canónico AF (mapa de
  bridges, mapa JS por síntoma, mandatory reading, boundary de ownership,
  plan pre-código, verificación)
- `docs/demo/software-factory-human-start.md` — contrato portátil G-ODD
  (lanes, un writer, reviewer fresco, V0/V1/V2, one-shot, publicación)
- `docs/backend-agent-first-refactor-plan-2026-09-27.md` — diagnóstico y plan
  backend (segunda aplicación del patrón)
