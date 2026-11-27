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
import type { DailyNote, DailyNoteReturnItineraryDetails, DamageSeverity } from '@/lib/types';

type Props = {
  note: DailyNote;
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

export function InvestigationReturnActions({ note, isAdmin, onUpdated }: Props) {
  const [details, setDetails] = useState<DailyNoteReturnItineraryDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [startKm, setStartKm] = useState('');
  const [startFuel, setStartFuel] = useState('');
  const [endKm, setEndKm] = useState('');
  const [endFuel, setEndFuel] = useState('');
  const [parts, setParts] = useState<string[]>([]);
  const [newPart, setNewPart] = useState('');
  const [damageDrafts, setDamageDrafts] = useState<DamageDraft[]>([]);
  const userId = getSession()?.user.id;
  const itinerary = details?.itinerary ?? null;
  const isSubmitted = Boolean(itinerary?.submitted_at);
  const itineraryReady = Boolean(
    itinerary?.submitted_at && itinerary.start_km !== null && itinerary.start_fuel !== null
      && itinerary.end_km !== null && itinerary.end_fuel !== null && details?.parts.length,
  );

  useEffect(() => {
    let active = true;
    apiClient.notes.getReturnItinerary(note.id).then((result) => {
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
  }, [note.id]);

  const refreshDetails = async () => {
    try {
      const result = await apiClient.notes.getReturnItinerary(note.id);
      setDetails(result);
      setLoadError(false);
      return result;
    } catch (error) {
      setLoadError(true);
      throw error;
    }
  };

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
    setStartKm(itinerary?.start_km === null || itinerary?.start_km === undefined ? '' : String(itinerary.start_km));
    setStartFuel(itinerary?.start_fuel === null || itinerary?.start_fuel === undefined ? '' : String(itinerary.start_fuel));
    setEndKm(itinerary?.end_km === null || itinerary?.end_km === undefined ? '' : String(itinerary.end_km));
    setEndFuel(itinerary?.end_fuel === null || itinerary?.end_fuel === undefined ? '' : String(itinerary.end_fuel));
    setParts(details?.parts.map((part) => part.part_name) ?? []);
    setNewPart('');
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
    if (!itineraryReady) {
      Alert.alert('Itinerary belum lengkap', 'Pemesan harus mengirim KM/fuel awal dan akhir, serta minimal satu part sebelum Admin mengonfirmasi pengembalian.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.notes.confirmReturn(note.id);
      await onUpdated();
    } catch (error) {
      Alert.alert('Gagal mengonfirmasi pengembalian Investigation', error instanceof Error ? error.message : 'Terjadi kesalahan.');
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
    const allParts = [...parts, newPart].map((part) => part.trim()).filter(Boolean);
    if ((submit && allParts.length === 0) || allParts.length > 50 || allParts.some((part) => part.length > 160)) {
      Alert.alert('Daftar part tidak valid', 'Saat mengirim itinerary, isi minimal satu part yang dibongkar. Maksimal 50 part dan 160 karakter per part.');
      return;
    }
    if (damageDrafts.length > 20 || damageDrafts.some((damage) => !damage.description.trim() || damage.description.trim().length > 500)) {
      Alert.alert('Laporan kerusakan belum lengkap', 'Setiap laporan kerusakan wajib memiliki deskripsi (maksimal 500 karakter), dengan maksimal 20 laporan.');
      return;
    }

    setSaving(true);
    let itinerarySaved = false;
    try {
      await apiClient.notes.saveReturnItinerary(
        note.id,
        startKmValue,
        startFuelValue,
        endKmValue,
        endFuelValue,
        allParts,
        damageDrafts.map(({ id, description, severity }) => ({ id, description: description.trim(), severity })),
        submit,
      );
      itinerarySaved = true;
      for (const damage of damageDrafts) {
        for (const photo of damage.newPhotos) {
          if (!photo.base64) throw new Error('Data foto kerusakan tidak valid. Pilih ulang foto tersebut.');
          await apiClient.notes.uploadReturnDamagePhoto(note.id, damage.id, photo.id, photo.base64);
        }
      }
      setEditing(false);
      setDamageDrafts([]);
      let refreshError: unknown = null;
      try {
        await refreshDetails();
      } catch (error) {
        refreshError = error;
      }
      if (submit) {
        Alert.alert('Itinerary dikirim', 'Itinerary pengembalian Investigation berhasil dikirim dan menunggu Admin menerima unit.');
      } else if (refreshError) {
        Alert.alert('Draft tersimpan', `KM Awal dan Fuel Awal sudah tersimpan, tetapi status terbaru gagal dimuat. ${refreshError instanceof Error ? refreshError.message : 'Coba muat ulang itinerary.'}`);
      }
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
          Alert.alert('Itinerary tersimpan sebagian', `${message}\n\nData terbaru juga gagal dimuat: ${refreshError instanceof Error ? refreshError.message : 'Terjadi kesalahan.'}`);
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
      Alert.alert('Batas laporan tercapai', 'Maksimal 20 laporan kerusakan per Investigation.');
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

  const addDamagePhoto = async (damageIndex: number) => {
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

  const removeDamagePhoto = async (damageIndex: number, photoId: string, isNew: boolean) => {
    if (isNew) {
      setDamageDrafts((current) => current.map((damage, index) => (
        index === damageIndex
          ? { ...damage, newPhotos: damage.newPhotos.filter((photo) => photo.id !== photoId) }
          : damage
      )));
      return;
    }
    const damage = damageDrafts[damageIndex];
    if (!damage) return;
    setSaving(true);
    try {
      await apiClient.notes.deleteReturnDamagePhoto(note.id, damage.id, photoId);
      setDamageDrafts((current) => current.map((item, index) => (
        index === damageIndex ? { ...item, photos: item.photos.filter((photo) => photo.id !== photoId) } : item
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

  return (
    <>
      <Text style={styles.status}>
        Itinerary: {loading ? 'Memuat...' : loadError ? 'gagal dimuat' : !itinerary ? 'belum diisi' : isSubmitted ? 'dikirim · menunggu konfirmasi Admin' : 'draft tersimpan'}
      </Text>
      {loadError ? <Button label="Coba muat ulang itinerary" style={styles.button} onPress={() => { void retryLoad(); }} loading={loading} disabled={loading} /> : null}
      {note.created_by === userId && note.status === 'active' ? (
        <Button
          label={itinerary ? 'Ubah itinerary Investigation' : 'Isi KM Awal & Fuel Awal'}
          style={styles.button}
          onPress={openEditor}
          disabled={loading || loadError || saving}
        />
      ) : null}
      {isAdmin ? (
        <Button
          label={saving ? 'Memproses...' : !note.created_by ? 'Perlu identifikasi pemilik' : loadError ? 'Itinerary gagal dimuat' : itineraryReady ? 'Konfirmasi unit diterima' : 'Menunggu itinerary pengembalian'}
          style={styles.button}
          onPress={() => { void confirmReturn(); }}
          loading={saving}
          disabled={!itineraryReady || loading || loadError || saving}
        />
      ) : null}
      {itinerary ? (
        <View style={styles.summary}>
          {itinerary.start_km !== null && itinerary.start_fuel !== null
            ? <Text style={styles.summaryText}>KM Awal {itinerary.start_km.toLocaleString('id-ID')} · Fuel Awal {itinerary.start_fuel}%</Text>
            : <Text style={styles.summaryText}>KM Awal dan Fuel Awal belum lengkap.</Text>}
          {itinerary.end_km !== null && itinerary.end_fuel !== null
            ? <Text style={styles.summaryText}>KM Akhir {itinerary.end_km.toLocaleString('id-ID')} · Fuel Akhir {itinerary.end_fuel}%</Text>
            : null}
        </View>
      ) : null}
      {details?.damages.length ? (
        <View style={styles.summary}>
          <Text style={styles.label}>Laporan kerusakan</Text>
          {details.damages.filter((damage) => !damage.is_return_draft || note.created_by === userId).map((damage) => (
            <View key={damage.id} style={styles.readonlyDamage}>
              <Text style={styles.summaryText}>
                {damage.severity === 'high' ? 'Tinggi' : damage.severity === 'medium' ? 'Sedang' : 'Rendah'}: {damage.description}
              </Text>
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
          if (saving) return;
          setEditing(false);
          setDamageDrafts([]);
        }}
        title="Itinerary Pengembalian"
      >
        <Text style={styles.helpText}>Simpan KM Awal dan Fuel Awal sebagai draft setelah Investigation disetujui. Saat mengembalikan unit, lengkapi KM/Fuel Akhir dan minimal satu part yang dibongkar lalu kirim ke Admin. Laporan kerusakan bersifat opsional.</Text>
        <Field label="Kilometer Awal*" value={startKm} onChangeText={setStartKm} placeholder="Contoh: 12000" keyboardType="numeric" />
        <PercentageField label="Fuel Awal (%)*" value={startFuel} onChange={setStartFuel} />
        <Field label="Kilometer Akhir" value={endKm} onChangeText={setEndKm} placeholder="Diisi saat mengembalikan unit" keyboardType="numeric" />
        <PercentageField label="Fuel Akhir (%)" value={endFuel} onChange={setEndFuel} />
        <Text style={styles.label}>Part yang dibongkar (wajib saat submit)</Text>
        {parts.map((part, index) => (
          <View key={`part-${index}`} style={styles.partRow}>
            <View style={styles.partField}><Field label={`Part ${index + 1}`} value={part} onChangeText={(value) => setParts((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder="Nama part yang dibongkar" /></View>
            <TouchableOpacity style={styles.removePartButton} onPress={() => setParts((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityLabel={`Hapus part ${index + 1}`}>
              <X size={18} color={Colors.error} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.partRow}>
          <View style={styles.partField}><Field label="Tambah part" value={newPart} onChangeText={setNewPart} placeholder="Nama part yang dibongkar" /></View>
          <TouchableOpacity
            style={styles.addPartButton}
            onPress={() => {
              const part = newPart.trim();
              if (!part || part.length > 160 || parts.length >= 50) {
                Alert.alert('Part tidak valid', 'Nama part wajib diisi, maksimal 160 karakter, dan jumlah part maksimal 50.');
                return;
              }
              setParts((current) => [...current, part]);
              setNewPart('');
            }}
          >
            <Plus size={20} color={Colors.white} />
          </TouchableOpacity>
        </View>
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
            <Text style={styles.label}>Foto kerusakan (opsional, maksimal 5)</Text>
            <View style={styles.photoRow}>
              {damage.photos.map((photo) => (
                <View key={photo.id} style={styles.photoContainer}>
                  <Image source={{ uri: photo.url }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void removeDamagePhoto(index, photo.id, false); }} disabled={saving} accessibilityLabel="Hapus foto kerusakan">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {damage.newPhotos.map((photo) => (
                <View key={photo.id} style={styles.photoContainer}>
                  <Image source={{ uri: photo.preview }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void removeDamagePhoto(index, photo.id, true); }} disabled={saving} accessibilityLabel="Hapus foto kerusakan baru">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {damage.photos.length + damage.newPhotos.length < 5 ? (
                <TouchableOpacity style={styles.addPhotoButton} onPress={() => { void addDamagePhoto(index); }} disabled={saving}>
                  <ImagePlus size={21} color={Colors.primary} />
                  <Text style={styles.addPhotoText}>Tambah foto</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
        <View style={{ height: Spacing.md }} />
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
  helpText: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  summary: { marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, gap: Spacing.xs },
  summaryText: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 18 },
  readonlyDamage: { paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, marginBottom: Spacing.xs },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.md, backgroundColor: Colors.primary },
  addButtonText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: Colors.white },
  damageCard: { marginBottom: Spacing.md, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.white },
  damageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  damageTitle: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold, color: Colors.textPrimary },
  severityRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.sm },
  severityButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderLight },
  severityText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  activeSeverityText: { color: Colors.white },
  partRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs },
  partField: { flex: 1 },
  removePartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: '#FEE2E2' },
  addPartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.primary },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  photoContainer: { position: 'relative' },
  photoPreview: { width: 82, height: 82, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  removePhotoButton: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.error },
  addPhotoButton: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryLight },
  addPhotoText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.primary },
});
