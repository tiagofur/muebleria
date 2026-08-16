import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import {
  ArrowLeft,
  Ruler,
  Trash2,
  Save,
  Zap,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import { useLaserMeasureStore } from '../stores/laserMeasureStore';
import { useCrmStore } from '../stores/crmStore';

export interface PhotoAnnotationScreenProps {
  onBack: () => void;
  imageUri?: string;
}

export interface DimensionLine {
  id: string;
  label: string;
  valueMm: number;
  startX: number; // percentage 0 - 100
  startY: number;
  endX: number;
  endY: number;
}

const DEFAULT_SURVEY_CANVAS =
  'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80';

export function PhotoAnnotationScreen({
  onBack,
  imageUri = DEFAULT_SURVEY_CANVAS,
}: PhotoAnnotationScreenProps) {
  const { lastMeasurement, wallMeasurements } = useLaserMeasureStore();
  const addPhoto = useCrmStore((s) => s.addPhoto);

  const [annotations, setAnnotations] = useState<DimensionLine[]>([
    {
      id: 'ann-1',
      label: 'Ancho Muro Principal',
      valueMm: wallMeasurements.wallWidthMm ?? 2850,
      startX: 15,
      startY: 75,
      endX: 85,
      endY: 75,
    },
    {
      id: 'ann-2',
      label: 'Alto Techo',
      valueMm: wallMeasurements.wallHeightMm ?? 2600,
      startX: 88,
      startY: 20,
      endX: 88,
      endY: 80,
    },
  ]);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    'ann-1'
  );

  const handleAddFromLaser = () => {
    const mm = lastMeasurement?.distanceMm ?? 1500;
    const newAnn: DimensionLine = {
      id: `ann-${Date.now()}`,
      label: `Cota Láser #${annotations.length + 1}`,
      valueMm: mm,
      startX: 25,
      startY: 40 + annotations.length * 10,
      endX: 75,
      endY: 40 + annotations.length * 10,
    };
    setAnnotations([...annotations, newAnn]);
    setSelectedAnnotationId(newAnn.id);
  };

  const handleRemoveAnnotation = (id: string) => {
    setAnnotations(annotations.filter((a) => a.id !== id));
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
  };

  const handleSaveToProject = () => {
    addPhoto(
      'proj-1',
      'survey',
      imageUri,
      `Relevamiento acotado con láser: ${annotations
        .map((a) => `${a.label} (${a.valueMm} mm)`)
        .join(', ')}`
    );
    Alert.alert(
      'Foto Acotada Guardada',
      'El relevamiento con sus cotas láser se ha guardado en el archivo del proyecto.',
      [{ text: 'Aceptar', onPress: onBack }]
    );
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
            Acotación sobre Foto
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Superposición de cotas láser ({annotations.length} medidas)
          </Text>
        </View>
        <Button
          title="Guardar"
          size="sm"
          icon={<Save size={15} color="#ffffff" />}
          onPress={handleSaveToProject}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Photo Viewport with Visual Overlay Dimension Lines */}
        <Card style={styles.canvasCard} elevated>
          <View style={styles.canvasWrapper}>
            <Image
              source={{ uri: imageUri }}
              style={styles.canvasImage}
              resizeMode="cover"
            />

            {/* Render Dimension Lines Over Photo */}
            {annotations.map((ann) => {
              const isSelected = selectedAnnotationId === ann.id;
              const isHorizontal = Math.abs(ann.startY - ann.endY) < 15;

              return (
                <Pressable
                  key={ann.id}
                  style={[
                    styles.dimensionLineBox,
                    {
                      left: `${Math.min(ann.startX, ann.endX)}%`,
                      top: `${Math.min(ann.startY, ann.endY)}%`,
                      width: isHorizontal
                        ? `${Math.abs(ann.endX - ann.startX)}%`
                        : 28,
                      height: isHorizontal
                        ? 28
                        : `${Math.abs(ann.endY - ann.startY)}%`,
                    },
                    isSelected && styles.dimensionLineSelected,
                  ]}
                  onPress={() => setSelectedAnnotationId(ann.id)}
                >
                  <View
                    style={[
                      styles.dimensionTag,
                      isSelected && styles.dimensionTagSelected,
                    ]}
                  >
                    <Text style={styles.dimensionTagText}>
                      {ann.valueMm} mm
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.canvasToolbar}>
            <Button
              title="Cota desde Láser"
              size="sm"
              icon={<Zap size={15} color="#ffffff" />}
              onPress={handleAddFromLaser}
              style={styles.laserAddBtn}
            />
            {lastMeasurement && (
              <Badge
                label={`Último: ${lastMeasurement.distanceMm} mm`}
                variant="primary"
              />
            )}
          </View>
        </Card>

        {/* Annotations List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Listado de Cotas en Imagen</Text>
        </View>

        {annotations.map((ann) => {
          const isSelected = selectedAnnotationId === ann.id;
          return (
            <Card
              key={ann.id}
              style={isSelected ? styles.annCardActive : styles.annCard}
            >
              <View style={styles.annRow}>
                <View style={styles.annInfo}>
                  <Text style={styles.annLabel}>{ann.label}</Text>
                  <Text style={styles.annValue}>
                    {ann.valueMm} mm ({(ann.valueMm / 1000).toFixed(3)} m)
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRemoveAnnotation(ann.id)}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Trash2 size={18} color="#ef4444" />
                </Pressable>
              </View>
            </Card>
          );
        })}
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
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  canvasCard: {
    padding: 0,
    overflow: 'hidden',
  },
  canvasWrapper: {
    width: '100%',
    height: 260,
    position: 'relative',
    backgroundColor: '#000000',
  },
  canvasImage: {
    width: '100%',
    height: '100%',
    opacity: 0.85,
  },
  dimensionLineBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#38bdf8',
    borderStyle: 'dashed',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimensionLineSelected: {
    borderColor: '#f59e0b',
    borderWidth: 2.5,
    borderStyle: 'solid',
  },
  dimensionTag: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  dimensionTagSelected: {
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(180, 83, 9, 0.9)',
  },
  dimensionTagText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  canvasToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  laserAddBtn: {
    backgroundColor: '#0284c7',
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  annCard: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  annCardActive: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  annRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  annInfo: {
    flex: 1,
  },
  annLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  annValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: 2,
  },
  deleteBtn: {
    padding: spacing.xs,
  },
});
