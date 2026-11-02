# Convención de origen y anclaje de herrajes

**Estado:** implementado (#1453 F1+F2). Fecha: 2026-11-02.
**Consumidores:** `packages/domain/src/hardwarePlacement.ts` (TS), `backend-go/internal/domain/engine/layout.go` (Go), `apps/sketchup-extension/.../furniture_builder.rb` (host), `packages/ui/src/preview3d/HardwareMesh.tsx` (web).

## El punto de montaje

Toda posición de herraje se resuelve a un **punto de montaje** sobre la cara
ancla del tablero. Ese único punto alimenta tres cadenas — dibujo 3D, AABB de
colisión/perfil (Go) y perforación CNC (F131) — y por contrato **no pueden
divergir**: TS y Go comparten el resolvedor (`resolveHardwareFacePoint` /
`resolveHardwareFacePoint` gemelo) y el host recibe el punto ya resuelto en
`localTransform.TranslationMm` / `OffsetMm`.

```
punto de montaje = clamp( base(xRef|yRef) + offset(mm|fórmula) − ancla(hwAnchor, rotZ) )
```

El clamp aplica **solo al punto final**: nunca deja el herraje fuera de la
cara, pero los componentes intermedios no se recortan.

## Referencias del panel (`xRef`/`yRef`: min|max|center)

La base contra la que se mide el offset, por eje de la cara:

| ref | base | uso típico |
|---|---|---|
| `min` (default/ausente) | esquina origen de la cara | histórico; offsets absolutos |
| `center` | punto medio de la cara | **cajón**: centrado sin conocer el herraje |
| `max` | borde opuesto | **puerta**: borde libre con offset negativo |

Presets de autoría: «Cajón centrado» (`center` + 0) y «Puerta borde» (`max` +
offsets). La fórmula (`PW/2`, `HW`, etc.) se evalúa igual sobre cualquiera de
las tres bases.

## Ancla del herraje (`hwAnchor`: mount|center|hole:\<opId\>)

Qué punto del PROPIO herraje aterriza en el punto de montaje:

| ancla | punto del herraje | uso |
|---|---|---|
| `mount` (default/ausente) | el origen canónico (ver tabla por familia) | assets preparados con su punto 0 en el punto de montaje |
| `center` | centro del bounding box (`dimensions`) | assets con origen en esquina |
| `hole:<opId>` | la operación de maquinado `<opId>` del perfil F131 | alinear un agujero exacto; rota con `rotationDeg.z` como el drilling |

## Origen canónico por familia

Al preparar un asset 3D (SKP/GLB), el punto 0 del modelo debe coincidir con el
**punto de montaje** de la familia; el maquinado del catálogo (F131) se expresa
en ese mismo origen. Mover el punto 0 del asset NO rompe la posición mientras
el perfil de maquinado se reexprese en el mismo origen.

| familia | origen canónico (punto 0 del asset) |
|---|---|
| Tirador barra (bar-pull) | centro del grip, sobre la cara de montaje (Z=0 cara, +Z saliente) |
| Tirador copa (cup-pull) | centro de la base de la copa |
| Perilla (knob) | centro del vástago sobre la cara |
| Bisagra (hinge) | centro del cazolete (copa Ø35) |
| Corredera (slide) | origen del riel (extremo trasero, cara superior) |
| Riel (rail) / Pata (leg) | origen del perfil / plano de apoyo |

Convenciones de ejes del espacio canónico (mount_frame): **+X** longitudinal
(largo del grip), **+Y** transversal, **+Z** saliente desde la cara de
montaje. El proxy de respaldo de SketchUp (`build_hardware_proxy_box`) se
dibuja centrado in-plano en el origen y creciendo en +Z — la misma convención
del AABB de Go y del dibujo web.

## Paridad y compatibilidad

- Fixture compartido `contracts/hardwarePlacementAnchoring.contract.json`:
  TS (vitest) y Go (go test) resuelven los mismos casos, incluido el legacy
  sin refs/ancla (byte-idéntico al comportamiento histórico) y el redondeo
  determinista 1e-6 del trig de rotación.
- Las variables de fórmula HW/HH/HD (dimensiones efectivas) provienen de
  `dimensions` del registro o de los escalares preview* (ver #1453 F1).
- El direccionamiento por copia (izq/der en pares de puertas) NO es parte de
  esta convención: las copias clonan la placement idéntica (#1452).
