import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArrowLeft, Factory, QrCode } from 'lucide-react-native';
import { apiClient } from '../services/apiClient';
import { useFloorScannerStore } from '../stores/floorScannerStore';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Header } from '../components/common/Header';
import { colors, spacing, typography, radius } from '../theme';

interface QueueProject {
  id: string;
  name: string;
  status: string;
  customer_id?: string;
  items: { module_id: string; quantity: number }[];
  updated_at: string;
}

export interface ProductionQueueScreenProps {
  onBack: () => void;
  /** Navigate to the scanner with the obra pre-selected. */
  onScanProject: (projectId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: 'Aceptada',
  produced: 'En producción',
};

export function ProductionQueueScreen({
  onBack,
  onScanProject,
}: ProductionQueueScreenProps) {
  const [projects, setProjects] = useState<QueueProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const setActiveProjectId = useFloorScannerStore((s) => s.setActiveProjectId);

  const load = useCallback(async () => {
    try {
      const all = await apiClient.get<QueueProject[]>('/projects');
      const queue = all
        .filter((p) => p.status === 'accepted' || p.status === 'produced')
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      setProjects(queue);
    } catch (err) {
      Alert.alert(
        'Sin conexión',
        err instanceof Error ? err.message : 'No se pudo cargar la cola.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openScanner = (projectId: string) => {
    setActiveProjectId(projectId);
    onScanProject(projectId);
  };

  const itemCount = (p: QueueProject) =>
    p.items.reduce((n, it) => n + (it.quantity > 0 ? it.quantity : 1), 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <Header
          title="Cola de Producción"
          leftAction={
            <Pressable onPress={onBack} hitSlop={12}>
              <ArrowLeft size={22} color="#ffffff" />
            </Pressable>
          }
        />
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
          title="Cola de Producción"
          leftAction={
            <Pressable onPress={onBack} hitSlop={12}>
              <ArrowLeft size={22} color="#ffffff" />
            </Pressable>
          }
        />
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#ffffff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Factory size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No hay obras en producción</Text>
            <Text style={styles.emptySubtitle}>
              Las cotizaciones aceptadas aparecen acá para escanear en el piso.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.card} elevated>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.cardMeta}>
                  {itemCount(item)} módulos ·{' '}
                  {new Date(item.updated_at).toLocaleDateString('es-MX')}
                </Text>
              </View>
              <Badge
                label={STATUS_LABELS[item.status] ?? item.status}
                variant={item.status === 'produced' ? 'info' : 'success'}
              />
            </View>
            <Button
              title="Escanear esta obra"
              icon={<QrCode size={16} color="#ffffff" />}
              size="sm"
              onPress={() => openScanner(item.id)}
            />
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background },
  spinner: { marginTop: spacing.xxl },
  list: { padding: spacing.md, gap: spacing.sm },
  card: { gap: spacing.sm },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitleCol: { flex: 1 },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardMeta: { ...typography.body, color: colors.textMuted },
  empty: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.textPrimary },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
