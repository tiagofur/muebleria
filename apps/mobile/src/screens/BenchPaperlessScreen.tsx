import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Layers,
  Sparkles,
  RotateCcw,
  Box,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import { usePresentationStore } from '../stores/presentationStore';

export interface BenchPaperlessScreenProps {
  onBack: () => void;
  onOpen3D?: () => void;
}

export function BenchPaperlessScreen({
  onBack,
  onOpen3D,
}: BenchPaperlessScreenProps) {
  const {
    benchActivePieces,
    toggleBenchPieceAssembled,
    resetBenchAssembly,
    getSelectedModule,
  } = usePresentationStore();

  const currentModule = getSelectedModule();
  const assembledCount = benchActivePieces.filter((p) => p.assembled).length;
  const totalCount = benchActivePieces.length;
  const progressPercent =
    totalCount > 0 ? Math.round((assembledCount / totalCount) * 100) : 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Modo Banco Paperless
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {currentModule?.name || 'Módulo'} • Guía de Armado
          </Text>
        </View>
        {onOpen3D ? (
          <Button
            title="Ver 3D"
            size="sm"
            variant="secondary"
            onPress={onOpen3D}
          />
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Progress HUD Card */}
        <Card style={styles.progressCard} elevated>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.progressTitle}>Progreso de Armado</Text>
              <Text style={styles.progressSubtitle}>
                {assembledCount} de {totalCount} piezas colocadas ({progressPercent}%)
              </Text>
            </View>
            <Badge
              label={progressPercent === 100 ? 'Listo' : 'En Armado'}
              variant={progressPercent === 100 ? 'success' : 'primary'}
            />
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${progressPercent}%`,
                  backgroundColor:
                    progressPercent === 100 ? '#16a34a' : colors.primary,
                },
              ]}
            />
          </View>

          {assembledCount > 0 && (
            <View style={styles.resetRow}>
              <Button
                title="Reiniciar Checklist"
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} color={colors.textMuted} />}
                onPress={resetBenchAssembly}
              />
            </View>
          )}
        </Card>

        {/* Pieces Checklist */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Despiece y Tapacantos del Módulo ({totalCount})
          </Text>
        </View>

        {benchActivePieces.map((piece, idx) => {
          const isDone = piece.assembled;
          return (
            <Pressable
              key={piece.id}
              style={[styles.pieceCard, isDone && styles.pieceCardDone]}
              onPress={() => toggleBenchPieceAssembled(piece.id)}
            >
              <View style={styles.pieceHeader}>
                <View style={styles.checkboxContainer}>
                  {isDone ? (
                    <CheckCircle2 size={24} color="#16a34a" />
                  ) : (
                    <Circle size={24} color="#94a3b8" />
                  )}
                </View>

                <View style={styles.pieceInfoCol}>
                  <View style={styles.pieceTitleRow}>
                    <Text
                      style={[
                        styles.pieceName,
                        isDone && styles.pieceNameDone,
                      ]}
                    >
                      {idx + 1}. {piece.name}
                    </Text>
                    <Badge label={piece.material} variant="info" />
                  </View>

                  {/* Dimensions Box */}
                  <View style={styles.dimRow}>
                    <Text style={styles.dimText}>
                      📏 <Text style={styles.dimBold}>{piece.lengthMm}</Text> ×{' '}
                      <Text style={styles.dimBold}>{piece.widthMm}</Text> ×{' '}
                      {piece.thicknessMm} mm
                    </Text>
                  </View>

                  {/* Edge Banding Diagram Badges */}
                  <View style={styles.edgesRow}>
                    <Text style={styles.edgesLabel}>Cantos:</Text>
                    <View
                      style={[
                        styles.edgeBadge,
                        piece.edges.L1 && styles.edgeBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.edgeBadgeText,
                          piece.edges.L1 && styles.edgeBadgeTextActive,
                        ]}
                      >
                        L1 {piece.edges.L1 ? '✓' : '-'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.edgeBadge,
                        piece.edges.L2 && styles.edgeBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.edgeBadgeText,
                          piece.edges.L2 && styles.edgeBadgeTextActive,
                        ]}
                      >
                        L2 {piece.edges.L2 ? '✓' : '-'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.edgeBadge,
                        piece.edges.W1 && styles.edgeBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.edgeBadgeText,
                          piece.edges.W1 && styles.edgeBadgeTextActive,
                        ]}
                      >
                        W1 {piece.edges.W1 ? '✓' : '-'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.edgeBadge,
                        piece.edges.W2 && styles.edgeBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.edgeBadgeText,
                          piece.edges.W2 && styles.edgeBadgeTextActive,
                        ]}
                      >
                        W2 {piece.edges.W2 ? '✓' : '-'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </Pressable>
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
  progressCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  progressSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  progressBarTrack: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  resetRow: {
    alignItems: 'flex-end',
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  pieceCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pieceCardDone: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    opacity: 0.8,
  },
  pieceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkboxContainer: {
    paddingTop: 2,
  },
  pieceInfoCol: {
    flex: 1,
    gap: 4,
  },
  pieceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pieceName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
  pieceNameDone: {
    color: '#166534',
    textDecorationLine: 'line-through',
  },
  dimRow: {
    marginTop: 2,
  },
  dimText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 14,
  },
  dimBold: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  edgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  edgesLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginRight: 2,
  },
  edgeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  edgeBadgeActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  edgeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
  },
  edgeBadgeTextActive: {
    color: '#1d4ed8',
    fontWeight: 'bold',
  },
});
