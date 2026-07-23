# Review — feature F059

**Veredicto:** CHANGES_REQUESTED

## Resumen ejecutivo

La refactorización introduce una **regresión funcional**: el editor
(modal) ya no se cierra después de guardar ni al cancelar, porque el hook
`useEntityEditorState` posee su propio `modalOpen` interno mientras los 3
screens conservan su propio `useState(false)` local para `modalOpen`.
`forceCloseEditor()`/`closeModal()` del hook solo afectan el estado interno
del hook; el estado local del screen (que es el que realmente controla el
`open={modalOpen}` del `<Modal>`) nunca se pone en `false`.

Las pruebas existentes no detectaron la regresión porque solo asertan que
se llamó al callback `onCreate`/`onUpdate`, no que el modal se haya
cerrado. Lo verifiqué con un probe test ad-hoc (ahora eliminado) que
confirma: tras hacer click en "Guardar", `input-code` sigue presente.

Adicionalmente, la mayoría de los **acceptance criteria** de reducción de
tamaño no se cumplen, y la API pública del hook contiene campos muertos.

## Checkpoints

- C1: [x] harness completo
- C2: [ ] estado coherente — `feature_list.json` todavía muestra F059
      `status: "pending"` (línea 1168), no `in_progress` ni `done`
- C3: [x] arquitectura respetada (hook en `packages/ui/src/common/`,
      no toca dominio ni storage)
- C4: [x] `pnpm test`, `typecheck`, `init.sh` verde — pero ver bloque de
      regresión: la suite verde es insuficiente porque no cubre el flujo
      "modal se cierra al guardar"
- C5: [ ] sesión no cerrada: `progress/current.md` todavía describe F059
      como pendiente; `feature_list.json` marca F059 como `pending`

## Diseño UI/UX

No aplica directamente (no es fase 4 ni toca presentación visual).
Los `data-testid` se preservaron: ComponentsScreen 9, StructuresScreen 13,
ModulesScreen 7 — idénticos al base.

## Regresión funcional (bloqueante)

`packages/ui/src/common/useEntityEditorState.ts` declara internamente:

```ts
const [modalOpen, setModalOpen] = useState(false);   // L76 del hook
const [editingId, setEditingId] = useState<string | null>(null); // L77
```

Y los 3 screens siguen declarando los suyos (a pesar de consumir el hook):

- `ComponentsScreen.tsx:93-94`
- `StructuresScreen.tsx:100-101`
- `ModulesScreen.tsx:186-187`

Los screens NO destruyen `modalOpen`/`editingId` del hook (ver bloque
`const { draft, setDraft, ... } = useEntityEditorState(...)` en cada
screen). El JSX de cada screen ata el `<Modal open={modalOpen}>` a su
variable local:

- `ComponentsScreen.tsx:422` y `:495` → `open={modalOpen}` (local)
- `StructuresScreen.tsx:497` y `:639` → `open={modalOpen}` (local)
- `ModulesScreen.tsx:1062` → `open={modalOpen}` (local)

Consecuencia: cuando el screen llama `forceCloseEditor()` (post-save, en
`ComponentsScreen.tsx:313`, `StructuresScreen.tsx:329`, `ModulesScreen.tsx:675`)
o `closeModal()` (botón Cancelar, `Modal.onClose`, handler de discard),
solo se actualiza el estado interno del hook. El `modalOpen` local del
screen queda en `true` y el modal permanece abierto.

Probe de confirmación (test temporal, ya eliminado del working tree):
tras `fireEvent.click(screen.getByTestId('save-btn'))`, esperar a que
`screen.queryByTestId('input-code')` sea `null` → timeout. El formulario
sigue visible.

Comportamiento en base (`git merge-base origin/main HEAD`): cada screen
tenía su propio `forceCloseEditor` local que llamaba `setModalOpen(false)`
directamente sobre el estado local, cerrando el modal correctamente.

## Acceptance criteria — feature_list.json L1153-1161

- [x] "useEntityEditorState hook existe en packages/ui/src/common/"
      (aceptado; el plan original decía `EntityEditorLayout` pero el
      commit renombró explícitamente a hook)
- [ ] "ModulesScreen.tsx < 600 líneas" — **1248 L** (objetivo: < 600)
- [ ] "StructuresScreen.tsx < 500 líneas" — **760 L** (objetivo: < 500)
- [ ] "ComponentsScreen.tsx < 400 líneas" — **549 L** (objetivo: < 400)
- [~] "Tests de contrato: las 3 entidades siguen exponiendo el mismo
      comportamiento (deep-link /:id/edit, NEW_ENTITY_ID, tabs,
      validation focus)" — la suite existente pasa (320 ui), PERO no
      cubre el contrato crítico "el modal se cierra". El contrato real
      se rompió (ver regresión arriba).
- [ ] "Smoke visual: abrir/editar/guardar un Module, Structure y Component
      en menos clicks que antes" — no se ejecutó ningún smoke manual de
      guardar; el flujo de guardar quedó roto.
- [x] "pnpm test + typecheck + init.sh verde" — todos verde (con la
      salvedad de cobertura).

## Otros problemas

1. **API muerta del hook.** Los handlers `openCreateEditor` (L107-115) y
   `openEditEditor` (L117-128) están expuestos pero **ningún consumidor
   los usa** (verificado: `grep -rn "openCreateEditor\|openEditEditor"`
   solo los encuentra en el propio hook). Los screens reimplementan su
   propio `handleCreateNew`/`handleEdit`/`startCreate`/`startEdit` porque
   necesitan enrutar primero por `onRequestEdit`. ~40 líneas de código
   muerto en el hook.

2. **Lectores muertos del hook.** Los campos `modalOpen` y `editingId`
   expuestos en `EntityEditorState` (L21, L22) no son consumidos por
   ningún screen, porque cada screen sigue usando su variable local.
   Para que el hook sea la fuente de verdad real, los screens deberían
   (a) eliminar su `useState` local de `modalOpen`/`editingId`, y
   (b) usar los del hook. Mientras tanto, los campos del hook son
   fuente de bugs silenciosos.

3. **Comentario误导 (misleading).** Los 3 screens contienen el comentario
   `// F059: isDraftDirty, forceCloseEditor, closeModal come from
   // useEntityEditorState.` sin aclarar que `modalOpen`/`editingId`
   siguen siendo locales. Esto oculta la desconexión de estado.

## Cambios requeridos

1. **(Bloqueante) Hacer del hook la única fuente de verdad para
   `modalOpen` y `editingId`.** Dos opciones:
   - (a) El hook expone `setModalOpen` y `setEditingId` y los screens
     eliminan sus `useState` locales, usando exclusivamente los del
     hook; o
   - (b) El hook recibe `modalOpen`/`editingId` y sus setters como
     opciones desde el screen.
   Cualquier opción debe lograr que `forceCloseEditor()`/`closeModal()`
   cierren efectivamente el `<Modal>` visible.

2. **(Bloqueante) Agregar tests de contrato que cubran "el modal se
   cierra tras guardar" y "el modal se cierra al cancelar sin cambios"**
   en los 3 screens. Hoy estos flujos no tienen cobertura y la
   regresión anterior pasó desapercibida.

3. **Eliminar API muerta.** Remover `openCreateEditor` y `openEditEditor`
   del hook si ningún screen los usa, o migrar los screens a usarlos
   (atendiendo el shortcut `onRequestEdit`).

4. **Aclarar el contrato del hook** (comentario o tipo) sobre quién es la
   fuente de verdad de `modalOpen`/`editingId`.

5. **Actualizar `feature_list.json`** para que F059 refleje su estado
   real (`in_progress`, no `pending`).

6. **(Deseable) Acercarse a los objetivos de tamaño** de
   `feature_list.json`. Si la reducción real (549/760/1248 vs
   400/500/600) es deliberada, documentar la renegociación en
   `progress/current.md` y actualizar los acceptance criteria.

## Cómo reproducir la regresión

```bash
# Probe temporal (eliminar después):
cat > packages/ui/src/components/__probe.test.tsx <<'TSX'
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { ComponentsScreen } from './ComponentsScreen';
import type { OptionGroup } from '@muebles/domain';
const og: OptionGroup[] = [
  { id: 'og1', code: 'FRENTE', name: 'Frente', kind: 'board', required: true, optionIds: [] },
];
describe('F059 regression', () => {
  it('modal closes after save', async () => {
    const onCreate = vi.fn();
    render(<ComponentsScreen components={[]} optionGroups={og} materials={[]}
      onCreate={onCreate} onUpdate={vi.fn()} onToggleActive={vi.fn()} canMutate />);
    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));
    await waitFor(() => expect(screen.queryByTestId('input-code')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('input-code'), { target: { value: 'COM-X' } });
    fireEvent.change(screen.getByTestId('input-name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    fireEvent.change(screen.getByTestId('input-length'), { target: { value: '100' } });
    fireEvent.change(screen.getByTestId('input-width'), { target: { value: '100' } });
    fireEvent.change(screen.getByTestId('input-thickness'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('component-editor-tab-options'));
    await userEvent.selectOptions(screen.getByTestId('input-optionRoles'), ['FRENTE']);
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(onCreate).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('input-code')).toBeNull(); // FAILS hoy
    });
  });
});
TSX
pnpm --filter @muebles/ui test -- __probe
rm packages/ui/src/components/__probe.test.tsx
```

Resultado esperado en HEAD: timeout en el último `waitFor` (el formulario
sigue visible después de Guardar).
