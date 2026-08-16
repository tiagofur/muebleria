import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './src/stores/authStore';
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
import { colors, radius, typography } from './src/theme';

export type ActiveScreen =
  | 'home'
  | 'scanner'
  | 'survey'
  | 'photos'
  | 'chat'
  | 'warranties'
  | 'catalog'
  | 'quoter'
  | 'customers';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('home');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loadSession = useAuthStore((s) => s.loadSession);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

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
          />
        );
    }
  };

  return (
    <View style={styles.appContainer}>
      <StatusBar style={currentScreen === 'scanner' ? 'light' : 'dark'} />
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
    marginBottom: 16,
  },
  logoText: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '800',
  },
  splashTitle: {
    ...typography.h2,
    color: '#f8fafc',
    marginBottom: 24,
  },
  spinner: {
    marginTop: 8,
  },
});
