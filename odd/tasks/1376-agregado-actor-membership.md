# ODD — #1376 Membresía fijo/móvil por actor para conjuntos en agregados

Issue: #1376 (`status:approved`, P2, `type:feature`).
Lane: Delegated Direct — este artifact es la memoria de ejecución.
Base: `main 6e60895a`. Rama: `feat/1376-agregado-actor-membership`. Writer único.

## Decisión de diseño y contexto

Diferido de #670 (§1.2-3 de `docs/architecture/audit-670-final.md`): un agregado
paramétrico (ej. cajón con correderas/guías, o frente con herrajes) declara en
su receta cuáles de sus miembros rígidos pertenecen al cuerpo del mueble (`body`)
y cuáles pertenecen al actor móvil (`actor:<id>` o `<id>`).

Invariantes que se preservan:
- Ninguna operación de apertura/cierre modifica el BOM, mecanizado, precios ni
  `bomFingerprint` (`authoringDirty = false`).
- Membresía por actor es presentación / cinemática, no autoridad de fabricación.
- Poses de apertura son transitorias; cerrar restaura las poses canónicas cerradas
  con 0 drift flotante (50 ciclos).

## Contrato de membresía

1. **Definición de Miembro Rígido (`AgregadoRigidMember`)**:
   - Campo `actorMembership?: string` (en Go `ActorMembership string json:"actorMembership,omitempty"`).
   - Valores canónicos:
     - `'body'` o vacío/omitido: miembro fijado al cuerpo del mueble (ej. guía fija de corredera al costado). Nunca se mueve con ningún actor.
     - `'actor:<id>'` o `<id>`: miembro solidario al actor móvil (ej. guía móvil, laterales de cajón, brackets de frente).
2. **Resultado de resolución (`ResolvedRigidMember`)**:
   - Preserva `actorMembership` resuelto tanto en `ResolvedAssembly` como en `PublishedAssemblySnapshot` y tras `AttachVisualPins`.
   - Paridad estricta TS ↔ Go.
3. **Runtime SketchUp**:
   - `ChildMetadataWriter.write_hardware` persiste `actorMembership` en el intent del componente nativo de SketchUp.
   - `Selection::DoorActors.scan`: los miembros con `actorMembership == 'body'` se excluyen de `hardware_by_host`, quedando fijos en el cuerpo del mueble.
   - Los miembros con membresía al actor se asocian al actor correspondiente y se mueven solidarios con él.
   - 50 ciclos de apertura/cierre sin drift.
   - Múltiples instancias de la misma receta (ej. 3 cajones) no interfieren entre sí.

## Slices de ejecución

- **Slice 1**: Contrato y dominio en TS y Go (`AgregadoRigidMember`, `ResolvedRigidMember`, `PublishedAssemblySnapshot`, resolución de ensamble en ambos motores).
- **Slice 2**: Fixture compartida `contracts/agregadoActorMembership.contract.json` + tests de paridad en Go y TS.
- **Slice 3**: Adaptador de cinemática SketchUp (`furniture_builder.rb`, `door_actors.rb`, `presentation_motion_adapter.rb`) + tests Ruby (50 ciclos sin drift, fijos inmóviles, instancias aisladas).
- **Slice 4**: Verificación final, freeze, revisión independiente fresca y PR.

## No-Goals

- Nuevas cinemáticas o animaciones complejas (tijeras, compases).
- Maquinado / drilling según actor (los maquinados ya se resuelven por la geometría).
- Editor visual de membresía en la UI (se declara en la receta).
