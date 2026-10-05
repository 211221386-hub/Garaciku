import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Car, KeyRound, AlertTriangle, ClipboardCheck, Info, LogOut, UserRound, ShieldCheck } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { clearSession, getSession } from '@/lib/auth';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';

export default function SettingsScreen() {
  const [stats, setStats] = useState({ cars: 0, notes: 0, damages: 0, rentals: 0, completeness: 0 });
  const session = getSession();
  const role = session?.user.role ?? 4;
  const canSeeFullSettings = role === 1 || role === 2;

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [c, n, d, s, comp] = await Promise.all([
          apiClient.cars.getAll(),
          apiClient.notes.getAll(),
          apiClient.damages.getAll(),
          apiClient.rentals.getAll(),
          apiClient.completeness.getAll(),
        ]);
        setStats({
          cars: c.length,
          notes: n.length,
          damages: d.length,
          rentals: s.length,
          completeness: comp.length,
        });
      })();
    }, [])
  );

  const statItems = [
    { icon: Car, label: 'Mobil', value: stats.cars, color: Colors.primary },
    { icon: ClipboardCheck, label: 'Kelengkapan', value: stats.completeness, color: Colors.secondary },
    { icon: AlertTriangle, label: 'Kerusakan', value: stats.damages, color: Colors.warning },
    { icon: KeyRound, label: 'Rental', value: stats.rentals, color: Colors.success },
  ];

  const handleLogout = () => {
    clearSession();
    router.replace('/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Pengaturan</Text>
        <Text style={styles.title}>Tentang Aplikasi</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.userCard}>
          <View style={styles.userHeader}>
            <View style={styles.avatarWrap}>
              <UserRound size={22} color={Colors.white} strokeWidth={2.2} />
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{session?.user.full_name ?? 'Pengguna'}</Text>
              <Text style={styles.userRole}>Role {role}</Text>
            </View>
          </View>

          <Text style={styles.sessionInfo}>Token aktif sampai {session ? new Date(session.expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'expired'}</Text>
        </View>

        {canSeeFullSettings ? (
          <>
            <View style={styles.statsGrid}>
              {statItems.map((stat) => {
                const Icon = stat.icon;
                return (
                  <View key={stat.label} style={styles.statCard}>
                    <View style={[styles.statIcon, { backgroundColor: stat.color + '18' }]}>
                      <Icon size={20} color={stat.color} strokeWidth={2.2} />
                    </View>
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tentang</Text>
              <View style={styles.aboutCard}>
                <View style={styles.aboutRow}>
                  <Info size={20} color={Colors.primary} strokeWidth={2} />
                  <View style={styles.aboutText}>
                    <Text style={styles.aboutTitle}>GARACI - Perawatan Mobil</Text>
                    <Text style={styles.aboutSubtitle}>Versi 1.0.0</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tips Perawatan</Text>
              <View style={styles.tipsCard}>
                <Text style={styles.tipText}>- Catat setiap rental mobil secara teratur</Text>
                <Text style={styles.tipText}>- Periksa kelengkapan mobil minimal sebulan sekali</Text>
                <Text style={styles.tipText}>- Laporkan kerusakan segera setelah ditemukan</Text>
                <Text style={styles.tipText}>- Tulis catatan harian untuk melacak aktivitas</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ringkasan akun</Text>
            <View style={styles.aboutCard}>
              <View style={styles.aboutRow}>
                <ShieldCheck size={22} color={Colors.primary} strokeWidth={2} />
                <View style={styles.aboutText}>
                  <Text style={styles.aboutTitle}>Akun Anda hanya menampilkan ringkasan</Text>
                  <Text style={styles.aboutSubtitle}>Role {role} tidak memiliki akses penuh ke pengaturan detail.</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Jumlah rental yang pernah dibuat</Text>
              <Text style={styles.summaryValue}>{stats.rentals}</Text>
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Detail akun</Text>
              <Text style={styles.summaryText}>Nama: {session?.user.full_name ?? '-'}</Text>
              <Text style={styles.summaryText}>Username: {session?.user.username ?? '-'}</Text>
              <Text style={styles.summaryText}>Role: {role}</Text>
              <Text style={styles.summaryText}>Status: {session?.user.is_active ? 'Aktif' : 'Nonaktif'}</Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut size={18} color={Colors.white} strokeWidth={2.2} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: Spacing.xl + 18,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  greeting: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.primarySoft,
    marginBottom: 2,
  },
  title: {
    fontSize: Typography.xxxl,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  content: {
    padding: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl + 72,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  statValue: {
    fontSize: Typography.xxl,
    fontFamily: Typography.fontBold,
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  userCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  userRole: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sessionInfo: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  aboutCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  aboutText: {
    flex: 1,
  },
  aboutTitle: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  aboutSubtitle: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textTertiary,
  },
  tipsCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.xs,
  },
  tipText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: Typography.lineHeightBody,
  },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryLabel: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  summaryValue: {
    fontSize: Typography.xxl,
    fontFamily: Typography.fontBold,
    color: Colors.primary,
  },
  summaryText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  logoutButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  logoutText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
  },
});
