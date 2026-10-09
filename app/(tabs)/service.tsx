import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { KeyRound, Plus, ChevronRight, RotateCcw } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { formatDate, formatCurrency } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { TimeField } from '@/components/TimeField';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { RentalStatus } from '@/lib/types';
import { getSession } from '@/lib/auth';
import { notifyOverdueRentals } from '@/lib/notifications';

type RentalWithCar = {
  id: string;
  car_id: string;
  renter_name: string;
  renter_email: string;
  start_date: string;
  start_time: string;
  end_date: string | null;
  end_time: string | null;
  total_cost: number | null;
  purpose: string;
  status: RentalStatus;
  notes: string;
  car_name: string;
};

const statusConfig: Record<RentalStatus, { label: string; bg: string; text: string }> = {
  pending: { label: 'Menunggu persetujuan', bg: '#FEF3C7', text: '#92400E' },
  active: { label: 'Aktif', bg: Colors.primaryLight, text: Colors.primary },
  approved: { label: 'Disetujui', bg: '#DCFCE7', text: '#15803D' },
  overdue: { label: 'Lewat waktu', bg: '#FEE2E2', text: Colors.error },
  rejected: { label: 'Ditolak', bg: '#FEE2E2', text: Colors.error },
  returned: { label: 'Dikembalikan', bg: Colors.surfaceAlt, text: Colors.textSecondary },
  cancelled: { label: 'Dibatalkan', bg: '#FEE2E2', text: Colors.error },
  completed: { label: 'Selesai', bg: '#DCFCE7', text: '#15803D' },
};

export default function RentalScreen() {
  const [rentals, setRentals] = useState<RentalWithCar[]>([]);
  const [activeTab, setActiveTab] = useState<'borrowing' | 'return'>('borrowing');
  const [cars, setCars] = useState<{ id: string; name: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [currentlyRentedCarIds, setCurrentlyRentedCarIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [form, setForm] = useState({ car_id: '', renter_name: '', renter_email: '', start_date: '', start_time: '', end_date: '', end_time: '', purpose: '', notes: '' });

  const fetchRentals = useCallback(async () => {
    try {
      const [rentalData, carData, rentedIds] = await Promise.all([
        apiClient.rentals.getAll(),
        apiClient.cars.getAll(),
        apiClient.rentals.getCurrentlyRentedCarIds(),
      ]);
      setRentals(rentalData);
      if ([1, 2].includes(getSession()?.user.role ?? 0)) void notifyOverdueRentals(rentalData);
      const isRestrictedRole = ![1, 2].includes(getSession()?.user.role ?? 4);
      setCars(isRestrictedRole ? carData.filter((car) => !rentedIds.includes(car.id)) : carData);
      setCurrentlyRentedCarIds(rentedIds);
    } catch (error) { console.error('Error fetching rentals:', error); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchRentals(); }, [fetchRentals]));

  const overdueCount = rentals.filter((rental) => rental.status === 'overdue').length;
  const returnStatuses: RentalStatus[] = ['approved', 'active', 'overdue', 'returned', 'completed'];
  const returnRentals = rentals.filter((rental) => returnStatuses.includes(rental.status));
  const borrowingRentals = rentals.filter((rental) => !returnStatuses.includes(rental.status));
  const displayedRentals = activeTab === 'borrowing' ? borrowingRentals : returnRentals;
  const pendingReturnCount = returnRentals.filter((rental) => ['approved', 'active', 'overdue'].includes(rental.status)).length;
  const isAdmin = [1, 2].includes(getSession()?.user.role ?? 0);

  const addRental = async () => {
    if (saving) return;
    if (!form.car_id) {
      Alert.alert('Pilih mobil terlebih dahulu', 'Pilih salah satu mobil sebelum menyimpan rental.');
      return;
    }
    if (!form.renter_name.trim()) {
      Alert.alert('Nama penyewa wajib diisi', 'Masukkan nama penyewa sebelum menyimpan rental.');
      return;
    }
    if (currentlyRentedCarIds.includes(form.car_id)) {
      Alert.alert('Mobil sudah dibooking', 'Pilih mobil lain karena mobil ini sudah digunakan atau disetujui untuk rental lain.');
      return;
    }
    if (!form.start_date || !form.start_time || !form.end_date || !form.end_time) {
      Alert.alert('Jadwal belum lengkap', 'Tanggal dan jam mulai serta selesai wajib diisi. Waktu menggunakan WIB.');
      return;
    }
    if (form.end_date === form.start_date && form.end_time <= form.start_time) {
      Alert.alert('Jadwal tidak valid', 'Jam selesai harus lebih lambat dari jam mulai.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.renter_email.trim())) {
      Alert.alert('Email wajib diisi', 'Masukkan alamat email penyewa yang valid.');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    setSaving(true);
    try {
      await apiClient.rentals.create({ car_id: form.car_id, renter_name: form.renter_name.trim(), renter_email: form.renter_email.trim(), start_date: form.start_date || today, start_time: form.start_time, end_date: form.end_date, end_time: form.end_time, purpose: form.purpose.trim(), notes: form.notes.trim() });
      setForm({ car_id: '', renter_name: '', renter_email: '', start_date: '', start_time: '', end_date: '', end_time: '', purpose: '', notes: '' });
      setSheet(false);
      await fetchRentals();
    } catch (error) {
      Alert.alert('Gagal menyimpan rental', error instanceof Error ? error.message : 'Terjadi kesalahan. Pastikan migration jadwal rental sudah dijalankan di Supabase.');
    } finally {
      setSaving(false);
    }
  };

  const confirmReturn = async (rental: RentalWithCar) => {
    if (returningId === rental.id) return;
    setReturningId(rental.id);
    try {
      await apiClient.rentals.confirmReturn(rental.id);
      await fetchRentals();
    } catch (error) {
      Alert.alert('Gagal mengonfirmasi pengembalian', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setReturningId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}><Text style={styles.greeting}>Rental Mobil</Text><Text style={styles.title}>{activeTab === 'borrowing' ? 'Peminjaman' : 'Pengembalian'}</Text>{activeTab === 'return' && isAdmin && overdueCount > 0 ? <Text style={styles.overdueNotice}>{overdueCount} rental perlu konfirmasi pengembalian</Text> : null}</View>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, activeTab === 'borrowing' && styles.activeTab]} onPress={() => setActiveTab('borrowing')}>
          <KeyRound size={17} color={activeTab === 'borrowing' ? Colors.primary : Colors.textSecondary} strokeWidth={2.2} />
          <Text style={[styles.tabText, activeTab === 'borrowing' && styles.activeTabText]}>Peminjaman</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'return' && styles.activeTab]} onPress={() => setActiveTab('return')}>
          <RotateCcw size={17} color={activeTab === 'return' ? Colors.primary : Colors.textSecondary} strokeWidth={2.2} />
          <Text style={[styles.tabText, activeTab === 'return' && styles.activeTabText]}>Pengembalian</Text>
          {pendingReturnCount > 0 ? <Text style={[styles.tabCount, activeTab === 'return' && styles.activeTabCount]}>{pendingReturnCount}</Text> : null}
        </TouchableOpacity>
      </View>
      <FlatList data={displayedRentals} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRentals(); }} colors={[Colors.primary]} />}
        renderItem={({ item }) => { const st = statusConfig[item.status] ?? statusConfig.active; return (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/car/rental/${item.id}` as never)} activeOpacity={0.85}>
            <View style={styles.rentalIcon}><KeyRound size={16} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={styles.cardBody}>
              <Text style={styles.renterName} numberOfLines={1}>{item.renter_name}</Text>
              <Text style={styles.carName} numberOfLines={1}>{item.car_name ?? 'Mobil tidak diketahui'}</Text>
              <Text style={styles.emailText} numberOfLines={1}>{item.renter_email}</Text>
              <View style={styles.metaRow}><Text style={styles.metaText}>{formatDate(item.start_date)} {item.start_time || ''}</Text>{item.end_date ? <Text style={styles.metaText}> - {formatDate(item.end_date)} {item.end_time || ''}</Text> : null}</View>
              <View style={styles.metaRow}>{item.purpose ? <Text style={styles.metaText}>Tujuan: {item.purpose}</Text> : null}{item.total_cost ? <Text style={styles.costText}>{formatCurrency(item.total_cost)}</Text> : null}</View>
              <View style={[styles.statusPill, { backgroundColor: st.bg }]}><Text style={[styles.statusText, { color: st.text }]}>{st.label}</Text></View>
              {activeTab === 'return' && isAdmin && ['approved', 'active', 'overdue'].includes(item.status) ? <TouchableOpacity style={[styles.returnButton, returningId === item.id && styles.actionDisabled]} onPress={() => confirmReturn(item)} disabled={returningId === item.id}><Text style={styles.returnButtonText}>{returningId === item.id ? 'Memproses...' : 'Unit sudah diterima'}</Text></TouchableOpacity> : null}
            </View>
            <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.2} />
          </TouchableOpacity>
        ); }}
        ListEmptyComponent={<EmptyState icon={activeTab === 'borrowing' ? <KeyRound size={32} color={Colors.primary} strokeWidth={2} /> : <RotateCcw size={32} color={Colors.primary} strokeWidth={2} />} title={activeTab === 'borrowing' ? 'Belum ada peminjaman' : 'Belum ada pengembalian'} subtitle={activeTab === 'borrowing' ? 'Ajukan peminjaman mobil dengan tombol tambah.' : 'Peminjaman yang disetujui akan muncul di sini.'} />}
      />
      {activeTab === 'borrowing' ? <TouchableOpacity style={styles.fab} onPress={() => setSheet(true)} activeOpacity={0.85}><Plus size={26} color={Colors.white} strokeWidth={2.6} /></TouchableOpacity> : null}
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Tambah Rental Mobil">
        <Text style={styles.label}>Pilih Mobil</Text>
        <View style={styles.carPicker}>{cars.map((c) => { const active = form.car_id === c.id; return <TouchableOpacity key={c.id} onPress={() => setForm({ ...form, car_id: c.id })} style={[styles.carChip, active && styles.carChipActive]}><Text style={[styles.carChipText, active && styles.carChipTextActive]}>{c.name}</Text></TouchableOpacity>; })}</View>
        <Field label="Nama Penyewa*" value={form.renter_name} onChangeText={(t) => setForm({ ...form, renter_name: t })} placeholder="Contoh: Budi Santoso" />
        <Field label="Email Penyewa*" value={form.renter_email} onChangeText={(t) => setForm({ ...form, renter_email: t })} placeholder="contoh@email.com" keyboardType="default" />
        <DateField label="Tanggal Mulai" value={form.start_date} onChange={(value) => setForm({ ...form, start_date: value })} placeholder="Pilih tanggal (kosongkan = hari ini)" />
        <TimeField label="Jam Mulai (WIB)" value={form.start_time} onChange={(value) => setForm({ ...form, start_time: value })} />
        <DateField label="Tanggal Selesai" value={form.end_date} onChange={(value) => setForm({ ...form, end_date: value })} placeholder="Pilih tanggal" minimumDate={form.start_date ? new Date(`${form.start_date}T00:00:00`) : undefined} />
        <TimeField label="Jam Selesai (WIB)" value={form.end_time} onChange={(value) => setForm({ ...form, end_time: value })} />
        <Field label="Tujuan Peminjaman" value={form.purpose} onChangeText={(t) => setForm({ ...form, purpose: t })} placeholder="Contoh: Perjalanan dinas, liburan keluarga" />
        <Field label="Catatan" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} placeholder="Catatan tambahan..." multiline />
        <View style={{ height: Spacing.sm }} /><Button label="Simpan Rental" onPress={addRental} loading={saving} disabled={!form.car_id || !form.renter_name.trim() || !form.renter_email.trim() || !form.start_date || !form.start_time || !form.end_date || !form.end_time} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  greeting: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primarySoft, marginBottom: 2 },
  title: { fontSize: Typography.xxxl, fontFamily: Typography.fontBold, color: Colors.white },
  overdueNotice: { marginTop: Spacing.xs, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: '#FDE68A' },
  tabs: { flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: Spacing.md, padding: 4, borderRadius: Radius.lg, backgroundColor: Colors.surfaceAlt },
  tab: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderRadius: Radius.md },
  activeTab: { backgroundColor: Colors.white },
  tabText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  activeTabText: { color: Colors.primary, fontFamily: Typography.fontSemiBold },
  tabCount: { minWidth: 20, height: 20, paddingHorizontal: 5, textAlign: 'center', textAlignVertical: 'center', borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: Colors.white, color: Colors.textSecondary, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  activeTabCount: { backgroundColor: Colors.primaryLight, color: Colors.primary },
  list: { padding: Spacing.lg, paddingBottom: 100 },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderLight },
  rentalIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md, marginTop: 2 },
  cardBody: { flex: 1, marginRight: Spacing.xs },
  renterName: { fontSize: Typography.base, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary, marginBottom: 2 },
  carName: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primary, marginBottom: Spacing.xs },
  emailText: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginBottom: Spacing.xs },
  metaRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  metaText: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textTertiary },
  costText: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold, color: Colors.primary },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill, marginTop: Spacing.xs },
  statusText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  returnButton: { alignSelf: 'flex-start', marginTop: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  actionDisabled: { opacity: 0.6 },
  returnButtonText: { color: Colors.white, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 58, height: 58, borderRadius: Radius.pill, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  carPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  carChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
});
