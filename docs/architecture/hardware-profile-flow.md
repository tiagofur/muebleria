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
        hardware_profile   │  └─ release #773            │
                           │     inmutable               │
Componente (definición)    │                             │
  └─ Side Assignment ──────┘                             │
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
                            Machining (DXF/CNC)                        BOM
                            (recipeRevision,                    items × catálogo
                             technicalProfileId)                (precios vivos
                                                                 del herraje)
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
   `TechnicalProfileID/Revision` + `RecipeRevision`; cada línea de BOM lleva
   `hardwareId` — comprar y mecanizar salen del mismo modelo sin duplicar
   identidad.
4. **Fail-closed en cada frontera**: perfil inexistente/inactivo, revisión
   faltante, lado incompatible o receta roja dejan la unión no fabricable
   (terminal estructurado), nunca degradan a fallback.

## Secuencia de entrega

| Orden | Issue | Entrega | Puerta con la anterior |
|---|---|---|---|
| 1 | **#912** | Contrato de dominio + docs (este par de archivos) + fixture Go/TS | — |
| 2 | #913 | Persistencia/API de perfiles (tabla, API generada, RLS, revisiones) | contrato #912 |
| 3 | #918 | Kind `hardware_profile` en releases #772/#773 + pinning | #913 |
| 4 | #916 | El resolve consume asignaciones/perfiles del release pineado; terminal→READY con perfiles reales | #918 + specs técnicas de herrajes |
| 5 | #914/#915 | React: catálogo de perfiles + asignación por lado | #913 |
| 6 | #875 | Config de fábrica: parametrización vía overlay (`hardware.`) | #916 + #775 |
| 7 | #917 | BOM desde items de perfil | #916 |
| 8 | #919 | Golden vertical: gabinete → perfil → contacto → machining + BOM | todas |
| 9 | #920 | Consolidación de docs canónicas | #912–#919 |
| 10 | #879 | Consumidor CNC nativo (BHX) sobre la salida neutral | salida neutral completa |

## Handoff para agentes

- Antes de tocar Hardware/Profiles/assignments/recipes/BOM/machining: leer
  [hardware-profiles.md](hardware-profiles.md) y la issue exacta.
- Dónde registrar cosas: herraje (compra) → catálogo Hardware; solución por
  contacto → Hardware Profile; qué lado → Component Side Assignment; cómo se
  mecaniza → ContactOperationRecipe; cuánto se compra → BOM.
- Revalidar el estado real del código en cada arranque: este flujo describe
  el objetivo por slice; lo implementado y lo pendiente se distinguen en cada
  issue y su evidencia.
