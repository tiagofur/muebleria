export { AgregadosScreen, type AgregadosScreenProps } from './AgregadosScreen';
export {
  agregadoToDraft,
  draftToAgregado,
  createEmptyAgregadoDraft,
  type AgregadoDraft,
} from './agregadoDraft';
// editor sub-components (for testing / reuse)
export { AgregadoListView, type AgregadoListViewProps } from './editor/AgregadoListView';
export { AgregadoDetailView, type AgregadoDetailViewProps } from './editor/AgregadoDetailView';
export { AgregadoEditorForm, type AgregadoEditorFormProps, type AgregadoEditorTab } from './editor/AgregadoEditorForm';
export { Agregado3DModal, type Agregado3DModalProps } from './editor/Agregado3DModal';
