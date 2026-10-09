import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, ClipboardCheck, X } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { apiClient } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { differenceInCalendarDays, formatDate } from '@/lib/format';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { RentalRecord, RentalStatus } from '@/lib/types';
import { EmptyState } from '@/components/EmptyState';

type ApprovalRental = RentalRecord & { car_name: string };

const isAdmin = () => [1, 2].includes(getSession()?.user.role ?? 0);

const statusConfig: Record<RentalStatus, { label: string; backgroundColor: string; color: string }> = {
  pending: { label: 'Menunggu', backgroundColor: '#FEF3C7', color: '#92400E' },
  active: { label: 'Aktif', backgroundColor: Colors.primaryLight, color: Colors.primary },
  approved: { label: 'Disetujui', backgroundColor: '#DCFCE7', color: '#15803D' },
  overdue: { label: 'Lewat waktu', backgroundColor: '#FEE2E2', color: Colors.error },
  rejected: { label: 'Ditolak', backgroundColor: '#FEE2E2', color: Colors.error },
  returned: { label: 'Dikembalikan', backgroundColor: Colors.surfaceAlt, color: Colors.textSecondary },
  cancelled: { label: 'Dibatalkan', backgroundColor: '#FEE2E2', color: Colors.error },
  completed: { label: 'Selesai', backgroundColor: '#DCFCE7', color: '#15803D' },
};

export default function ApprovalScreen() {
  const [rentals, setRentals] = useState<ApprovalRental[]>([]);
  const [cars, setCars] = useState<{ id: string; name: string; plate_number: string }[]>([]);
  const [selectedCars, setSelectedCars] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [decision, setDecision] = useState<{ rental: ApprovalRental; status: 'approved' | 'rejected' } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);

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
    const session = getSession();
    if (!session || ![1, 2].includes(session.user.role)) return;
    setProcessingId(rental.id);
    setErrorMessage(null);
    setNotificationError(null);
    try {
      const approvedCarId = selectedCars[rental.id] ?? rental.car_id;
      await apiClient.rentals.decideApproval(rental.id, {
        status,
        car_id: status === 'approved' ? approvedCarId : rental.car_id,
        approved_by: session.user.id,
        approved_at: new Date().toISOString(),
      });
      if (status === 'approved') {
        try {
          const approvedCar = cars.find((car) => car.id === approvedCarId);
          if (!approvedCar) throw new Error('Data mobil yang disetujui tidak ditemukan.');
          const endDate = rental.end_date ?? rental.start_date;
          await apiClient.rentals.notifyApproved({
            namaPemesan: rental.renter_name,
            emailpemesan: rental.renter_email,
            nomorTelepon: rental.renter_phone ?? '',
            jenisKendaraan: approvedCar.name,
            platNomor: approvedCar.plate_number,
            tanggalMulaiSewa: rental.start_date,
            tanggalSelesaiSewa: endDate,
            jumlahHariSewa: Math.max(1, differenceInCalendarDays(rental.start_date, endDate)),
          });
        } catch (error) {
          setNotificationError(`Rental berhasil disetujui, tetapi notifikasi gagal dikirim: ${error instanceof Error ? error.message : 'Terjadi kesalahan.'}`);
        }
      }
      setDecision(null);
      await fetchApprovals();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses approval.');
    } finally {
      setProcessingId(null);
    }
  };

  const confirmDecision = (rental: ApprovalRental, status: 'approved' | 'rejected') => {
    setErrorMessage(null);
    setDecision({ rental, status });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Persetujuan Rental</Text>
        <Text style={styles.title}>{isAdmin() ? 'Review Permintaan' : 'Approval Saya'}</Text>
      </View>
      {notificationError ? (
        <View style={styles.notificationError}>
          <Text style={styles.notificationErrorText}>{notificationError}</Text>
          <TouchableOpacity onPress={() => setNotificationError(null)} accessibilityLabel="Tutup pesan">
            <X size={18} color={Colors.error} />
          </TouchableOpacity>
        </View>
      ) : null}
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
                  <TouchableOpacity style={[styles.action, styles.approve, processingId === item.id && styles.actionDisabled]} onPress={() => confirmDecision(item, 'approved')} disabled={processingId === item.id}><Check size={17} color={Colors.white} /><Text style={[styles.actionText, { color: Colors.white }]}>{processingId === item.id ? 'Memproses...' : 'Approve'}</Text></TouchableOpacity>
                </View>
              </>
            ) : <Text style={styles.waiting}>{item.status === 'pending' ? 'Menunggu admin role 1 atau 2 memilih dan menyetujui mobil.' : item.status === 'approved' || item.status === 'completed' ? 'Permintaan Anda sudah disetujui.' : 'Permintaan Anda ditolak.'}</Text>}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<ClipboardCheck size={32} color={Colors.primary} strokeWidth={2} />} title={isAdmin() ? 'Tidak ada approval pending' : 'Belum ada riwayat approval'} subtitle={isAdmin() ? 'Permintaan baru dari role 3 dan 4 akan muncul di sini.' : 'Permintaan rental Anda akan muncul di sini.'} />}
      />
      {decision ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <View style={[styles.confirmIcon, decision.status === 'rejected' && styles.rejectIcon]}>
              {decision.status === 'approved' ? <Check size={24} color={Colors.primary} strokeWidth={2.5} /> : <X size={24} color={Colors.error} strokeWidth={2.5} />}
            </View>
            <Text style={styles.confirmTitle}>{decision.status === 'approved' ? 'Approve Rental?' : 'Tolak Rental?'}</Text>
            <Text style={styles.confirmMessage}>{decision.status === 'approved' ? 'Permintaan' : 'Permintaan'} {decision.rental.renter_name} akan {decision.status === 'approved' ? 'disetujui' : 'ditolak'}.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmButton, styles.cancelButton]} onPress={() => setDecision(null)}><Text style={styles.cancelButtonText}>Batal</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, decision.status === 'approved' ? styles.approve : styles.reject, processingId === decision.rental.id && styles.actionDisabled]} disabled={processingId === decision.rental.id} onPress={() => { void decide(decision.rental, decision.status); }}><Text style={[styles.actionText, { color: decision.status === 'approved' ? Colors.white : Colors.error }]}>{processingId === decision.rental.id ? 'Memproses...' : decision.status === 'approved' ? 'Approve' : 'Tolak'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {errorMessage ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.confirmTitle}>Approval gagal</Text>
            <Text style={styles.confirmMessage}>{errorMessage}</Text>
            <TouchableOpacity style={[styles.confirmButton, styles.approve, styles.errorClose]} onPress={() => setErrorMessage(null)}><Text style={[styles.actionText, { color: Colors.white }]}>Tutup</Text></TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  greeting: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primarySoft, marginBottom: 2 },
  title: { fontSize: Typography.xxxl, fontFamily: Typography.fontBold, color: Colors.white },
  notificationError: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.lg, marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: '#FEE2E2' },
  notificationErrorText: { flex: 1, fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.error, lineHeight: 20 },
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
  actionDisabled: { opacity: 0.6 },
  modalOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  confirmModal: { width: '100%', maxWidth: 430, backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', elevation: 12 },
  confirmIcon: { width: 52, height: 52, borderRadius: Radius.pill, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  rejectIcon: { backgroundColor: '#FEE2E2' },
  confirmTitle: { fontSize: Typography.xl, fontFamily: Typography.fontBold, color: Colors.textPrimary, textAlign: 'center' },
  confirmMessage: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 21, textAlign: 'center', marginTop: Spacing.sm },
  confirmActions: { flexDirection: 'row', gap: Spacing.sm, width: '100%', marginTop: Spacing.lg },
  confirmButton: { flex: 1, minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { backgroundColor: Colors.surfaceAlt },
  errorClose: { flex: 0, width: '100%', marginTop: Spacing.lg },
  cancelButtonText: { color: Colors.textPrimary, fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
});