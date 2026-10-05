import { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { TouchableOpacity, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';

export default function EditCarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await apiClient.cars.getById(id);
      if (data) {
        setName(data.name);
        setBrand(data.brand);
        setModel(data.model);
        setYear(data.year ? String(data.year) : '');
        setPlate(data.plate_number);
        setColor(data.color);
        setPhotoUrl(data.photo_url ?? '');
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
      await apiClient.cars.update(id, {
        name: name.trim(),
        brand: brand.trim(),
        model: model.trim(),
        year: year ? parseInt(year, 10) : null,
        plate_number: plate.trim().toUpperCase(),
        color: color.trim(),
        photo_url: photoUrl.trim() || null,
      });
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
});
