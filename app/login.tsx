import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '@/lib/api';
import { createSession, hasValidSession } from '@/lib/auth';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';

const roleLabels: Record<number, string> = {
  1: 'Role 1 - Admin',
  2: 'Role 2 - Operator',
  3: 'Role 3 - Staff',
  4: 'Role 4 - Viewer',
};

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Login gagal', 'Username dan password wajib diisi.');
      return;
    }

    if (hasValidSession()) {
      router.replace('/(tabs)');
      return;
    }

    setLoading(true);
    try {
      const loginResult = await apiClient.users.login(username.trim(), password.trim());
      if (!loginResult) {
        Alert.alert('Login gagal', 'Username atau password tidak valid.');
        setLoading(false);
        return;
      }

      const sessionUser = loginResult.user ?? loginResult;
      createSession(sessionUser, loginResult.token, loginResult.expiresAt);
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Login gagal', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>GARACI</Text>
        <Text style={styles.subtitle}>Masuk untuk melanjutkan</Text>

        <View style={styles.inputWrap}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Masukkan username"
            autoCapitalize="none"
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrap}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Masukkan password"
            secureTextEntry
            style={styles.input}
          />
        </View>

        <View style={styles.roleBox}>
          <Text style={styles.roleTitle}>Daftar Role</Text>
          {Object.entries(roleLabels).map(([role, label]) => (
            <Text key={role} style={styles.roleItem}>{label}</Text>
          ))}
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Memproses...' : 'Masuk'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: Typography.xxxl,
    fontFamily: Typography.fontBold,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.base,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  inputWrap: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
  },
  roleBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  roleTitle: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
    marginBottom: Spacing.xs,
  },
  roleItem: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
});
