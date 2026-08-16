import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Lock, Mail, Server, Fingerprint } from 'lucide-react-native';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { colors, spacing, radius, typography } from '../theme';
import { useAuthStore } from '../stores/authStore';
import { getApiBaseUrl, setApiBaseUrl } from '../services/apiClient';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isBiometricSupported = useAuthStore((s) => s.isBiometricSupported);
  const loginWithBiometrics = useAuthStore((s) => s.loginWithBiometrics);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Ingresa tu correo y contraseña para continuar.');
      return;
    }
    setErrorMsg('');
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Credenciales inválidas o error de conexión con el taller.');
    }
  };

  const handleBiometrics = async () => {
    const success = await loginWithBiometrics();
    if (!success) {
      Alert.alert(
        'Autenticación Biométrica',
        'No se pudo autenticar con Face ID / Huella. Por favor ingresa tu contraseña.'
      );
    }
  };

  const handleSaveServerUrl = () => {
    if (!serverUrl.trim()) return;
    setApiBaseUrl(serverUrl.trim());
    setShowServerConfig(false);
    Alert.alert('Servidor Actualizado', `Conectando a: ${serverUrl.trim()}`);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand Header */}
        <View style={styles.brandHeader}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>M</Text>
          </View>
          <Text style={styles.appTitle}>Muebles Mobile</Text>
          <Text style={styles.appSubtitle}>Sistema de Taller, Obra y Cotizaciones</Text>
        </View>

        {/* Login Form Card */}
        <Card style={styles.formCard} elevated>
          <Text style={styles.cardTitle}>Iniciar Sesión</Text>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          <Input
            label="Correo Electrónico"
            placeholder="operario@taller.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            leftIcon={<Mail size={18} color={colors.textMuted} />}
          />

          <Input
            label="Contraseña"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            leftIcon={<Lock size={18} color={colors.textMuted} />}
          />

          <Button
            title="Entrar al Taller"
            size="lg"
            loading={isLoading}
            onPress={handleLogin}
            style={styles.submitButton}
          />

          {isBiometricSupported ? (
            <Button
              title="Desbloquear con Face ID / Huella"
              variant="outline"
              size="md"
              icon={<Fingerprint size={20} color={colors.primary} />}
              onPress={handleBiometrics}
              style={styles.biometricButton}
            />
          ) : null}
        </Card>

        {/* Server IP Config Toggle */}
        <View style={styles.serverConfigContainer}>
          {!showServerConfig ? (
            <Button
              title={`Servidor: ${getApiBaseUrl()}`}
              variant="ghost"
              size="sm"
              icon={<Server size={14} color={colors.textMuted} />}
              textStyle={styles.serverConfigText}
              onPress={() => setShowServerConfig(true)}
            />
          ) : (
            <Card style={styles.serverCard}>
              <Text style={styles.serverCardTitle}>Configurar IP del Servidor</Text>
              <Input
                placeholder="http://192.168.1.50:8080"
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.serverButtonRow}>
                <Button
                  title="Cancelar"
                  variant="secondary"
                  size="sm"
                  onPress={() => setShowServerConfig(false)}
                />
                <Button title="Guardar" size="sm" onPress={handleSaveServerUrl} />
              </View>
            </Card>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logoText: {
    color: colors.textOnPrimary,
    fontSize: 32,
    fontWeight: '800',
  },
  appTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  appSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  formCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  biometricButton: {
    marginTop: spacing.md,
  },
  serverConfigContainer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  serverConfigText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  serverCard: {
    width: '100%',
    padding: spacing.md,
  },
  serverCardTitle: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  serverButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
