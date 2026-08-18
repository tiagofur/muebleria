import { useState, useRef, useId, type ChangeEvent, type DragEvent } from 'react';
import type { ProjectPhoto, ProjectPhotoStage } from '@muebles/domain';
import {
  Camera,
  UploadCloud,
  Star,
  Trash2,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  X,
  Edit2,
  Check,
  Image as ImageIcon,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { compressImage } from '../../common/imageCompression';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import './projectPhotosGallery.css';

export interface ProjectPhotosGalleryProps {
  readonly projectId: string;
  readonly photos: readonly ProjectPhoto[];
  readonly onUploadPhotos: (files: File[], stage: ProjectPhotoStage, caption?: string) => Promise<void>;
  readonly onUpdatePhoto: (
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<void>;
  readonly onDeletePhoto: (photoId: string) => Promise<void>;
  readonly readOnly?: boolean;
}

const STAGE_LABELS: Record<ProjectPhotoStage, { label: string; badgeClass: string }> = {
  survey: { label: 'Relevamiento (Antes)', badgeClass: 'badge--survey' },
  in_workshop: { label: 'Taller (Armado)', badgeClass: 'badge--workshop' },
  installed: { label: 'Instalado (Terminado)', badgeClass: 'badge--installed' },
  delivery_receipt: { label: 'Acta / Conformidad', badgeClass: 'badge--receipt' },
};

type StageFilter = 'all' | 'showcase' | ProjectPhotoStage;

export function ProjectPhotosGallery({
  projectId: _projectId,
  photos,
  onUploadPhotos,
  onUpdatePhoto,
  onDeletePhoto,
  readOnly = false,
}: ProjectPhotosGalleryProps) {
  const [activeTab, setActiveTab] = useState<StageFilter>('all');
  const [uploadStage, setUploadStage] = useState<ProjectPhotoStage>('installed');
  const [uploadCaption, setUploadCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [tempCaption, setTempCaption] = useState('');
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadStageSelectId = useId();

  // Counts per category
  const counts = {
    all: photos.length,
    showcase: photos.filter((p) => p.isShowcase).length,
    survey: photos.filter((p) => p.stage === 'survey').length,
    in_workshop: photos.filter((p) => p.stage === 'in_workshop').length,
    installed: photos.filter((p) => p.stage === 'installed').length,
    delivery_receipt: photos.filter((p) => p.stage === 'delivery_receipt').length,
  };

  // Filtered photos
  const filteredPhotos = photos.filter((p) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'showcase') return p.isShowcase;
    return p.stage === activeTab;
  });

  const handleTabChange = (tab: StageFilter) => {
    setActiveTab(tab);
    if (tab === 'survey' || tab === 'in_workshop' || tab === 'installed' || tab === 'delivery_receipt') {
      setUploadStage(tab);
    }
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    if (rawFiles.length === 0) return;

    setIsUploading(true);
    try {
      // Compress each image in browser canvas
      const compressedFiles = await Promise.all(
        rawFiles.map((file) => compressImage(file, { maxDimension: 1920, quality: 0.82 })),
      );
      await onUploadPhotos(compressedFiles, uploadStage, uploadCaption.trim() || undefined);
      setUploadCaption('');
    } catch (err) {
      console.error('Error uploading photos:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processFiles(e.target.files);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!readOnly) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (readOnly) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void processFiles(e.dataTransfer.files);
    }
  };

  const handleToggleShowcase = async (photo: ProjectPhoto) => {
    if (readOnly) return;
    await onUpdatePhoto(photo.id, { isShowcase: !photo.isShowcase });
  };

  const handleChangeStage = async (photo: ProjectPhoto, newStage: ProjectPhotoStage) => {
    if (readOnly) return;
    await onUpdatePhoto(photo.id, { stage: newStage });
  };

  const startEditCaption = (photo: ProjectPhoto) => {
    setEditingCaptionId(photo.id);
    setTempCaption(photo.caption || '');
  };

  const saveCaption = async (photoId: string) => {
    await onUpdatePhoto(photoId, { caption: tempCaption.trim() });
    setEditingCaptionId(null);
  };

  return (
    <div className="project-photos-gallery">
      {/* Header & Tabs */}
      <div className="project-photos-gallery__header">
        <div className="project-photos-gallery__tabs">
          <button
            type="button"
            className={`gallery-tab ${activeTab === 'all' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            <ImageIcon size={15} aria-hidden="true" />
            <span>Todas</span>
            <span className="gallery-tab__badge">{counts.all}</span>
          </button>
          <button
            type="button"
            className={`gallery-tab ${activeTab === 'survey' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('survey')}
          >
            <span>Relevamiento</span>
            <span className="gallery-tab__badge">{counts.survey}</span>
          </button>
          <button
            type="button"
            className={`gallery-tab ${activeTab === 'in_workshop' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('in_workshop')}
          >
            <span>Taller</span>
            <span className="gallery-tab__badge">{counts.in_workshop}</span>
          </button>
          <button
            type="button"
            className={`gallery-tab ${activeTab === 'installed' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('installed')}
          >
            <span>Instalado</span>
            <span className="gallery-tab__badge">{counts.installed}</span>
          </button>
          <button
            type="button"
            className={`gallery-tab ${activeTab === 'delivery_receipt' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('delivery_receipt')}
          >
            <span>Acta de Entrega</span>
            <span className="gallery-tab__badge">{counts.delivery_receipt}</span>
          </button>
          <button
            type="button"
            className={`gallery-tab gallery-tab--showcase ${activeTab === 'showcase' ? 'gallery-tab--active' : ''}`}
            onClick={() => handleTabChange('showcase')}
          >
            <Star size={14} className="gallery-tab__star-icon" aria-hidden="true" />
            <span>Portafolio</span>
            <span className="gallery-tab__badge">{counts.showcase}</span>
          </button>
        </div>
      </div>

      {/* Upload Dropzone */}
      {!readOnly && (
        <div
          className={`project-photos-uploader ${isDragging ? 'project-photos-uploader--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="project-photos-uploader__file-input"
            onChange={handleFileChange}
            disabled={isUploading}
          />
          <div className="project-photos-uploader__drop-area" onClick={() => fileInputRef.current?.click()}>
            {isUploading ? (
              <div className="project-photos-uploader__loading">
                <Loader2 size={28} className="animate-spin" />
                <span>Optimizando y subiendo fotos...</span>
              </div>
            ) : (
              <>
                <UploadCloud size={32} className="project-photos-uploader__icon" />
                <div className="project-photos-uploader__text">
                  <strong>Arrastra fotos aquí o haz clic para seleccionar</strong>
                  <p>Las fotos se comprimen automáticamente antes de subir (WebP/JPEG).</p>
                </div>
              </>
            )}
          </div>

          <div className="project-photos-uploader__controls">
            <div className="project-photos-uploader__stage-select">
              <label htmlFor={uploadStageSelectId}>Etapa:</label>
              <select
                id={uploadStageSelectId}
                className="input-select input-select--sm"
                value={uploadStage}
                onChange={(e) => setUploadStage(e.target.value as ProjectPhotoStage)}
                disabled={isUploading}
              >
                <option value="survey">Relevamiento (Antes)</option>
                <option value="in_workshop">Taller (Armado)</option>
                <option value="installed">Instalado (Terminado)</option>
                <option value="delivery_receipt">Acta / Conformidad</option>
              </select>
            </div>
            <input
              type="text"
              className="input-text input-text--sm project-photos-uploader__caption-input"
              placeholder="Pie de foto opcional..."
              value={uploadCaption}
              onChange={(e) => setUploadCaption(e.target.value)}
              disabled={isUploading}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm project-photos-uploader__btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <Camera size={15} aria-hidden="true" />
              <span>Subir Fotos</span>
            </button>
          </div>
        </div>
      )}

      {/* Grid of Photos */}
      {filteredPhotos.length === 0 ? (
        <div className="project-photos-gallery__empty">
          <FolderOpen size={40} className="project-photos-gallery__empty-icon" />
          <p className="project-photos-gallery__empty-title">
            {activeTab === 'showcase'
              ? 'No hay fotos destacadas para el portafolio todavía'
              : 'No hay fotos cargadas en esta etapa'}
          </p>
          {!readOnly && (
            <p className="project-photos-gallery__empty-desc">
              Sube fotos del relevamiento, proceso de armado o resultado final instalado.
            </p>
          )}
        </div>
      ) : (
        <div className="project-photos-grid">
          {filteredPhotos.map((photo, index) => {
            const stageInfo = STAGE_LABELS[photo.stage] || STAGE_LABELS.installed;
            const isEditingCaption = editingCaptionId === photo.id;

            return (
              <div key={photo.id} className="photo-card">
                <div className="photo-card__media" onClick={() => setLightboxIndex(index)}>
                  <img
                    src={photo.thumbnailUrl || photo.url}
                    alt={photo.caption || `Foto de ${stageInfo.label}`}
                    loading="lazy"
                  />
                  <div className="photo-card__overlay">
                    <button
                      type="button"
                      className="photo-card__zoom-btn"
                      title="Ver en pantalla completa"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxIndex(index);
                      }}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="photo-card__info">
                  <div className="photo-card__meta">
                    <div className="photo-card__stage-wrapper">
                      {!readOnly ? (
                        <select
                          className={`photo-card__stage-select ${stageInfo.badgeClass}`}
                          value={photo.stage}
                          onChange={(e) => void handleChangeStage(photo, e.target.value as ProjectPhotoStage)}
                        >
                          <option value="survey">Relevamiento</option>
                          <option value="in_workshop">Taller</option>
                          <option value="installed">Instalado</option>
                          <option value="delivery_receipt">Acta</option>
                        </select>
                      ) : (
                        <span className={`badge ${stageInfo.badgeClass}`}>{stageInfo.label}</span>
                      )}
                    </div>

                    {!readOnly && (
                      <div className="photo-card__actions">
                        <button
                          type="button"
                          className={`photo-card__star-btn ${photo.isShowcase ? 'photo-card__star-btn--active' : ''}`}
                          onClick={() => void handleToggleShowcase(photo)}
                          title={photo.isShowcase ? 'Quitar de portafolio' : 'Destacar para portafolio'}
                        >
                          <Star size={16} fill={photo.isShowcase ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          className="photo-card__delete-btn"
                          onClick={() => setDeletingPhotoId(photo.id)}
                          title="Eliminar foto"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingCaption ? (
                    <div className="photo-card__caption-edit">
                      <input
                        type="text"
                        className="input-text input-text--sm"
                        value={tempCaption}
                        onChange={(e) => setTempCaption(e.target.value)}
                        placeholder="Pie de foto..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveCaption(photo.id);
                          if (e.key === 'Escape') setEditingCaptionId(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => void saveCaption(photo.id)}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--secondary"
                        onClick={() => setEditingCaptionId(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="photo-card__caption"
                      onClick={() => !readOnly && startEditCaption(photo)}
                      title={!readOnly ? 'Clic para editar pie de foto' : undefined}
                    >
                      <span className="photo-card__caption-text">
                        {photo.caption || <em className="text-muted">Sin pie de foto</em>}
                      </span>
                      {!readOnly && <Edit2 size={12} className="photo-card__caption-icon" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
        <div className="gallery-lightbox" onClick={() => setLightboxIndex(null)}>
          <div className="gallery-lightbox__dialog" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="gallery-lightbox__close"
              onClick={() => setLightboxIndex(null)}
              title="Cerrar (Esc)"
            >
              <X size={24} />
            </button>

            {lightboxIndex > 0 && (
              <button
                type="button"
                className="gallery-lightbox__nav gallery-lightbox__nav--prev"
                onClick={() => setLightboxIndex(lightboxIndex - 1)}
                title="Foto anterior"
              >
                <ChevronLeft size={32} />
              </button>
            )}

            <div className="gallery-lightbox__image-container">
              <img
                src={filteredPhotos[lightboxIndex].url}
                alt={filteredPhotos[lightboxIndex].caption || 'Foto del proyecto'}
              />
            </div>

            {lightboxIndex < filteredPhotos.length - 1 && (
              <button
                type="button"
                className="gallery-lightbox__nav gallery-lightbox__nav--next"
                onClick={() => setLightboxIndex(lightboxIndex + 1)}
                title="Foto siguiente"
              >
                <ChevronRight size={32} />
              </button>
            )}

            <div className="gallery-lightbox__footer">
              <div className="gallery-lightbox__info">
                <span className="badge badge--dark">
                  {STAGE_LABELS[filteredPhotos[lightboxIndex].stage]?.label || 'Foto'}
                </span>
                {filteredPhotos[lightboxIndex].caption && (
                  <p className="gallery-lightbox__caption">{filteredPhotos[lightboxIndex].caption}</p>
                )}
              </div>
              <span className="gallery-lightbox__counter">
                {lightboxIndex + 1} de {filteredPhotos.length}
              </span>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deletingPhotoId !== null}
        onClose={() => setDeletingPhotoId(null)}
        title="Eliminar foto"
        message="La foto se elimina de la obra. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (deletingPhotoId) void onDeletePhoto(deletingPhotoId);
        }}
        dataTestId="photo-delete-confirm"
      />
    </div>
  );
}
