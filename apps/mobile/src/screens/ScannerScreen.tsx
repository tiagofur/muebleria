import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
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
    backgroundColor: '#090d16',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: '#0f172a',
  },
  headerTitle: {
    ...typography.h3,
    color: '#ffffff',
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
  idleText: {
    ...typography.body,
    color: '#cbd5e1',
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
