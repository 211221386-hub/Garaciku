import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { createSession, getSession } from '@/lib/auth';
import { apiClient } from '@/lib/api';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

export default function FirstLoginScreen() {
  const session = getSession();
  const [fullName, setFullName] = useState(session?.user.full_name ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [phone, setPhone] = useState(session?.user.phone ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const finishSetup = async () => {
    setErrorMessage('');
    if (password.length < 8 || password.length > 128) {
      setErrorMessage('Password baru harus terdiri dari 8 sampai 128 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Konfirmasi password tidak cocok.');
      return;
    }

    const currentSession = getSession();
    if (!currentSession?.token) {
      router.replace('/login');
      return;
    }

    setSaving(true);
    try {
      const user = await apiClient.users.completeFirstLogin({
        full_name: fullName,
        email,
        phone,
        new_password: password,
      });
      createSession(user, currentSession.token, currentSession.expiresAt);
      router.replace('/(tabs)');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Gagal menyelesaikan pengaturan akun.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.brand}>GARACI</Text>
          <Text style={styles.title}>Lengkapi akun</Text>
          <Text style={styles.subtitle}>Buat password baru dan lengkapi profil sebelum melanjutkan.</Text>
          <Field label="Nama lengkap*" value={fullName} onChangeText={setFullName} placeholder="Nama lengkap" />
          <Field label="Email*" value={email} onChangeText={setEmail} placeholder="nama@email.com" keyboardType="email-address" />
          <Field label="Nomor telepon*" value={phone} onChangeText={setPhone} placeholder="Contoh: 08123456789" keyboardType="phone-pad" />
          <Field label="Password baru*" value={password} onChangeText={setPassword} placeholder="Minimal 8 karakter" secureTextEntry />
          <Field label="Konfirmasi password baru*" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Ulangi password baru" secureTextEntry />
          {errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}
          <Button label="Simpan dan lanjutkan" onPress={() => { void finishSetup(); }} loading={saving} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary, justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  form: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl },
  brand: { fontSize: Typography.sm, fontFamily: Typography.fontBold, color: Colors.primary, marginBottom: Spacing.sm },
  title: { fontSize: Typography.xxl, fontFamily: Typography.fontBold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 21, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  error: { color: Colors.error, fontSize: Typography.sm, fontFamily: Typography.fontMedium, marginBottom: Spacing.md },
});