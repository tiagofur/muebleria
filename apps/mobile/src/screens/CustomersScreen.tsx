import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Alert,
} from 'react-native';
import {
  ArrowLeft,
  Phone,
  MessageCircle,
  MapPin,
  Mail,
  Search,
  UserCheck,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { colors, spacing, radius, typography } from '../theme';
import { useCatalogStore } from '../stores/catalogStore';

export interface CustomersScreenProps {
  onBack: () => void;
  onSelectCustomer?: (customerName: string) => void;
}

export function CustomersScreen({
  onBack,
  onSelectCustomer,
}: CustomersScreenProps) {
  const [query, setQuery] = useState('');
  const customers = useCatalogStore((s) => s.getCustomers());

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase().trim()) ||
      (c.phone && c.phone.includes(query.trim())) ||
      (c.address && c.address.toLowerCase().includes(query.toLowerCase().trim()))
  );

  const handleCall = (phone?: string) => {
    if (!phone) {
      Alert.alert('Sin Teléfono', 'Este cliente no tiene teléfono cargado.');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const handleWhatsApp = (phone?: string) => {
    if (!phone) {
      Alert.alert('Sin Teléfono', 'Este cliente no tiene teléfono cargado.');
      return;
    }
    const clean = phone.replace(/[^0-9]/g, '');
    Linking.openURL(`whatsapp://send?phone=${clean}`);
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
            Ficha 360° de Clientes
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Directorio de contactos y obras ({filtered.length})
          </Text>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Input
          placeholder="Buscar por cliente, teléfono o dirección..."
          value={query}
          onChangeText={setQuery}
          leftIcon={<Search size={18} color={colors.textMuted} />}
          containerStyle={styles.searchContainer}
        />
      </View>

      {/* List */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {filtered.length === 0 ? (
          <Card style={styles.emptyCard}>
            <UserCheck size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin Clientes</Text>
            <Text style={styles.emptySubtitle}>
              No se encontraron clientes que coincidan con la búsqueda.
            </Text>
          </Card>
        ) : (
          filtered.map((c) => (
            <Card key={c.id} style={styles.customerCard} elevated>
              <View style={styles.cardHeader}>
                <View style={styles.nameColumn}>
                  <Text style={styles.customerName}>{c.name}</Text>
                  {c.notes ? (
                    <Text style={styles.docNumber}>{c.notes}</Text>
                  ) : null}
                </View>
                <Badge label="Activo" variant="success" />
              </View>

              {/* Contact Details */}
              <View style={styles.detailsBlock}>
                {c.phone ? (
                  <View style={styles.detailRow}>
                    <Phone size={15} color={colors.textMuted} />
                    <Text style={styles.detailText}>{c.phone}</Text>
                  </View>
                ) : null}

                {c.email ? (
                  <View style={styles.detailRow}>
                    <Mail size={15} color={colors.textMuted} />
                    <Text style={styles.detailText}>{c.email}</Text>
                  </View>
                ) : null}

                {c.address ? (
                  <View style={styles.detailRow}>
                    <MapPin size={15} color={colors.textMuted} />
                    <Text style={styles.detailText} numberOfLines={2}>
                      {c.address}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Quick Actions */}
              <View style={styles.cardActions}>
                <Button
                  title="Llamar"
                  variant="secondary"
                  size="sm"
                  icon={<Phone size={15} color={colors.textPrimary} />}
                  onPress={() => handleCall(c.phone)}
                  style={styles.actionBtn}
                />
                <Button
                  title="WhatsApp"
                  size="sm"
                  icon={<MessageCircle size={15} color="#ffffff" />}
                  onPress={() => handleWhatsApp(c.phone)}
                  style={styles.whatsappBtn}
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
  searchBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchContainer: {
    marginBottom: spacing.xs,
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
  customerCard: {
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  nameColumn: {
    flex: 1,
  },
  customerName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
  docNumber: {
    ...typography.caption,
    color: colors.textMuted,
  },
  detailsBlock: {
    gap: 4,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
  whatsappBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
  },
});
