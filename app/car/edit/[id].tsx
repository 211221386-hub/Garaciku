import { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import type { Car } from '@/lib/types';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/Button';
import { getSession } from '@/lib/auth';

export default function EditCarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [periodicServiceStartDate, setPeriodicServiceStartDate] = useState<string | null>(null);
  const [canSetPeriodicServiceStartDate, setCanSetPeriodicServiceStartDate] = useState(false);
  const [annualTaxDueDate, setAnnualTaxDueDate] = useState<string | null>(null);
  const [plateTaxDueDate, setPlateTaxDueDate] = useState<string | null>(null);
  const [operationalStatus, setOperationalStatus] = useState<Car['operational_status']>('ready');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (![1, 2].includes(getSession()?.user.role ?? 0)) {
        router.replace('/(tabs)');
        return;
      }
      const data = await apiClient.cars.getById(id);
      if (data) {
        setName(data.name);
        setBrand(data.brand);
        setModel(data.model);
        setYear(data.year ? String(data.year) : '');
        setPlate(data.plate_number);
        setColor(data.color);
        setPhotoUrl(data.photo_url ?? '');
        setPeriodicServiceStartDate(data.periodic_service_start_date);
        setCanSetPeriodicServiceStartDate(data.periodic_service_start_date === null);
        setAnnualTaxDueDate(data.annual_tax_due_date);
        setPlateTaxDueDate(data.plate_tax_due_date);
        setOperationalStatus(data.operational_status);
      }
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Nama wajib diisi', 'Beri nama untuk mobil Anda.');
      return;
    }
    setSaving(true);
    try {
      const updatedCar = await apiClient.cars.update(id, {
        name: name.trim(),
        brand: brand.trim(),
        model: model.trim(),
        year: year ? parseInt(year, 10) : null,
        plate_number: plate.trim().toUpperCase(),
        color: color.trim(),
        photo_url: photoUrl.trim() || null,
        ...(periodicServiceStartDate ? { periodic_service_start_date: periodicServiceStartDate } : {}),
        ...(annualTaxDueDate ? { annual_tax_due_date: annualTaxDueDate } : {}),
        ...(plateTaxDueDate ? { plate_tax_due_date: plateTaxDueDate } : {}),
      });
      setPeriodicServiceStartDate(updatedCar.periodic_service_start_date);
      setCanSetPeriodicServiceStartDate(updatedCar.periodic_service_start_date === null);
      await apiClient.cars.setOperationalStatus(id, operationalStatus);
      router.back();
    } catch (error) {
      Alert.alert('Gagal menyimpan', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft size={24} color={Colors.white} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Mobil</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
        <Field label="Nama Mobil*" value={name} onChangeText={setName} placeholder="Contoh: Avanza Hitam" />
        <Field label="Merek" value={brand} onChangeText={setBrand} placeholder="Contoh: Toyota" />
        <Field label="Model" value={model} onChangeText={setModel} placeholder="Contoh: Avanza 1.3 G" />
        <Field label="Tahun" value={year} onChangeText={setYear} placeholder="2020" keyboardType="numeric" />
        <Field label="Plat Nomor" value={plate} onChangeText={setPlate} placeholder="B 1234 ABC" />
        <Field label="Warna" value={color} onChangeText={setColor} placeholder="Hitam" />
        <Field label="URL Gambar Mobil" value={photoUrl} onChangeText={setPhotoUrl} placeholder="https://contoh.com/mobil.jpg" />
        {canSetPeriodicServiceStartDate ? (
          <>
            <Text style={styles.sectionLabel}>Jadwal Service Berkala</Text>
            <DateField label="Tanggal Service Berkala Pertama (opsional)" value={periodicServiceStartDate ?? ''} onChange={setPeriodicServiceStartDate} />
            <Text style={styles.helperText}>Tanggal ini hanya dapat diisi satu kali. Setelah disimpan, jadwal berikutnya dibuat otomatis 6 bulan setelah Service dikonfirmasi.</Text>
          </>
        ) : null}
        {annualTaxDueDate === null || plateTaxDueDate === null ? (
          <>
            <Text style={styles.sectionLabel}>Pajak Kendaraan</Text>
            {annualTaxDueDate === null ? <DateField label="Jatuh Tempo Pajak Tahunan (opsional)" value="" onChange={setAnnualTaxDueDate} allowClear /> : null}
            {plateTaxDueDate === null ? <DateField label="Jatuh Tempo Pajak 5 Tahunan (opsional)" value="" onChange={setPlateTaxDueDate} allowClear /> : null}
            <Text style={styles.helperText}>Tanggal yang sudah diatur hanya berubah setelah konfirmasi pajak. Reminder muncul mulai 7 hari sebelum jatuh tempo.</Text>
          </>
        ) : null}
        <Text style={styles.sectionLabel}>Status Unit</Text>
        <View style={styles.statusOptions}>
          <TouchableOpacity style={[styles.statusOption, operationalStatus === 'ready' && styles.statusOptionActive]} onPress={() => setOperationalStatus('ready')}>
            <Text style={[styles.statusOptionText, operationalStatus === 'ready' && styles.statusOptionTextActive]}>Ready</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statusOption, operationalStatus === 'under_maintenance' && styles.statusOptionActive]} onPress={() => setOperationalStatus('under_maintenance')}>
            <Text style={[styles.statusOptionText, operationalStatus === 'under_maintenance' && styles.statusOptionTextActive]}>Maintenance</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statusOption, operationalStatus === 'inactive' && styles.statusOptionActive]} onPress={() => setOperationalStatus('inactive')}>
            <Text style={[styles.statusOptionText, operationalStatus === 'inactive' && styles.statusOptionTextActive]}>Inactive</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: Spacing.md }} />
        <Button label="Simpan Perubahan" onPress={save} loading={saving} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: Spacing.xl + 12,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.lg,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  form: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  sectionLabel: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  helperText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  statusOptions: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  statusOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  statusOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusOptionText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  statusOptionTextActive: { color: Colors.white },
});
