import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';
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
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [feedbackTitle, setFeedbackTitle] = useState('Login gagal');

  const handleLogin = async () => {
    setFeedbackTitle('Login gagal');
    if (!username.trim() || !password.trim()) {
      setLoginError('Username dan password wajib diisi.');
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
        setLoginError('Username atau password tidak valid.');
        return;
      }

      const sessionUser = loginResult.user ?? loginResult;
      createSession(sessionUser, loginResult.token, loginResult.expiresAt);
      router.replace('/(tabs)');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setLoginError(message || 'Terjadi kesalahan saat login. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setFeedbackTitle('Pendaftaran gagal');
    if (!fullName.trim() || !username.trim() || !password) {
      setFeedbackTitle('Pendaftaran gagal');
      setLoginError('Nama lengkap, username, dan password wajib diisi.');
      return;
    }
    if (password.length < 8) {
      setFeedbackTitle('Pendaftaran gagal');
      setLoginError('Password harus terdiri dari minimal 8 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setFeedbackTitle('Pendaftaran gagal');
      setLoginError('Konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      const result = await apiClient.users.register(username.trim(), fullName.trim(), password);
      createSession(result.user, result.token, result.expiresAt);
      router.replace('/(tabs)');
    } catch (error) {
      setFeedbackTitle('Pendaftaran gagal');
      setLoginError(error instanceof Error ? error.message : 'Terjadi kesalahan saat membuat akun.');
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
        <Text style={styles.subtitle}>{isRegistering ? 'Buat akun GARACI' : 'Masuk untuk melanjutkan'}</Text>

        {isRegistering && (
          <View style={styles.inputWrap}>
            <Text style={styles.label}>Nama lengkap</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Masukkan nama lengkap"
              autoCapitalize="words"
              style={styles.input}
            />
          </View>
        )}

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

        {isRegistering && (
          <View style={styles.inputWrap}>
            <Text style={styles.label}>Konfirmasi password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Ulangi password"
              secureTextEntry
              style={styles.input}
            />
          </View>
        )}

        {isRegistering ? (
          <Text style={styles.roleHint}>Akun baru akan menggunakan role Viewer.</Text>
        ) : (
          <View style={styles.roleBox}>
            <Text style={styles.roleTitle}>Daftar Role</Text>
            {Object.entries(roleLabels).map(([role, label]) => (
              <Text key={role} style={styles.roleItem}>{label}</Text>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.button} onPress={isRegistering ? handleRegister : handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Memproses...' : isRegistering ? 'Buat akun' : 'Masuk'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.switchModeButton}
          onPress={() => {
            setIsRegistering(!isRegistering);
            setLoginError('');
          }}
          disabled={loading}
        >
          <Text style={styles.switchModeText}>
            {isRegistering ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Buat akun baru'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={!!loginError}
        transparent
        animationType="fade"
        onRequestClose={() => setLoginError('')}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <CircleAlert size={24} color={Colors.error} strokeWidth={2.2} />
            </View>
            <Text style={styles.modalTitle}>{feedbackTitle}</Text>
            <Text style={styles.modalMessage}>{loginError}</Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setLoginError('')}
              activeOpacity={0.85}
            >
              <Text style={styles.modalButtonText}>Mengerti</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  roleHint: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
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
  switchModeButton: {
    alignItems: 'center',
    paddingTop: Spacing.md,
  },
  switchModeText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.overlay,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  modalMessage: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeightBody,
    marginBottom: Spacing.lg,
  },
  modalButton: {
    minWidth: 120,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
  },
  modalButtonText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
});
