import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { KeyRound, Plus, ChevronRight, RotateCcw } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { dateRangesOverlap, differenceInCalendarDays, formatDate, formatCurrency } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { TimeField } from '@/components/TimeField';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { Car, RentalStatus } from '@/lib/types';
import { getSession } from '@/lib/auth';
import { notifyOverdueRentals } from '@/lib/notifications';

type RecordKind = 'rental' | 'duplicate';

type RentalWithCar = {
  id: string;
  cycle_id: string;
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

type RentalAvailability = Pick<RentalWithCar, 'car_id' | 'start_date' | 'end_date' | 'status'>;

const blockingStatuses: RentalStatus[] = ['pending', 'active', 'approved', 'overdue'];

function hasRentalConflict(reservations: RentalAvailability[], carId: string, startDate: string, endDate: string) {
  return reservations.some((reservation) =>
    reservation.car_id === carId
    && blockingStatuses.includes(reservation.status)
    && dateRangesOverlap(startDate, endDate, reservation.start_date, reservation.end_date ?? reservation.start_date)
  );
}

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
  const [cars, setCars] = useState<Pick<Car, 'id' | 'name' | 'plate_number'>[]>([]);
  const [availabilityRentals, setAvailabilityRentals] = useState<RentalAvailability[]>([]);
  const [selectedCarIds, setSelectedCarIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [recordKind, setRecordKind] = useState<RecordKind>('rental');
  const [saving, setSaving] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [form, setForm] = useState({ car_id: '', start_date: '', start_time: '', end_date: '', end_time: '', purpose: '', notes: '' });
  const [duplicateForm, setDuplicateForm] = useState({
    name: '',
    section: '',
    start_date: '',
    end_date: '',
    start_km: '',
    end_km: '',
    start_fuel: '',
    end_fuel: '',
    content: '',
  });

  const fetchRentals = useCallback(async () => {
    setAvailabilityLoading(true);
    try {
      const [rentalData, carData, reservationData] = await Promise.all([
        apiClient.rentals.getAll(),
        apiClient.cars.getAll(),
        apiClient.rentals.getAvailability(),
      ]);
      setRentals(rentalData);
      setAvailabilityRentals(reservationData);
      if ([1, 2].includes(getSession()?.user.role ?? 0)) void notifyOverdueRentals(rentalData);
      setCars(carData);
    } catch (error) { console.error('Error fetching rentals:', error); }
    finally {
      setAvailabilityLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchRentals(); }, [fetchRentals]));

  const overdueCount = rentals.filter((rental) => rental.status === 'overdue').length;
  const returnStatuses: RentalStatus[] = ['approved', 'active', 'overdue', 'returned', 'completed'];
  const returnRentals = rentals.filter((rental) => returnStatuses.includes(rental.status));
  const borrowingRentals = rentals.filter((rental) => !returnStatuses.includes(rental.status));
  const displayedRentals = activeTab === 'borrowing' ? borrowingRentals : returnRentals;
  const pendingReturnCount = returnRentals.filter((rental) => ['approved', 'active', 'overdue'].includes(rental.status)).length;
  const isAdmin = [1, 2].includes(getSession()?.user.role ?? 0);
  const userProfile = getSession()?.user;
  const profileEmail = userProfile?.email?.trim() ?? '';
  const profilePhone = userProfile?.phone?.trim() ?? '';
  const profileComplete = Boolean(
    userProfile?.full_name?.trim()
    && /^\S+@\S+\.\S+$/.test(profileEmail)
    && profilePhone.replace(/\D/g, '').length >= 7
  );
  const hasOpenCycle = !isAdmin && rentals.some((rental) => ['pending', 'approved', 'active', 'overdue'].includes(rental.status));
  const rentalRangeValid = Boolean(form.start_date && form.end_date && form.end_date >= form.start_date);
  const duplicateRangeValid = Boolean(duplicateForm.start_date && duplicateForm.end_date && duplicateForm.end_date >= duplicateForm.start_date);
  const selectedRangeValid = recordKind === 'rental' ? rentalRangeValid : duplicateRangeValid;
  const rangeStart = recordKind === 'rental' ? form.start_date : duplicateForm.start_date;
  const rangeEnd = recordKind === 'rental' ? form.end_date : duplicateForm.end_date;
  const availableCars = selectedRangeValid
    ? cars.filter((car) => !hasRentalConflict(availabilityRentals, car.id, rangeStart, rangeEnd))
    : [];
  const selectedCarAvailable = recordKind === 'rental'
    ? selectedCarIds.length > 0 && selectedCarIds.every((carId) => availableCars.some((car) => car.id === carId))
    : availableCars.some((car) => car.id === form.car_id);

  const resetFormState = () => {
    setForm({ car_id: '', start_date: '', start_time: '', end_date: '', end_time: '', purpose: '', notes: '' });
    setSelectedCarIds([]);
    setDuplicateForm({ name: '', section: '', start_date: '', end_date: '', start_km: '', end_km: '', start_fuel: '', end_fuel: '', content: '' });
    setRecordKind('rental');
  };

  const addRecord = async () => {
    if (saving) return;
    if (recordKind === 'duplicate' && !form.car_id) {
      Alert.alert('Pilih mobil terlebih dahulu', 'Pilih salah satu mobil sebelum menyimpan data.');
      return;
    }
    if (recordKind === 'rental' && selectedCarIds.length === 0) {
      Alert.alert('Pilih unit terlebih dahulu', 'Pilih minimal satu unit untuk siklus Transportation ini.');
      return;
    }

    if (recordKind === 'duplicate') {
      if (!duplicateForm.name.trim() || !duplicateForm.section.trim() || !duplicateForm.start_date || !duplicateForm.end_date || !duplicateForm.start_km || !duplicateForm.end_km || !duplicateForm.start_fuel || !duplicateForm.end_fuel || !duplicateForm.content.trim()) {
        Alert.alert('Data belum lengkap', 'Isi semua field Investigation sebelum menyimpan.');
        return;
      }

      const startKm = Number(duplicateForm.start_km);
      const endKm = Number(duplicateForm.end_km);
      const startFuel = Number(duplicateForm.start_fuel);
      const endFuel = Number(duplicateForm.end_fuel);
      if ([startKm, endKm, startFuel, endFuel].some((value) => !Number.isFinite(value) || value < 0)) {
        Alert.alert('Angka tidak valid', 'KM dan fuel harus berupa angka nol atau lebih.');
        return;
      }
      if (startFuel > 100 || endFuel > 100) {
        Alert.alert('Persentase fuel tidak valid', 'Fuel awal dan akhir harus berada di antara 0% dan 100%.');
        return;
      }
      if (endKm < startKm) {
        Alert.alert('KM tidak valid', 'KM akhir harus sama atau lebih besar dari KM awal.');
        return;
      }
      if (duplicateForm.end_date < duplicateForm.start_date) {
        Alert.alert('Rentang tanggal tidak valid', 'Tanggal selesai harus sama atau setelah tanggal mulai.');
        return;
      }

      setSaving(true);
      try {
        const latestReservations = await apiClient.rentals.getAvailability();
        if (hasRentalConflict(latestReservations, form.car_id, duplicateForm.start_date, duplicateForm.end_date)) {
          throw new Error('Unit sudah terbooking pada rentang tanggal tersebut. Pilih unit atau tanggal lain.');
        }
        await apiClient.notes.create({
          car_id: form.car_id,
          name: duplicateForm.name.trim(),
          section: duplicateForm.section.trim(),
          note_date: duplicateForm.start_date,
          start_date: duplicateForm.start_date,
          end_date: duplicateForm.end_date,
          start_km: startKm,
          end_km: endKm,
          start_fuel: startFuel,
          end_fuel: endFuel,
          content: duplicateForm.content.trim(),
        });
        resetFormState();
        setSheet(false);
      } catch (error) {
        Alert.alert('Gagal menyimpan Investigation', error instanceof Error ? error.message : 'Terjadi kesalahan.');
      } finally {
        setSaving(false);
      }
      return;
    }

    const renterProfile = getSession()?.user;
    const renterName = renterProfile?.full_name?.trim() ?? '';
    const renterEmail = renterProfile?.email?.trim() ?? '';
    const renterPhone = renterProfile?.phone?.trim() ?? '';
    if (!renterName || !/^\S+@\S+\.\S+$/.test(renterEmail) || renterPhone.replace(/\D/g, '').length < 7) {
      Alert.alert('Profil belum lengkap', 'Lengkapi nama lengkap, email, dan nomor telepon di Settings sebelum membuat Transportation.');
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
    if (form.end_date < form.start_date) {
      Alert.alert('Jadwal tidak valid', 'Tanggal selesai harus sama atau setelah tanggal mulai.');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    setSaving(true);
    try {
      const createdRentals = await apiClient.rentals.createCycle({
        car_ids: selectedCarIds,
        start_date: form.start_date || today,
        start_time: form.start_time,
        end_date: form.end_date || null,
        end_time: form.end_time || null,
        purpose: form.purpose.trim(),
        notes: form.notes.trim(),
      });
      const firstRental = createdRentals[0];
      if (getSession()?.user.role !== 2) {
        try {
          await apiClient.rentals.notifyCreated({
            namaPemesan: firstRental.renter_name,
            emailPemesan: firstRental.renter_email,
            nomorTelepon: firstRental.renter_phone,
            jenisKendaraan: cars.filter((car) => selectedCarIds.includes(car.id)).map((car) => car.name).join(', '),
            platNomor: cars.filter((car) => selectedCarIds.includes(car.id)).map((car) => car.plate_number).join(', '),
            tanggalMulaiSewa: firstRental.start_date,
            tanggalSelesaiSewa: firstRental.end_date ?? '',
            jumlahHariSewa: firstRental.end_date ? differenceInCalendarDays(firstRental.start_date, firstRental.end_date) : '',
          });
        } catch (error) {
          Alert.alert('Transportation tersimpan', `Notifikasi otomatis gagal dikirim: ${error instanceof Error ? error.message : 'Terjadi kesalahan.'}`);
        }
      }
      resetFormState();
      setSheet(false);
      await fetchRentals();
    } catch (error) {
      Alert.alert('Gagal menyimpan Transportation', error instanceof Error ? error.message : 'Terjadi kesalahan. Pastikan migration jadwal Transportation sudah dijalankan di Supabase.');
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
      <View style={styles.header}><Text style={styles.greeting}>Transportation Mobil</Text><Text style={styles.title}>{activeTab === 'borrowing' ? 'Transportation' : 'Pengembalian'}</Text>{activeTab === 'return' && isAdmin && overdueCount > 0 ? <Text style={styles.overdueNotice}>{overdueCount} Transportation perlu konfirmasi pengembalian</Text> : null}</View>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, activeTab === 'borrowing' && styles.activeTab]} onPress={() => setActiveTab('borrowing')}>
          <KeyRound size={17} color={activeTab === 'borrowing' ? Colors.primary : Colors.textSecondary} strokeWidth={2.2} />
          <Text style={[styles.tabText, activeTab === 'borrowing' && styles.activeTabText]}>Transportation</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'return' && styles.activeTab]} onPress={() => setActiveTab('return')}>
          <RotateCcw size={17} color={activeTab === 'return' ? Colors.primary : Colors.textSecondary} strokeWidth={2.2} />
          <Text style={[styles.tabText, activeTab === 'return' && styles.activeTabText]}>Pengembalian</Text>
          {pendingReturnCount > 0 ? <Text style={[styles.tabCount, activeTab === 'return' && styles.activeTabCount]}>{pendingReturnCount}</Text> : null}
        </TouchableOpacity>
      </View>
      <FlatList data={displayedRentals} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRentals(); }} colors={[Colors.primary]} />}
        renderItem={({ item }) => { const st = statusConfig[item.status] ?? statusConfig.active; const cycleUnitCount = rentals.filter((rental) => rental.cycle_id === item.cycle_id).length; return (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/car/rental/${item.id}` as never)} activeOpacity={0.85}>
            <View style={styles.rentalIcon}><KeyRound size={16} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={styles.cardBody}>
              <Text style={styles.renterName} numberOfLines={1}>{item.renter_name}</Text>
              <Text style={styles.carName} numberOfLines={1}>{item.car_name ?? 'Mobil tidak diketahui'}</Text>
              <Text style={styles.emailText} numberOfLines={1}>{item.renter_email}</Text>
              {cycleUnitCount > 1 ? <Text style={styles.emailText}>Satu siklus Transportation · {cycleUnitCount} unit</Text> : null}
              <View style={styles.metaRow}><Text style={styles.metaText}>{formatDate(item.start_date)} {item.start_time || ''}</Text>{item.end_date ? <Text style={styles.metaText}> - {formatDate(item.end_date)} {item.end_time || ''}</Text> : null}</View>
              <View style={styles.metaRow}>{item.purpose ? <Text style={styles.metaText}>Tujuan: {item.purpose}</Text> : null}{item.total_cost ? <Text style={styles.costText}>{formatCurrency(item.total_cost)}</Text> : null}</View>
              <View style={[styles.statusPill, { backgroundColor: st.bg }]}><Text style={[styles.statusText, { color: st.text }]}>{st.label}</Text></View>
              {activeTab === 'return' && isAdmin && ['approved', 'active', 'overdue'].includes(item.status) ? <TouchableOpacity style={[styles.returnButton, returningId === item.id && styles.actionDisabled]} onPress={() => confirmReturn(item)} disabled={returningId === item.id}><Text style={styles.returnButtonText}>{returningId === item.id ? 'Memproses...' : 'Unit sudah diterima'}</Text></TouchableOpacity> : null}
            </View>
            <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.2} />
          </TouchableOpacity>
        ); }}
        ListEmptyComponent={<EmptyState icon={activeTab === 'borrowing' ? <KeyRound size={32} color={Colors.primary} strokeWidth={2} /> : <RotateCcw size={32} color={Colors.primary} strokeWidth={2} />} title={activeTab === 'borrowing' ? 'Belum ada Transportation' : 'Belum ada pengembalian'} subtitle={activeTab === 'borrowing' ? 'Ajukan Transportation untuk mobil dengan tombol tambah.' : 'Transportation yang disetujui akan muncul di sini.'} />}
      />
      {activeTab === 'borrowing' ? <TouchableOpacity style={styles.fab} onPress={() => { if (hasOpenCycle) setRecordKind('duplicate'); setSheet(true); }} activeOpacity={0.85}><View style={styles.fabContent}><Plus size={26} color={Colors.white} strokeWidth={2.6} /><Text style={styles.fabLabel}>{hasOpenCycle ? 'Tambah Investigation' : 'Tambah Transportation/Investigation'}</Text></View></TouchableOpacity> : null}
      <Sheet visible={sheet} onClose={() => { setSheet(false); resetFormState(); }} title="Tambah Transportation/Investigation">
        {hasOpenCycle ? <Text style={styles.cycleNoticeText}>Siklus Transportation masih berjalan. Pengajuan baru tersedia setelah Admin mengonfirmasi semua unit sudah diterima.</Text> : null}
        <Text style={styles.label}>Jenis transaksi</Text>
        <View style={styles.recordTypeRow}>
          <TouchableOpacity disabled={hasOpenCycle} style={[styles.recordType, recordKind === 'rental' && styles.recordTypeActive, hasOpenCycle && styles.actionDisabled]} onPress={() => { setRecordKind('rental'); setSelectedCarIds([]); setForm((current) => ({ ...current, car_id: '' })); }}>
            <Text style={[styles.recordTypeText, recordKind === 'rental' && styles.recordTypeTextActive]}>Transportation</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.recordType, recordKind === 'duplicate' && styles.recordTypeActive]} onPress={() => { setRecordKind('duplicate'); setSelectedCarIds([]); setForm((current) => ({ ...current, car_id: '' })); }}>
            <Text style={[styles.recordTypeText, recordKind === 'duplicate' && styles.recordTypeTextActive]}>Investigation</Text>
          </TouchableOpacity>
        </View>

        {recordKind === 'rental' ? (
          <>
            <DateField label="Tanggal Mulai*" value={form.start_date} onChange={(value) => { setForm({ ...form, start_date: value, end_date: form.end_date && form.end_date < value ? '' : form.end_date, car_id: '' }); setSelectedCarIds([]); }} placeholder="Pilih tanggal mulai" />
            <DateField label="Tanggal Selesai*" value={form.end_date} onChange={(value) => { setForm({ ...form, end_date: value, car_id: '' }); setSelectedCarIds([]); }} placeholder="Pilih tanggal selesai" minimumDate={form.start_date ? new Date(`${form.start_date}T00:00:00`) : undefined} />
          </>
        ) : (
          <>
            <DateField label="Mulai*" value={duplicateForm.start_date} onChange={(value) => { setDuplicateForm({ ...duplicateForm, start_date: value, end_date: duplicateForm.end_date && duplicateForm.end_date < value ? '' : duplicateForm.end_date }); setForm((current) => ({ ...current, car_id: '' })); setSelectedCarIds([]); }} placeholder="Pilih tanggal mulai" />
            <DateField label="Selesai*" value={duplicateForm.end_date} onChange={(value) => { setDuplicateForm({ ...duplicateForm, end_date: value }); setForm((current) => ({ ...current, car_id: '' })); setSelectedCarIds([]); }} placeholder="Pilih tanggal selesai" minimumDate={duplicateForm.start_date ? new Date(`${duplicateForm.start_date}T00:00:00`) : undefined} />
          </>
        )}

        {selectedRangeValid ? (
          <>
            <Text style={styles.label}>{recordKind === 'rental' ? 'Pilih Unit (bisa lebih dari satu)*' : 'Unit tersedia*'}</Text>
            {availabilityLoading ? <Text style={styles.availabilityMessage}>Memeriksa ketersediaan unit...</Text> : (
              <View style={styles.carPicker}>
                {availableCars.map((car) => {
                  const selected = recordKind === 'rental' ? selectedCarIds.includes(car.id) : form.car_id === car.id;
                  return <TouchableOpacity key={car.id} onPress={() => {
                    if (recordKind === 'rental') {
                      setSelectedCarIds((current) => current.includes(car.id) ? current.filter((id) => id !== car.id) : [...current, car.id]);
                    } else {
                      setForm({ ...form, car_id: car.id });
                    }
                  }} style={[styles.carChip, selected && styles.carChipActive]}><Text style={[styles.carChipText, selected && styles.carChipTextActive]}>{car.name}</Text></TouchableOpacity>;
                })}
                {availableCars.length === 0 ? <Text style={styles.availabilityMessage}>Tidak ada unit tersedia untuk rentang tanggal ini.</Text> : null}
              </View>
            )}
          </>
        ) : <Text style={styles.availabilityMessage}>Pilih tanggal mulai dan selesai terlebih dahulu untuk melihat unit yang tersedia.</Text>}

        {recordKind === 'rental' ? (
          <>
            <Text style={styles.profileHint}>{profileComplete ? `Pemesan: ${userProfile?.full_name} · ${profileEmail} · ${profilePhone}` : 'Lengkapi nama, email, dan nomor telepon di Settings sebelum menyimpan Transportation.'}</Text>
            <TimeField label="Jam Mulai (WIB)" value={form.start_time} onChange={(value) => setForm({ ...form, start_time: value })} />
            <TimeField label="Jam Selesai (WIB)" value={form.end_time} onChange={(value) => setForm({ ...form, end_time: value })} />
            <Field label="Tujuan Transportation" value={form.purpose} onChangeText={(t) => setForm({ ...form, purpose: t })} placeholder="Contoh: Perjalanan dinas, liburan keluarga" />
            <Field label="Catatan" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} placeholder="Catatan tambahan..." multiline />
          </>
        ) : (
          <>
            <Field label="Pencatat*" value={duplicateForm.name} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, name: t })} placeholder="Contoh: Rizky / Tim Operasional" />
            <Field label="Bagian*" value={duplicateForm.section} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, section: t })} placeholder="Contoh: Maintenance / Ops" />
            <Field label="KM Awal*" value={duplicateForm.start_km} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, start_km: t })} placeholder="Contoh: 12000" keyboardType="numeric" />
            <Field label="KM Akhir*" value={duplicateForm.end_km} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, end_km: t })} placeholder="Contoh: 12150" keyboardType="numeric" />
            <Field label="Fuel Awal*" value={duplicateForm.start_fuel} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, start_fuel: t })} placeholder="0-100" keyboardType="numeric" />
            <Field label="Fuel Akhir*" value={duplicateForm.end_fuel} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, end_fuel: t })} placeholder="0-100" keyboardType="numeric" />
            <Field label="Detail*" value={duplicateForm.content} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, content: t })} placeholder="Rincian aktivitas yang dilakukan..." multiline />
          </>
        )}

        <View style={{ height: Spacing.sm }} />
        <Button label={recordKind === 'rental' ? 'Simpan Transportation' : 'Simpan Investigation'} onPress={addRecord} loading={saving} disabled={(hasOpenCycle && recordKind === 'rental') || !selectedCarAvailable || (recordKind === 'rental' ? !profileComplete || !form.start_time || !form.end_time : !duplicateForm.name.trim() || !duplicateForm.section.trim() || !duplicateForm.start_km || !duplicateForm.end_km || !duplicateForm.start_fuel || !duplicateForm.end_fuel || !duplicateForm.content.trim())} />
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
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, borderRadius: Radius.pill, backgroundColor: Colors.primary, elevation: 8 },
  fabContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 16 },
  fabLabel: { color: Colors.white, fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  carPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  availabilityMessage: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginBottom: Spacing.md },
  cycleNoticeText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.warning, lineHeight: 20, marginBottom: Spacing.sm },
  profileHint: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginBottom: Spacing.sm },
  carChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
  recordTypeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  recordType: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.borderLight, alignItems: 'center' },
  recordTypeActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primarySoft },
  recordTypeText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  recordTypeTextActive: { color: Colors.primary, fontFamily: Typography.fontSemiBold },
});
