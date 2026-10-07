# ODD — #1147 placements sin identidad: el editor no puede guardar lo que el resolver no interpreta

- Issue: https://github.com/tiagofur/muebleria/issues/1147 (aprobación del
  owner en conversación 2026-10-07, label `status:approved` registrada).
- Base: `origin/main` @ `fb5fa861` — rama `fix/1147-placement-identity`
  (worktree `muebles-worktrees/1147-placement-identity`, escritor único).
- Topología: Delegated Direct ligera (este artefacto).

## Regla implementada

Ningún editor guarda un herraje posicionado sin identidad (ni `hardwareId`
ni `optionRole`): nunca más un jsonb con placements vacíos que rompe todo
resolve del mueble (AGR-PUE-IZQ).

1. **Dominio**: `hardwarePlacementIdentityError` (misma regla del resolve:
   `invalid` = sin identidad; hardwareId gana si ambos) +
   `findHardwarePlacementsWithoutIdentity(components)` → índices
   (componente, placement) para los guards.
2. **Editor compartido** (`HardwarePlacementsEditor`, agregados + overrides
   de módulo/estructura): la fila sin identidad muestra badge "Sin
   identidad" + razón (`...-identity-error`); el cambio de modo a grupo
   auto-elige el primer grupo (la fila nunca queda sin identidad tras un
   cambio de modo — pinned por test).
3. **Guard de guardado (agregados)**: `AgregadosScreen.onSubmit` bloquea con
   el nombre de la pieza y salta al tab Herrajes, sin llamada al backend.
4. **Guard de guardado (módulos)**: `useModulesScreenState.validate()`
   rechaza con pieza+herraje señalados; `tabForModuleValidationError`
   enruta "sin identidad" al tab Componentes (marker antes del genérico
   'herraje').

## Notas de alcance

- La estructura no tiene `validate()` propio: queda cubierta por el badge
  compartido + el fail-closed del servidor (resolve 422 "has neither
  hardwareId nor optionRole") — anotado, no bloqueante.
- El select de grupo ignora el valor vacío (nunca escribe `optionRole: ''`);
  hoy además es inalcanzable por UI (la fila '' cae en modo específico) —
  el guard es defensivo.

## Verificación

- V1: dominio 1795 (predicado+scanner nuevos), ui 2220 (editor 13/13,
  agregados screen 9/9 con bloqueo+fix-path, marcador de tab), web 600,
  storage 268 — todo verde; `pnpm typecheck` OK.
- V2: browser/SketchUp no aplica (validación de formularios React cubierta
  por jsdom suites; el fail-closed del servidor ya tenía tests Go).
