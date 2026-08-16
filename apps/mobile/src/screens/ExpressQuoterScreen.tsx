import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
} from 'react-native';
import {
  ArrowLeft,
  Trash2,
  Plus,
  Minus,
  Share2,
  MessageCircle,
  Layers,
  Sparkles,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { colors, spacing, radius, typography } from '../theme';
import { useQuoterStore } from '../stores/quoterStore';
import { useCatalogStore } from '../stores/catalogStore';

export interface ExpressQuoterScreenProps {
  onBack: () => void;
  onOpenCatalog?: () => void;
}

export function ExpressQuoterScreen({
  onBack,
  onOpenCatalog,
}: ExpressQuoterScreenProps) {
  const items = useQuoterStore((s) => s.items);
  const customerName = useQuoterStore((s) => s.customerName);
  const setCustomerName = useQuoterStore((s) => s.setCustomerName);
  const projectTitle = useQuoterStore((s) => s.projectTitle);
  const setProjectTitle = useQuoterStore((s) => s.setProjectTitle);
  const commercialMarginPercent = useQuoterStore(
    (s) => s.commercialMarginPercent
  );
  const setCommercialMarginPercent = useQuoterStore(
    (s) => s.setCommercialMarginPercent
  );

  const updateItemQuantity = useQuoterStore((s) => s.updateItemQuantity);
  const updateItemDimensions = useQuoterStore((s) => s.updateItemDimensions);
  const removeCartItem = useQuoterStore((s) => s.removeCartItem);
  const clearCart = useQuoterStore((s) => s.clearCart);
  const getTotals = useQuoterStore((s) => s.getTotals);
  const generateWhatsAppText = useQuoterStore((s) => s.generateWhatsAppText);

  const getModuleById = useCatalogStore((s) => s.getModuleById);

  const totals = getTotals();

  const handleShareWhatsApp = async () => {
    const text = generateWhatsAppText();
    const url = `whatsapp://send?text=${encodeURIComponent(text)}`;

    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Presupuesto Generado',
          'Copia el siguiente texto para enviarlo al cliente:\n\n' + text
        );
      }
    } catch {
      Alert.alert('Presupuesto para WhatsApp', text);
    }
  };

  const handleAdjustWidth = (itemId: string, currentWidth: number, delta: number) => {
    const newWidth = Math.max(300, Math.min(2400, currentWidth + delta));
    updateItemDimensions(itemId, { lengthMm: newWidth });
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
            Cotizador Express
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Cálculo en vivo con @muebles/domain
          </Text>
        </View>

        <Button
          title="Catálogo"
          variant="secondary"
          size="sm"
          onPress={onOpenCatalog}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Customer & Title Card */}
        <Card style={styles.clientCard}>
          <Input
            label="Nombre del Cliente"
            value={customerName}
            onChangeText={setCustomerName}
            containerStyle={styles.inputGap}
          />
          <Input
            label="Título de la Cotización"
            value={projectTitle}
            onChangeText={setProjectTitle}
            containerStyle={styles.inputGap}
          />

          {/* Margin Buttons */}
          <Text style={styles.marginLabel}>
            Margen Comercial: {commercialMarginPercent}%
          </Text>
          <View style={styles.marginRow}>
            {[25, 30, 35, 40, 50].map((margin) => (
              <Pressable
                key={margin}
                style={[
                  styles.marginChip,
                  commercialMarginPercent === margin && styles.marginChipActive,
                ]}
                onPress={() => setCommercialMarginPercent(margin)}
              >
                <Text
                  style={[
                    styles.marginChipText,
                    commercialMarginPercent === margin &&
                      styles.marginChipTextActive,
                  ]}
                >
                  {margin}%
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Modules List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Módulos Cotizados ({items.length})
          </Text>
          {items.length > 0 ? (
            <Button
              title="Vaciar"
              variant="ghost"
              size="sm"
              onPress={clearCart}
            />
          ) : null}
        </View>

        {items.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Layers size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Cotizador Vacío</Text>
            <Text style={styles.emptySubtitle}>
              Selecciona módulos desde el Catálogo para cotizar medidas, materiales y herrajes en vivo.
            </Text>
            <Button
              title="Abrir Catálogo"
              icon={<Plus size={18} color="#ffffff" />}
              onPress={onOpenCatalog}
              style={styles.openCatalogBtn}
            />
          </Card>
        ) : (
          <View style={styles.itemsList}>
            {items.map((it) => {
              const mod = getModuleById(it.moduleId);
              const presets = mod?.presets || [];

              return (
                <Card key={it.id} style={styles.itemCard} elevated>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemTitleCol}>
                      <Text style={styles.itemTitle}>{it.moduleName}</Text>
                      <Text style={styles.itemCode}>{it.moduleCode}</Text>
                    </View>
                    <Pressable
                      onPress={() => removeCartItem(it.id)}
                      hitSlop={8}
                      style={styles.deleteBtn}
                    >
                      <Trash2 size={18} color={colors.danger} />
                    </Pressable>
                  </View>

                  {/* Dimensions & Quick Adjust */}
                  <View style={styles.dimsBox}>
                    <View style={styles.dimRow}>
                      <Text style={styles.dimLabel}>Ancho (L):</Text>
                      <View style={styles.stepper}>
                        <Pressable
                          onPress={() => handleAdjustWidth(it.id, it.lengthMm, -50)}
                          style={styles.stepBtn}
                        >
                          <Minus size={14} color={colors.textPrimary} />
                        </Pressable>
                        <Text style={styles.dimValue}>{it.lengthMm} mm</Text>
                        <Pressable
                          onPress={() => handleAdjustWidth(it.id, it.lengthMm, 50)}
                          style={styles.stepBtn}
                        >
                          <Plus size={14} color={colors.textPrimary} />
                        </Pressable>
                      </View>
                    </View>
                    <Text style={styles.dimSecondary}>
                      Prof: {it.widthMm} mm • Alto: {it.heightMm} mm
                    </Text>
                  </View>

                  {/* Dimension Presets if available */}
                  {presets.length > 0 ? (
                    <View style={styles.presetsRow}>
                      <Text style={styles.presetTitle}>Presets:</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.presetChips}>
                          {presets.map((p) => (
                            <Pressable
                              key={p.id}
                              style={styles.presetChip}
                              onPress={() =>
                                updateItemDimensions(it.id, {
                                  lengthMm: p.width,
                                  widthMm: p.depth,
                                  heightMm: p.height,
                                })
                              }
                            >
                              <Text style={styles.presetChipText}>{p.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  ) : null}

                  {/* Quantity & Unit/Total Price */}
                  <View style={styles.itemFooter}>
                    <View style={styles.qtyStepper}>
                      <Pressable
                        onPress={() => updateItemQuantity(it.id, it.quantity - 1)}
                        style={styles.qtyBtn}
                      >
                        <Minus size={14} color={colors.textPrimary} />
                      </Pressable>
                      <Text style={styles.qtyText}>{it.quantity}</Text>
                      <Pressable
                        onPress={() => updateItemQuantity(it.id, it.quantity + 1)}
                        style={styles.qtyBtn}
                      >
                        <Plus size={14} color={colors.textPrimary} />
                      </Pressable>
                    </View>

                    <View style={styles.priceCol}>
                      <Text style={styles.unitPriceText}>
                        ${it.unitPrice.toLocaleString('es-AR')} c/u
                      </Text>
                      <Text style={styles.itemTotalText}>
                        ${it.totalPrice.toLocaleString('es-AR')}
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* Live Total Card */}
        {items.length > 0 ? (
          <Card style={styles.totalsCard} elevated>
            <Text style={styles.totalsTitle}>Resumen de Costos y Presupuesto</Text>

            <View style={styles.totalLine}>
              <Text style={styles.totalLineLabel}>Materiales (Placas y Cantos)</Text>
              <Text style={styles.totalLineVal}>
                ${totals.subtotalMaterials.toLocaleString('es-AR')}
              </Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={styles.totalLineLabel}>Herrajes y Accesorios</Text>
              <Text style={styles.totalLineVal}>
                ${totals.subtotalHardware.toLocaleString('es-AR')}
              </Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={styles.totalLineLabel}>Mano de Obra y Corte</Text>
              <Text style={styles.totalLineVal}>
                ${totals.subtotalLabor.toLocaleString('es-AR')}
              </Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={styles.totalLineLabel}>
                Margen Comercial ({commercialMarginPercent}%)
              </Text>
              <Text style={styles.totalLineVal}>
                ${totals.marginAmount.toLocaleString('es-AR')}
              </Text>
            </View>

            <View style={styles.grandTotalDivider} />

            <View style={styles.grandTotalRow}>
              <View>
                <Text style={styles.grandTotalLabel}>TOTAL ESTIMADO</Text>
                <Text style={styles.grandTotalSub}>
                  {totals.totalQuantity} módulos • ~{totals.totalM2} m²
                </Text>
              </View>
              <Text style={styles.grandTotalVal}>
                ${totals.total.toLocaleString('es-AR')}
              </Text>
            </View>

            <Button
              title="Compartir por WhatsApp"
              size="lg"
              icon={<MessageCircle size={20} color="#ffffff" />}
              onPress={handleShareWhatsApp}
              style={styles.whatsappBtn}
            />
          </Card>
        ) : null}
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
  clientCard: {
    padding: spacing.md,
  },
  inputGap: {
    marginBottom: spacing.sm,
  },
  marginLabel: {
    ...typography.captionBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  marginRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  marginChip: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marginChipActive: {
    backgroundColor: colors.primary,
  },
  marginChipText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  marginChipTextActive: {
    color: colors.textOnPrimary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
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
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  openCatalogBtn: {
    width: '100%',
  },
  itemsList: {
    gap: spacing.md,
  },
  itemCard: {
    padding: spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  itemTitleCol: {
    flex: 1,
  },
  itemTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
  itemCode: {
    ...typography.mono,
    color: colors.textMuted,
    fontWeight: '700',
  },
  deleteBtn: {
    padding: spacing.xs,
  },
  dimsBox: {
    backgroundColor: colors.surfaceHover,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dimLabel: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    minWidth: 64,
    textAlign: 'center',
  },
  dimSecondary: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  presetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  presetTitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  presetChips: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  presetChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: '#e0f2fe',
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  presetChipText: {
    ...typography.captionBold,
    color: '#0369a1',
    fontSize: 11,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    minWidth: 28,
    textAlign: 'center',
  },
  priceCol: {
    alignItems: 'flex-end',
  },
  unitPriceText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  itemTotalText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 16,
  },
  totalsCard: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceCard,
    borderColor: colors.primaryLight,
  },
  totalsTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalLineLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  totalLineVal: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  grandTotalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  grandTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  grandTotalLabel: {
    ...typography.captionBold,
    color: colors.textPrimary,
    fontSize: 14,
  },
  grandTotalSub: {
    ...typography.caption,
    color: colors.textMuted,
  },
  grandTotalVal: {
    ...typography.h2,
    color: colors.primary,
    fontSize: 22,
  },
  whatsappBtn: {
    width: '100%',
    backgroundColor: '#16a34a',
  },
});
