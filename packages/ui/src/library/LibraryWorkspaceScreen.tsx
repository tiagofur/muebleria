import { useState, type ReactNode } from 'react';
import { Library } from 'lucide-react';
import type {
  HardwareProfile,
  LibraryReleaseSummary,
  StandardDraftDiffReport,
  StandardDraftValidationReport,
} from '@granete/storage';
import { PageHeader } from '../common/PageHeader';
import { ScreenBoundary } from '../common/ScreenBoundary';
import { Modal } from '../common/Modal';
import { LibraryConsumerViewPanel } from '../catalogs/LibraryConsumerViewPanel';
import { LibraryDraftValidationPanel } from '../catalogs/LibraryDraftValidationPanel';
import { LibraryDraftWorkspaceBanner } from '../catalogs/LibraryDraftWorkspaceBanner';
import { LibraryPublishConfirmContent } from '../catalogs/LibraryPublishConfirmContent';
import { LibraryPublishHistoryPanel } from '../catalogs/LibraryPublishHistoryPanel';

/**
 * Hub del ciclo de revisiones de la biblioteca (#1184).
 *
 * Única superficie con las acciones del bibliotecario: abrir borrador,
 * probarlo, publicarlo con diff + confirmación, historial completo y la
 * vista consumidor de #1102 Slice D. Las superficies de autoría (Catálogos y
 * Librería) sólo muestran la línea contextual — el estado es global de la
 * biblioteca, no de la pantalla (#1184 reemplaza el stack duplicado 10×).
 */

export interface LibraryWorkspaceScreenProps {
  readonly onGoHome: () => void;
  // Estado del workspace de autoría (useStandardLibraryWorkspace).
  readonly currentPublished: LibraryReleaseSummary | null;
  readonly currentDraft: LibraryReleaseSummary | null;
  readonly suggestedVersion: string;
  readonly loading: boolean;
  readonly opening: boolean;
  readonly error: string | null;
  readonly onOpenDraft: () => void;
  readonly onValidateDraft: () => void;
  readonly publishedReleases: ReadonlyArray<LibraryReleaseSummary>;
  readonly currentValidation: StandardDraftValidationReport | null;
  readonly validating: boolean;
  // Publicación: diff + transición atómica (el modal vive en el hub).
  readonly currentDiff: StandardDraftDiffReport | null;
  readonly diffLoading: boolean;
  readonly onRequestDiff: () => void;
  readonly publishing: boolean;
  readonly onPublish: () => Promise<boolean>;
  // Vista consumidor (#1102 Slice D).
  readonly consumerPin: string | null;
  readonly consumerProfiles: ReadonlyArray<HardwareProfile>;
  readonly consumerLoading: boolean;
  readonly consumerError: string | null;
  readonly onPinConsumer: (releaseId: string) => void;
}

export function LibraryWorkspaceScreen({
  onGoHome,
  currentPublished,
  currentDraft,
  suggestedVersion,
  loading,
  opening,
  error,
  onOpenDraft,
  onValidateDraft,
  publishedReleases,
  currentValidation,
  validating,
  currentDiff,
  diffLoading,
  onRequestDiff,
  publishing,
  onPublish,
  consumerPin,
  consumerProfiles,
  consumerLoading,
  consumerError,
  onPinConsumer,
}: LibraryWorkspaceScreenProps): ReactNode {
  // La confirmación pide el diff al abrirse (#1102 Slice C) y el publish
  // atómico cierra el modal sólo cuando el backend confirma el release.
  const [publishOpen, setPublishOpen] = useState(false);

  return (
    <ScreenBoundary screenLabel="Biblioteca" onGoHome={onGoHome}>
      <PageHeader
        title="Biblioteca"
        icon={<Library size={20} aria-hidden />}
        subtitle="El ciclo de la biblioteca de manufactura: componé el borrador, probalo y publicalo como versión consumible."
      />
      <LibraryDraftWorkspaceBanner
        currentPublished={currentPublished}
        currentDraft={currentDraft}
        suggestedVersion={suggestedVersion}
        loading={loading}
        opening={opening}
        validating={validating}
        error={error}
        onOpenDraft={onOpenDraft}
        onValidateDraft={onValidateDraft}
        onPublishClick={() => {
          setPublishOpen(true);
          onRequestDiff();
        }}
      />
      <LibraryDraftValidationPanel
        report={currentValidation}
        validating={validating}
      />
      <LibraryPublishHistoryPanel
        releases={publishedReleases}
        defaultOpen
      />
      <LibraryConsumerViewPanel
        pin={consumerPin}
        published={publishedReleases}
        profiles={consumerProfiles}
        loading={consumerLoading}
        error={consumerError}
        onPin={onPinConsumer}
      />
      <Modal
        open={publishOpen && currentDraft !== null}
        onClose={() => {
          if (!publishing) setPublishOpen(false);
        }}
        title={
          currentDraft
            ? `Publicar biblioteca v${currentDraft.version}`
            : 'Publicar biblioteca'
        }
        dataTestId="library-publish-modal"
      >
        <LibraryPublishConfirmContent
          version={currentDraft?.version ?? ''}
          diff={currentDiff}
          loading={diffLoading}
          error={error}
          publishing={publishing}
          onCancel={() => setPublishOpen(false)}
          onConfirm={() => {
            void onPublish().then((published) => {
              if (published) setPublishOpen(false);
            });
          }}
        />
      </Modal>
    </ScreenBoundary>
  );
}
