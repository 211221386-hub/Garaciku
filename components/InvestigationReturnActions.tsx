import { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ImagePlus, Plus, X } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { apiClient } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { DailyNote, DailyNoteReturnItineraryDetails } from '@/lib/types';

type Props = {
  note: DailyNote;
  isAdmin: boolean;
  onUpdated: () => void | Promise<void>;
};

type PhotoDraft = { base64: string; preview: string };

function pickCompressedPhoto(): Promise<PhotoDraft | null> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Pilih foto hanya tersedia melalui browser.'));
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca gambar.'));
      reader.onload = () => {
        const image = new window.Image();
        image.onerror = () => reject(new Error('File yang dipilih bukan gambar yang valid.'));
        image.onload = () => {
          const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) return reject(new Error('Browser tidak dapat memproses gambar.'));
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Gagal mengompres gambar.'));
            if (blob.size > 2 * 1024 * 1024) return reject(new Error('Ukuran gambar setelah kompresi masih lebih dari 2 MB.'));
            const compressedReader = new FileReader();
            compressedReader.onerror = () => reject(new Error('Gagal menyiapkan gambar.'));
            compressedReader.onload = () => {
              const preview = String(compressedReader.result ?? '');
              resolve({ base64: preview.split(',')[1] ?? '', preview });
            };
            compressedReader.readAsDataURL(blob);
          }, 'image/jpeg', 0.78);
        };
        image.src = String(reader.result ?? '');
      };
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function InvestigationReturnActions({ note, isAdmin, onUpdated }: Props) {
  const [details, setDetails] = useState<DailyNoteReturnItineraryDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [endKm, setEndKm] = useState('');
  const [endFuel, setEndFuel] = useState('');
  const [parts, setParts] = useState<string[]>([]);
  const [newPart, setNewPart] = useState('');
  const [newPhotos, setNewPhotos] = useState<PhotoDraft[]>([]);
  const userId = getSession()?.user.id;
  const itineraryReady = Boolean(details?.itinerary && details.parts.length > 0);

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
    setEndKm(details?.itinerary ? String(details.itinerary.end_km) : '');
    setEndFuel(details?.itinerary ? String(details.itinerary.end_fuel) : '');
    setParts(details?.parts.map((part) => part.part_name) ?? []);
    setNewPart('');
    setNewPhotos([]);
    setEditing(true);
  };

  const confirmReturn = async () => {
    if (!itineraryReady) {
      Alert.alert('Itinerary belum lengkap', 'Pemesan harus mengirim KM akhir, fuel akhir, dan minimal satu part sebelum Admin mengonfirmasi pengembalian.');
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

  const deletePhoto = async (photoId: string) => {
    setSaving(true);
    try {
      await apiClient.notes.deleteReturnPhoto(note.id, photoId);
      await refreshDetails();
    } catch (error) {
      Alert.alert('Gagal menghapus foto', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  const saveItinerary = async () => {
    if (saving) return;
    const endKmValue = Number(endKm);
    const endFuelValue = Number(endFuel);
    const allParts = [...parts, newPart].map((part) => part.trim()).filter(Boolean);
    if (!Number.isInteger(endKmValue) || endKmValue < 0 || (note.start_km !== null && endKmValue < note.start_km)) {
      Alert.alert('KM akhir tidak valid', 'KM akhir harus berupa bilangan bulat dan tidak boleh kurang dari KM awal.');
      return;
    }
    if (!Number.isInteger(endFuelValue) || endFuelValue < 0 || endFuelValue > 100) {
      Alert.alert('Fuel akhir tidak valid', 'Fuel akhir harus berupa bilangan bulat antara 0 dan 100.');
      return;
    }
    if (allParts.length === 0 || allParts.length > 50 || allParts.some((part) => part.length > 160)) {
      Alert.alert('Daftar part tidak valid', 'Isi minimal satu part yang dibongkar. Maksimal 50 part dan 160 karakter per part.');
      return;
    }

    setSaving(true);
    const uploadedPhotoIds: string[] = [];
    try {
      for (const photo of newPhotos) {
        if (!photo.base64) throw new Error('Data foto tidak valid. Pilih ulang foto tersebut.');
        const uploaded = await apiClient.notes.uploadReturnPhoto(note.id, photo.base64);
        uploadedPhotoIds.push(uploaded.id);
      }
      await apiClient.notes.saveReturnItinerary(note.id, endKmValue, endFuelValue, allParts);
      uploadedPhotoIds.length = 0;
      try {
        await refreshDetails();
      } catch {
        setLoadError(true);
      }
      setNewPhotos([]);
      setEditing(false);
      Alert.alert('Itinerary tersimpan', 'Itinerary pengembalian Investigation berhasil disimpan.');
      await onUpdated();
    } catch (error) {
      const cleanupErrors: string[] = [];
      for (const photoId of uploadedPhotoIds) {
        try {
          await apiClient.notes.deleteReturnPhoto(note.id, photoId);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : 'Gagal membersihkan foto yang sudah terunggah.');
        }
      }
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
      Alert.alert('Gagal menyimpan itinerary', cleanupErrors.length
        ? `${message}\n\nSebagian foto sementara tidak dapat dibersihkan: ${cleanupErrors.join('; ')}`
        : message);
    } finally {
      setSaving(false);
    }
  };

  const addPhoto = async () => {
    if ((details?.photos.length ?? 0) + newPhotos.length >= 5) {
      Alert.alert('Batas foto tercapai', 'Maksimal 5 foto untuk satu itinerary.');
      return;
    }
    try {
      const photo = await pickCompressedPhoto();
      if (photo) setNewPhotos((current) => [...current, photo]);
    } catch (error) {
      Alert.alert('Gagal memilih foto', error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses foto.');
    }
  };

  return (
    <>
      <Text style={styles.status}>Itinerary: {loading ? 'Memuat...' : loadError ? 'gagal dimuat' : itineraryReady ? 'sudah dikirim' : 'belum dikirim'}</Text>
      {loadError ? <Button label="Coba muat ulang itinerary" style={styles.button} onPress={() => { void retryLoad(); }} loading={loading} disabled={loading} /> : null}
      {note.created_by === userId ? (
        <Button
          label={itineraryReady ? 'Ubah itinerary pengembalian' : 'Isi itinerary pengembalian'}
          style={styles.button}
          onPress={openEditor}
          disabled={loading || loadError || saving}
        />
      ) : null}
      {isAdmin ? (
        <Button
          label={saving ? 'Memproses...' : !note.created_by ? 'Perlu identifikasi pemilik' : loadError ? 'Itinerary gagal dimuat' : itineraryReady ? 'Unit sudah diterima' : 'Menunggu itinerary'}
          style={styles.button}
          onPress={() => { void confirmReturn(); }}
          loading={saving}
          disabled={!itineraryReady || loading || loadError || saving}
        />
      ) : null}
      <Sheet
        visible={editing}
        onClose={() => {
          if (saving) return;
          setEditing(false);
          setNewPhotos([]);
        }}
        title="Itinerary Pengembalian"
      >
        <Text style={styles.helpText}>Isi KM akhir, fuel akhir, dan minimal satu part yang dibongkar. Foto bersifat opsional dan itinerary masih dapat diubah sampai Admin mengonfirmasi penerimaan unit.</Text>
        <Field label="Kilometer Akhir*" value={endKm} onChangeText={setEndKm} placeholder="Contoh: 12150" keyboardType="numeric" />
        <Field label="Fuel Akhir (%) *" value={endFuel} onChangeText={setEndFuel} placeholder="0-100" keyboardType="numeric" />
        <Text style={styles.label}>Part yang dibongkar*</Text>
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
        <Text style={styles.label}>Foto part (opsional, maksimal 5)</Text>
        <View style={styles.photoRow}>
          {details?.photos.map((photo) => (
            <View key={photo.id} style={styles.photoContainer}>
              <Image source={{ uri: photo.url }} style={styles.photoPreview} />
              <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void deletePhoto(photo.id); }} disabled={saving} accessibilityLabel="Hapus foto">
                <X size={14} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ))}
          {newPhotos.map((photo, index) => (
            <View key={`new-photo-${index}`} style={styles.photoContainer}>
              <Image source={{ uri: photo.preview }} style={styles.photoPreview} />
              <TouchableOpacity style={styles.removePhotoButton} onPress={() => setNewPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityLabel="Hapus foto baru">
                <X size={14} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ))}
          {(details?.photos.length ?? 0) + newPhotos.length < 5 ? (
            <TouchableOpacity style={styles.addPhotoButton} onPress={() => { void addPhoto(); }} disabled={saving}>
              <ImagePlus size={22} color={Colors.primary} />
              <Text style={styles.addPhotoText}>Tambah foto</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={{ height: Spacing.md }} />
        <Button label="Simpan itinerary" onPress={() => { void saveItinerary(); }} loading={saving} disabled={loading || saving} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: Typography.xs, fontFamily: Typography.fontRegular, color: Colors.textSecondary, marginTop: Spacing.xs },
  button: { height: 42, marginTop: Spacing.sm },
  helpText: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  partRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs },
  partField: { flex: 1 },
  removePartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: '#FEE2E2' },
  addPartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.primary },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  photoContainer: { position: 'relative' },
  photoPreview: { width: 88, height: 88, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  removePhotoButton: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.error },
  addPhotoButton: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryLight },
  addPhotoText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.primary },
});
