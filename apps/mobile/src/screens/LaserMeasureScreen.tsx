import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  ArrowLeft,
  Bluetooth,
  BluetoothConnected,
  Ruler,
  RefreshCw,
  Zap,
  CheckCircle2,
  Trash2,
  Maximize2,
  MoveUp,
  Sparkles,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import {
  useLaserMeasureStore,
  type MeasurementTarget,
} from '../stores/laserMeasureStore';
import { bleLaserService } from '../services/bleLaserService';

export interface LaserMeasureScreenProps {
  onBack: () => void;
  onNavigateToAnnotation?: () => void;
}

const TARGETS: { id: MeasurementTarget; label: string; icon: string }[] = [
  { id: 'wall_width', label: 'Ancho Muro', icon: '↔' },
  { id: 'wall_height', label: 'Alto a Techo', icon: '↕' },
  { id: 'wall_depth', label: 'Profundidad Muro', icon: '↗' },
  { id: 'water_supply_offset', label: 'Toma Agua / Desagüe', icon: '💧' },
  { id: 'gas_supply_offset', label: 'Toma de Gas', icon: '🔥' },
  { id: 'electrical_socket_offset', label: 'Caja Enchufe', icon: '⚡' },
];

export function LaserMeasureScreen({
  onBack,
  onNavigateToAnnotation,
}: LaserMeasureScreenProps) {
  const {
    isScanning,
    discoveredDevices,
    connectedDevice,
    activeTarget,
    lastMeasurement,
    history,
    wallMeasurements,
    activeWall,
    startScanning,
    stopScanning,
    connectDevice,
    disconnectDevice,
    setActiveTarget,
    setActiveWall,
    recordMeasurement,
    clearHistory,
    resetWallMeasures,
  } = useLaserMeasureStore();

  const [unitMode, setUnitMode] = useState<'mm' | 'm'>('mm');

  useEffect(() => {
    // Auto-scan on screen enter if not connected
    if (!connectedDevice) {
      startScanning();
    }
    return () => {
      stopScanning();
    };
  }, [connectedDevice]);

  const handleSimulateLaserShot = () => {
    // Simulate typical room measurement (e.g. 2400 - 3200 mm)
    const randomDistance = Math.floor(Math.random() * (3600 - 1800 + 1) + 1800);
    bleLaserService.emitMeasurement(randomDistance);
  };

  const formatDistance = (mm?: number) => {
    if (mm === undefined) return '---';
    if (unitMode === 'm') {
      return `${(mm / 1000).toFixed(3)} m`;
    }
    return `${mm} mm`;
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
            Medición Láser BLE
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {connectedDevice ? `Conectado: ${connectedDevice.name}` : 'Buscando distanciómetros...'}
          </Text>
        </View>
        {onNavigateToAnnotation ? (
          <Button
            title="Anotar Foto"
            size="sm"
            variant="secondary"
            onPress={onNavigateToAnnotation}
          />
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* BLE Connection Status Card */}
        <Card style={styles.deviceCard} elevated>
          <View style={styles.deviceHeader}>
            <View style={styles.deviceInfo}>
              {connectedDevice ? (
                <BluetoothConnected size={24} color="#16a34a" />
              ) : (
                <Bluetooth size={24} color={colors.primary} />
              )}
              <View>
                <Text style={styles.deviceName}>
                  {connectedDevice ? connectedDevice.name : 'Distanciómetro Láser'}
                </Text>
                <Text style={styles.deviceSub}>
                  {connectedDevice
                    ? `Batería: ${connectedDevice.batteryLevel ?? 85}% • Señal: ${connectedDevice.rssi} dBm`
                    : isScanning
                    ? 'Escaneando dispositivos cercanos...'
                    : 'Sin conexión activa'}
                </Text>
              </View>
            </View>

            {connectedDevice ? (
              <Button
                title="Desconectar"
                variant="ghost"
                size="sm"
                onPress={disconnectDevice}
              />
            ) : (
              <Button
                title={isScanning ? 'Buscando...' : 'Escanear'}
                variant="secondary"
                size="sm"
                icon={
                  isScanning ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <RefreshCw size={15} color={colors.primary} />
                  )
                }
                onPress={isScanning ? stopScanning : startScanning}
              />
            )}
          </View>

          {/* Discovered devices dropdown if not connected */}
          {!connectedDevice && discoveredDevices.length > 0 && (
            <View style={styles.deviceList}>
              <Text style={styles.deviceListTitle}>Dispositivos encontrados:</Text>
              {discoveredDevices.map((dev) => (
                <Pressable
                  key={dev.id}
                  style={styles.discoveredRow}
                  onPress={() => connectDevice(dev)}
                >
                  <View style={styles.discoveredInfo}>
                    <Text style={styles.discoveredName}>{dev.name}</Text>
                    <Text style={styles.discoveredRssi}>Señal: {dev.rssi} dBm</Text>
                  </View>
                  <Badge label="Vincular" variant="primary" />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        {/* Live Measurement HUD */}
        <Card style={styles.hudCard} elevated>
          <View style={styles.hudTop}>
            <Badge
              label={`Muro ${activeWall.toUpperCase()} • ${
                TARGETS.find((t) => t.id === activeTarget)?.label
              }`}
              variant="primary"
            />
            <View style={styles.unitToggle}>
              <Pressable
                style={[styles.unitBtn, unitMode === 'mm' && styles.unitBtnActive]}
                onPress={() => setUnitMode('mm')}
              >
                <Text
                  style={[styles.unitBtnText, unitMode === 'mm' && styles.unitBtnTextActive]}
                >
                  mm
                </Text>
              </Pressable>
              <Pressable
                style={[styles.unitBtn, unitMode === 'm' && styles.unitBtnActive]}
                onPress={() => setUnitMode('m')}
              >
                <Text
                  style={[styles.unitBtnText, unitMode === 'm' && styles.unitBtnTextActive]}
                >
                  m
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Digital Readout */}
          <View style={styles.readoutContainer}>
            <Text style={styles.readoutValue}>
              {lastMeasurement
                ? unitMode === 'm'
                  ? (lastMeasurement.distanceMm / 1000).toFixed(3)
                  : lastMeasurement.distanceMm
                : '0'}
            </Text>
            <Text style={styles.readoutUnit}>{unitMode}</Text>
          </View>

          {/* Laser Shot Buttons */}
          <View style={styles.hudActions}>
            <Button
              title="Disparar Medición Láser"
              size="lg"
              icon={<Zap size={20} color="#ffffff" />}
              onPress={handleSimulateLaserShot}
              style={styles.laserShotBtn}
            />
          </View>
        </Card>

        {/* Wall Selector Tabs */}
        <View style={styles.wallSelector}>
          {(['north', 'south', 'east', 'west'] as const).map((w) => (
            <Pressable
              key={w}
              style={[styles.wallTab, activeWall === w && styles.wallTabActive]}
              onPress={() => setActiveWall(w)}
            >
              <Text
                style={[styles.wallTabText, activeWall === w && styles.wallTabTextActive]}
              >
                {w === 'north'
                  ? 'Norte'
                  : w === 'south'
                  ? 'Sur'
                  : w === 'east'
                  ? 'Este'
                  : 'Oeste'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Measurement Targets Grid */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Cotas del Muro Actual</Text>
          <Pressable onPress={resetWallMeasures}>
            <Text style={styles.clearText}>Limpiar</Text>
          </Pressable>
        </View>

        <View style={styles.targetsGrid}>
          {TARGETS.map((t) => {
            const isSelected = activeTarget === t.id;
            let val: number | undefined;
            if (t.id === 'wall_width') val = wallMeasurements.wallWidthMm;
            else if (t.id === 'wall_height') val = wallMeasurements.wallHeightMm;
            else if (t.id === 'wall_depth') val = wallMeasurements.wallDepthMm;
            else if (t.id === 'water_supply_offset') val = wallMeasurements.waterSupplyOffsetMm;
            else if (t.id === 'gas_supply_offset') val = wallMeasurements.gasSupplyOffsetMm;
            else if (t.id === 'electrical_socket_offset')
              val = wallMeasurements.electricalSocketOffsetMm;

            return (
              <Pressable
                key={t.id}
                style={[styles.targetCard, isSelected && styles.targetCardActive]}
                onPress={() => setActiveTarget(t.id)}
              >
                <View style={styles.targetIconRow}>
                  <Text style={styles.targetIcon}>{t.icon}</Text>
                  {val !== undefined && (
                    <CheckCircle2 size={16} color="#16a34a" />
                  )}
                </View>
                <Text style={styles.targetLabel}>{t.label}</Text>
                <Text
                  style={[
                    styles.targetValue,
                    val !== undefined && styles.targetValueFilled,
                  ]}
                >
                  {formatDistance(val)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* History Feed */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Historial de Disparos ({history.length})</Text>
          {history.length > 0 && (
            <Pressable onPress={clearHistory}>
              <Text style={styles.clearText}>Borrar historial</Text>
            </Pressable>
          )}
        </View>

        {history.length === 0 ? (
          <Card style={styles.emptyHistoryCard}>
            <Ruler size={32} color={colors.textMuted} />
            <Text style={styles.emptyHistoryText}>
              Presiona el botón del distanciómetro para capturar cotas.
            </Text>
          </Card>
        ) : (
          history.slice(0, 5).map((evt, idx) => (
            <Card key={`${evt.timestamp}-${idx}`} style={styles.historyCard}>
              <View style={styles.historyRow}>
                <View style={styles.historyMain}>
                  <Text style={styles.historyDistance}>{evt.distanceMm} mm</Text>
                  <Text style={styles.historySub}>
                    {(evt.distanceMm / 1000).toFixed(3)} m • {new Date(evt.timestamp).toLocaleTimeString()}
                  </Text>
                </View>
                <Button
                  title="Asignar a Cota"
                  size="sm"
                  variant="secondary"
                  onPress={() => recordMeasurement(evt.distanceMm)}
                />
              </View>
            </Card>
          ))
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
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  deviceCard: {
    padding: spacing.md,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  deviceName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  deviceSub: {
    ...typography.caption,
    color: colors.textMuted,
  },
  deviceList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  deviceListTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  discoveredInfo: {
    flex: 1,
  },
  discoveredName: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 14,
  },
  discoveredRssi: {
    ...typography.caption,
    color: colors.textMuted,
  },
  hudCard: {
    padding: spacing.lg,
    backgroundColor: '#0f172a',
    borderColor: '#334155',
  },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: radius.md,
    padding: 2,
  },
  unitBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  unitBtnActive: {
    backgroundColor: colors.primary,
  },
  unitBtnText: {
    ...typography.caption,
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  unitBtnTextActive: {
    color: '#ffffff',
  },
  readoutContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginVertical: spacing.lg,
    gap: spacing.xs,
  },
  readoutValue: {
    fontSize: 54,
    fontWeight: '900',
    color: '#38bdf8',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  readoutUnit: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  hudActions: {
    marginTop: spacing.xs,
  },
  laserShotBtn: {
    backgroundColor: '#0284c7',
  },
  wallSelector: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wallTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  wallTabActive: {
    backgroundColor: colors.primary,
  },
  wallTabText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textMuted,
  },
  wallTabTextActive: {
    color: '#ffffff',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  targetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  targetCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  targetCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  targetIconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  targetIcon: {
    fontSize: 18,
  },
  targetLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  targetValue: {
    ...typography.bodyBold,
    fontSize: 16,
    color: colors.textMuted,
    marginTop: 2,
  },
  targetValueFilled: {
    color: colors.textPrimary,
  },
  emptyHistoryCard: {
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyHistoryText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  historyCard: {
    padding: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyMain: {
    flex: 1,
  },
  historyDistance: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
  historySub: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
