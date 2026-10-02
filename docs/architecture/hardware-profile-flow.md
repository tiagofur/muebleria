# Flujo de perfiles de herrajes y secuencia de entrega

> Compañero operativo de [hardware-profiles.md](hardware-profiles.md) (#912):
> el flujo de datos, la secuencia de issues y el handoff entre slices. No
> introduce conceptos nuevos; si contradice al contrato, gana el contrato.

## Flujo de datos

```text
[Autoría]                    [Biblioteca]                      [Resolve]

Config fábrica (#875)   Standard Granete
  └─ overlay #775         hardware ──┐
     (hardware.*)                    │
                         Hardware Profile        SketchUp/React declara
                           │  ▲                    intención de unión
              kind:        │  │ kind:                     │
        hardware_profile   │  └─ release publicada          │
                           │     (compile → publish:        │
                           │      manifiesto + blobs +      │
                           │      resource_refs)           │
                           │            │                    │
                           │            └── lectura pineada  │
                           │                (release exacto)│
Componente (definición)    │                             │
  └─ Side Assignment ──────┴─────────────────────────────┤
       (por cara canónica)                               ▼
                                              POST /furniture/authoring/resolve
                                                        │
                                   contacto verificado (A0a) + estaciones (A0b)
                                                        │
                                   receta del perfil pineado (TechnicalProfileID)
                                                        │
                                   operaciones por participante + provenance
                                                        │
                                   ┌────────────────────┴──────────────────┐
                                   ▼                                       ▼
                            Machining (DXF/CNC)                   Demanda de compra
                            (recipeRevision,                     (items × contactos
                             technicalProfileId)                 verificados × catálogo)
```

## Reglas de flujo

1. **Default vs override**: Standard define el perfil y su receta; el overlay
   de fábrica puede cambiar qué perfil aplica y parámetros permitidos; la
   asignación del componente específica por cara; la relationship autoreada
   puede fijar recetas exactas (hoy, camino `fixed-shelf-side`).
2. **El resolve solo acepta perfiles del release efectivo**: el snapshot
   reconstruye perfiles/recetas del contenido pineado, nunca de defaults
   actuales ni de catálogo live.
3. **Provenance cierra el círculo**: cada operación lleva
   `TechnicalProfileID/Revision` + `RecipeRevision`; cada línea de demanda
   lleva `hardwareId` — comprar y mecanizar salen del mismo modelo sin
   duplicar identidad.
4. **Fail-closed en cada frontera**: perfil inexistente/inactivo, revisión
   faltante, lado incompatible o receta roja dejan la unión no fabricable
   (terminal estructurado), nunca degradan a fallback.
5. **Publicar es parte del flujo**: sin fila en
   `library_release_resource_refs` el blob publicado no lo puede leer
   ninguna tenant. La publicación inserta/actualiza la ref de cada recurso
   del manifiesto dentro de la misma transacción que lo publica.

## Superficies (dónde tocar qué)

| Necesito… | Superficie | Nota |
|---|---|---|
| Registrar un herraje (código, unidad, precio) | `POST/PUT /api/catalog/hardware` + UI Catálogo | El precio nunca se copia al perfil. |
| Definir la solución de un contacto | `POST/PUT /api/catalog/hardware-profiles` (`revision` obligatoria) | Hoy el `recipe` no se acepta por API: lo escribe el seed (#955). |
| Decir a qué lado aplica | `PUT /api/catalog/components/{id}/side-assignments` (`{side, profileId}`) | Seis caras canónicas; `UNIQUE (component_id, side)`. |
| Fijar la receta de una unión concreta | `AuthoringRelationship.Recipes` en el resolve | Gana sobre la asignación por lado; sin recetas declaradas, entra la del perfil. |
| Publicar el Standard con los perfiles | `POST /api/manufacturing-libraries/standard/releases/{id}/publish` | Sólo `platform_admin`; irreversible. |
| Semilla de demo | `POST /api/seed` | Crea el primer perfil con receta y publica el draft Standard si la identidad es `platform_admin`. |

## Secuencia de entrega

Estado a 2026-10-01.

| Orden | Issue | Entrega | Puerta con la anterior | Estado |
|---|---|---|---|---|
| 1 | **#912** | Contrato de dominio + docs (este par de archivos) + fixture Go/TS | — | cerrada |
| 2 | #913 | Persistencia/API de perfiles (tabla, API generada, RLS, revisiones) | contrato #912 | cerrada |
| 3 | #918 | Kind `hardware_profile` en releases #772/#773 + pinning | #913 | cerrada |
| 4 | #916 | El resolve consume asignaciones/perfiles del release pineado; terminal→READY con perfiles reales | #918 | cerrada |
| 5 | #914/#915 | React: catálogo de perfiles + asignación por lado | #913 | cerradas |
| 6 | #875 | Config de fábrica: parametrización vía overlay (`hardware.`) | #916 + #775 | parcial: la política `joint.*`/`hardware.*` aún no alimenta el resolvedor |
| 7 | #917 | Demanda de compra desde items de perfil | #916 | cerrada |
| 8 | #955 | Superficie de publicación Standard + seed demo del primer perfil con receta | #918 | cerrada (PR #956) |
| 9 | #919 | Golden vertical: gabinete → perfil → contacto → machining + demanda | todas | abierta |
| 10 | #920 | Consolidación de docs canónicas | #912–#918 | este documento |
| 11 | #958 | Browser gate del flujo releases → rebase → resolución | #944 | abierta |
| 12 | #879 | Consumidor CNC nativo (BHX) sobre la salida neutral | salida neutral completa | abierta |

## Handoff para agentes

- Antes de tocar Hardware/Profiles/assignments/recipes/BOM/machining: leer
  [hardware-profiles.md](hardware-profiles.md) y la issue exacta.
- Dónde registrar cosas: herraje (compra) → catálogo Hardware; solución por
  contacto → Hardware Profile; qué lado → Component Side Assignment; cómo se
  mecaniza → ContactOperationRecipe; cuánto se compra → demanda/BOM.
- El CRUD generado usa DELETE por path —
  `DELETE /api/catalog/hardware-profiles/{id}` y
  `DELETE /api/catalog/components/{id}/side-assignments/{side}` — el
  generador ignora query params en DELETE; no reintentes por query.
- Revalidar el estado real del código en cada arranque: este flujo describe
  el objetivo por slice; lo implementado y lo pendiente se distinguen en cada
  issue, en el §8 del contrato y en su evidencia.
- No des por hecho que el `recipe` se puede escribir por API ni que existe
  superficie SketchUp para perfiles: ambos están listados como huecos en el
  contrato, no como trabajo hecho.
