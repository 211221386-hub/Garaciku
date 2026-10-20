import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Wrench, Plus, ChevronRight, Trash2 } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { addDaysToISO, addMonthsToISO, formatDate, formatCurrency, todayISO } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { ServiceRecord } from '@/lib/types';
import { getSession } from '@/lib/auth';
import { syncServiceReminders } from '@/lib/notifications';

type ServiceWithCar = ServiceRecord & { car_name: string };

type ServiceForm = {
  car_id: string;
  service_date: string;
  service_type: string;
  description: string;
  cost: string;
  mileage: string;
  workshop: string;
  status: 'completed' | 'scheduled';
  reminder_interval_months: string;
};

const emptyForm: ServiceForm = {
  car_id: '', service_date: '', service_type: '', description: '', cost: '', mileage: '', workshop: '',
  status: 'completed', reminder_interval_months: '',
};

function getReminderStatus(nextServiceDate: string): 'Jatuh tempo' | 'Segera' | null {
  const nextDate = new Date(`${nextServiceDate}T00:00:00Z`);
  const today = new Date(`${todayISO()}T00:00:00Z`);
  if (Number.isNaN(nextDate.getTime())) return null;

  const daysUntilService = Math.ceil((nextDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (daysUntilService <= 0) return 'Jatuh tempo';
  if (daysUntilService <= 30) return 'Segera';
  return null;
}

export default function ServiceScreen() {
  useEffect(() => {
    const role = getSession()?.user.role;
    if (role !== 1 && role !== 2) router.replace('/(tabs)');
  }, []);

  const [services, setServices] = useState<ServiceWithCar[]>([]);
  const [cars, setCars] = useState<{ id: string; name: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<ServiceWithCar | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingServiceId, setConfirmingServiceId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);

  const fetchServices = useCallback(async () => {
    try {
      const [serviceData, carData] = await Promise.all([apiClient.services.getAll(), apiClient.cars.getAll()]);
      setServices(serviceData);
      setCars(carData);
      void syncServiceReminders(serviceData).catch((error) => console.warn('Gagal menyinkronkan reminder service:', error));
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchServices(); }, [fetchServices]));

  const addService = async () => {
    if (saving) return;
    if (!form.car_id || !form.service_type.trim()) return;

    const numericFields = [
      { label: 'Biaya', value: form.cost, integer: false },
      { label: 'Kilometer', value: form.mileage, integer: true },
      ...(form.status === 'scheduled' ? [{ label: 'Interval bulan', value: form.reminder_interval_months, integer: true, positive: true }] : []),
    ];
    for (const field of numericFields) {
      if (!field.value) continue;
      const value = Number(field.value);
      if (!Number.isFinite(value) || value < 0 || (field.integer && !Number.isInteger(value)) || (field.positive && value === 0)) {
        Alert.alert('Angka tidak valid', `${field.label} harus berupa angka${field.positive ? ' lebih dari 0' : ' nol atau lebih'}${field.integer ? ' tanpa desimal' : ''}.`);
        return;
      }
    }
    if (form.status === 'scheduled' && !form.service_date) {
      Alert.alert('Tanggal service wajib diisi', 'Pilih tanggal rencana service agar reminder dapat dijadwalkan.');
      return;
    }
    if (form.status === 'scheduled' && !form.reminder_interval_months) {
      Alert.alert('Interval reminder wajib diisi', 'Masukkan interval service dalam bulan untuk membuat pengingat otomatis.');
      return;
    }

    setSaving(true);
    try {
      const serviceDate = form.service_date || todayISO();
      const isScheduled = form.status === 'scheduled';
      await apiClient.services.create({
        car_id: form.car_id,
        service_date: serviceDate,
        service_type: form.service_type.trim(),
        status: form.status,
        description: form.description.trim(),
        cost: form.cost ? Number(form.cost) : null,
        mileage: form.mileage ? Number(form.mileage) : null,
        workshop: form.workshop.trim(),
        next_service_date: isScheduled ? serviceDate : null,
        next_service_mileage: null,
        reminder_enabled: isScheduled,
        reminder_interval_months: isScheduled ? Number(form.reminder_interval_months) : null,
        reminder_interval_mileage: null,
      });
      setForm(emptyForm);
      setSheet(false);
      await fetchServices();
    } catch (error) {
      Alert.alert('Gagal menyimpan service', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  const deleteService = (service: ServiceWithCar) => {
    setServiceToDelete(service);
  };

  const removeService = async (service: ServiceWithCar) => {
    try {
      await apiClient.services.delete(service.id);
      setServiceToDelete(null);
      await fetchServices();
    } catch (error) {
      Alert.alert('Gagal menghapus service', error instanceof Error ? error.message : 'Terjadi kesalahan. Jalankan migration policy Supabase terlebih dahulu.');
    }
  };

  const confirmServiceDone = async (service: ServiceWithCar) => {
    if (confirmingServiceId || service.status !== 'scheduled' || !service.reminder_enabled) return;
    setConfirmingServiceId(service.id);
    const completedDate = todayISO();
    const intervalMonths = service.reminder_interval_months;
    const nextServiceDate = intervalMonths ? addMonthsToISO(completedDate, intervalMonths) : null;
    let nextRecord: ServiceRecord | null = null;

    try {
      if (nextServiceDate) {
        nextRecord = await apiClient.services.create({
          car_id: service.car_id,
          service_date: nextServiceDate,
          service_type: service.service_type,
          description: '',
          cost: null,
          mileage: null,
          workshop: service.workshop,
          status: 'scheduled',
          next_service_date: nextServiceDate,
          next_service_mileage: null,
          reminder_enabled: true,
          reminder_interval_months: intervalMonths,
          reminder_interval_mileage: null,
        });
      }
      try {
        await apiClient.services.update(service.id, {
          status: 'completed',
          service_date: completedDate,
          reminder_enabled: false,
          next_service_date: null,
          next_service_mileage: null,
        });
      } catch (error) {
        if (nextRecord) await apiClient.services.delete(nextRecord.id).catch(() => undefined);
        throw error;
      }
      await fetchServices();
    } catch (error) {
      Alert.alert('Gagal mengonfirmasi service', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setConfirmingServiceId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Perawatan Berkala</Text>
        <Text style={styles.title}>Service Mobil</Text>
      </View>
      <FlatList
        data={services}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchServices(); }} colors={[Colors.primary]} />}
        renderItem={({ item }) => {
          const isScheduledReminder = item.status === 'scheduled' && item.reminder_enabled;
          const dueDate = item.next_service_date || item.service_date;
          const reminderStatus = isScheduledReminder ? getReminderStatus(dueDate) : null;
          const confirmationWindowEnd = addDaysToISO(todayISO(), 7);
          return (
          <View style={styles.card}>
            <TouchableOpacity style={styles.cardMain} onPress={() => router.push(`/car/${item.car_id}`)} activeOpacity={0.85}>
            <View style={styles.serviceIcon}><Wrench size={18} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={styles.cardBody}>
              <Text style={styles.serviceType} numberOfLines={1}>{item.service_type}</Text>
              <Text style={styles.carName} numberOfLines={1}>{item.car_name || 'Mobil tidak diketahui'}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>{formatDate(item.service_date)}</Text>
                {item.workshop ? <Text style={styles.metaText}>{item.workshop}</Text> : null}
              </View>
              <Text style={[styles.statusText, item.status === 'scheduled' && styles.scheduledText]}>
                {item.status === 'scheduled' ? 'Terjadwal' : 'Sudah dilakukan'}
              </Text>
              {isScheduledReminder ? <Text style={styles.reminderText}>Reminder: {formatDate(dueDate)}</Text> : null}
              {reminderStatus ? <Text style={[styles.reminderStatus, reminderStatus === 'Jatuh tempo' ? styles.overdueReminder : styles.soonReminder]}>{reminderStatus}</Text> : null}
              {item.cost !== null ? <Text style={styles.costText}>{formatCurrency(item.cost)}</Text> : null}
              {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
            </View>
            <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={() => deleteService(item)} hitSlop={10} accessibilityLabel={`Hapus service ${item.service_type}`}>
              <Trash2 size={18} color={Colors.error} strokeWidth={2.2} />
            </TouchableOpacity>
            {isScheduledReminder && dueDate <= confirmationWindowEnd ? (
              <TouchableOpacity style={[styles.confirmServiceButton, confirmingServiceId === item.id && styles.actionDisabled]} onPress={() => { void confirmServiceDone(item); }} disabled={confirmingServiceId === item.id}>
                <Text style={styles.confirmServiceButtonText}>{confirmingServiceId === item.id ? 'Memproses...' : 'Konfirmasi sudah melakukan'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          );
        }}
        ListEmptyComponent={<EmptyState icon={<Wrench size={32} color={Colors.primary} strokeWidth={2} />} title="Belum ada service" subtitle="Tambahkan riwayat service berkala setiap mobil." />}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setSheet(true)} activeOpacity={0.85}><Plus size={26} color={Colors.white} strokeWidth={2.6} /></TouchableOpacity>
      {serviceToDelete ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <View style={styles.confirmIcon}><Trash2 size={24} color={Colors.error} strokeWidth={2.2} /></View>
            <Text style={styles.confirmTitle}>Hapus Service?</Text>
            <Text style={styles.confirmMessage}>Catatan service &quot;{serviceToDelete.service_type}&quot; akan dihapus permanen.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmButton, styles.cancelButton]} onPress={() => setServiceToDelete(null)}>
                <Text style={styles.cancelButtonText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmButton, styles.deleteConfirmButton]} onPress={() => { void removeService(serviceToDelete); }}>
                <Text style={styles.deleteConfirmText}>Hapus</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Tambah Service">
        <Text style={styles.label}>Pilih Mobil</Text>
        <View style={styles.carPicker}>
          {cars.map((car) => <TouchableOpacity key={car.id} onPress={() => setForm({ ...form, car_id: car.id })} style={[styles.carChip, form.car_id === car.id && styles.carChipActive]}><Text style={[styles.carChipText, form.car_id === car.id && styles.carChipTextActive]}>{car.name}</Text></TouchableOpacity>)}
        </View>
        <Field label="Jenis Service*" value={form.service_type} onChangeText={(value) => setForm({ ...form, service_type: value })} placeholder="Contoh: Ganti oli" />
        <Text style={styles.label}>Status Service</Text>
        <View style={styles.carPicker}>
          <TouchableOpacity onPress={() => setForm({ ...form, status: 'completed' })} style={[styles.carChip, form.status === 'completed' && styles.carChipActive]}><Text style={[styles.carChipText, form.status === 'completed' && styles.carChipTextActive]}>Sudah dilakukan</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setForm({ ...form, status: 'scheduled' })} style={[styles.carChip, form.status === 'scheduled' && styles.carChipActive]}><Text style={[styles.carChipText, form.status === 'scheduled' && styles.carChipTextActive]}>Terjadwal</Text></TouchableOpacity>
        </View>
        <DateField label={form.status === 'scheduled' ? 'Tanggal Rencana Service*' : 'Tanggal Service'} value={form.service_date} onChange={(value) => setForm({ ...form, service_date: value })} placeholder={form.status === 'scheduled' ? 'Pilih tanggal service' : 'Pilih tanggal (kosongkan = hari ini)'} />
        <Field label="Bengkel" value={form.workshop} onChangeText={(value) => setForm({ ...form, workshop: value })} placeholder="Nama bengkel" />
        <Field label="Biaya (Rp)" value={form.cost} onChangeText={(value) => setForm({ ...form, cost: value })} placeholder="0" keyboardType="numeric" />
        <Field label="Kilometer" value={form.mileage} onChangeText={(value) => setForm({ ...form, mileage: value })} placeholder="Contoh: 45000" keyboardType="numeric" />
        <Field label="Keterangan" value={form.description} onChangeText={(value) => setForm({ ...form, description: value })} placeholder="Detail pekerjaan service" multiline />
        {form.status === 'scheduled' ? <>
          <Text style={styles.label}>Reminder Otomatis</Text>
          <Text style={styles.reminderText}>Notifikasi harian akan dimulai 7 hari sebelum tanggal service.</Text>
          <Field label="Interval (bulan)*" value={form.reminder_interval_months} onChangeText={(value) => setForm({ ...form, reminder_interval_months: value })} placeholder="Contoh: 6" keyboardType="numeric" />
        </> : null}
        <Button label="Simpan Service" onPress={addService} loading={saving} disabled={!form.car_id || !form.service_type.trim()} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  greeting: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primarySoft, marginBottom: 2 },
  title: { fontSize: Typography.xxxl, fontFamily: Typography.fontBold, color: Colors.white },
  list: { padding: Spacing.lg, paddingBottom: 110 },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderLight },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  deleteButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: Spacing.xs },
  modalOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  confirmModal: { width: '100%', maxWidth: 420, backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', elevation: 12 },
  confirmIcon: { width: 52, height: 52, borderRadius: Radius.pill, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  confirmTitle: { fontSize: Typography.xl, fontFamily: Typography.fontBold, color: Colors.textPrimary, textAlign: 'center' },
  confirmMessage: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 21, textAlign: 'center', marginTop: Spacing.sm },
  confirmActions: { flexDirection: 'row', gap: Spacing.sm, width: '100%', marginTop: Spacing.lg },
  confirmButton: { flex: 1, minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { backgroundColor: Colors.surfaceAlt },
  deleteConfirmButton: { backgroundColor: Colors.error },
  cancelButtonText: { color: Colors.textPrimary, fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
  deleteConfirmText: { color: Colors.white, fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
  serviceIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  cardBody: { flex: 1, marginRight: Spacing.xs },
  serviceType: { fontSize: Typography.base, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },
  carName: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primary, marginBottom: Spacing.xs },
  metaRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  metaText: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textTertiary },
  costText: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold, color: Colors.primary, marginTop: 4 },
  description: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginTop: 4 },
  statusText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: Colors.success, marginTop: 5 },
  scheduledText: { color: Colors.warning },
  reminderText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.primary, marginTop: 3 },
  reminderStatus: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, marginTop: 3 },
  overdueReminder: { color: Colors.error },
  soonReminder: { color: Colors.warning },
  confirmServiceButton: { alignSelf: 'flex-start', marginTop: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  confirmServiceButtonText: { color: Colors.white, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  actionDisabled: { opacity: 0.6 },
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 58, height: 58, borderRadius: Radius.pill, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  carPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  carChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
});
