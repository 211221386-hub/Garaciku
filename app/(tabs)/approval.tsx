import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, ClipboardCheck, X } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { apiClient } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { RentalRecord, RentalStatus } from '@/lib/types';
import { EmptyState } from '@/components/EmptyState';

type ApprovalRental = RentalRecord & { car_name: string };

const isAdmin = () => [1, 2].includes(getSession()?.user.role ?? 0);

const statusConfig: Record<RentalStatus, { label: string; backgroundColor: string; color: string }> = {
  pending: { label: 'Menunggu', backgroundColor: '#FEF3C7', color: '#92400E' },
  active: { label: 'Aktif', backgroundColor: Colors.primaryLight, color: Colors.primary },
  approved: { label: 'Disetujui', backgroundColor: '#DCFCE7', color: '#15803D' },
  rejected: { label: 'Ditolak', backgroundColor: '#FEE2E2', color: Colors.error },
  returned: { label: 'Dikembalikan', backgroundColor: Colors.surfaceAlt, color: Colors.textSecondary },
  cancelled: { label: 'Dibatalkan', backgroundColor: '#FEE2E2', color: Colors.error },
  completed: { label: 'Selesai', backgroundColor: '#DCFCE7', color: '#15803D' },
};

export default function ApprovalScreen() {
  const [rentals, setRentals] = useState<ApprovalRental[]>([]);
  const [cars, setCars] = useState<{ id: string; name: string }[]>([]);
  const [selectedCars, setSelectedCars] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const fetchApprovals = useCallback(async () => {
    try {
      const [rentalData, carData] = await Promise.all([apiClient.rentals.getAll(), apiClient.cars.getAll()]);
      setRentals(isAdmin() ? rentalData.filter((rental) => rental.status === 'pending') : rentalData);
      setCars(carData);
      setSelectedCars((current) => Object.fromEntries(rentalData.map((rental) => [rental.id, current[rental.id] ?? rental.car_id])));
    } catch (error) {
      Alert.alert('Gagal memuat approval', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchApprovals(); }, [fetchApprovals]));

  const decide = async (rental: ApprovalRental, status: 'approved' | 'rejected') => {
    if (!isAdmin()) return;
    try {
      await apiClient.rentals.update(rental.id, {
        status,
        car_id: status === 'approved' ? (selectedCars[rental.id] ?? rental.car_id) : rental.car_id,
        approved_by: getSession()?.user.id ?? null,
        approved_at: new Date().toISOString(),
      });
      fetchApprovals();
    } catch (error) {
      Alert.alert('Gagal memproses approval', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    }
  };

  const confirmDecision = (rental: ApprovalRental, status: 'approved' | 'rejected') => {
    const action = status === 'approved' ? 'menyetujui' : 'menolak';
    Alert.alert(`${status === 'approved' ? 'Approve' : 'Tolak'} rental`, `Anda akan ${action} permintaan ${rental.renter_name}.`, [
      { text: 'Batal', style: 'cancel' },
      { text: status === 'approved' ? 'Approve' : 'Tolak', style: status === 'rejected' ? 'destructive' : 'default', onPress: () => decide(rental, status) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Persetujuan Rental</Text>
        <Text style={styles.title}>{isAdmin() ? 'Review Permintaan' : 'Approval Saya'}</Text>
      </View>
      <FlatList
        data={rentals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchApprovals(); }} colors={[Colors.primary]} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.icon}><ClipboardCheck size={18} color={Colors.primary} strokeWidth={2.2} /></View>
              <View style={styles.cardBody}>
                <Text style={styles.name}>{item.renter_name}</Text>
                <Text style={styles.email}>{item.renter_email}</Text>
              </View>
              <View style={[styles.pending, { backgroundColor: statusConfig[item.status].backgroundColor }]}><Text style={[styles.pendingText, { color: statusConfig[item.status].color }]}>{statusConfig[item.status].label}</Text></View>
            </View>
            <Text style={styles.meta}>{formatDate(item.start_date)}{item.end_date ? ` - ${formatDate(item.end_date)}` : ''}</Text>
            <Text style={styles.purpose}>{item.purpose || 'Tanpa tujuan peminjaman'}</Text>
            {isAdmin() ? (
              <>
                <Text style={styles.label}>Mobil yang disetujui</Text>
                <View style={styles.carPicker}>
                  {cars.map((car) => {
                    const active = (selectedCars[item.id] ?? item.car_id) === car.id;
                    return <TouchableOpacity key={car.id} onPress={() => setSelectedCars((current) => ({ ...current, [item.id]: car.id }))} style={[styles.carChip, active && styles.carChipActive]}><Text style={[styles.carChipText, active && styles.carChipTextActive]}>{car.name}</Text></TouchableOpacity>;
                  })}
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.action, styles.reject]} onPress={() => confirmDecision(item, 'rejected')}><X size={17} color={Colors.error} /><Text style={[styles.actionText, { color: Colors.error }]}>Tolak</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.action, styles.approve]} onPress={() => confirmDecision(item, 'approved')}><Check size={17} color={Colors.white} /><Text style={[styles.actionText, { color: Colors.white }]}>Approve</Text></TouchableOpacity>
                </View>
              </>
            ) : <Text style={styles.waiting}>{item.status === 'pending' ? 'Menunggu admin role 1 atau 2 memilih dan menyetujui mobil.' : item.status === 'approved' || item.status === 'completed' ? 'Permintaan Anda sudah disetujui.' : 'Permintaan Anda ditolak.'}</Text>}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<ClipboardCheck size={32} color={Colors.primary} strokeWidth={2} />} title={isAdmin() ? 'Tidak ada approval pending' : 'Belum ada riwayat approval'} subtitle={isAdmin() ? 'Permintaan baru dari role 3 dan 4 akan muncul di sini.' : 'Permintaan rental Anda akan muncul di sini.'} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  greeting: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primarySoft, marginBottom: 2 },
  title: { fontSize: Typography.xxxl, fontFamily: Typography.fontBold, color: Colors.white },
  list: { padding: Spacing.lg, paddingBottom: 100 },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderLight },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.sm },
  cardBody: { flex: 1 },
  name: { fontSize: Typography.base, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },
  email: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginTop: 2 },
  pending: { backgroundColor: '#FEF3C7', borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  pendingText: { color: '#92400E', fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  meta: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textTertiary, marginTop: Spacing.md },
  purpose: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textPrimary, marginTop: Spacing.xs },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: Spacing.xs },
  carPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  carChip: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  action: { flex: 1, minHeight: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.xs },
  reject: { backgroundColor: '#FEE2E2' },
  approve: { backgroundColor: Colors.primary },
  actionText: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
  waiting: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginTop: Spacing.md, lineHeight: 20 },
});