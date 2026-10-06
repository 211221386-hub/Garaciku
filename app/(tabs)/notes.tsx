import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Wrench, Plus, ChevronRight, Trash2 } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { formatDate, formatCurrency, todayISO } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { ServiceRecord } from '@/lib/types';
import { getSession } from '@/lib/auth';

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
  next_service_date: string;
  next_service_mileage: string;
  reminder_enabled: boolean;
  reminder_interval_months: string;
  reminder_interval_mileage: string;
};

const emptyForm: ServiceForm = {
  car_id: '', service_date: '', service_type: '', description: '', cost: '', mileage: '', workshop: '',
  status: 'completed', next_service_date: '', next_service_mileage: '', reminder_enabled: false,
  reminder_interval_months: '', reminder_interval_mileage: '',
};

export default function ServiceScreen() {
  useEffect(() => {
    const role = getSession()?.user.role;
    if (role !== 1 && role !== 2) router.replace('/(tabs)');
  }, []);

  const [services, setServices] = useState<ServiceWithCar[]>([]);
  const [cars, setCars] = useState<{ id: string; name: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<ServiceForm>(emptyForm);

  const fetchServices = useCallback(async () => {
    try {
      const [serviceData, carData] = await Promise.all([apiClient.services.getAll(), apiClient.cars.getAll()]);
      setServices(serviceData);
      setCars(carData);
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchServices(); }, [fetchServices]));

  const addService = async () => {
    if (!form.car_id || !form.service_type.trim()) return;
    try {
      await apiClient.services.create({
        car_id: form.car_id,
        service_date: form.service_date || todayISO(),
        service_type: form.service_type.trim(),
        status: form.status,
        description: form.description.trim(),
        cost: form.cost ? parseFloat(form.cost) : null,
        mileage: form.mileage ? parseInt(form.mileage, 10) : null,
        workshop: form.workshop.trim(),
        next_service_date: form.next_service_date || null,
        next_service_mileage: form.next_service_mileage ? parseInt(form.next_service_mileage, 10) : null,
        reminder_enabled: form.reminder_enabled,
        reminder_interval_months: form.reminder_interval_months ? parseInt(form.reminder_interval_months, 10) : null,
        reminder_interval_mileage: form.reminder_interval_mileage ? parseInt(form.reminder_interval_mileage, 10) : null,
      });
      setForm(emptyForm);
      setSheet(false);
      fetchServices();
    } catch (error) {
      Alert.alert('Gagal menyimpan service', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    }
  };

  const deleteService = (service: ServiceWithCar) => {
    Alert.alert('Hapus Service', `Hapus catatan service "${service.service_type}"?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.services.delete(service.id);
            fetchServices();
          } catch (error) {
            Alert.alert('Gagal menghapus service', error instanceof Error ? error.message : 'Terjadi kesalahan.');
          }
        },
      },
    ]);
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
        renderItem={({ item }) => (
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
              {item.reminder_enabled && item.next_service_date ? <Text style={styles.reminderText}>Reminder: {formatDate(item.next_service_date)}</Text> : null}
              {item.cost !== null ? <Text style={styles.costText}>{formatCurrency(item.cost)}</Text> : null}
              {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
            </View>
            <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={() => deleteService(item)} hitSlop={10} accessibilityLabel={`Hapus service ${item.service_type}`}>
              <Trash2 size={18} color={Colors.error} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<Wrench size={32} color={Colors.primary} strokeWidth={2} />} title="Belum ada service" subtitle="Tambahkan riwayat service berkala setiap mobil." />}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setSheet(true)} activeOpacity={0.85}><Plus size={26} color={Colors.white} strokeWidth={2.6} /></TouchableOpacity>
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
        <DateField label="Tanggal Service" value={form.service_date} onChange={(value) => setForm({ ...form, service_date: value })} placeholder="Pilih tanggal (kosongkan = hari ini)" />
        <Field label="Bengkel" value={form.workshop} onChangeText={(value) => setForm({ ...form, workshop: value })} placeholder="Nama bengkel" />
        <Field label="Biaya (Rp)" value={form.cost} onChangeText={(value) => setForm({ ...form, cost: value })} placeholder="0" keyboardType="numeric" />
        <Field label="Kilometer" value={form.mileage} onChangeText={(value) => setForm({ ...form, mileage: value })} placeholder="Contoh: 45000" keyboardType="numeric" />
        <Field label="Keterangan" value={form.description} onChangeText={(value) => setForm({ ...form, description: value })} placeholder="Detail pekerjaan service" multiline />
        <Text style={styles.label}>Reminder Service Berikutnya</Text>
        <TouchableOpacity onPress={() => setForm({ ...form, reminder_enabled: !form.reminder_enabled })} style={[styles.carChip, form.reminder_enabled && styles.carChipActive]}><Text style={[styles.carChipText, form.reminder_enabled && styles.carChipTextActive]}>{form.reminder_enabled ? 'Reminder aktif' : 'Aktifkan reminder'}</Text></TouchableOpacity>
        {form.reminder_enabled ? <>
          <DateField label="Tanggal Service Berikutnya" value={form.next_service_date} onChange={(value) => setForm({ ...form, next_service_date: value })} placeholder="Pilih tanggal" />
          <Field label="Interval (bulan)" value={form.reminder_interval_months} onChangeText={(value) => setForm({ ...form, reminder_interval_months: value })} placeholder="Contoh: 6" keyboardType="numeric" />
          <Field label="Kilometer Berikutnya" value={form.next_service_mileage} onChangeText={(value) => setForm({ ...form, next_service_mileage: value })} placeholder="Contoh: 50000" keyboardType="numeric" />
          <Field label="Interval Kilometer" value={form.reminder_interval_mileage} onChangeText={(value) => setForm({ ...form, reminder_interval_mileage: value })} placeholder="Contoh: 10000" keyboardType="numeric" />
        </> : null}
        <Button label="Simpan Service" onPress={addService} disabled={!form.car_id || !form.service_type.trim()} />
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
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, width: 58, height: 58, borderRadius: Radius.pill, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  carPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  carChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
});
