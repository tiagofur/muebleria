# Guía de Reutilización de Código — Web/Desktop ↔ React Native

> **Estado:** Guía de ingeniería y contratos de código compartido  
> **Fecha:** 2026-08-15  
> **Objetivo:** Maximizar el aprovechamiento de la lógica de negocio existente, evitando duplicación de código y garantizando consistencia absoluta en precios, despieces y validaciones.

---

## 1. Matriz de Reutilización de Código

El monorepo `muebles` está diseñado con una separación estricta entre **dominio de negocio** (puro), **persistencia** (puertos) y **presentación** (shells). Esto permite que la gran mayoría de la lógica sea compartida:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MATRIZ DE COMPARTICIÓN                           │
├──────────────────────────┬─────────────────┬────────────────────────────────┤
│ Capa / Módulo            │ % Reutilización │ Estrategia de Integración      │
├──────────────────────────┼─────────────────┼────────────────────────────────┤
│ @muebles/domain          │     100%        │ Importación directa (TS puro)  │
│ DTOs & Mappers API       │     100%        │ Reutilización de apiMappers.ts │
│ Reglas RBAC y Permisos   │     100%        │ Reutilización de rbac.ts       │
│ Parsers QR (#141 / F089) │     100%        │ Reutilización pieceLabelQr.ts  │
│ Fórmulas & Motor BOM     │     100%        │ Reutilización de engine.ts     │
│ Stores & Hooks Headless  │      85%        │ Misma lógica / State adapters  │
│ Design Tokens (Colores)  │      90%        │ Mapeo CSS Variables -> TS Obj  │
│ Componentes UI Visuales  │       0%        │ React Native Primitives nativos│
└──────────────────────────┴─────────────────┴────────────────────────────────┘
```

---

## 2. Reutilización 100% de `@muebles/domain`

El paquete `packages/domain` no tiene dependencias de React, DOM (`document`, `window`), Electron, ni Node.js (`fs`). Por lo tanto, se importa directamente en React Native sin requerir transpilación especial:

### 2.1 Módulos de Dominio Utilizados en Mobile

```typescript
// apps/mobile/src/hooks/usePieceScanner.ts
import {
  parsePieceLabelScan,
  type PieceLabelQrFields,
  type ParsedPieceLabelScan,
} from '@muebles/domain';

import {
  setProjectItemFloorStatus,
  nextItemFloorStatus,
  countFloorStatuses,
  type ItemFloorStatus,
} from '@muebles/domain';

import {
  calculateProjectTotals,
  resolveBom,
  type ResolvedBom,
  type Project,
  type ProjectItem,
} from '@muebles/domain';

import { hasPermission, type UserRole } from '@muebles/domain';
```

### 2.2 Ejemplo: Escaneo de Piezas y Avance de Piso en React Native

```tsx
// apps/mobile/src/features/scanner/PieceScanCard.tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  parsePieceLabelScan,
  nextItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  type PieceLabelQrFields,
} from '@muebles/domain';
import { useFloorScannerStore } from '../../stores/floorScannerStore';
import { colors, spacing, typography, radius } from '../../theme';

interface PieceScanCardProps {
  scannedText: string;
  onStatusUpdated?: () => void;
}

export function PieceScanCard({ scannedText, onStatusUpdated }: PieceScanCardProps) {
  const parsed = parsePieceLabelScan(scannedText);
  const updateFloorStatus = useFloorScannerStore((s) => s.updateItemStatus);

  if (!parsed || parsed.kind !== 'payload') {
    return (
      <View style={styles.errorCard}>
        <Text style={styles.errorText}>Código QR de pieza no válido o no reconocido</Text>
      </View>
    );
  }

  const { fields } = parsed;
  const currentStatus = useFloorScannerStore((s) => s.getItemStatus(fields.partCode));
  const nextStatus = nextItemFloorStatus(currentStatus);

  const handleAdvanceStatus = async () => {
    if (!nextStatus) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateFloorStatus(fields.projectId, fields.partCode ?? fields.moduleCode, nextStatus);
    onStatusUpdated?.();
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.moduleCode}>{fields.moduleCode}</Text>
        <Text style={styles.partCode}>{fields.partCode || 'Pieza Principal'}</Text>
      </View>

      <Text style={styles.description}>{fields.description}</Text>

      <View style={styles.dimensionsRow}>
        <Text style={styles.dimensionBadge}>
          {fields.lengthMm} × {fields.widthMm} mm
        </Text>
        <Text style={styles.materialBadge}>{fields.materialCode}</Text>
        {fields.edgeSides ? (
          <Text style={styles.edgeBadge}>Cantos: {fields.edgeSides}</Text>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <View style={styles.statusInfo}>
          <Text style={styles.statusLabel}>Estado actual:</Text>
          <Text style={styles.statusValue}>
            {ITEM_FLOOR_STATUS_LABELS_ES[currentStatus || 'pending']}
          </Text>
        </View>

        {nextStatus && (
          <Pressable style={styles.advanceButton} onPress={handleAdvanceStatus}>
            <Text style={styles.advanceButtonText}>
              Avanzar a {ITEM_FLOOR_STATUS_LABELS_ES[nextStatus]}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  moduleCode: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  partCode: {
    ...typography.mono,
    color: colors.textMuted,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  dimensionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  dimensionBadge: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...typography.captionBold,
    color: colors.primary,
  },
  materialBadge: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...typography.caption,
    color: colors.textSecondary,
  },
  edgeBadge: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...typography.caption,
    color: colors.warning,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  statusInfo: {
    flexDirection: 'column',
  },
  statusLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statusValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  advanceButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  advanceButtonText: {
    color: colors.textOnPrimary,
    ...typography.bodyBold,
  },
  errorCard: {
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: {
    color: colors.danger,
    ...typography.body,
  },
});
```

---

## 3. Reutilización de `@muebles/storage` y Mappers de API

En `packages/storage/src/apiMappers.ts` se encuentran las funciones de serialización y deserialización bidireccional entre las estructuras en snake_case del backend Go (PostgreSQL) y los tipos de dominio en TypeScript (camelCase).

### 3.1 Mappers 100% Compartidos
- `mapApiProjectToDomain` / `mapDomainProjectToApi`
- `mapApiCustomerToDomain` / `mapDomainCustomerToApi`
- `mapApiMaterialToDomain` / `mapDomainMaterialToApi`
- `mapApiModuleToDomain` / `mapDomainModuleToApi`

Al realizar llamadas REST desde React Native, se utilizan exactamente los mismos mappers:

```typescript
// apps/mobile/src/services/projectApi.ts
import { mapApiProjectToDomain, type ApiProject } from '@muebles/storage';
import { type Project } from '@muebles/domain';
import { apiClient } from './apiClient';

export async function fetchProjectById(id: string): Promise<Project> {
  const response = await apiClient.get<ApiProject>(`/api/projects/${id}`);
  return mapApiProjectToDomain(response.data);
}
```

---

## 4. Reutilización de Estado: Zustand y Hooks Headless

Los stores Zustand de la versión web (`apps/web/src/stores/`) y los de la app móvil comparten la misma estructura de tipos y reducers lógicos, desacoplados del entorno de ejecución:

```typescript
// apps/mobile/src/stores/authStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { type UserRole } from '@muebles/domain';

interface AuthState {
  token: string | null;
  userId: string | null;
  userRole: UserRole | null;
  userName: string | null;
  isAuthenticated: boolean;
  setSession: (token: string, userId: string, role: UserRole, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSessionFromStorage: () => Promise<void>;
}

const TOKEN_KEY = 'muebles_auth_token';
const USER_KEY = 'muebles_auth_user';

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  userRole: null,
  userName: null,
  isAuthenticated: false,

  setSession: async (token, userId, role, name) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify({ userId, role, name }));
    set({ token, userId, userRole: role, userName: name, isAuthenticated: true });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, userId: null, userRole: null, userName: null, isAuthenticated: false });
  },

  loadSessionFromStorage: async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const userRaw = await SecureStore.getItemAsync(USER_KEY);
    if (token && userRaw) {
      const user = JSON.parse(userRaw);
      set({
        token,
        userId: user.userId,
        userRole: user.role,
        userName: user.name,
        isAuthenticated: true,
      });
    }
  },
}));
```

---

## 5. Mapeo del Sistema de Diseño (Web CSS ↔ React Native)

Las variables CSS definidas en `docs/design.md` se traducen a un archivo de constantes TypeScript en `apps/mobile/src/theme/`:

| Token Web (CSS Var) | Valor Original | Token React Native (`theme/colors.ts`) |
|---|---|---|
| `--color-primary` | `hsl(217, 91%, 60%)` | `'#3b82f6'` / `'hsl(217, 91%, 60%)'` |
| `--color-primary-dark` | `hsl(217, 91%, 48%)` | `'#2563eb'` |
| `--color-surface` | `hsl(220, 18%, 97%)` | `'#f8fafc'` (Modo Claro) / `'#0f172a'` (Oscuro) |
| `--color-border` | `hsl(220, 13%, 91%)` | `'#e2e8f0'` |
| `--text-base` | `14px / Inter` | `fontSize: 14, fontFamily: 'Inter-Regular'` |
| `--text-lg` | `18px / Inter Semibold`| `fontSize: 18, fontFamily: 'Inter-SemiBold'` |
| `--radius-md` | `8px` | `borderRadius: 8` |
| `--radius-lg` | `12px` | `borderRadius: 12` |

### 5.1 Iconografía
- En Web: `lucide-react`
- En React Native: `lucide-react-native` (misma lista de iconos, mismos nombres: `Camera`, `QrCode`, `Ruler`, `CheckCircle`, `MessageSquare`, `Share2`, `FileText`).
