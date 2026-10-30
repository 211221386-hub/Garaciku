import { Redirect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { ListChecks } from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { getSession } from '@/lib/auth';

export default function CheckingScreen() {
  const role = getSession()?.user.role ?? 4;
  if (![1, 2].includes(role)) return <Redirect href="/(tabs)" />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Pengecekan</Text>
        <Text style={styles.title}>Pengecekan Kendaraan</Text>
      </View>
      <EmptyState
        icon={<ListChecks size={32} color={Colors.primary} strokeWidth={2} />}
        title="Pengecekan siap digunakan"
        subtitle="Daftar dan form pengecekan akan ditambahkan setelah item pengecekan ditentukan."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  greeting: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primarySoft, marginBottom: 2 },
  title: { fontSize: Typography.xxxl, fontFamily: Typography.fontBold, color: Colors.white },
});
