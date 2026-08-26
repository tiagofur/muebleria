import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import {
  ArrowLeft,
  Search,
  ShoppingCart,
  Plus,
} from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { colors, spacing, radius, typography } from '../theme';
import {
  useCatalogStore,
  type CatalogTab,
} from '../stores/catalogStore';
import { useQuoterStore } from '../stores/quoterStore';
import type { Module } from '@granete/domain';

export interface CatalogScreenProps {
  onBack: () => void;
  onOpenQuoter?: () => void;
}

export function CatalogScreen({ onBack, onOpenQuoter }: CatalogScreenProps) {
  const activeTab = useCatalogStore((s) => s.activeTab);
  const setActiveTab = useCatalogStore((s) => s.setActiveTab);
  const searchQuery = useCatalogStore((s) => s.searchQuery);
  const setSearchQuery = useCatalogStore((s) => s.setSearchQuery);

  const materials = useCatalogStore((s) => s.getFilteredMaterials());
  const edgeBands = useCatalogStore((s) => s.getFilteredEdgeBands());
  const hardware = useCatalogStore((s) => s.getFilteredHardware());
  const modules = useCatalogStore((s) => s.getFilteredModules());

  const addModuleToCart = useQuoterStore((s) => s.addModuleToCart);
  const cartCount = useQuoterStore((s) => s.items.length);

  const handleAddModule = (mod: Module) => {
    addModuleToCart(mod);
    Alert.alert('Agregado al Cotizador', `"${mod.name}" fue añadido a la cotización activa.`);
  };

  const tabs: Array<{ id: CatalogTab; label: string; count: number }> = [
    { id: 'modules', label: 'Módulos', count: modules.length },
    { id: 'materials', label: 'Tableros', count: materials.length },
    { id: 'edgeBands', label: 'Cantos', count: edgeBands.length },
    { id: 'hardware', label: 'Herrajes', count: hardware.length },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Catálogo Comercial
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Materiales, cantos, herrajes y módulos
          </Text>
        </View>

        <Pressable
          onPress={onOpenQuoter}
          style={styles.cartButton}
          hitSlop={8}
        >
          <ShoppingCart size={22} color={colors.primary} />
          {cartCount > 0 ? (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Input
          placeholder="Buscar por nombre, código o categoría..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          leftIcon={<Search size={18} color={colors.textMuted} />}
          containerStyle={styles.searchContainer}
        />
      </View>

      {/* Tab Pills */}
      <View style={styles.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.tabsRow}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  style={[styles.tab, isActive && styles.tabActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Text
                    style={[styles.tabText, isActive && styles.tabTextActive]}
                  >
                    {tab.label} ({tab.count})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Content List */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'modules' ? (
          <View style={styles.grid}>
            {modules.map((mod) => {
              const width = mod.externalDims?.width ?? mod.presets?.[0]?.width ?? 800;
              const depth = mod.externalDims?.depth ?? mod.presets?.[0]?.depth ?? 600;
              const height = mod.externalDims?.height ?? mod.presets?.[0]?.height ?? 860;
              const category = mod.furnitureType || mod.categoryId || 'estándar';

              return (
                <Card key={mod.id} style={styles.moduleCard} elevated>
                  <View style={styles.moduleHeader}>
                    <Badge label={category.toUpperCase()} variant="primary" />
                    <Text style={styles.moduleCode}>{mod.code}</Text>
                  </View>

                  <Text style={styles.moduleTitle}>{mod.name}</Text>

                  <View style={styles.dimsRow}>
                    <Text style={styles.dimsText}>
                      📐 {width} × {depth} × {height} mm
                    </Text>
                  </View>

                  <Button
                    title="Agregar a Cotización"
                    size="sm"
                    icon={<Plus size={16} color="#ffffff" />}
                    onPress={() => handleAddModule(mod)}
                    style={styles.addBtn}
                  />
                </Card>
              );
            })}
          </View>
        ) : activeTab === 'materials' ? (
          <View style={styles.list}>
            {materials.map((mat) => (
              <Card key={mat.id} style={styles.materialCard}>
                <View
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: mat.previewColor || '#e2e8f0' },
                  ]}
                />
                <View style={styles.itemInfo}>
                  <Text style={styles.itemCode}>{mat.code}</Text>
                  <Text style={styles.itemTitle}>{mat.name}</Text>
                  <Text style={styles.itemSub}>
                    {mat.thicknessMm}mm • {mat.widthMm}×{mat.lengthMm} mm ({((mat.widthMm * mat.lengthMm) / 1_000_000).toFixed(2)} m²)
                  </Text>
                </View>
                <View style={styles.priceColumn}>
                  <Text style={styles.priceValue}>
                    ${mat.costPerM2.toLocaleString('es-AR')}
                  </Text>
                  <Text style={styles.priceUnit}>/ m²</Text>
                </View>
              </Card>
            ))}
          </View>
        ) : activeTab === 'edgeBands' ? (
          <View style={styles.list}>
            {edgeBands.map((edge) => (
              <Card key={edge.id} style={styles.materialCard}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemCode}>{edge.code}</Text>
                  <Text style={styles.itemTitle}>{edge.name}</Text>
                  <Text style={styles.itemSub}>
                    Espesor: {edge.thicknessMm}mm
                  </Text>
                </View>
                <View style={styles.priceColumn}>
                  <Text style={styles.priceValue}>
                    ${edge.costPerMl.toLocaleString('es-AR')}
                  </Text>
                  <Text style={styles.priceUnit}>/ metro</Text>
                </View>
              </Card>
            ))}
          </View>
        ) : (
          <View style={styles.list}>
            {hardware.map((hw) => (
              <Card key={hw.id} style={styles.materialCard}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemCode}>{hw.code}</Text>
                  <Text style={styles.itemTitle}>{hw.name}</Text>
                  <Text style={styles.itemSub}>
                    Unidad: {hw.unit} {hw.packageSize ? `(Pack: ${hw.packageSize})` : ''}
                  </Text>
                </View>
                <View style={styles.priceColumn}>
                  <Text style={styles.priceValue}>
                    ${hw.costPerUnit.toLocaleString('es-AR')}
                  </Text>
                  <Text style={styles.priceUnit}>/ un.</Text>
                </View>
              </Card>
            ))}
          </View>
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
  cartButton: {
    position: 'relative',
    padding: spacing.xs,
  },
  cartBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: colors.danger,
    borderRadius: radius.full,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  searchBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  searchContainer: {
    marginBottom: spacing.xs,
  },
  tabsBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHover,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textOnPrimary,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  grid: {
    gap: spacing.md,
  },
  moduleCard: {
    padding: spacing.md,
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  moduleCode: {
    ...typography.mono,
    color: colors.textMuted,
    fontWeight: '700',
  },
  moduleTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: 2,
  },
  dimsRow: {
    backgroundColor: colors.surfaceHover,
    padding: spacing.xs + 2,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  dimsText: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  addBtn: {
    width: '100%',
  },
  list: {
    gap: spacing.sm,
  },
  materialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.md,
  },
  itemInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  itemCode: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  itemTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  itemSub: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  priceColumn: {
    alignItems: 'flex-end',
  },
  priceValue: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 15,
  },
  priceUnit: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
});
