import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './src/stores/authStore';
import { useCatalogStore } from './src/stores/catalogStore';
import { useFloorScannerStore } from './src/stores/floorScannerStore';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { SurveyScreen } from './src/screens/SurveyScreen';
import { ProjectPhotosScreen } from './src/screens/ProjectPhotosScreen';
import { ProjectChatScreen } from './src/screens/ProjectChatScreen';
import { WarrantyTicketsScreen } from './src/screens/WarrantyTicketsScreen';
import { CatalogScreen } from './src/screens/CatalogScreen';
import { ExpressQuoterScreen } from './src/screens/ExpressQuoterScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { LaserMeasureScreen } from './src/screens/LaserMeasureScreen';
import { PhotoAnnotationScreen } from './src/screens/PhotoAnnotationScreen';
import { Presentation3DScreen } from './src/screens/Presentation3DScreen';
import { DigitalSignatureScreen } from './src/screens/DigitalSignatureScreen';
import { BenchPaperlessScreen } from './src/screens/BenchPaperlessScreen';
import { ProductionQueueScreen } from './src/screens/ProductionQueueScreen';
import { colors, radius, typography, spacing } from './src/theme';

export type ActiveScreen =
  | 'home'
  | 'scanner'
  | 'survey'
  | 'photos'
  | 'chat'
  | 'warranties'
  | 'catalog'
  | 'quoter'
  | 'customers'
  | 'laser'
  | 'annotation'
  | '3d'
  | 'signature'
  | 'bench'
  | 'queue';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('home');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loadSession = useAuthStore((s) => s.loadSession);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Real workshop catalog + pending floor-scan sync once authenticated.
  const loadCatalogFromApi = useCatalogStore((s) => s.loadFromApi);
  const syncPendingFloorScans = useFloorScannerStore((s) => s.syncPending);
  useEffect(() => {
    if (isAuthenticated) {
      void loadCatalogFromApi();
      void syncPendingFloorScans();
    }
  }, [isAuthenticated, loadCatalogFromApi, syncPendingFloorScans]);

  if (isLoading) {
    return (
      <View style={styles.splashContainer}>
        <StatusBar style="light" />
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>M</Text>
        </View>
        <Text style={styles.splashTitle}>Muebles Mobile</Text>
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.appContainer}>
        <StatusBar style="dark" />
        <LoginScreen />
      </View>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'scanner':
        return <ScannerScreen onBack={() => setCurrentScreen('home')} />;
      case 'survey':
        return (
          <SurveyScreen
            onBack={() => setCurrentScreen('home')}
            onViewGallery={() => setCurrentScreen('photos')}
            onNavigateToLaser={() => setCurrentScreen('laser')}
            onNavigateToAnnotation={() => setCurrentScreen('annotation')}
          />
        );
      case 'photos':
        return <ProjectPhotosScreen onBack={() => setCurrentScreen('survey')} />;
      case 'chat':
        return <ProjectChatScreen onBack={() => setCurrentScreen('home')} />;
      case 'warranties':
        return <WarrantyTicketsScreen onBack={() => setCurrentScreen('home')} />;
      case 'catalog':
        return (
          <CatalogScreen
            onBack={() => setCurrentScreen('home')}
            onOpenQuoter={() => setCurrentScreen('quoter')}
          />
        );
      case 'quoter':
        return (
          <ExpressQuoterScreen
            onBack={() => setCurrentScreen('home')}
            onOpenCatalog={() => setCurrentScreen('catalog')}
          />
        );
      case 'customers':
        return <CustomersScreen onBack={() => setCurrentScreen('home')} />;
      case 'laser':
        return (
          <LaserMeasureScreen
            onBack={() => setCurrentScreen('home')}
            onNavigateToAnnotation={() => setCurrentScreen('annotation')}
          />
        );
      case 'annotation':
        return <PhotoAnnotationScreen onBack={() => setCurrentScreen('home')} />;
      case '3d':
        return (
          <Presentation3DScreen
            onBack={() => setCurrentScreen('home')}
            onOpenBench={() => setCurrentScreen('bench')}
          />
        );
      case 'signature':
        return <DigitalSignatureScreen onBack={() => setCurrentScreen('home')} />;
      case 'bench':
        return (
          <BenchPaperlessScreen
            onBack={() => setCurrentScreen('home')}
            onOpen3D={() => setCurrentScreen('3d')}
          />
        );
      case 'queue':
        return (
          <ProductionQueueScreen
            onBack={() => setCurrentScreen('home')}
            onScanProject={() => setCurrentScreen('scanner')}
          />
        );
      case 'home':
      default:
        return (
          <HomeScreen
            onOpenScanner={() => setCurrentScreen('scanner')}
            onOpenSurvey={() => setCurrentScreen('survey')}
            onOpenPhotos={() => setCurrentScreen('photos')}
            onOpenChat={() => setCurrentScreen('chat')}
            onOpenWarranties={() => setCurrentScreen('warranties')}
            onOpenCatalog={() => setCurrentScreen('catalog')}
            onOpenQuoter={() => setCurrentScreen('quoter')}
            onOpenCustomers={() => setCurrentScreen('customers')}
            onOpenLaser={() => setCurrentScreen('laser')}
            onOpenAnnotation={() => setCurrentScreen('annotation')}
            onOpen3D={() => setCurrentScreen('3d')}
            onOpenSignature={() => setCurrentScreen('signature')}
            onOpenBench={() => setCurrentScreen('bench')}
          />
        );
    }
  };

  return (
    <View style={styles.appContainer}>
      <StatusBar
        style={
          currentScreen === 'scanner' ||
          currentScreen === 'laser' ||
          currentScreen === '3d'
            ? 'light'
            : 'dark'
        }
      />
      {renderScreen()}
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
  },
  splashTitle: {
    ...typography.h2,
    color: '#ffffff',
    marginBottom: spacing.lg,
  },
  spinner: {
    marginTop: spacing.md,
  },
});
