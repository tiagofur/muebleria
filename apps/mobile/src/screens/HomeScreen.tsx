import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import {
  QrCode,
  Users,
  Camera,
  Layers,
  Wrench,
  LogOut,
  ChevronRight,
  MessageSquare,
  BookOpen,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { colors, spacing, radius, typography } from '../theme';
import { useAuthStore } from '../stores/authStore';

export interface HomeScreenProps {
  onOpenScanner?: () => void;
  onOpenSurvey?: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenWarranties?: () => void;
  onOpenCatalog?: () => void;
  onOpenQuoter?: () => void;
  onOpenCustomers?: () => void;
}

export function HomeScreen({
  onOpenScanner,
  onOpenSurvey,
  onOpenPhotos,
  onOpenChat,
  onOpenWarranties,
  onOpenCatalog,
  onOpenQuoter,
  onOpenCustomers,
}: HomeScreenProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Cerrar Sesión', '¿Deseas salir del sistema?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar Sesión',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  };

  const roleLabel = user?.role ? user.role.toUpperCase().replace('_', ' ') : 'OPERARIO';

  return (
    <View style={styles.container}>
      {/* Top App Header */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Text style={styles.greeting}>Hola, {user?.name || 'Taller'}</Text>
          <View style={styles.roleBadgeContainer}>
            <Badge label={roleLabel} variant="primary" />
          </View>
        </View>

        <Button
          title=""
          variant="ghost"
          size="sm"
          icon={<LogOut size={20} color={colors.textSecondary} />}
          onPress={handleLogout}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Quick Actions Title */}
        <Text style={styles.sectionTitle}>Herramientas de Taller y Campo</Text>

        {/* Action 1: QR Piece Scanner (Production Floor) */}
        <Card
          style={styles.heroActionCard}
          elevated
          onPress={onOpenScanner}
        >
          <View style={styles.actionIconContainer}>
            <QrCode size={28} color="#ffffff" />
          </View>
          <View style={styles.actionTextContainer}>
            <View style={styles.actionTitleRow}>
              <Text style={styles.heroActionTitle}>Escáner QR de Piso</Text>
              <Badge label="Piso" variant="success" />
            </View>
            <Text style={styles.actionSubtitle}>
              Escanear etiquetas de piezas, validar tapacantos y avanzar estados.
            </Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} />
        </Card>

        <View style={styles.grid}>
          {/* Action 2: Express Quoter */}
          <Card
            style={styles.gridCard}
            onPress={onOpenQuoter}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#f3e8ff' }]}>
              <Layers size={22} color="#7c3aed" />
            </View>
            <Text style={styles.gridCardTitle}>Cotizador Express</Text>
            <Text style={styles.gridCardDesc}>Cálculo en vivo y WhatsApp</Text>
          </Card>

          {/* Action 3: Catalog */}
          <Card
            style={styles.gridCard}
            onPress={onOpenCatalog}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#dcfce7' }]}>
              <BookOpen size={22} color="#16a34a" />
            </View>
            <Text style={styles.gridCardTitle}>Catálogo Móvil</Text>
            <Text style={styles.gridCardDesc}>Placas, cantos y herrajes</Text>
          </Card>

          {/* Action 4: Job Site Survey & Photos */}
          <Card
            style={styles.gridCard}
            onPress={onOpenSurvey}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#fef3c7' }]}>
              <Camera size={22} color="#d97706" />
            </View>
            <Text style={styles.gridCardTitle}>Relevamiento & Fotos</Text>
            <Text style={styles.gridCardDesc}>Captura por etapas y cotas</Text>
          </Card>

          {/* Action 5: Technical Chat */}
          <Card
            style={styles.gridCard}
            onPress={onOpenChat}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#e0f2fe' }]}>
              <MessageSquare size={22} color="#0284c7" />
            </View>
            <Text style={styles.gridCardTitle}>Chat Técnico</Text>
            <Text style={styles.gridCardDesc}>Consultas con ingeniería</Text>
          </Card>

          {/* Action 6: Customers 360 */}
          <Card
            style={styles.gridCard}
            onPress={onOpenCustomers}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#fae8ff' }]}>
              <Users size={22} color="#c026d3" />
            </View>
            <Text style={styles.gridCardTitle}>Clientes 360°</Text>
            <Text style={styles.gridCardDesc}>Directorio, llamadas y chat</Text>
          </Card>

          {/* Action 7: Warranties & Post-Sale */}
          <Card
            style={styles.gridCard}
            onPress={onOpenWarranties}
          >
            <View style={[styles.gridIconBadge, { backgroundColor: '#fee2e2' }]}>
              <Wrench size={22} color="#dc2626" />
            </View>
            <Text style={styles.gridCardTitle}>Garantías & Service</Text>
            <Text style={styles.gridCardDesc}>Reporte de reclamos</Text>
          </Card>
        </View>

        {/* Workshop Offline Status Banner */}
        <View style={styles.syncStatusCard}>
          <Text style={styles.syncStatusTitle}>🟢 Motor de Cálculo Activo (@muebles/domain)</Text>
          <Text style={styles.syncStatusText}>
            Presupuestación paramétrica local 100% offline con sincronización al servidor.
          </Text>
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userInfo: {
    flexDirection: 'column',
  },
  greeting: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  roleBadgeContainer: {
    alignSelf: 'flex-start',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  heroActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceCard,
    marginBottom: spacing.lg,
    borderColor: colors.primaryLight,
  },
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  actionTextContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  actionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  heroActionTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
  actionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  gridCard: {
    width: '47.5%',
    padding: spacing.md,
    minHeight: 130,
    justifyContent: 'space-between',
  },
  gridIconBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  gridCardTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  gridCardDesc: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  syncStatusCard: {
    backgroundColor: colors.surfaceHover,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncStatusTitle: {
    ...typography.captionBold,
    color: colors.success,
    marginBottom: 2,
  },
  syncStatusText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
