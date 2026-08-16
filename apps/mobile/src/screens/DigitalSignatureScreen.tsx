import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  PanResponder,
  GestureResponderEvent,
} from 'react-native';
import {
  ArrowLeft,
  PenTool,
  CheckCircle2,
  RotateCcw,
  FileCheck,
  ShieldCheck,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { colors, spacing, radius, typography } from '../theme';
import { usePresentationStore } from '../stores/presentationStore';

export interface DigitalSignatureScreenProps {
  onBack: () => void;
  projectId?: string;
  projectName?: string;
  defaultCustomerName?: string;
}

export function DigitalSignatureScreen({
  onBack,
  projectId = 'proj-1',
  projectName = 'Cocina Residencia Pérez',
  defaultCustomerName = 'Roberto Pérez',
}: DigitalSignatureScreenProps) {
  const [customerName, setCustomerName] = useState(defaultCustomerName);
  const [documentNumber, setDocumentNumber] = useState('28.450.123');
  const [notes, setNotes] = useState('Mobiliario recibido e instalado conforme a plano.');
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [isSigned, setIsSigned] = useState(false);

  const saveDigitalSignature = usePresentationStore((s) => s.saveDigitalSignature);

  // PanResponder for smooth finger drawing
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          setPoints((prev) => [...prev, { x: locationX, y: locationY }]);
          setIsSigned(true);
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          setPoints((prev) => [...prev, { x: locationX, y: locationY }]);
        },
      }),
    []
  );

  const handleClearSignature = () => {
    setPoints([]);
    setIsSigned(false);
  };

  const handleConfirmSignature = () => {
    if (!isSigned || points.length < 5) {
      Alert.alert(
        'Firma Requerida',
        'Por favor solicita al cliente que dibuje su firma en el recuadro táctil.'
      );
      return;
    }

    if (!customerName.trim()) {
      Alert.alert('Datos Incompletos', 'Ingresa el nombre del firmante.');
      return;
    }

    saveDigitalSignature({
      projectId,
      customerName,
      documentNumber,
      notes,
      signatureSvgPaths: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    });

    Alert.alert(
      'Acta de Entrega Registrada',
      'La firma digital y el acta de conformidad han sido guardadas y vinculadas al proyecto.',
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
            Acta de Entrega Digital
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName} • Firma de Conformidad
          </Text>
        </View>
        <Badge label="Legal" variant="success" />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Compliance Guarantee Banner */}
        <Card style={styles.guaranteeCard} elevated>
          <View style={styles.guaranteeRow}>
            <ShieldCheck size={28} color="#16a34a" />
            <View style={styles.guaranteeTextCol}>
              <Text style={styles.guaranteeTitle}>
                Acta de Recepción de Obra
              </Text>
              <Text style={styles.guaranteeDesc}>
                Certifica la entrega de los módulos instalados y da inicio a la garantía de fabricación.
              </Text>
            </View>
          </View>
        </Card>

        {/* Customer & Signer Form */}
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Datos del Receptor / Cliente</Text>

          <Input
            label="Nombre y Apellido"
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Ej. Roberto Pérez"
          />

          <Input
            label="DNI / CUIT"
            value={documentNumber}
            onChangeText={setDocumentNumber}
            placeholder="Ej. 28.450.123"
            keyboardType="numeric"
          />

          <Input
            label="Observaciones de Conformidad"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Muebles recibidos sin observaciones..."
          />
        </Card>

        {/* Touch Drawing Signature Canvas */}
        <Card style={styles.signatureCard} elevated>
          <View style={styles.sigHeader}>
            <View style={styles.sigTitleRow}>
              <PenTool size={18} color={colors.primary} />
              <Text style={styles.sigTitle}>Firma Táctil del Cliente</Text>
            </View>
            {isSigned && (
              <Button
                title="Limpiar"
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} color={colors.textMuted} />}
                onPress={handleClearSignature}
              />
            )}
          </View>

          {/* Touch Canvas */}
          <View style={styles.canvasContainer} {...panResponder.panHandlers}>
            {points.length === 0 ? (
              <View style={styles.canvasPlaceholder}>
                <PenTool size={36} color="#cbd5e1" />
                <Text style={styles.placeholderText}>
                  Dibuje la firma aquí con el dedo o stylus
                </Text>
                <View style={styles.signingLine} />
                <Text style={styles.lineLabel}>Línea de Firma</Text>
              </View>
            ) : (
              <View style={styles.drawingArea}>
                {points.map((p, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.dot,
                      {
                        left: p.x - 2,
                        top: p.y - 2,
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>

          <Text style={styles.legalDisclaimer}>
            Al firmar, el receptor declara haber inspeccionado los módulos, herrajes y terminaciones instaladas, prestando plena conformidad.
          </Text>
        </Card>

        {/* Action Button */}
        <Button
          title="Confirmar Entrega y Guardar Acta"
          size="lg"
          icon={<FileCheck size={20} color="#ffffff" />}
          onPress={handleConfirmSignature}
          style={styles.confirmBtn}
        />
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
  guaranteeCard: {
    padding: spacing.md,
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  guaranteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  guaranteeTextCol: {
    flex: 1,
  },
  guaranteeTitle: {
    ...typography.bodyBold,
    color: '#166534',
  },
  guaranteeDesc: {
    ...typography.caption,
    color: '#15803d',
    marginTop: 2,
  },
  formCard: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  formTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  signatureCard: {
    padding: spacing.md,
  },
  sigHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sigTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sigTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  canvasContainer: {
    width: '100%',
    height: 180,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  canvasPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  placeholderText: {
    ...typography.caption,
    color: '#94a3b8',
    marginTop: spacing.xs,
  },
  signingLine: {
    position: 'absolute',
    bottom: 35,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: '#cbd5e1',
  },
  lineLabel: {
    position: 'absolute',
    bottom: 18,
    fontSize: 10,
    color: '#94a3b8',
  },
  drawingArea: {
    flex: 1,
    position: 'relative',
  },
  dot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0f172a',
  },
  legalDisclaimer: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: '#16a34a',
    marginTop: spacing.xs,
  },
});
