# ODD — #1342 Orientación del wedge del bisel (corte 45° invertido)

- **Lane**: Delegated Direct (diagnóstico con datos reales + fix de host).
- **Base**: `origin/main` @ 313cdf90 · **Rama**: `feat/1342-bevel-orientation` · **Escritor**: implementer sesión 2026-10-15 (reserva en la issue).
- **Aprobación**: owner en sesión («antes de ir al 1342»).

## Diagnóstico (la cadena que funcionó)

1. Probe del authoring resolve con el diseño REAL del owner (7d20601c, POST read-only con sus
   choices): puerta `Puerta 1 Hoja` dims [397,15,682], translation [2,590,2], **basis identidad**;
   el release v5 congeló banda [0,2,668]×[396,13,13] (leída del manufacturing snapshot de
   cfef2001 en la dev DB — sin tocar su diseño).
2. Probe Ruby ejecutando el builder REAL con esos números bajo stubs: **los 5 anillos del wedge
   salen INWARD** (Newell de cada anillo final apunta INTO del prisma). En SketchUp real:
   prisma del revés — el blanco afuera-arriba fotografiado.
3. Causa raíz: `ring_normal` multiplicaba **diferencias consecutivas** (Δy·Δz, Δz·Δx, Δx·Δy) —
   no es Newell (que cruza-parea: Δy·(z+z')). Basura: 0 para cuadrados, signo inconstante para
   triángulos → `orient_ring!` decidía sobre ruido.
4. Hueco de tests: FaceStub devolvía normal FIJA +Z — el winding era invisible (lección 3 de
   #1327, tercera vez que escapa por ahí).

## Fix (commit 4dedc33a, PR #1347)

- `ring_normal`: Newell real (sumas cruz-pareadas).
- FaceStub: normal DERIVADA DEL WINDING (regla mano derecha, normalizado).
- Regresión: las 5 caras del wedge OUTWARD (dot>0 vs centroide) + la rampa mirando frente-arriba;
  FALLA con el código anterior.

## Verificación

- rake verify: RuboCop 308/0, unit 1450 runs/10102 assertions, boundary 6/4239, RBZ 0.1.77
  sha256 419a15b2c3c41222967a819531a20451889a71430f013ad4d61dda3792443130 (commit 4dedc33a).
- CI: success (selector: sólo plugin; Go/TS/browser skipping correcto). PR #1347 MERGEABLE.
- **Delivery: partial a propósito** — la aceptación de la issue es VISUAL del owner en SketchUp
  real: re-declarar el bisel (perfil v7) → quitar/re-aplicar apertura (pinea v7) → verificar.

## Lección de proceso (nueva, dura)

Tres fixes seguidos (#1339/#1340/#1341) iteraron sobre el mismo subsistema sin que NINGUNA prueba
mirara la orientación de las caras: el stub con normal fija convirtió los tests en teatro. Regla:
**cada comportamiento del host que afecte al render (normales, winding, merges coplanares) debe
estar modelado en el stub y asertado** — y ante un bug visual persistente, reproducir con los
números REALES servidos (probe del resolve), no con fixtures inventados.
