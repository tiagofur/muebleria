import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Vibration,
} from 'react-native';
import { ArrowLeft, History, RotateCcw } from 'lucide-react-native';
import { ScannerView } from '../components/scanner/ScannerView';
import { PieceScanCard } from '../components/scanner/PieceScanCard';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import { useFloorScannerStore } from '../stores/floorScannerStore';
import { ITEM_FLOOR_STATUS_LABELS_ES } from '@muebles/domain';

export interface ScannerScreenProps {
  onBack: () => void;
}

export function ScannerScreen({ onBack }: ScannerScreenProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const processScan = useFloorScannerStore((s) => s.processScan);
  const activeScan = useFloorScannerStore((s) => s.activeScan);
  const setActiveScan = useFloorScannerStore((s) => s.setActiveScan);
  const history = useFloorScannerStore((s) => s.history);
  const clearHistory = useFloorScannerStore((s) => s.clearHistory);
  const autoAdvance = useFloorScannerStore((s) => s.autoAdvance);
  const setAutoAdvance = useFloorScannerStore((s) => s.setAutoAdvance);
  const advanceScan = useFloorScannerStore((s) => s.advanceScan);
  const pendingCount = useFloorScannerStore((s) => s.pendingScans.length);
  const syncPending = useFloorScannerStore((s) => s.syncPending);

  const handleScan = async (data: string) => {
    await processScan(data);
  };

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color="#ffffff" />
        </Pressable>

        <Text style={styles.headerTitle}>Escáner de Piso</Text>

        <Pressable
          onPress={() => setHistoryOpen(true)}
          hitSlop={12}
          style={styles.iconBtn}
        >
          <History size={22} color="#ffffff" />
        </Pressable>
      </View>

      {/* Main Scanner Viewport */}
      <View style={styles.scannerArea}>
        <ScannerView
          onScan={handleScan}
          title="Taller de Producción"
          subtitle="Enfoca la etiqueta QR de la pieza de tablero"
        />
      </View>

      {/* Bottom Sheet / Active Piece Overlay */}
      {activeScan ? (
        <View style={styles.bottomOverlay}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Pieza Detectada</Text>
            <Button
              title="Cerrar"
              variant="ghost"
              size="sm"
              onPress={() => setActiveScan(null)}
            />
          </View>
          {activeScan.resolution ? (
            <View style={styles.resolutionBox}>
              <Text style={styles.resolutionProject}>
                {activeScan.resolution.projectName} · {activeScan.resolution.factoryCode}
              </Text>
              <Text style={styles.resolutionStatus}>
                {ITEM_FLOOR_STATUS_LABELS_ES[activeScan.resolution.statusBefore]}
                {activeScan.resolution.statusAfter !== activeScan.resolution.statusBefore
                  ? ` → ${ITEM_FLOOR_STATUS_LABELS_ES[activeScan.resolution.statusAfter]}`
                  : ''}
              </Text>
              {activeScan.resolution.nextStatus ? (
                <Button
                  title={`Marcar: ${ITEM_FLOOR_STATUS_LABELS_ES[activeScan.resolution.nextStatus!]}`}
                  variant="primary"
                  size="sm"
                  onPress={() => {
                    Vibration.vibrate([0, 80]);
                    advanceScan(activeScan);
                  }}
                />
              ) : (
                <Text style={styles.resolutionDone}>Completo ✓</Text>
              )}
            </View>
          ) : null}
          {activeScan.physical ? (
            <View style={styles.resolutionBox}>
              <Text style={styles.resolutionProject}>
                {activeScan.physical.kind === 'part' ? 'Pieza' : 'Unidad'} ·{' '}
                {activeScan.physical.partCode ?? activeScan.physical.id}
                {activeScan.physical.unitIndex ? ` (U${activeScan.physical.unitIndex})` : ''}
              </Text>
              <Text style={styles.resolutionStatus}>
                {activeScan.physical.status.replace(/_/g, ' ')}
              </Text>
              {activeScan.physical.nextStatus || activeScan.physical.status !== 'installed' ? (
                <Button
                  title="Avanzar"
                  variant="primary"
                  size="sm"
                  onPress={() => {
                    Vibration.vibrate([0, 80]);
                    advanceScan(activeScan);
                  }}
                />
              ) : (
                <Text style={styles.resolutionDone}>Instalada ✓</Text>
              )}
            </View>
          ) : null}
          {activeScan.error ? (
            <Text style={styles.scanError}>{activeScan.error}</Text>
          ) : null}
          <PieceScanCard
            parsedScan={activeScan.parsed}
            onDismiss={() => setActiveScan(null)}
          />
        </View>
      ) : (
        <View style={styles.idleBottomBanner}>
          <Text style={styles.idleText}>
            💡 Listo para escanear. Acerca una etiqueta con código QR.
          </Text>
          <Pressable
            style={styles.autoAdvanceToggle}
            onPress={() => setAutoAdvance(!autoAdvance)}
          >
            <Text style={styles.autoAdvanceText}>
              {autoAdvance ? '✓ Auto-avanzar' : 'Auto-avanzar'} · {history.length} escaneos
              {pendingCount > 0 ? ` · ${pendingCount} sin sincronizar` : ''}
            </Text>
          </Pressable>
          {pendingCount > 0 ? (
            <Button title="Sincronizar" variant="primary" size="sm" onPress={syncPending} />
          ) : null}
        </View>
      )}

      {/* Scan History Modal */}
      <Modal
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={`Historial de Escaneos (${history.length})`}
        footer={
          <>
            <Button
              title="Borrar Todo"
              variant="danger"
              icon={<RotateCcw size={16} color="#ffffff" />}
              onPress={clearHistory}
            />
            <Button title="Cerrar" onPress={() => setHistoryOpen(false)} />
          </>
        }
      >
        {history.length === 0 ? (
          <Text style={styles.emptyHistoryText}>
            No hay piezas escaneadas en esta sesión.
          </Text>
        ) : (
          <ScrollView style={styles.historyList}>
            {history.map((rec) => {
              const parsed = rec.parsed;
              const code =
                parsed.kind === 'payload'
                  ? `${parsed.fields.moduleCode} - ${parsed.fields.partCode || 'Base'}`
                  : parsed.kind === 'modulePayload'
                    ? `${parsed.fields.factoryCode} (Bulto ${parsed.fields.packageIndex ?? 1})`
                    : parsed.code;

              return (
                <Pressable
                  key={rec.id}
                  style={styles.historyItem}
                  onPress={() => {
                    setActiveScan(rec);
                    setHistoryOpen(false);
                  }}
                >
                  <View style={styles.historyItemContent}>
                    <Text style={styles.historyCode}>{code}</Text>
                    {parsed.kind === 'payload' ? (
                      <Text style={styles.historyDesc}>
                        {parsed.fields.lengthMm}×{parsed.fields.widthMm} mm •{' '}
                        {parsed.fields.materialCode}
                      </Text>
                    ) : parsed.kind === 'modulePayload' ? (
                      <Text style={styles.historyDesc}>
                        {parsed.fields.moduleName}
                      </Text>
                    ) : null}
                  </View>
                  <Badge
                    label={ITEM_FLOOR_STATUS_LABELS_ES[rec.currentStatus]}
                    variant={rec.currentStatus === 'installed' ? 'success' : 'default'}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.scannerBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.scannerHeaderBg,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.scannerTextOnDark,
  },
  iconBtn: {
    padding: spacing.xs,
  },
  scannerArea: {
    flex: 1,
  },
  bottomOverlay: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sheetTitle: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  idleBottomBanner: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    padding: spacing.lg,
    alignItems: 'center',
  },
  autoAdvanceToggle: {
    paddingVertical: spacing.sm,
  },
  autoAdvanceText: {
    color: colors.scannerSubtextOnDark,
    fontSize: typography.body.fontSize,
  },
  resolutionBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  resolutionProject: {
    color: colors.scannerTextOnDark,
    fontSize: typography.h3.fontSize,
    fontWeight: '600',
  },
  resolutionStatus: {
    color: colors.scannerSuccessOnDark,
    fontSize: typography.body.fontSize,
  },
  resolutionDone: {
    color: colors.scannerMutedOnDark,
    fontSize: typography.body.fontSize,
  },
  scanError: {
    color: colors.scannerErrorOnDark,
    fontSize: typography.body.fontSize,
    marginBottom: spacing.sm,
  },
  idleText: {
    ...typography.body,
    color: colors.scannerSubtextOnDark,
    textAlign: 'center',
  },
  emptyHistoryText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  historyList: {
    maxHeight: 340,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyItemContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  historyCode: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  historyDesc: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
