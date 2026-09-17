# Dossier Canónico del Piloto MERIVOBOX (#670-E)

## 1. Introducción y Propósito

Este documento establece la procedencia técnica auditada, clasificación de datos y reglas de ensamble para el piloto comercial **Blum MERIVOBOX**, validado de extremo a extremo en Granete (#670-E).

**Regla arquitectónica central:**
MERIVOBOX es **datos + recipe + variants + assets**, NUNCA arquitectura especial.
El núcleo del resolver, los motores de variantes, BOM, Proyectar 3D y la extensión de SketchUp operan de forma puramente genérica sin condicionales de marca (`if blum`, `if merivobox`), evaluando contratos declarativos.

---

## 2. Fuentes Técnicas y Autoridad de Procedencia (R1)

Cada dato clasificado como `REAL_VERIFIED` cuenta con una autoridad técnica verificable y trazable:

- **Fabricante:** Julius Blum GmbH, Industriestrasse 1, 6973 Höchst, Austria.
- **Documento Primario:** *Katalog und Arbeitshandbuch 2024/2025* (Blum Catalogue and Technical Manual 2024/2025), edición en español.
- **Identificador de Catálogo:** KA-160/24-ES (publicación técnica oficial 2024).
- **Sección y Capítulos:**
  - Capítulo 8: *Box-Systeme* (Sistemas Box) → Subsección *MERIVOBOX modular mit Zarge* (MERIVOBOX modular con perfil/costado).
  - Pp. 240–241: Panorama del programa y alturas (N, M, K, E).
  - Pp. 242–243: Cajón estándar altura M — Guías de cuerpo 450/453 BLUMOTION y fijaciones de frente.
  - P. 245: *Planung — Zuschnitt für 16 mm Spanplatten* (Planificación — Medidas de corte para tableros de 16 mm: fondo y trasera de madera).
- **Fecha de Verificación:** 2026-09-17.

### Matriz Exhaustiva de Clasificación de Datos

| Parámetro / Magnitud | Valor Técnico | Clasificación | Autoridad / Referencia Exacta |
|---|---|---|---|
| **Sistema y Familia** | MERIVOBOX cajón estándar | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 240 |
| **Altura nominal de perfil (costado)** | Altura M (perfil 91 mm) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, ref. "Zarge M" |
| **Espacio mínimo interior en altura ($KH_{min}$)** | 107 mm | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, cota de montaje M |
| **Longitudes nominales evaluadas ($NL$)** | 450 mm, 500 mm | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, tabla de guías |
| **Profundidad mínima interior de cuerpo ($LT_{min}$)** | $NL + 3\text{ mm}$ (clearance físico de guía) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, esquema de cotas $LT_{min} = NL + 3$ |
| **Clearance de instalación del módulo en el piloto** | 3 mm (clearance exacto de guía) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242 |
| **Capacidad de carga nominal** | 40 kg (guía BLUMOTION) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, código 450.4501B / 450.5001B |
| **Corte de fondo de cajón: Ancho** | $LW - 58\text{ mm}$ ($LW$ = ancho interior cuerpo) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245, fórmula $LW - 58$ |
| **Corte de fondo de cajón: Longitud** | $NL - 16\text{ mm}$ | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245, fórmula $NL - 16$ |
| **Corte de fondo de cajón: Espesor** | 16 mm | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245, "16 mm Spanplatten" |
| **Corte de trasera de madera: Ancho** | $LW - 58\text{ mm}$ | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245, fórmula $LW - 58$ |
| **Corte de trasera de madera: Altura** | 69 mm (para altura M) | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245, cota 69 mm en tabla Altura M |
| **Corte de trasera de madera: Espesor** | 16 mm | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 245 |
| **Composición comercial del Kit** | 1 par de costados M, 1 par de guías 40kg, fijaciones | `REAL_VERIFIED` | Blum KA-160/24-ES, p. 242, lista de componentes de pedido |
| **Origen y orientación de MountFrame** | Base inferior trasera ($[15, 5, 2]\text{ mm}$ local) | `PILOT_ASSUMPTION` | Preparación local de malla #668 (no publicado en catálogo CAD) |
| **Geometría visual 3D en CI** | Malla sintética con bounding box verificado | `SYNTHETIC_FIXTURE` | Protección de propiedad intelectual de modelos CAD propietarios |
| **Matriz CNC de perforaciones en costados** | Patrón 32 mm en caras interiores de laterales | `UNKNOWN_NOT_USED` | Reservado para integración futura de manufactura (#17) |
| **Mecanismo TIP-ON / servo-drive** | Unidades mecánicas/eléctricas de expulsión | `UNKNOWN_NOT_USED` | Fuera de alcance (#20) |

---

## 3. Separación de Datos Comerciales y Geometría Visual (R2)

Para garantizar cumplimiento legal y estabilidad en CI sin depender de descargas externas de CAD propietario de terceros:

1. **Entorno Automatizado / CI (`SYNTHETIC_FIXTURE`):**
   - Se utilizan modelos geométricos sintéticos con las medidas externas verificadas del componente ($500 \times 91 \times 16\text{ mm}$ para costado, $500 \times 30 \times 20\text{ mm}$ para guía).
   - Valida al 100% las transformaciones matriciales, rigidez (`scale = [1,1,1]`, `det = +1.0`), composición de MountFrames y paridad multi-renderer.
   - En documentación y evidencia se consigna explícitamente como `SYNTHETIC_FIXTURE`.
2. **Entorno Host / Manual (SketchUp real con modelos autorizados):**
   - Si un usuario u organización dispone de un modelo `.skp` provisto legítimamente por Blum o su distribuidor, pasa por el flujo estándar de #668: subida → medición de bounds → preparación de `MountFrame` → publicación → pin inmutable.

---

## 4. Definición Geométrica: $W$ vs. $LW$ y Desacoplamiento de Paneles (R3)

Para evitar asumir lateral de 16 mm en el core o esconder la regla de $LW$:

- **$W$ (`moduleOuterWidthMm`):** Ancho exterior total del mueble.
- **`leftPanelThicknessMm` / `rightPanelThicknessMm`:** Espesores de los costados del mueble (resueltos por la autoridad de mueble/layout, típicamente 15 mm, 16 mm, 18 mm o 19 mm).
- **$LW$ (`moduleInnerWidthMm`):** Ancho libre interior del cuerpo:
  $$LW = W - (\text{leftPanelThicknessMm} + \text{rightPanelThicknessMm})$$

> [!IMPORTANT]
> La recipe de MERIVOBOX recibe como parámetro geométrico de ancho interior la magnitud $LW$ (`assembly_width = LW`).
> **La recipe NUNCA asume $LW = W - 32$.**
> Si el mueble usa laterales de 18 mm ($LW = 600 - 36 = 564\text{ mm}$), la recipe calcula:
> - Fondo ancho: $564 - 58 = 506\text{ mm}$.
> - Miembro derecho colocado en $X = 564\text{ mm}$.
> Los 16 mm del fondo y la trasera son el espesor del material del cajón (`MaterialBoard` del catálogo), no de los laterales del mueble.

---

## 5. Política Comercial y Mapeo BOM (R4)

La estructura comercial de pedido de Blum MERIVOBOX para un cajón estándar comprende:
- **Línea de Compra BOM (Kit Comercial):**
  - Código: `KIT-MERIVOBOX-M` (Unidad: `set`).
  - Contiene: 2 costados de cajón (izq/der), 2 guías de cuerpo BLUMOTION (izq/der), 2 fijaciones frontales (tornillo o EXPANDO).
- **Mapeo a Miembros Visuales en la Recipe:**
  - `side-left`: `bomRole = 'included_in_kit'`
  - `side-right`: `bomRole = 'included_in_kit'`
  - `runner-left`: `bomRole = 'included_in_kit'`
  - `runner-right`: `bomRole = 'included_in_kit'`
- **Piezas Fabricadas:**
  - `comp-bottom`: fondo de tablero aglomerado/melamina de 16 mm.
  - `comp-back`: trasera de tablero aglomerado/melamina de 16 mm.
  - Se imputan a la demanda de corte y tableros (despiece industrial), nunca al catálogo de herrajes comprados.

---

## 6. Validación de Boundaries en Variantes (R6)

El conjunto de variantes discretas evalúa dos longitudes nominales:
- **Variante A:** $NL = 450\text{ mm}$.
- **Variante B:** $NL = 500\text{ mm}$.
- **Regla de Holgura:** $LT_{min} = NL + \text{clearance}$ donde $\text{clearance} = 3\text{ mm}$ (`REAL_VERIFIED`, Blum KA-160/24-ES, p. 242).

### Puntos Críticos de Prueba (Boundary Testing)

| Profundidad Interior ($LT$) | Espacio Neto ($LT - 3$) | Variante Seleccionada | Comportamiento Esperado |
|---|---|---|---|
| **$449.9\text{ mm}$** | $446.9\text{ mm} < 450$ | Ninguna | `AssemblyVariantNotFoundError` (fail-closed, sin nearest) |
| **$453.0\text{ mm}$** | $450.0\text{ mm} == 450$ | **NL 450 mm** (Variante A) | Límite inferior exacto de Variante A |
| **$480.0\text{ mm}$** | $477.0\text{ mm}$ | **NL 450 mm** (Variante A) | Punto interior estable de Variante A |
| **$502.9\text{ mm}$** | $499.9\text{ mm} < 500$ | **NL 450 mm** (Variante A) | Punto justo por debajo del límite de Variante B |
| **$503.0\text{ mm}$** | $500.0\text{ mm} == 500$ | **NL 500 mm** (Variante B) | Límite inferior exacto de Variante B |
| **$530.0\text{ mm}$** | $527.0\text{ mm}$ | **NL 500 mm** (Variante B) | Punto interior estable de Variante B |

---

## 7. Independencia entre Visual Pins y Resolución Mecánica (R7)

La resolución matemática, geométrica y comercial del ensamble es pura y determinista:
$$\text{Agregado} + \text{Parámetros} \longrightarrow \text{ResolvedAssembly}$$

- Los `visualBindings` (assetId, revisionId, SHA256, MountFrame) se asocian de forma desacoplada.
- **Regresión garantizada:** El resultado de evaluar la misma recipe y dimensiones con visual pins completos versus sin visual pins produce:
  - Exactamente las mismas variantes seleccionadas.
  - Exactamente las mismas traslaciones y bases de miembros.
  - Exactamente las mismas dimensiones de piezas fabricadas.
  - Exactamente los mismos ítems y cantidades en el BOM.
  - Única diferencia: disponibilidad de renderizado (`exact` vs. `proxy`).

---

## 8. Persistencia Real de Snapshots Históricos (R5)

La integridad de Snapshots históricos (#670-B) se verifica de extremo a extremo:
1. Creación de la recipe de Agregado en storage persistente.
2. Inserción de `AgregadoRevision` R1 en PostgreSQL real.
3. Resolución de la configuración en un proyecto y attach de visual pins exactos.
4. Congelamiento mediante `FreezePublishedAssemblySnapshot` e inserción en la tabla `agregado_assembly_snapshots` (S1).
5. Publicación de `DesignRevision` D1 referenciando S1.
6. Mutación del catálogo mutable: creación de `AgregadoRevision` R2 con dimensiones o variantes distintas.
7. Relectura de D1 a través de las APIs productivas:
   - Devuelve invariablemente el snapshot S1 (con R1).
   - Consume las variantes históricas congeladas.
   - Preserva `assetRevisionId` exacto, sin consultar el catálogo mutable ni sustituir por R2.
