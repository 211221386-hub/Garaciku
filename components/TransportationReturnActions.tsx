import { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ImagePlus, Plus, X } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { PercentageField } from '@/components/PercentageField';
import { Sheet } from '@/components/Sheet';
import { apiClient } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { pickCompressedPhoto, type CompressedPhotoDraft } from '@/lib/photo';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { DamageSeverity, RentalRecord, RentalReturnItineraryDetails } from '@/lib/types';

type Props = {
  rental: RentalRecord;
  isAdmin: boolean;
  onUpdated: () => void | Promise<void>;
};

type DamageDraft = {
  id: string;
  description: string;
  severity: DamageSeverity;
  photos: { id: string; url: string }[];
  newPhotos: CompressedPhotoDraft[];
};

const severityOptions: { value: DamageSeverity; label: string; color: string }[] = [
  { value: 'low', label: 'Rendah', color: Colors.success },
  { value: 'medium', label: 'Sedang', color: Colors.warning },
  { value: 'high', label: 'Tinggi', color: Colors.error },
];

export function TransportationReturnActions({ rental, isAdmin, onUpdated }: Props) {
  const [details, setDetails] = useState<RentalReturnItineraryDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [startKm, setStartKm] = useState('');
  const [startFuel, setStartFuel] = useState('');
  const [endKm, setEndKm] = useState('');
  const [endFuel, setEndFuel] = useState('');
  const [damageDrafts, setDamageDrafts] = useState<DamageDraft[]>([]);
  const userId = getSession()?.user.id;
  const isOwner = rental.user_id === userId;
  const itinerary = details?.itinerary ?? null;
  const isSubmitted = Boolean(itinerary?.submitted_at);
  const hasSubmittedItinerary = Boolean(
    itinerary?.submitted_at && itinerary.start_km >= 0 && itinerary.start_fuel >= 0
      && itinerary.end_km !== null && itinerary.end_fuel !== null,
  );

  const refreshDetails = async () => {
    const result = await apiClient.rentals.getReturnItinerary(rental.id);
    setDetails(result);
    setLoadError(false);
    return result;
  };

  useEffect(() => {
    let active = true;
    apiClient.rentals.getReturnItinerary(rental.id).then((result) => {
      if (active) setDetails(result);
    }).catch((error) => {
      if (active) {
        setLoadError(true);
        Alert.alert('Gagal memuat itinerary', error instanceof Error ? error.message : 'Terjadi kesalahan.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [rental.id]);

  const retryLoad = async () => {
    setLoading(true);
    try {
      await refreshDetails();
    } catch (error) {
      Alert.alert('Gagal memuat itinerary', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setLoading(false);
    }
  };

  const openEditor = () => {
    setStartKm(itinerary ? String(itinerary.start_km) : '');
    setStartFuel(itinerary ? String(itinerary.start_fuel) : '');
    setEndKm(itinerary?.end_km === null || itinerary?.end_km === undefined ? '' : String(itinerary.end_km));
    setEndFuel(itinerary?.end_fuel === null || itinerary?.end_fuel === undefined ? '' : String(itinerary.end_fuel));
    setDamageDrafts((details?.damages ?? []).map((damage) => ({
      id: damage.id,
      description: damage.description,
      severity: damage.severity,
      photos: damage.photos,
      newPhotos: [],
    })));
    setEditing(true);
  };

  const confirmReturn = async () => {
    if (!hasSubmittedItinerary) {
      Alert.alert('Itinerary belum lengkap', 'Peminjam harus mengirim KM Awal, Fuel Awal, KM Akhir, dan Fuel Akhir sebelum Admin menerima unit.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.rentals.confirmReturn(rental.id);
      await onUpdated();
    } catch (error) {
      Alert.alert('Gagal mengonfirmasi pengembalian', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  const saveItinerary = async (submit: boolean) => {
    if (saving) return;
    const startKmValue = Number(startKm);
    const startFuelValue = Number(startFuel);
    const endKmValue = endKm.trim() ? Number(endKm) : null;
    const endFuelValue = endFuel.trim() ? Number(endFuel) : null;
    if (!Number.isInteger(startKmValue) || startKmValue < 0) {
      Alert.alert('KM awal tidak valid', 'KM awal harus berupa bilangan bulat nol atau lebih.');
      return;
    }
    if (!Number.isInteger(startFuelValue) || startFuelValue < 0 || startFuelValue > 100) {
      Alert.alert('Fuel awal tidak valid', 'Fuel awal harus berupa persentase 0 sampai 100.');
      return;
    }
    if ((endKmValue === null) !== (endFuelValue === null)
      || (endKmValue !== null && (!Number.isInteger(endKmValue) || endKmValue < startKmValue))
      || (endFuelValue !== null && (!Number.isInteger(endFuelValue) || endFuelValue < 0 || endFuelValue > 100))) {
      Alert.alert('Data akhir tidak valid', 'Isi KM Akhir dan Fuel Akhir bersama-sama. KM Akhir tidak boleh kurang dari KM Awal dan Fuel harus 0–100%.');
      return;
    }
    if (submit && (endKmValue === null || endFuelValue === null)) {
      Alert.alert('Itinerary belum lengkap', 'Isi KM Akhir dan Fuel Akhir sebelum mengirim itinerary pengembalian.');
      return;
    }
    if (damageDrafts.length > 20 || damageDrafts.some((damage) => !damage.description.trim() || damage.description.trim().length > 500)) {
      Alert.alert('Laporan kerusakan belum lengkap', 'Setiap laporan kerusakan wajib memiliki deskripsi (maksimal 500 karakter), dengan maksimal 20 laporan.');
      return;
    }

    setSaving(true);
    let itinerarySaved = false;
    try {
      await apiClient.rentals.saveReturnItinerary({
        rentalId: rental.id,
        startKm: startKmValue,
        startFuel: startFuelValue,
        endKm: endKmValue,
        endFuel: endFuelValue,
        submit,
        damages: damageDrafts.map(({ id, description, severity }) => ({ id, description: description.trim(), severity })),
      });
      itinerarySaved = true;
      for (const damage of damageDrafts) {
        for (const photo of damage.newPhotos) {
          if (!photo.base64) throw new Error('Data foto tidak valid. Pilih ulang foto tersebut.');
          await apiClient.rentals.uploadReturnDamagePhoto({
            rentalId: rental.id,
            damageId: damage.id,
            photoId: photo.id,
            base64: photo.base64,
          });
        }
      }
      await refreshDetails();
      setEditing(false);
      setDamageDrafts([]);
      Alert.alert(
        submit ? 'Itinerary dikirim' : 'Draft tersimpan',
        submit
          ? 'Itinerary pengembalian berhasil dikirim dan menunggu Admin menerima unit.'
          : 'KM Awal dan Fuel Awal tersimpan sebagai draft. Lengkapi KM Akhir dan Fuel Akhir saat unit dikembalikan.',
      );
      try {
        await onUpdated();
      } catch (error) {
        Alert.alert('Itinerary tersimpan, daftar approval gagal diperbarui', error instanceof Error ? error.message : 'Muat ulang tab Approval.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
      if (itinerarySaved) {
        try {
          await refreshDetails();
        } catch (refreshError) {
          Alert.alert('Gagal menyimpan itinerary', `${message}\n\nData terbaru juga gagal dimuat: ${refreshError instanceof Error ? refreshError.message : 'Terjadi kesalahan.'}`);
          return;
        }
      }
      Alert.alert('Gagal menyimpan itinerary', message);
    } finally {
      setSaving(false);
    }
  };

  const addDamage = () => {
    if (damageDrafts.length >= 20) {
      Alert.alert('Batas laporan tercapai', 'Maksimal 20 laporan kerusakan per Transportation.');
      return;
    }
    setDamageDrafts((current) => [...current, {
      id: crypto.randomUUID(),
      description: '',
      severity: 'low',
      photos: [],
      newPhotos: [],
    }]);
  };

  const addPhoto = async (damageIndex: number) => {
    const damage = damageDrafts[damageIndex];
    if (!damage || damage.photos.length + damage.newPhotos.length >= 5) {
      Alert.alert('Batas foto tercapai', 'Maksimal 5 foto untuk setiap laporan kerusakan.');
      return;
    }
    try {
      const photo = await pickCompressedPhoto();
      if (photo) {
        setDamageDrafts((current) => current.map((item, index) => (
          index === damageIndex ? { ...item, newPhotos: [...item.newPhotos, photo] } : item
        )));
      }
    } catch (error) {
      Alert.alert('Gagal memilih foto', error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses foto.');
    }
  };

  const removePhoto = async (damageIndex: number, photoId: string, isNew: boolean) => {
    if (isNew) {
      setDamageDrafts((current) => current.map((damage, index) => (
        index === damageIndex
          ? { ...damage, newPhotos: damage.newPhotos.filter((photo) => photo.id !== photoId) }
          : damage
      )));
      return;
    }
    setSaving(true);
    try {
      await apiClient.rentals.deleteReturnDamagePhoto(rental.id, damageDrafts[damageIndex].id, photoId);
      setDamageDrafts((current) => current.map((damage, index) => (
        index === damageIndex ? { ...damage, photos: damage.photos.filter((photo) => photo.id !== photoId) } : damage
      )));
      await refreshDetails();
    } catch (error) {
      Alert.alert('Gagal menghapus foto', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  const removeDamage = (damageIndex: number) => {
    const damage = damageDrafts[damageIndex];
    if (!damage) return;
    if (damage.photos.length) {
      Alert.alert('Hapus foto terlebih dahulu', 'Hapus foto pada laporan ini satu per satu sebelum menghapus laporannya.');
      return;
    }
    setDamageDrafts((current) => current.filter((_, index) => index !== damageIndex));
  };

  const statusText = loading
    ? 'memuat...'
    : loadError
      ? 'gagal dimuat'
      : !itinerary
        ? 'belum diisi'
        : isSubmitted
          ? 'dikirim · menunggu konfirmasi Admin'
          : 'draft tersimpan';

  return (
    <>
      <Text style={styles.status}>Itinerary Transportation: {statusText}</Text>
      {loadError ? <Button label="Coba muat ulang itinerary" style={styles.button} onPress={() => { void retryLoad(); }} loading={loading} disabled={loading} /> : null}
      {isOwner && !rental.return_confirmed_at ? (
        <Button
          label={itinerary ? 'Ubah itinerary Transportation' : 'Isi KM Awal & Fuel Awal'}
          style={styles.button}
          onPress={openEditor}
          disabled={loading || loadError || saving}
        />
      ) : null}
      {isAdmin ? (
        <Button
          label={saving ? 'Memproses...' : hasSubmittedItinerary ? 'Konfirmasi unit diterima' : 'Menunggu itinerary peminjam'}
          style={styles.button}
          onPress={() => { void confirmReturn(); }}
          loading={saving}
          disabled={!hasSubmittedItinerary || loading || loadError || saving}
        />
      ) : null}
      {itinerary ? (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>KM Awal {itinerary.start_km.toLocaleString('id-ID')} · Fuel Awal {itinerary.start_fuel}%</Text>
          {itinerary.end_km !== null && itinerary.end_fuel !== null
            ? <Text style={styles.summaryText}>KM Akhir {itinerary.end_km.toLocaleString('id-ID')} · Fuel Akhir {itinerary.end_fuel}%</Text>
            : null}
          {details?.return_confirmed_by_name ? <Text style={styles.summaryText}>Petugas penerima unit: {details.return_confirmed_by_name}</Text> : null}
          {details?.damages.filter((damage) => !damage.is_return_draft || isOwner).map((damage) => (
            <View key={damage.id} style={styles.readonlyDamage}>
              <Text style={styles.summaryText}>Kerusakan ({damage.severity === 'high' ? 'Tinggi' : damage.severity === 'medium' ? 'Sedang' : 'Rendah'}): {damage.description}</Text>
              {damage.photos.length ? (
                <View style={styles.photoRow}>
                  {damage.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.url }} style={styles.photoPreview} />)}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <Sheet
        visible={editing}
        onClose={() => {
          if (!saving) {
            setEditing(false);
            setDamageDrafts([]);
          }
        }}
        title="Itinerary Transportation"
      >
        <Text style={styles.helpText}>
          Simpan KM Awal dan Fuel Awal sebagai draft saat mulai memakai unit. Saat pengembalian, lengkapi KM Akhir dan Fuel Akhir lalu kirim ke Admin. Laporan kerusakan bersifat opsional.
        </Text>
        <Field label="Kilometer Awal*" value={startKm} onChangeText={setStartKm} placeholder="Contoh: 12100" keyboardType="numeric" />
        <PercentageField label="Fuel Awal (%)*" value={startFuel} onChange={setStartFuel} />
        <Field label="Kilometer Akhir" value={endKm} onChangeText={setEndKm} placeholder="Diisi saat mengembalikan unit" keyboardType="numeric" />
        <PercentageField label="Fuel Akhir (%)" value={endFuel} onChange={setEndFuel} />

        <View style={styles.sectionHeader}>
          <Text style={styles.label}>Laporan kerusakan (opsional)</Text>
          <TouchableOpacity style={styles.addButton} onPress={addDamage} disabled={saving}>
            <Plus size={17} color={Colors.white} />
            <Text style={styles.addButtonText}>Tambah</Text>
          </TouchableOpacity>
        </View>
        {damageDrafts.map((damage, index) => (
          <View key={damage.id} style={styles.damageCard}>
            <View style={styles.damageHeader}>
              <Text style={styles.damageTitle}>Kerusakan {index + 1}</Text>
              <TouchableOpacity onPress={() => removeDamage(index)} disabled={saving} accessibilityLabel={`Hapus laporan kerusakan ${index + 1}`}>
                <X size={18} color={Colors.error} />
              </TouchableOpacity>
            </View>
            <Field
              label="Deskripsi kerusakan*"
              value={damage.description}
              onChangeText={(value) => setDamageDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: value } : item))}
              placeholder="Contoh: Baret pada pintu kiri"
              multiline
            />
            <Text style={styles.label}>Tingkat keparahan</Text>
            <View style={styles.severityRow}>
              {severityOptions.map((option) => {
                const active = damage.severity === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setDamageDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, severity: option.value } : item))}
                    style={[styles.severityButton, active && { backgroundColor: option.color, borderColor: option.color }]}
                  >
                    <Text style={[styles.severityText, active && styles.activeSeverityText]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.label}>Foto (opsional, maksimal 5)</Text>
            <View style={styles.photoRow}>
              {damage.photos.map((photo) => (
                <View key={photo.id} style={styles.photoContainer}>
                  <Image source={{ uri: photo.url }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void removePhoto(index, photo.id, false); }} disabled={saving} accessibilityLabel="Hapus foto">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {damage.newPhotos.map((photo) => (
                <View key={photo.id} style={styles.photoContainer}>
                  <Image source={{ uri: photo.preview }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void removePhoto(index, photo.id, true); }} disabled={saving} accessibilityLabel="Hapus foto baru">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {damage.photos.length + damage.newPhotos.length < 5 ? (
                <TouchableOpacity style={styles.addPhotoButton} onPress={() => { void addPhoto(index); }} disabled={saving}>
                  <ImagePlus size={21} color={Colors.primary} />
                  <Text style={styles.addPhotoText}>Tambah foto</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
        {!isSubmitted ? (
          <Button label="Simpan draft KM/Fuel Awal" onPress={() => { void saveItinerary(false); }} loading={saving} disabled={loading || saving} />
        ) : null}
        <View style={{ height: Spacing.sm }} />
        <Button
          label={isSubmitted ? 'Simpan perubahan itinerary' : 'Kirim itinerary pengembalian'}
          onPress={() => { void saveItinerary(true); }}
          loading={saving}
          disabled={loading || saving}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginTop: Spacing.xs },
  button: { height: 42, marginTop: Spacing.sm },
  summary: { marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, gap: Spacing.xs },
  summaryText: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 18 },
  readonlyDamage: { paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  helpText: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, marginBottom: Spacing.xs },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.md, backgroundColor: Colors.primary },
  addButtonText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: Colors.white },
  damageCard: { marginBottom: Spacing.md, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.white },
  damageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  damageTitle: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },
  severityRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.sm },
  severityButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderLight },
  severityText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  activeSeverityText: { color: Colors.white },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  photoContainer: { position: 'relative' },
  photoPreview: { width: 82, height: 82, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  removePhotoButton: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.error },
  addPhotoButton: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryLight },
  addPhotoText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.primary },
});
