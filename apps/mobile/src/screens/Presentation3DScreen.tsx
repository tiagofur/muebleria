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
  Box,
  RotateCcw,
  Eye,
  Sliders,
  Sparkles,
  Layers,
  Check,
  Maximize2,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import { usePresentationStore } from '../stores/presentationStore';
import { seedCatalogExpandedLatAm } from '@muebles/domain';

export interface Presentation3DScreenProps {
  onBack: () => void;
  onOpenBench?: () => void;
}

export function Presentation3DScreen({
  onBack,
  onOpenBench,
}: Presentation3DScreenProps) {
  const {
    selectedModuleId,
    explodedViewProgress,
    selectedMaterialId,
    cameraPreset,
    setSelectedModuleId,
    setExplodedViewProgress,
    setSelectedMaterialId,
    setCameraPreset,
    getSelectedModule,
    getSelectedMaterial,
  } = usePresentationStore();

  const [rotationAngle, setRotationAngle] = useState(35);
  const currentModule = getSelectedModule();
  const currentMaterial = getSelectedMaterial();

  const handleRotateLeft = () => setRotationAngle((prev) => (prev - 45 + 360) % 360);
  const handleRotateRight = () => setRotationAngle((prev) => (prev + 45) % 360);

  const materials = seedCatalogExpandedLatAm.materials;
  const modules = seedCatalogExpandedLatAm.modules;

  // Visual simulation dimensions
  const dims = currentModule?.externalDims ?? {
    width: 800,
    depth: 600,
    height: 860,
  };

  const previewColor = currentMaterial?.previewColor || '#d97706';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Presentación 3D & Despiece
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {currentModule?.name || 'Módulo'} • Vista Cliente
          </Text>
        </View>
        {onOpenBench ? (
          <Button
            title="Modo Banco"
            size="sm"
            variant="secondary"
            onPress={onOpenBench}
          />
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* 3D Interactive Viewport Card */}
        <Card style={styles.viewportCard} elevated>
          {/* Top Overlays */}
          <View style={styles.viewportOverlayTop}>
            <Badge
              label={`${dims.width} × ${dims.depth} × ${dims.height} mm`}
              variant="primary"
            />
            <Badge
              label={`Ángulo: ${rotationAngle}°`}
              variant="info"
            />
          </View>

          {/* 3D Visual Rendering Canvas (Isometric Projections) */}
          <View style={styles.canvasArea}>
            <View
              style={[
                styles.isometricStage,
                {
                  transform: [
                    { rotate: `${rotationAngle}deg` },
                    { scale: 1 - explodedViewProgress * 0.15 },
                  ],
                },
              ]}
            >
              {/* Outer Shell / Carcase */}
              <View
                style={[
                  styles.furnitureMesh,
                  {
                    backgroundColor: previewColor,
                    borderColor: '#1e293b',
                  },
                ]}
              >
                {/* Simulated Exploded Panels */}
                <View
                  style={[
                    styles.explodedDoor,
                    {
                      backgroundColor: previewColor,
                      transform: [
                        {
                          translateY: -explodedViewProgress * 50,
                        },
                        {
                          translateX: explodedViewProgress * 40,
                        },
                      ],
                      opacity: 0.95,
                    },
                  ]}
                >
                  <Text style={styles.meshPartLabel}>Frente</Text>
                </View>

                <View
                  style={[
                    styles.explodedShelf,
                    {
                      backgroundColor: previewColor,
                      transform: [
                        {
                          translateY: explodedViewProgress * 35,
                        },
                      ],
                    },
                  ]}
                >
                  <Text style={styles.meshPartLabel}>Estante</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Orbit and Rotation Controls */}
          <View style={styles.viewportControls}>
            <Button
              title="⟲ -45°"
              size="sm"
              variant="secondary"
              onPress={handleRotateLeft}
              style={styles.orbitBtn}
            />
            <Button
              title="Restablecer"
              size="sm"
              variant="ghost"
              onPress={() => {
                setRotationAngle(35);
                setExplodedViewProgress(0);
              }}
              style={styles.orbitBtn}
            />
            <Button
              title="+45° ⟳"
              size="sm"
              variant="secondary"
              onPress={handleRotateRight}
              style={styles.orbitBtn}
            />
          </View>
        </Card>

        {/* Exploded View Slider Controls */}
        <Card style={styles.controlCard}>
          <View style={styles.controlTitleRow}>
            <Sliders size={18} color={colors.primary} />
            <Text style={styles.controlTitle}>Despiece y Explosión de Partes</Text>
            <Text style={styles.sliderValueText}>
              {Math.round(explodedViewProgress * 100)}%
            </Text>
          </View>

          <View style={styles.sliderButtonsRow}>
            {[0, 0.25, 0.5, 0.75, 1].map((val) => (
              <Pressable
                key={val}
                style={[
                  styles.progressStepBtn,
                  explodedViewProgress === val && styles.progressStepBtnActive,
                ]}
                onPress={() => setExplodedViewProgress(val)}
              >
                <Text
                  style={[
                    styles.progressStepText,
                    explodedViewProgress === val && styles.progressStepTextActive,
                  ]}
                >
                  {Math.round(val * 100)}%
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Material & Texture Finish Switcher */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Material de Acabado</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.materialsRow}>
            {materials.map((mat) => {
              const isSelected = selectedMaterialId === mat.id;
              return (
                <Pressable
                  key={mat.id}
                  style={[
                    styles.materialCard,
                    isSelected && styles.materialCardActive,
                  ]}
                  onPress={() => setSelectedMaterialId(mat.id)}
                >
                  <View
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: mat.previewColor || '#d97706' },
                    ]}
                  >
                    {isSelected && <Check size={16} color="#ffffff" />}
                  </View>
                  <Text style={styles.materialName} numberOfLines={1}>
                    {mat.name}
                  </Text>
                  <Text style={styles.materialThickness}>
                    {mat.thicknessMm} mm
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* Module Switcher Carousel */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Seleccionar Módulo</Text>
        </View>

        <View style={styles.modulesGrid}>
          {modules.slice(0, 6).map((mod) => {
            const isSelected = selectedModuleId === mod.id;
            return (
              <Pressable
                key={mod.id}
                style={[styles.moduleCard, isSelected && styles.moduleCardActive]}
                onPress={() => setSelectedModuleId(mod.id)}
              >
                <Box
                  size={20}
                  color={isSelected ? colors.primary : colors.textMuted}
                />
                <View style={styles.moduleTextCol}>
                  <Text
                    style={[
                      styles.moduleCardName,
                      isSelected && styles.moduleCardNameActive,
                    ]}
                    numberOfLines={1}
                  >
                    {mod.name}
                  </Text>
                  <Text style={styles.moduleCardCode}>{mod.code}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
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
  viewportCard: {
    backgroundColor: '#090d16',
    borderColor: '#1e293b',
    padding: spacing.md,
    height: 320,
    justifyContent: 'space-between',
  },
  viewportOverlayTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  canvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  isometricStage: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  furnitureMesh: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
  explodedDoor: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  explodedShelf: {
    position: 'absolute',
    width: 90,
    height: 18,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meshPartLabel: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
  viewportControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderRadius: radius.md,
    padding: 4,
  },
  orbitBtn: {
    flex: 1,
    marginHorizontal: 2,
  },
  controlCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  controlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  controlTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    flex: 1,
  },
  sliderValueText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 16,
  },
  sliderButtonsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  progressStepBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  progressStepBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  progressStepText: {
    ...typography.caption,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  progressStepTextActive: {
    color: '#ffffff',
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  materialsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  materialCard: {
    width: 110,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  materialCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  colorSwatch: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  materialName: {
    ...typography.caption,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  materialThickness: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  modulesGrid: {
    gap: spacing.xs,
  },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  moduleCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  moduleTextCol: {
    flex: 1,
  },
  moduleCardName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  moduleCardNameActive: {
    color: colors.primary,
  },
  moduleCardCode: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
