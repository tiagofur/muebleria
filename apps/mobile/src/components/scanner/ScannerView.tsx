import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { Zap, ZapOff, Keyboard, QrCode } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export interface ScannerViewProps {
  onScan: (data: string) => void;
  title?: string;
  subtitle?: string;
}

const { width } = Dimensions.get('window');
const TARGET_SIZE = Math.min(width * 0.72, 280);

export function ScannerView({
  onScan,
  title = 'Escáner de Piezas',
  subtitle = 'Apunta al código QR de la etiqueta',
}: ScannerViewProps) {
  const [torchOn, setTorchOn] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const handleManualSubmit = () => {
    if (!manualCode.trim()) return;
    const code = manualCode.trim();
    setManualModalOpen(false);
    setManualCode('');
    onScan(code);
  };

  return (
    <View style={styles.container}>
      {/* Top Controls Overlay */}
      <View style={styles.topControls}>
        <Pressable
          style={[styles.controlBtn, torchOn && styles.controlBtnActive]}
          onPress={() => setTorchOn(!torchOn)}
          accessibilityLabel="Linterna"
        >
          {torchOn ? (
            <Zap size={22} color="#facc15" />
          ) : (
            <ZapOff size={22} color="#ffffff" />
          )}
        </Pressable>

        <Pressable
          style={styles.controlBtn}
          onPress={() => setManualModalOpen(true)}
          accessibilityLabel="Ingreso Manual de Código"
        >
          <Keyboard size={22} color="#ffffff" />
        </Pressable>
      </View>

      {/* Target Reticle Frame */}
      <View style={styles.reticleContainer}>
        <View style={styles.reticle}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
          <QrCode size={48} color="rgba(255, 255, 255, 0.4)" />
        </View>
        <Text style={styles.guideTitle}>{title}</Text>
        <Text style={styles.guideSubtitle}>{subtitle}</Text>
      </View>

      {/* Manual Input Modal */}
      <Modal
        visible={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Ingresar Código Manual"
        footer={
          <>
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => setManualModalOpen(false)}
            />
            <Button title="Buscar Pieza" onPress={handleManualSubmit} />
          </>
        }
      >
        <Text style={styles.modalHint}>
          Pega el JSON de la etiqueta QR o escribe el código de módulo (ej. GAB-01-L1):
        </Text>
        <Input
          placeholder="Código o JSON..."
          value={manualCode}
          onChangeText={setManualCode}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.modalInput}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.3)',
    borderWidth: 1.5,
    borderColor: '#facc15',
  },
  reticleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: colors.primary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: radius.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: radius.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: radius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: radius.md,
  },
  guideTitle: {
    ...typography.h2,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  guideSubtitle: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  modalHint: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  modalInput: {
    minHeight: 80,
  },
});
