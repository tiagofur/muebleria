import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { ArrowLeft, Trash2, Camera } from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { colors, spacing, radius, typography } from '../theme';
import {
  useCrmStore,
  type PhotoStage,
  PHOTO_STAGE_LABELS_ES,
} from '../stores/crmStore';

export interface ProjectPhotosScreenProps {
  projectId?: string;
  projectName?: string;
  onBack: () => void;
}

export function ProjectPhotosScreen({
  projectId = 'proj-1',
  projectName = 'Cocina Residencia Pérez',
  onBack,
}: ProjectPhotosScreenProps) {
  const [selectedStage, setSelectedStage] = useState<PhotoStage | 'all'>('all');

  const photos = useCrmStore((s) =>
    s.getPhotosByProject(
      projectId,
      selectedStage === 'all' ? undefined : selectedStage
    )
  );
  const deletePhoto = useCrmStore((s) => s.deletePhoto);

  const handleDelete = (photoId: string) => {
    Alert.alert('Eliminar Foto', '¿Deseas quitar esta foto del proyecto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => deletePhoto(projectId, photoId),
      },
    ]);
  };

  const filterTabs: Array<{ id: PhotoStage | 'all'; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'survey', label: 'Relevamiento' },
    { id: 'in_workshop', label: 'Taller' },
    { id: 'installed', label: 'Instalado' },
    { id: 'delivery_receipt', label: 'Acta Entrega' },
  ];

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Galería del Proyecto
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName}
          </Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filtersBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filtersRow}>
            {filterTabs.map((tab) => {
              const isActive = tab.id === selectedStage;
              return (
                <Pressable
                  key={tab.id}
                  style={[styles.filterTab, isActive && styles.filterTabActive]}
                  onPress={() => setSelectedStage(tab.id)}
                >
                  <Text
                    style={[
                      styles.filterTabText,
                      isActive && styles.filterTabTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Gallery Content */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {photos.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Camera size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin Fotos</Text>
            <Text style={styles.emptySubtitle}>
              No hay fotos registradas en esta categoría.
            </Text>
          </Card>
        ) : (
          <View style={styles.galleryGrid}>
            {photos.map((photo) => (
              <Card key={photo.id} style={styles.photoCard} elevated>
                <View style={styles.photoPreview}>
                  <Camera size={32} color={colors.textMuted} />
                </View>

                <View style={styles.photoInfo}>
                  <Badge
                    label={PHOTO_STAGE_LABELS_ES[photo.stage]}
                    variant="primary"
                    style={styles.stageBadge}
                  />
                  <Text style={styles.captionText} numberOfLines={2}>
                    {photo.caption || 'Foto de obra sin nota'}
                  </Text>
                  <Text style={styles.dateText}>
                    {new Date(photo.createdAt).toLocaleString()}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleDelete(photo.id)}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Trash2 size={16} color={colors.danger} />
                </Pressable>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: spacing.sm,
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
  filtersBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  filtersRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  filterTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHover,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
  },
  filterTabText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  filterTabTextActive: {
    color: colors.textOnPrimary,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  galleryGrid: {
    gap: spacing.md,
  },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    position: 'relative',
  },
  photoPreview: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  photoInfo: {
    flex: 1,
    paddingRight: spacing.lg,
  },
  stageBadge: {
    marginBottom: 4,
  },
  captionText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  dateText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  deleteBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    padding: spacing.xs,
  },
});
