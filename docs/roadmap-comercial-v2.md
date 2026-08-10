# Roadmap Comercial v2 — Única fuente de verdad

> **Estado:** ACTIVO. Este documento reemplaza como backlog canónico a:
> `docs/perfect-app-roadmap.md`, `docs/app-excellence.md` (§roadmap),
> `docs/IDEAS/roadmap.md` y `docs/prd.md §17`. Esos quedan como registro
> histórico; el trabajo vivo vive aquí + GitHub issues (`tiagofur/muebleria`).
>
> **Fecha:** 2026-08-10 · **Horizonte:** 12 meses a "producto vendible en LatAm"

---

## 0. Propuesta de valor (norte comercial)

> **Cotizador + BOM + Producción para carpinterías pequeñas y medianas de
> LatAm.** Más simple que Promob, más completo que Excel, en español, con 3D
> que vende y sin requerir SketchUp. Muebles de medidas cerradas (cocinas,
> clóset, baño, oficina). De $40–80/mes por taller.

**No competimos** con Promob en mueble complejo/paramétrico libre ni en
fotorrealismo de catálogo. **Competimos** en:
1. Tiempo de cotización (minutos, no horas).
2. BOM + corte + etiquetas listos para producir, no solo dibujar.
3. Curva de aprendizaje de horas, no semanas.
4. Precio accesible para el taller chico que Promob no atiende.

**Dos modos de uso coexisten** (decisión de producto):
- **Proyectar (50%):** diseño 3D → muebles al proyecto con colocación espacial.
- **Cotizar rápido (50%):** añadir muebles por catálogo sin abrir el 3D.

Ambos modos deben hacerse **bien**. El 3D no es decorativo: genera BOM y
coloca piezas en muros reales. La cotización sin 3D no es subproducto:
es el flujo rápido para el vendedor que sabe qué vende.

---

## 1. Decisiones de producto (cerradas)

| # | Decisión | Elección | Implicación |
|---|----------|----------|-------------|
| D1 | Flujo añadir muebles | **Mejorar flujo actual** (cotización → "sin colocar" → drag al muro) | No se construye barra catálogo izquierda tipo Promob. Se pule el puente cotización↔3D. |
| D2 | Acabados de herrajes | **Variantes predefinidas primero, capas después** | Cada herraje ofrece N acabados cerrados (cromado/negro/bronce/mate). Modelo de capas por componente queda congelado (F080). |
| D3 | Panel inspector | **Rediseño del PartInspector actual** | Reorganizar en secciones colapsables, no arquitectura nueva con tabs. |
| D4 | Gestión del roadmap | **Este doc + GitHub issues + feature_list.json + PRD §17** | Una sola fuente narrativa (este doc), trackeo operativo en GitHub. |

**Stack:** React 19 + R3F + three.js + Vite + Electron + Go + Postgres. **No
migra** a C#/Qt/nativo. El 99% del mercado es Windows 10/11; Chromium (vía
Electron) es el mismo motor que ya corre en esos PCs.

---

## 2. Fases del roadmap comercial

### Fase A — Proyectar pulido (6–8 semanas)

Hacer que el flujo "añadir mueble → colocarlo en 3D" sea fluido, obvio y
agradable. Es el corazón del "se siente como Promob" sin copiar la barra de
catálogo.

| ID | Feature | Tiempo | Deps |
|----|---------|--------|------|
| **F065** | Colocación drag-drop mejorada: ítem "sin colocar" → drag directo al muro/piso con preview fantasma, snap visual, feedback de validez (rojo si colisión, verde si ok) | 2–3 sem | — |
| **F066** | Inspector 3D rediseñado con secciones colapsables: Dimensiones / Material / Herrajes / Acabado / Avanzado. Reemplaza `PartInspector` actual | 2 sem | — |
| **F067** | Paleta de materiales con aplicación por drag: arrastrar material desde el panel al piso, muro o pieza seleccionada (raycast al soltar). "Pintar" la escena | 2–3 sem | F066 |

**Resultado Fase A:** un vendedor abre un proyecto, añade 6 muebles desde
cotización, los arrastra al muro en 3D, aplica materiales, y ve algo que "se
ve como Promob" en menos de 10 minutos.

---

### Fase B — Herrajes 3D completos (6–8 semanas)

Herrajes visibles con posición, rotación y acabado. Sin perforaciones
dinámicas todavía (eso es Fase Congelada F081).

| ID | Feature | Tiempo | Deps |
|----|---------|--------|------|
| **F068** | Geometrías 3D de herrajes adicionales: bisagra (cuerpo + copa), corredera telescópica, riel, pata nivelable. Extender `previewShape` y `HardwareMesh.tsx` más allá de knob/bar-pull/cup-pull | 2–3 sem | rama actual `feat/agregado-hardware-3d` |
| **F069** | Variantes de acabado para herrajes: catálogo de acabados (cromado/negro/bronce/mate/cepillado), selector en inspector, swap de material PBR al elegir. Migración aditiva `hardware_finishes` | 2–3 sem | F066, F068 |
| **F070** | Editor de placement de herrajes en 3D: gizmo de posición/rotación interactivo en el viewport, ajuste fino en inspector (mm y grados), multi-selección | 2 sem | F068, F069 |

**Resultado Fase B:** cada mueble muestra sus jaladeras, bisagras y
correderas en el lugar correcto con el acabado elegido. El cliente ve en la
cotización 3D "cómo queda realmente".

---

### Fase C — Producción y corte de valor (6–8 semanas)

El diferenciador real vs Promob: **no solo dibujás, producís**. Lo que el
taller necesita para cortar y armar, listo.

| ID | Feature | Tiempo | Deps |
|----|---------|--------|------|
| **F071** | Etiquetas Zebra/ZPL para impresoras térmicas: 1–3 tamaños comunes (ej. 100×50, 100×150 mm), con código de pieza, dimensiones, material, QR. Genera `.zpl` descargable + impresión directa vía CUPS | 2 sem | — |
| **F072** | PDF preview de corte visual para cortes manuales: dibuja las piezas como rectángulos empaquetados sobre el tablero estándar (ej. 2440×1830), con dimensiones y código. Para el taller que corta a mano | 2–3 sem | — |
| **F073** | CSV de plan de corte editable y configurable: columnas seleccionables, separador configurable, presets por taller. Más allá del CSV fijo actual | 1–2 sem | — |
| **F074** | Lista de piezas con perforaciones como datos estructurados: cada pieza lleva su lista de perforaciones (diámetro, posición, profundidad) como datos, no como geometría. Fluye al CSV y a la etiqueta | 2–3 sem | — |

**Resultado Fase C:** un taller produce un proyecto de punta a punta —cotizó,
vio el 3D, generó plan de corte, etiquetó las piezas con su Zebra, cortó a
mano con el PDF de corte, armó con la lista de piezas— sin tocar Excel ni
Software externo (salvo el optimizador de corte opcional).

> **Nota sobre optimizador de corte:** el nesting 2D nativo sigue fuera de
> alcance (decisión D5 heredada). El taller exporta al optimizador externo
> (Plantilla_Optimizer.xlsx o CSV) o corta a mano con F072. Si demanda real
> aparece, se evalúa nesting nativo post-Fase D.

---

### Fase D — Empaquetado y lanzamiento (4–6 semanas)

Salir al mundo. Producto en manos de talleres reales.

| ID | Feature | Tiempo | Deps |
|----|---------|--------|------|
| **F075** | Electron empaquetado + firma Windows: instalador `.exe` con `electron-builder`, firma con certificado, auto-update. Cierra issue #38 / F032 | 2–3 sem | — |
| **F076** | Onboarding + datos semilla para demo comercial: proyecto ejemplo (cocina L completa), catálogo con muebles LatAm, tour guiado de 3 pasos | 1–2 sem | F075 |
| **F077** | Prep venta: pricing tiers ($40/80/mes), landing minimal, doc de demo, script de venta para ferias/contactos | 1–2 sem | F075, F076 |

**Resultado Fase D:** producto instalable en Windows con doble clic, demo
lista para mostrar en una carpintería, modelo de cobro definido.

---

## 3. Congelado — Solo con clientes pagando

Estas features **no se empiezan** hasta tener al menos 3 talleres pagando
durante 3 meses. Son válidas como visión pero matan el time-to-market si se
adelantan.

| ID | Feature | Disparador |
|----|---------|------------|
| **F078** | SketchUp plugin (exportador de modelo → tu API). Captura usuarios que ya usan SketchUp | Cliente pide "trabajar en SketchUp" |
| **F079** | Render backend Blender headless (render premium, add-on pago) | Cliente pide imagen fotorrealista de catálogo |
| **F080** | Capas de acabado por componente de herraje (cuerpo cromado + base negra independiente) | Demanda de catálogo de herrajes complejos |
| **F081** | Perforaciones dinámicas tipo Promob Builder (CSG visual + export a CNC) | Cliente con CNC que necesita G-code |

**Razón del congelamiento:** cada una de estas es 4–12 semanas de trabajo
que no genera ingresos hasta que exista demanda probada. El riesgo de
adelantarlas es morir puliendo lo que nadie pidió.

---

## 4. Anti-scope (lo que NO vamos a hacer)

- **No** competir con Promob en mueble paramétrico libre ni fotorrealismo.
- **No** construir un modelador 3D tipo SketchUp. Si el cliente quiere
  modelar libre, integramos (F078, congelado).
- **No** migrar a C#/Qt/nativo. El stack actual cumple.
- **No** nesting 2D nativo hasta demanda probada (D5 heredada).
- **No** mobile nativo (iOS/Android apps) en este horizonte.
- **No** multi-idioma más allá de español/portugués en este horizonte.
- **No** marketplace de catálogos de terceros en este horizonte.

---

## 5. Issues abiertos existentes (reconciliación)

| Issue | Título | Se integra en |
|-------|--------|---------------|
| #254 | Producción: elevaciones separadas por ambiente | Mejora de Producción (dentro de Fase C, póstre a F072) |
| #255 | Producción: islas en planta y elevación dedicada | Mejora de Producción (dentro de Fase C, póstre a F072) |
| #256 | Producción: vistas planta y 3D multi-ambiente | Mejora de Producción (dentro de Fase C, póstre a F072) |

Estos tres son mejoras al módulo Producción ya funcional; no bloquean Fase A
ni B. Se cierran como parte de Fase C cuando se trabaje el PDF de corte y
elevaciones.

---

## 6. Métricas de éxito (12 meses)

| Métrica | Meta Fase D | Meta 12 meses |
|---------|-------------|---------------|
| Talleres en piloto gratis | 3–5 | — |
| Talleres pagando | — | 15–30 |
| MRR | — | $600–2400 USD |
| Tiempo de cotización (medición en taller) | < 30 min cocina L | < 15 min |
| Dogfood exitoso (cocina L + 6 muebles < 10 min) | 1 taller | 5 talleres |

---

## 7. Cómo se actualiza este doc

- **Fuente narrativa:** este archivo (`docs/roadmap-comercial-v2.md`).
- **Trackeo operativo:** GitHub issues con label `type:feature` + milestone
  por fase (`fase-a-proyectar`, `fase-b-herrajes`, etc.).
- **Registro histórico de features:** `feature_list.json` (F065+).
- **Contrato de producto:** `docs/prd.md §17` referencia este doc.
- Al cerrar una fase: marcar issues done, actualizar §17, mover métricas.

Al empezar una feature: crear rama `feat/F0XX-<slug>`, mover issue a
`status:approved`, actualizar `progress/current.md`.
