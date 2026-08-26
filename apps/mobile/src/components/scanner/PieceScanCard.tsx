import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  ITEM_FLOOR_STATUS_LABELS_ES,
  nextItemFloorStatus,
  type ParsedPieceLabelScan,
  type ItemFloorStatus,
} from '@granete/domain';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { colors, spacing, radius, typography } from '../../theme';
import { useFloorScannerStore } from '../../stores/floorScannerStore';

export interface PieceScanCardProps {
  parsedScan: ParsedPieceLabelScan;
  onStatusUpdated?: () => void;
  onDismiss?: () => void;
}

export function PieceScanCard({
  parsedScan,
  onStatusUpdated,
  onDismiss,
}: PieceScanCardProps) {
  const isPiecePayload = parsedScan.kind === 'payload';
  const isModulePayload = parsedScan.kind === 'modulePayload';
  const itemId = isPiecePayload
    ? parsedScan.fields.partCode || parsedScan.fields.moduleCode
    : isModulePayload
      ? parsedScan.fields.itemId || parsedScan.fields.factoryCode
      : parsedScan.code;

  const currentStatus = useFloorScannerStore((s) => s.getItemStatus(itemId));

  const getStatusBadgeVariant = (status: ItemFloorStatus) => {
    switch (status) {
      case 'cut':
        return 'info';
      case 'edged':
        return 'warning';
      case 'assembled':
        return 'success';
      case 'packaged':
        return 'primary';
      case 'loaded':
        return 'success';
      case 'installed':
        return 'primary';
      default:
        return 'default';
    }
  };

  if (!isPiecePayload && !isModulePayload) {
    return (
      <Card style={styles.card} elevated>
        <View style={styles.header}>
          <Text style={styles.moduleCode}>Código General</Text>
          <Badge
            label={ITEM_FLOOR_STATUS_LABELS_ES[currentStatus]}
            variant={getStatusBadgeVariant(currentStatus)}
          />
        </View>

        <Text style={styles.plainCodeText}>{parsedScan.code}</Text>

        <View style={styles.footer}>
          <Badge label="Completado ✓" variant="success" />
        </View>
      </Card>
    );
  }

  if (isModulePayload) {
    const { fields } = parsedScan;
    const bultoLabel = fields.packageIndex && fields.totalPackages
      ? `Bulto ${fields.packageIndex} de ${fields.totalPackages}`
      : 'Mueble Armado';

    return (
      <Card style={styles.card} elevated>
        <View style={styles.header}>
          <View style={styles.titleColumn}>
            <Text style={styles.moduleCode}>{fields.factoryCode}</Text>
            <Text style={styles.partCode}>{bultoLabel}</Text>
          </View>
          <Badge
            label={ITEM_FLOOR_STATUS_LABELS_ES[currentStatus]}
            variant={getStatusBadgeVariant(currentStatus)}
          />
        </View>

        <Text style={styles.description}>{fields.moduleName}</Text>

        <View style={styles.badgeRow}>
          {fields.widthMm && fields.heightMm && fields.depthMm ? (
            <View style={styles.metricBadge}>
              <Text style={styles.metricLabel}>Medidas</Text>
              <Text style={styles.metricValue}>
                {fields.widthMm} × {fields.heightMm} × {fields.depthMm} mm
              </Text>
            </View>
          ) : null}

          {fields.revision ? (
            <View style={styles.metricBadge}>
              <Text style={styles.metricLabel}>Revisión OP</Text>
              <Text style={styles.metricValue}>Rev {fields.revision}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          {currentStatus === 'loaded' ? (
            <View style={styles.completedBadge}>
              <Text style={styles.completedText}>
                ✓ Cargado en Transporte
              </Text>
            </View>
          ) : (
            <View style={styles.actionRow}>
              <Pressable
                style={styles.loadButton}
                onPress={() => {
                  if (fields.projectId && fields.itemId) {
                    void Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                    void useFloorScannerStore
                      .getState()
                      .patchItemFloorStatus(
                        fields.projectId,
                        fields.itemId,
                        'loaded',
                      );
                    onStatusUpdated?.();
                  }
                }}
              >
                <Text style={styles.loadButtonText}>Marcar Cargado ✓</Text>
              </Pressable>
              {currentStatus !== 'packaged' ? (
                <Pressable
                  style={styles.packageButton}
                  onPress={() => {
                    if (fields.projectId && fields.itemId) {
                      void Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Medium,
                      );
                      void useFloorScannerStore
                        .getState()
                        .patchItemFloorStatus(
                          fields.projectId,
                          fields.itemId,
                          'packaged',
                        );
                      onStatusUpdated?.();
                    }
                  }}
                >
                  <Text style={styles.packageButtonText}>📦 Embalado</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </Card>
    );
  }

  const { fields } = parsedScan;

  return (
    <Card style={styles.card} elevated>
      {/* Module and Piece Header */}
      <View style={styles.header}>
        <View style={styles.titleColumn}>
          <Text style={styles.moduleCode}>{fields.moduleCode}</Text>
          <Text style={styles.partCode}>{fields.partCode || 'Pieza Principal'}</Text>
        </View>
        <Badge
          label={ITEM_FLOOR_STATUS_LABELS_ES[currentStatus]}
          variant={getStatusBadgeVariant(currentStatus)}
        />
      </View>

      <Text style={styles.description}>{fields.description}</Text>

      {/* Metric badges */}
      <View style={styles.badgeRow}>
        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Medidas</Text>
          <Text style={styles.metricValue}>
            {fields.lengthMm} × {fields.widthMm} mm
          </Text>
        </View>

        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Material</Text>
          <Text style={styles.metricValue} numberOfLines={1}>
            {fields.materialCode}
          </Text>
        </View>
      </View>

      {/* Edgebands representation */}
      {fields.edgeSides || fields.edgeCode ? (
        <View style={styles.edgeSection}>
          <Text style={styles.edgeTitle}>Tapacantos:</Text>
          <View style={styles.edgeBadges}>
            {fields.edgeSides ? (
              <Badge label={`Lados: ${fields.edgeSides}`} variant="warning" />
            ) : null}
            {fields.edgeCode ? (
              <Badge label={`Canto: ${fields.edgeCode}`} variant="default" />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Action Footer */}
      <View style={styles.footer}>
        <View style={styles.completedBadge}>
          <Text style={styles.completedText}>
            El avance se registra desde el escaneo (servidor)
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  titleColumn: {
    flex: 1,
  },
  moduleCode: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  partCode: {
    ...typography.mono,
    color: colors.primary,
    fontWeight: '700',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  plainCodeText: {
    ...typography.h3,
    color: colors.textPrimary,
    marginVertical: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricBadge: {
    flex: 1,
    backgroundColor: colors.surfaceHover,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 2,
  },
  metricValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  edgeSection: {
    marginBottom: spacing.md,
    padding: spacing.sm,
    backgroundColor: '#fffbeb',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  edgeTitle: {
    ...typography.captionBold,
    color: '#92400e',
    marginBottom: spacing.xs,
  },
  edgeBadges: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  footer: {
    marginTop: spacing.xs,
  },
  advanceButton: {
    width: '100%',
  },
  completedBadge: {
    backgroundColor: colors.successBg,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  completedText: {
    ...typography.bodyBold,
    color: colors.success,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  loadButton: {
    flex: 1.2,
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  loadButtonText: {
    ...typography.bodyBold,
    color: '#ffffff',
  },
  packageButton: {
    flex: 0.8,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  packageButtonText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
});
