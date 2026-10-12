# Architectural Decision Records (ADRs) — Granete

Este directorio contiene los registros de decisiones arquitectónicas (ADRs) del proyecto Granete.
Cada ADR documenta una decisión significativa de diseño, su contexto, las alternativas evaluadas
y las consecuencias técnicas de su adopción.

---

## 1. Reglas de autoridad y ciclo de vida de los estados

El estado de un ADR es determinante para saber si rige el comportamiento del producto:

| Estado | Significado y autoridad operativa |
| --- | --- |
| **Accepted** | **Decisión ratificada y vigente.** Gobierna la arquitectura y el diseño del dominio correspondiente. Los contratos y la implementación deben alinearse con esta decisión. |
| **Accepted target** | **Objetivo arquitectónico ratificado.** La arquitectura final acordada está definida; la implementación puede ser incremental o estar en progreso. |
| **Proposed** | **Propuesta técnica en evaluación.** Expresa una intención o diseño propuesto, pero **NO autoriza por sí sola cambios de implementación ni nuevos contratos** en el producto hasta ser ratificada formalmente. |
| **Superseded** | **Decisión histórica reemplazada.** La decisión fue superada por un ADR posterior. Se conserva para entender la evolución y justificación del cambio. |
| **Redirect** | **Alias de compatibilidad.** Archivo preserved para mantener enlaces históricos de issues y PRs tras el renombramiento de un ADR. |

> **Aviso para agentes:** Si un documento o issue referencia un ADR con estado `Proposed`, no lo trates como un contrato aceptado. Verifica en el código fuente, en los tests y en `docs/architecture/` el estado real de adopción antes de construir suposiciones.

---

## 2. Catálogo canónico de decisiones arquitectónicas

| ID | Título | Fecha | Estado verificado | Dominio / Documento canónico |
| --- | --- | --- | --- | --- |
| [ADR-0001](0001-sketchup-authoring-granete-manufacturing-truth.md) | SketchUp authoring, Granete manufacturing truth | 2026-08-24 | **Accepted** | Integración SketchUp ↔ Backend Go ([`docs/architecture/sketchup-backend-web-integration-excellence.md`](../architecture/sketchup-backend-web-integration-excellence.md)) |
| [ADR-0001 (alias)](0001-sketchup-authoring-muebles-manufacturing-truth.md) | Alias histórico de ADR-0001 | — | **Redirect** | Redirección a ADR-0001 |
| [ADR-0002](0002-parametric-furniture-library-architecture.md) | Universal Decoupled Architecture for Parametric Furniture Library | 2026-08-24 | **Accepted** | Librería paramétrica desacoplada ([`docs/architecture/parametric-furniture-library.md`](../architecture/parametric-furniture-library.md)) |
| [ADR-0003](0003-project-owned-furniture-identity-and-versioned-design.md) | Project-Owned Furniture Identity and Versioned Design | 2026-08-26 | **Accepted** | Hilo digital y versiones de diseño ([`docs/architecture/project-design-digital-thread.md`](../architecture/project-design-digital-thread.md)) |
| [ADR-0004](0004-sketchup-native-component-entity-model.md) | Native SketchUp Component Entity Model | 2026-08-26 | **Accepted target** | Modelo de entidades nativas en SketchUp ([`docs/architecture/sketchup-native-entity-model.md`](../architecture/sketchup-native-entity-model.md)) |
| [ADR-0005](0005-multi-organization-tenancy.md) | Multi-Organization Tenancy con membresías multi-rol | 2026-08-26 | **Accepted** | Tenancy multi-organización y RLS ([`docs/architecture/organization-foundation-v2.md`](../architecture/organization-foundation-v2.md)) |
| [ADR-0006](0006-membership-lifecycle-and-organization-relationships.md) | Explicit membership lifecycle and organization relationships | 2026-08-28 | **Proposed** | Ciclo de vida de membresías y gates de organización |
| [ADR-0007](0007-bounded-revocable-sessions-and-client-credentials.md) | Bounded revocable sessions and client credentials | 2026-08-31 | **Accepted** | Sesiones acotadas, pairing y credenciales de cliente ([`docs/architecture/organization-foundation-v2.md`](../architecture/organization-foundation-v2.md)) |
| [ADR-0008](0008-manufacturing-library-releases-overlays-and-local-store.md) | Manufacturing library releases, overlays and persistent local store | 2026-09-17 | **Accepted** | Distribución de librerías de manufactura y overlays ([`docs/architecture/manufacturing-library-platform.md`](../architecture/manufacturing-library-platform.md)) |
| [ADR-0009](0009-opening-front-system.md) | Opening / Front System separated from Body Construction | 2026-10-05 | **Proposed** | Sistema de aperturas y frentes ([`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)) |
| [ADR-0010](0010-construction-variants.md) | Construction Variants for the Body: fronteras y contrato inicial | 2026-10-10 | **Proposed** | Variantes constructivas del cuerpo ([`docs/architecture/construction-variants.md`](../architecture/construction-variants.md)) |

---

## 3. Relación con la documentación de arquitectura viva

Los ADRs son inmutables tras su aceptación, salvo para registrar adiciones de estado (ej. sub-fases completadas en ADR-0007) o marcar una supersesión formal.

La documentación viva y detallada de cada dominio reside en:
- Contrato marco de arquitectura: [`docs/architecture.md`](../architecture.md)
- Documentos de arquitectura especializada: [`docs/architecture/`](../architecture/)

Cuando un ADR es aceptado, la especificación técnica completa y sus actualizaciones operativas se mantienen en el documento correspondiente bajo `docs/architecture/` o en los contratos OpenAPI.

---

## 4. Guía para proponer un nuevo ADR

Para proponer una nueva decisión arquitectónica:

1. **Crear el archivo:** Nombrarlo `NNNN-<slug-en-ingles>.md` con el siguiente número secuencial de cuatro dígitos (ej. `0011-nombre-de-la-decision.md`).
2. **Encabezado estándar:**
   ```markdown
   # ADR-NNNN — Título descriptivo en inglés o bilingüe

   - **Status:** Proposed
   - **Date:** YYYY-MM-DD
   ```
3. **Secciones requeridas:**
   - **Context:** El problema arquitectónico, las restricciones del proyecto y por qué se requiere una decisión formal.
   - **Decision:** La decisión técnica adoptada o propuesta de forma inequívoca.
   - **Alternatives considered:** Qué otras soluciones se evaluaron y por qué fueron descartadas.
   - **Consequences:** Consecuencias positivas, negativas y riesgos derivados de la decisión.
4. **Estado inicial:** Todo nuevo ADR debe nacer como `Proposed`. Solo pasa a `Accepted` mediante revisión y ratificación formal del propietario o arquitecto líder del proyecto.
