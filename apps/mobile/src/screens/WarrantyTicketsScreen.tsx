import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { ArrowLeft, Plus, Wrench, AlertTriangle, CheckCircle } from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { colors, spacing, radius, typography } from '../theme';
import { useCrmStore, type WarrantyTicket } from '../stores/crmStore';

export interface WarrantyTicketsScreenProps {
  onBack: () => void;
}

export function WarrantyTicketsScreen({ onBack }: WarrantyTicketsScreenProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectName, setProjectName] = useState('Cocina Residencia Pérez');
  const [customerName, setCustomerName] = useState('Roberto Pérez');
  const [priority, setPriority] = useState<WarrantyTicket['priority']>('normal');

  const warranties = useCrmStore((s) => s.getWarranties());
  const createTicket = useCrmStore((s) => s.createWarrantyTicket);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert('Campos Incompletos', 'Ingresa el título y la descripción del reclamo.');
      return;
    }

    await createTicket({
      projectId: 'proj-1',
      projectName: projectName.trim(),
      customerName: customerName.trim(),
      title: title.trim(),
      description: description.trim(),
      priority,
    });

    setTitle('');
    setDescription('');
    setModalOpen(false);
    Alert.alert('Ticket Creado', 'El reclamo de garantía fue registrado con éxito.');
  };

  const getPriorityBadge = (p: WarrantyTicket['priority']) => {
    switch (p) {
      case 'urgent':
        return <Badge label="Urgente" variant="danger" />;
      case 'normal':
        return <Badge label="Normal" variant="warning" />;
      case 'low':
        return <Badge label="Baja" variant="default" />;
    }
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
            Garantías y Service
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Mesa de ayuda de post-venta
          </Text>
        </View>
        <Button
          title=""
          variant="ghost"
          size="sm"
          icon={<Plus size={22} color={colors.primary} />}
          onPress={() => setModalOpen(true)}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {warranties.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Wrench size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin Tickets de Garantía</Text>
            <Text style={styles.emptySubtitle}>
              No hay reclamos abiertos. Todos los trabajos están conformes.
            </Text>
          </Card>
        ) : (
          warranties.map((w) => (
            <Card key={w.id} style={styles.ticketCard} elevated>
              <View style={styles.ticketHeader}>
                <View style={styles.codeRow}>
                  <Text style={styles.ticketCode}>{w.code}</Text>
                  {getPriorityBadge(w.priority)}
                </View>
                <Badge
                  label={w.status === 'open' ? 'Abierto' : 'Resuelto'}
                  variant={w.status === 'open' ? 'warning' : 'success'}
                />
              </View>

              <Text style={styles.ticketTitle}>{w.title}</Text>
              <Text style={styles.ticketDesc}>{w.description}</Text>

              <View style={styles.ticketFooter}>
                <Text style={styles.customerText}>
                  👤 {w.customerName} • {w.projectName}
                </Text>
                <Text style={styles.dateText}>
                  {new Date(w.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* New Warranty Ticket Modal */}
      <Modal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo Ticket de Garantía"
        footer={
          <>
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => setModalOpen(false)}
            />
            <Button title="Crear Ticket" onPress={handleCreate} />
          </>
        }
      >
        <Input
          label="Proyecto / Obra"
          value={projectName}
          onChangeText={setProjectName}
        />
        <Input
          label="Cliente"
          value={customerName}
          onChangeText={setCustomerName}
        />
        <Input
          label="Título del Reclamo"
          placeholder="ej. Puerta desalineada o bisagra rota"
          value={title}
          onChangeText={setTitle}
        />
        <Input
          label="Descripción Detallada del Defecto"
          placeholder="Explica el problema observado en obra..."
          value={description}
          onChangeText={setDescription}
          multiline
          inputStyle={styles.multilineInput}
        />
      </Modal>
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
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  ticketCard: {
    padding: spacing.md,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ticketCode: {
    ...typography.mono,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  ticketTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  ticketDesc: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  ticketFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customerText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dateText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  multilineInput: {
    minHeight: 70,
  },
});
