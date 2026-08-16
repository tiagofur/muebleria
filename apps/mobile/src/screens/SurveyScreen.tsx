import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Ruler,
  CheckCircle,
  Plus,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { colors, spacing, radius, typography } from '../theme';
import {
  useCrmStore,
  type PhotoStage,
  PHOTO_STAGE_LABELS_ES,
} from '../stores/crmStore';

export interface SurveyScreenProps {
  projectId?: string;
  projectName?: string;
  onBack: () => void;
  onViewGallery?: () => void;
}

export function SurveyScreen({
  projectId = 'proj-1',
  projectName = 'Cocina Residencia Pérez',
  onBack,
  onViewGallery,
}: SurveyScreenProps) {
  const [activeStage, setActiveStage] = useState<PhotoStage>('survey');
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [measureNotes, setMeasureNotes] = useState('');

  const addPhoto = useCrmStore((s) => s.addPhoto);
  const photos = useCrmStore((s) => s.getPhotosByProject(projectId, activeStage));

  const stages: PhotoStage[] = [
    'survey',
    'in_workshop',
    'installed',
    'delivery_receipt',
  ];

  const handleCapturePhoto = async () => {
    // Simulated photo URL / local asset path
    const mockUrl = `https://picsum.photos/seed/${Date.now()}/800/600`;
    await addPhoto(projectId, activeStage, mockUrl, caption || undefined);
    setCaption('');
    setPhotoModalOpen(false);
    Alert.alert('Foto Guardada', 'La imagen fue registrada en el proyecto.');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Relevamiento en Obra
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName}
          </Text>
        </View>
        <Button
          title=""
          variant="ghost"
          size="sm"
          icon={<ImageIcon size={22} color={colors.primary} />}
          onPress={onViewGallery}
        />
      </View>

      {/* Stage Selector Pills */}
      <View style={styles.stagesBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.stageTabsRow}>
            {stages.map((stage) => {
              const isActive = stage === activeStage;
              return (
                <Pressable
                  key={stage}
                  style={[styles.stageTab, isActive && styles.stageTabActive]}
                  onPress={() => setActiveStage(stage)}
                >
                  <Text
                    style={[
                      styles.stageTabText,
                      isActive && styles.stageTabTextActive,
                    ]}
                  >
                    {PHOTO_STAGE_LABELS_ES[stage]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Active Stage Info Card */}
        <Card style={styles.infoCard}>
          <Text style={styles.stageTitle}>
            {PHOTO_STAGE_LABELS_ES[activeStage]}
          </Text>
          <Text style={styles.stageDesc}>
            {activeStage === 'survey'
              ? 'Captura fotos de muros, tomas de agua/gas y cotas de relevamiento antes de diseñar.'
              : activeStage === 'in_workshop'
              ? 'Registra avances del armado en banco, pre-ensamble y control de calidad.'
              : activeStage === 'installed'
              ? 'Fotos de los muebles completamente instalados y ajustados en obra.'
              : 'Foto del acta de conformidad firmada por el cliente.'}
          </Text>

          <Button
            title={`Tomar Foto · ${PHOTO_STAGE_LABELS_ES[activeStage]}`}
            size="lg"
            icon={<Camera size={20} color="#ffffff" />}
            onPress={() => setPhotoModalOpen(true)}
            style={styles.captureButton}
          />
        </Card>

        {/* Laser Measure Quick Card */}
        <Card style={styles.laserCard}>
          <View style={styles.laserHeader}>
            <View style={styles.laserIconBadge}>
              <Ruler size={20} color="#0284c7" />
            </View>
            <View style={styles.laserTitleCol}>
              <Text style={styles.laserTitle}>Distanciómetro Láser</Text>
              <Text style={styles.laserSubtitle}>Conexión Bluetooth BLE (Fase 4)</Text>
            </View>
            <Badge label="BLE" variant="info" />
          </View>

          <Input
            placeholder="Anotar medida manual en mm (ej. 3,250 mm)"
            value={measureNotes}
            onChangeText={setMeasureNotes}
            keyboardType="numeric"
          />
        </Card>

        {/* Photos in this stage */}
        <View style={styles.photosSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Fotos Registradas ({photos.length})
            </Text>
          </View>

          {photos.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No hay fotos en esta etapa. Presiona "Tomar Foto" para registrar la primera.
              </Text>
            </Card>
          ) : (
            <View style={styles.photosGrid}>
              {photos.map((p) => (
                <Card key={p.id} style={styles.photoItemCard}>
                  <View style={styles.photoPlaceholder}>
                    <Camera size={24} color={colors.textMuted} />
                  </View>
                  <Text style={styles.photoCaption} numberOfLines={2}>
                    {p.caption || 'Sin descripción'}
                  </Text>
                  <Text style={styles.photoDate}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </Text>
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Photo Modal */}
      <Modal
        visible={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        title="Registrar Foto de Obra"
        footer={
          <>
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => setPhotoModalOpen(false)}
            />
            <Button
              title="Guardar Foto"
              icon={<CheckCircle size={18} color="#ffffff" />}
              onPress={handleCapturePhoto}
            />
          </>
        }
      >
        <Text style={styles.modalStageText}>
          Etapa: {PHOTO_STAGE_LABELS_ES[activeStage]}
        </Text>
        <Input
          label="Descripción o Cota de la Foto"
          placeholder="ej. Muro A: 3,450 mm con caja de luz a 1.20m"
          value={caption}
          onChangeText={setCaption}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  iconBtn: {
    padding: spacing.xs,
  },
  stagesBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  stageTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  stageTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHover,
  },
  stageTabActive: {
    backgroundColor: colors.primary,
  },
  stageTabText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  stageTabTextActive: {
    color: colors.textOnPrimary,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  infoCard: {
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  stageTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  stageDesc: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  captureButton: {
    width: '100%',
  },
  laserCard: {
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  laserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  laserIconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  laserTitleCol: {
    flex: 1,
  },
  laserTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  laserSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  photosSection: {
    marginTop: spacing.sm,
  },
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  emptyCard: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  photoItemCard: {
    width: '47.5%',
    padding: spacing.sm,
  },
  photoPlaceholder: {
    height: 90,
    backgroundColor: colors.surfaceHover,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  photoCaption: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  photoDate: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  modalStageText: {
    ...typography.captionBold,
    color: colors.primary,
    marginBottom: spacing.md,
  },
});
