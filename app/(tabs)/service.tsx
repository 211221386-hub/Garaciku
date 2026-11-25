import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert, Image } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { KeyRound, Plus, ChevronRight, RotateCcw, ImagePlus, X } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import { dateRangesOverlap, formatDate, formatCurrency } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { TimeField } from '@/components/TimeField';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import type { Car, DailyNote, DailyNoteReturnItineraryDetails, RentalStatus } from '@/lib/types';
import type { UnitAvailability } from '@/lib/api';
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

type InvestigationWithCar = DailyNote & { car_name: string };
type ReturnPhotoDraft = { id?: string; base64?: string; preview: string };
type ReturnListItem =
  | { kind: 'rental'; item: RentalWithCar }
  | { kind: 'investigation'; item: InvestigationWithCar };

type RentalAvailability = UnitAvailability;

const blockingStatuses = ['pending', 'active', 'approved', 'overdue', 'pending_approval', 'scheduled', 'tax_due'];

function hasRentalConflict(reservations: RentalAvailability[], carId: string, startDate: string, endDate: string) {
  return reservations.some((reservation) =>
    reservation.car_id === carId
    && (['under_maintenance', 'inactive'].includes(reservation.status)
      || (blockingStatuses.includes(reservation.status)
        && dateRangesOverlap(startDate, endDate, reservation.start_date, reservation.end_date ?? '9999-12-31')))
  );
}

function pickCompressedReturnPhoto(): Promise<ReturnPhotoDraft | null> {
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
  const [investigations, setInvestigations] = useState<InvestigationWithCar[]>([]);
  const [returnItineraries, setReturnItineraries] = useState<Record<string, DailyNoteReturnItineraryDetails | null>>({});
  const [itineraryLoadErrors, setItineraryLoadErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'borrowing' | 'return'>('borrowing');
  const [cars, setCars] = useState<Pick<Car, 'id' | 'name' | 'plate_number'>[]>([]);
  const [availabilityRentals, setAvailabilityRentals] = useState<RentalAvailability[]>([]);
  const [selectedCarIds, setSelectedCarIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [selectedInvestigation, setSelectedInvestigation] = useState<InvestigationWithCar | null>(null);
  const [itineraryDetails, setItineraryDetails] = useState<DailyNoteReturnItineraryDetails | null>(null);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [editingItineraryNote, setEditingItineraryNote] = useState<InvestigationWithCar | null>(null);
  const [endKmDraft, setEndKmDraft] = useState('');
  const [endFuelDraft, setEndFuelDraft] = useState('');
  const [partDrafts, setPartDrafts] = useState<string[]>([]);
  const [newPartDraft, setNewPartDraft] = useState('');
  const [newReturnPhotos, setNewReturnPhotos] = useState<ReturnPhotoDraft[]>([]);
  const [savingItinerary, setSavingItinerary] = useState(false);
  const [recordKind, setRecordKind] = useState<RecordKind>('rental');
  const [saving, setSaving] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [form, setForm] = useState({ car_id: '', start_date: '', start_time: '', end_date: '', end_time: '', purpose: '', notes: '' });
  const [renterContact, setRenterContact] = useState(() => ({
    name: getSession()?.user.full_name ?? '',
    email: getSession()?.user.email ?? '',
    phone: getSession()?.user.phone ?? '',
  }));
  const [duplicateForm, setDuplicateForm] = useState({
    section: '',
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    start_km: '',
    start_fuel: '',
    content: '',
    detail: '',
  });

  const fetchRentals = useCallback(async () => {
    setAvailabilityLoading(true);
    try {
      const [rentalData, carData, reservationData, investigationData] = await Promise.all([
        apiClient.rentals.getAll(),
        apiClient.cars.getAll(),
        apiClient.rentals.getAvailability(),
        apiClient.notes.getAll(),
      ]);
      setRentals(rentalData);
      setInvestigations(investigationData);
      setAvailabilityRentals(reservationData);
      const itineraryResults = await Promise.all(investigationData
        .filter((note) => note.status === 'active')
        .map(async (note) => {
          try {
            return { id: note.id, details: await apiClient.notes.getReturnItinerary(note.id), error: null };
          } catch (error) {
            console.error(`Gagal memuat itinerary Investigation ${note.id}.`, error);
            return { id: note.id, details: null, error: error instanceof Error ? error.message : 'Gagal memuat itinerary.' };
          }
        }));
      setReturnItineraries(Object.fromEntries(itineraryResults.map(({ id, details }) => [id, details])));
      setItineraryLoadErrors(Object.fromEntries(itineraryResults
        .filter((result) => result.error)
        .map(({ id, error }) => [id, error as string])));
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
  const pendingReturnCount = returnRentals.filter((rental) => ['approved', 'active', 'overdue'].includes(rental.status)).length
    + investigations.filter((note) => note.status === 'active').length;
  const displayedRecords: ReturnListItem[] = activeTab === 'return'
    ? [
      ...returnRentals.map((item) => ({ kind: 'rental' as const, item })),
      ...investigations
        .filter((note) => note.status === 'active' || note.status === 'completed')
        .map((item) => ({ kind: 'investigation' as const, item })),
    ].sort((first, second) => second.item.start_date.localeCompare(first.item.start_date))
    : borrowingRentals.map((item) => ({ kind: 'rental' as const, item }));
  const isAdmin = [1, 2].includes(getSession()?.user.role ?? 0);
  const userProfile = getSession()?.user;
  const profileEmail = userProfile?.email?.trim() ?? '';
  const profilePhone = userProfile?.phone?.trim() ?? '';
  const profileComplete = Boolean(
    userProfile?.full_name?.trim()
    && /^\S+@\S+\.\S+$/.test(profileEmail)
    && profilePhone.replace(/\D/g, '').length >= 7
  );
  const rentalContact = isAdmin
    ? { name: renterContact.name.trim(), email: renterContact.email.trim(), phone: renterContact.phone.trim() }
    : { name: userProfile?.full_name?.trim() ?? '', email: profileEmail, phone: profilePhone };
  const rentalContactComplete = Boolean(
    rentalContact.name
    && /^\S+@\S+\.\S+$/.test(rentalContact.email)
    && rentalContact.phone.replace(/\D/g, '').length >= 7
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
    setDuplicateForm({ section: '', start_date: '', start_time: '', end_date: '', end_time: '', start_km: '', start_fuel: '', content: '', detail: '' });
    setRecordKind('rental');
  };

  const addRecord = async () => {
    if (saving) return;
    if (hasOpenCycle) {
      Alert.alert('Siklus Transportation masih berjalan', 'Pengajuan Transportation atau Investigation tersedia setelah Admin mengonfirmasi semua unit sudah diterima.');
      return;
    }
    if (recordKind === 'duplicate' && !form.car_id) {
      Alert.alert('Pilih mobil terlebih dahulu', 'Pilih salah satu mobil sebelum menyimpan data.');
      return;
    }
    if (recordKind === 'rental' && selectedCarIds.length === 0) {
      Alert.alert('Pilih unit terlebih dahulu', 'Pilih minimal satu unit untuk siklus Transportation ini.');
      return;
    }

    if (recordKind === 'duplicate') {
      const recorderName = getSession()?.user.full_name?.trim() ?? '';
      if (!recorderName || !duplicateForm.section.trim() || !duplicateForm.start_date || !duplicateForm.start_time || !duplicateForm.end_date || !duplicateForm.end_time || !duplicateForm.start_km || !duplicateForm.start_fuel || !duplicateForm.content.trim()) {
        Alert.alert('Data belum lengkap', 'Isi semua field Investigation sebelum menyimpan.');
        return;
      }

      const startKm = Number(duplicateForm.start_km);
      const startFuel = Number(duplicateForm.start_fuel);
      if ([startKm, startFuel].some((value) => !Number.isInteger(value) || value < 0)) {
        Alert.alert('Angka tidak valid', 'KM awal dan fuel awal harus berupa bilangan bulat nol atau lebih.');
        return;
      }
      if (startFuel > 100) {
        Alert.alert('Persentase fuel tidak valid', 'Fuel awal harus berada di antara 0% dan 100%.');
        return;
      }
      if (duplicateForm.end_date < duplicateForm.start_date) {
        Alert.alert('Rentang tanggal tidak valid', 'Tanggal selesai harus sama atau setelah tanggal mulai.');
        return;
      }
      if (duplicateForm.end_date === duplicateForm.start_date && duplicateForm.end_time <= duplicateForm.start_time) {
        Alert.alert('Jadwal tidak valid', 'Jam selesai harus lebih lambat dari jam mulai.');
        return;
      }

      setSaving(true);
      try {
        const latestReservations = await apiClient.rentals.getAvailability();
        if (hasRentalConflict(latestReservations, form.car_id, duplicateForm.start_date, duplicateForm.end_date)) {
          throw new Error('Unit tidak tersedia pada rentang tanggal tersebut karena ada jadwal aktif atau sedang dalam perawatan.');
        }
        await apiClient.notes.create({
          car_id: form.car_id,
          section: duplicateForm.section.trim(),
          note_date: duplicateForm.start_date,
          start_date: duplicateForm.start_date,
          start_time: duplicateForm.start_time,
          end_date: duplicateForm.end_date,
          end_time: duplicateForm.end_time,
          start_km: startKm,
          end_km: null,
          start_fuel: startFuel,
          end_fuel: null,
          content: duplicateForm.content.trim(),
          detail: duplicateForm.detail.trim(),
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

    if (!rentalContactComplete) {
      Alert.alert('Data pemesan belum lengkap', isAdmin
        ? 'Isi nama, email yang valid, dan nomor telepon pemesan.'
        : 'Lengkapi nama lengkap, email, dan nomor telepon di Settings sebelum membuat Transportation.');
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
      await apiClient.rentals.createCycle({
        car_ids: selectedCarIds,
        ...(isAdmin ? {
          renter_name: rentalContact.name,
          renter_email: rentalContact.email,
          renter_phone: rentalContact.phone,
        } : {}),
        start_date: form.start_date || today,
        start_time: form.start_time,
        end_date: form.end_date || null,
        end_time: form.end_time || null,
        purpose: form.purpose.trim(),
        notes: form.notes.trim(),
      });
      resetFormState();
      setSheet(false);
      setSaving(false);
      void fetchRentals();
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

  const confirmInvestigationReturn = async (note: InvestigationWithCar) => {
    const itinerary = returnItineraries[note.id];
    if (!itinerary?.itinerary || itinerary.parts.length === 0) {
      Alert.alert('Itinerary belum lengkap', 'Pemesan harus mengirim KM akhir, fuel akhir, dan minimal satu part sebelum Admin mengonfirmasi pengembalian.');
      return;
    }
    if (returningId === note.id) return;
    setReturningId(note.id);
    try {
      await apiClient.notes.confirmReturn(note.id);
      await fetchRentals();
    } catch (error) {
      Alert.alert('Gagal mengonfirmasi pengembalian Investigation', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setReturningId(null);
    }
  };

  const loadItinerary = async (note: InvestigationWithCar, forceRefresh = false) => {
    const cached = returnItineraries[note.id];
    if (cached && !forceRefresh) {
      setItineraryDetails(cached);
      return cached;
    }
    setItineraryLoading(true);
    try {
      const details = await apiClient.notes.getReturnItinerary(note.id);
      setReturnItineraries((current) => ({ ...current, [note.id]: details }));
      setItineraryLoadErrors((current) => {
        const { [note.id]: _error, ...remaining } = current;
        return remaining;
      });
      setItineraryDetails(details);
      return details;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memuat itinerary pengembalian.';
      setItineraryLoadErrors((current) => ({ ...current, [note.id]: message }));
      Alert.alert('Gagal memuat itinerary', message);
      return null;
    } finally {
      setItineraryLoading(false);
    }
  };

  const openInvestigationDetails = (note: InvestigationWithCar) => {
    setSelectedInvestigation(note);
    setItineraryDetails(null);
    void loadItinerary(note, true);
  };

  const openItineraryEditor = async (note: InvestigationWithCar) => {
    if (note.status !== 'active' || note.created_by !== userProfile?.id) return;
    setEditingItineraryNote(note);
    setNewReturnPhotos([]);
    const details = await loadItinerary(note, true);
    if (!details) {
      setEditingItineraryNote(null);
      return;
    }
    setEndKmDraft(details.itinerary ? String(details.itinerary.end_km) : '');
    setEndFuelDraft(details.itinerary ? String(details.itinerary.end_fuel) : '');
    setPartDrafts(details.parts.map((part) => part.part_name));
    setNewPartDraft('');
  };

  const addReturnPhoto = async () => {
    if (!editingItineraryNote || (itineraryDetails?.photos.length ?? 0) + newReturnPhotos.length >= 5) {
      Alert.alert('Batas foto tercapai', 'Maksimal 5 foto untuk satu itinerary.');
      return;
    }
    try {
      const photo = await pickCompressedReturnPhoto();
      if (photo) setNewReturnPhotos((current) => [...current, photo]);
    } catch (error) {
      Alert.alert('Gagal memilih foto', error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses foto.');
    }
  };

  const deleteExistingReturnPhoto = async (photoId: string) => {
    if (!editingItineraryNote || savingItinerary) return;
    setSavingItinerary(true);
    try {
      await apiClient.notes.deleteReturnPhoto(editingItineraryNote.id, photoId);
      const details = await apiClient.notes.getReturnItinerary(editingItineraryNote.id);
      setItineraryDetails(details);
      setReturnItineraries((current) => ({ ...current, [editingItineraryNote.id]: details }));
    } catch (error) {
      Alert.alert('Gagal menghapus foto', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSavingItinerary(false);
    }
  };

  const saveInvestigationItinerary = async () => {
    if (!editingItineraryNote || savingItinerary) return;
    const endKm = Number(endKmDraft);
    const endFuel = Number(endFuelDraft);
    const parts = [...partDrafts, newPartDraft].map((part) => part.trim()).filter(Boolean);
    if (!Number.isInteger(endKm) || endKm < 0 || (editingItineraryNote.start_km !== null && endKm < editingItineraryNote.start_km)) {
      Alert.alert('KM akhir tidak valid', 'KM akhir harus berupa bilangan bulat dan tidak boleh kurang dari KM awal.');
      return;
    }
    if (!Number.isInteger(endFuel) || endFuel < 0 || endFuel > 100) {
      Alert.alert('Fuel akhir tidak valid', 'Fuel akhir harus berupa bilangan bulat antara 0 dan 100.');
      return;
    }
    if (parts.length === 0 || parts.length > 50 || parts.some((part) => part.length > 160)) {
      Alert.alert('Daftar part tidak valid', 'Isi minimal satu part yang dibongkar. Maksimal 50 part dan 160 karakter per part.');
      return;
    }

    setSavingItinerary(true);
    const uploadedPhotoIds: string[] = [];
    try {
      for (const photo of newReturnPhotos) {
        if (!photo.base64) throw new Error('Data foto tidak valid. Pilih ulang foto tersebut.');
        const uploaded = await apiClient.notes.uploadReturnPhoto(editingItineraryNote.id, photo.base64);
        uploadedPhotoIds.push(uploaded.id);
      }
      await apiClient.notes.saveReturnItinerary(editingItineraryNote.id, endKm, endFuel, parts);
      const details = await apiClient.notes.getReturnItinerary(editingItineraryNote.id);
      setItineraryDetails(details);
      setReturnItineraries((current) => ({ ...current, [editingItineraryNote.id]: details }));
      setItineraryLoadErrors((current) => {
        const { [editingItineraryNote.id]: _error, ...remaining } = current;
        return remaining;
      });
      setNewReturnPhotos([]);
      setEditingItineraryNote(null);
      Alert.alert('Itinerary tersimpan', 'Itinerary pengembalian Investigation berhasil disimpan.');
      await fetchRentals();
    } catch (error) {
      const cleanupErrors: string[] = [];
      for (const photoId of uploadedPhotoIds) {
        try {
          await apiClient.notes.deleteReturnPhoto(editingItineraryNote.id, photoId);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : 'Gagal membersihkan foto yang sudah terunggah.');
        }
      }
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
      Alert.alert('Gagal menyimpan itinerary', cleanupErrors.length
        ? `${message}\n\nSebagian foto sementara tidak dapat dibersihkan: ${cleanupErrors.join('; ')}`
        : message);
    } finally {
      setSavingItinerary(false);
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
      <FlatList data={displayedRecords} keyExtractor={(entry) => `${entry.kind}-${entry.item.id}`} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRentals(); }} colors={[Colors.primary]} />}
        renderItem={({ item: entry }) => {
          if (entry.kind === 'investigation') {
            const note = entry.item;
            const returned = note.status === 'completed';
            const itinerary = returnItineraries[note.id];
            const itineraryReady = Boolean(itinerary?.itinerary && itinerary.parts.length > 0);
            const canSubmitItinerary = !returned && note.created_by === userProfile?.id;
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => openInvestigationDetails(note)}
              >
                <View style={styles.rentalIcon}><RotateCcw size={16} color={Colors.primary} strokeWidth={2.2} /></View>
                <View style={styles.cardBody}>
                  <View style={styles.recordTypeBadge}><Text style={styles.recordTypeBadgeText}>Investigation</Text></View>
                  <Text style={styles.renterName} numberOfLines={1}>{note.created_name}</Text>
                  <Text style={styles.carName} numberOfLines={1}>{note.car_name || 'Mobil tidak diketahui'}</Text>
                  <View style={styles.metaRow}><Text style={styles.metaText}>{formatDate(note.start_date)} {note.start_time || ''} - {formatDate(note.end_date)} {note.end_time || ''}</Text></View>
                  <Text style={styles.metaText}>Aktivitas: {note.content || note.section}</Text>
                  <View style={[styles.statusPill, { backgroundColor: returned ? Colors.surfaceAlt : Colors.primaryLight }]}>
                    <Text style={[styles.statusText, { color: returned ? Colors.textSecondary : Colors.primary }]}>{returned ? 'Selesai' : 'Menunggu pengembalian'}</Text>
                  </View>
                  {!returned ? <Text style={styles.metaText}>
                    Itinerary: {!note.created_by ? 'pemilik belum teridentifikasi' : itineraryLoadErrors[note.id] ? 'gagal dimuat' : itineraryReady ? 'sudah dikirim' : 'belum dikirim'}
                  </Text> : null}
                  {activeTab === 'return' && canSubmitItinerary ? (
                    <Button
                      label={itineraryReady ? 'Ubah itinerary pengembalian' : 'Isi itinerary pengembalian'}
                      style={styles.cardActionButton}
                      onPress={() => { void openItineraryEditor(note); }}
                    />
                  ) : null}
                  {activeTab === 'return' && isAdmin && !returned ? (
                    <TouchableOpacity
                      style={[styles.returnButton, (!itineraryReady || returningId === note.id) && styles.actionDisabled]}
                      onPress={() => { void confirmInvestigationReturn(note); }}
                      disabled={!itineraryReady || returningId === note.id}
                    >
                      <Text style={styles.returnButtonText}>
                        {returningId === note.id ? 'Memproses...' : itineraryReady ? 'Unit sudah diterima' : note.created_by ? 'Menunggu itinerary' : 'Perlu identifikasi pemilik'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.2} />
              </TouchableOpacity>
            );
          }
          const item = entry.item;
          const st = statusConfig[item.status] ?? statusConfig.active;
          const cycleUnitCount = rentals.filter((rental) => rental.cycle_id === item.cycle_id).length;
          return (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/car/rental/${item.id}` as never)} activeOpacity={0.85}>
            <View style={styles.rentalIcon}><KeyRound size={16} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={styles.cardBody}>
              <View style={styles.recordTypeBadge}><Text style={styles.recordTypeBadgeText}>Transportation</Text></View>
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
      <Sheet
        visible={selectedInvestigation !== null}
        onClose={() => setSelectedInvestigation(null)}
        title="Detail Investigation"
      >
        {selectedInvestigation ? (
          <>
            <View style={styles.detailTypeBadge}><Text style={styles.detailTypeBadgeText}>Investigation</Text></View>
            <ReturnDetailRow label="Pemesan" value={selectedInvestigation.created_name || '-'} />
            <ReturnDetailRow label="Kendaraan" value={selectedInvestigation.car_name || 'Mobil tidak diketahui'} />
            <ReturnDetailRow label="Periode" value={`${formatDate(selectedInvestigation.start_date)} ${selectedInvestigation.start_time || ''} - ${formatDate(selectedInvestigation.end_date)} ${selectedInvestigation.end_time || ''}`} />
            <ReturnDetailRow label="Bagian" value={selectedInvestigation.section || '-'} />
            <ReturnDetailRow label="Aktivitas" value={selectedInvestigation.content || '-'} />
            <ReturnDetailRow label="Detail" value={selectedInvestigation.detail || '-'} />
            <ReturnDetailRow label="KM awal" value={String(selectedInvestigation.start_km ?? '-')} />
            <ReturnDetailRow label="Fuel awal" value={`${selectedInvestigation.start_fuel ?? '-'}%`} />
            <ReturnDetailRow
              label="Status itinerary"
              value={itineraryLoading ? 'Memuat...' : itineraryLoadErrors[selectedInvestigation.id]
                ? 'Gagal dimuat'
                : itineraryDetails?.itinerary
                  ? 'Sudah dikirim'
                  : !selectedInvestigation.created_by
                    ? 'Pemilik belum teridentifikasi'
                  : selectedInvestigation.status === 'completed'
                    ? 'Selesai sebelum itinerary diwajibkan'
                    : 'Belum dikirim'}
            />
            {itineraryDetails?.itinerary ? (
              <>
                <ReturnDetailRow label="KM akhir" value={String(itineraryDetails.itinerary.end_km)} />
                <ReturnDetailRow label="Fuel akhir" value={`${itineraryDetails.itinerary.end_fuel}%`} />
                <Text style={styles.detailLabel}>Part yang dibongkar</Text>
                {itineraryDetails.parts.map((part) => <Text key={part.id} style={styles.partReadOnly}>• {part.part_name}</Text>)}
                <Text style={styles.detailLabel}>Foto part</Text>
                {itineraryDetails.photos.length ? (
                  <View style={styles.photoRow}>
                    {itineraryDetails.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.url }} style={styles.photoPreview} />)}
                  </View>
                ) : <Text style={styles.metaText}>Tidak ada foto.</Text>}
              </>
            ) : selectedInvestigation.status === 'completed' && (selectedInvestigation.end_km !== null || selectedInvestigation.end_fuel !== null) ? (
              <>
                <ReturnDetailRow label="KM akhir (data lama)" value={String(selectedInvestigation.end_km ?? '-')} />
                <ReturnDetailRow label="Fuel akhir (data lama)" value={`${selectedInvestigation.end_fuel ?? '-'}%`} />
              </>
            ) : null}
            <ReturnDetailRow label="Status pengembalian" value={selectedInvestigation.status === 'completed' ? 'Selesai' : 'Menunggu pengembalian'} />
          </>
        ) : null}
      </Sheet>
      <Sheet
        visible={editingItineraryNote !== null}
        onClose={() => {
          if (savingItinerary) return;
          setEditingItineraryNote(null);
          setNewReturnPhotos([]);
        }}
        title="Itinerary Pengembalian"
      >
        {editingItineraryNote ? (
          <>
            <Text style={styles.cycleNoticeText}>Isi KM akhir, fuel akhir, dan minimal satu part yang dibongkar. Foto bersifat opsional dan itinerary masih dapat diubah sampai Admin mengonfirmasi penerimaan unit.</Text>
            <Field label="Kilometer Akhir*" value={endKmDraft} onChangeText={setEndKmDraft} placeholder="Contoh: 12150" keyboardType="numeric" />
            <Field label="Fuel Akhir (%) *" value={endFuelDraft} onChangeText={setEndFuelDraft} placeholder="0-100" keyboardType="numeric" />
            <Text style={styles.label}>Part yang dibongkar*</Text>
            {partDrafts.map((part, index) => (
              <View key={`part-${index}`} style={styles.partRow}>
                <View style={styles.partField}><Field label={`Part ${index + 1}`} value={part} onChangeText={(value) => setPartDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder="Nama part yang dibongkar" /></View>
                <TouchableOpacity style={styles.removePartButton} onPress={() => setPartDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityLabel={`Hapus part ${index + 1}`}>
                  <X size={18} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.partRow}>
              <View style={styles.partField}><Field label="Tambah part" value={newPartDraft} onChangeText={setNewPartDraft} placeholder="Nama part yang dibongkar" /></View>
              <TouchableOpacity
                style={styles.addPartButton}
                onPress={() => {
                  const part = newPartDraft.trim();
                  if (!part || part.length > 160 || partDrafts.length >= 50) {
                    Alert.alert('Part tidak valid', 'Nama part wajib diisi, maksimal 160 karakter, dan jumlah part maksimal 50.');
                    return;
                  }
                  setPartDrafts((current) => [...current, part]);
                  setNewPartDraft('');
                }}
              >
                <Plus size={20} color={Colors.white} />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Foto part (opsional, maksimal 5)</Text>
            <View style={styles.photoRow}>
              {itineraryDetails?.photos.map((photo) => (
                <View key={photo.id} style={styles.photoContainer}>
                  <Image source={{ uri: photo.url }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => { void deleteExistingReturnPhoto(photo.id); }} disabled={savingItinerary} accessibilityLabel="Hapus foto">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {newReturnPhotos.map((photo, index) => (
                <View key={`new-photo-${index}`} style={styles.photoContainer}>
                  <Image source={{ uri: photo.preview }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => setNewReturnPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityLabel="Hapus foto baru">
                    <X size={14} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {(itineraryDetails?.photos.length ?? 0) + newReturnPhotos.length < 5 ? (
                <TouchableOpacity style={styles.addPhotoButton} onPress={() => { void addReturnPhoto(); }} disabled={savingItinerary}>
                  <ImagePlus size={22} color={Colors.primary} />
                  <Text style={styles.addPhotoText}>Tambah foto</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={{ height: Spacing.md }} />
            <Button label="Simpan itinerary" onPress={() => { void saveInvestigationItinerary(); }} loading={savingItinerary} disabled={itineraryLoading || savingItinerary} />
          </>
        ) : null}
      </Sheet>
      <Sheet visible={sheet} onClose={() => { setSheet(false); resetFormState(); }} title="Tambah Transportation/Investigation">
        {hasOpenCycle ? <Text style={styles.cycleNoticeText}>Siklus Transportation masih berjalan. Pengajuan baru tersedia setelah Admin mengonfirmasi semua unit sudah diterima.</Text> : null}
        <Text style={styles.label}>Jenis transaksi</Text>
        <View style={styles.recordTypeRow}>
          <TouchableOpacity disabled={hasOpenCycle} style={[styles.recordType, recordKind === 'rental' && styles.recordTypeActive, hasOpenCycle && styles.actionDisabled]} onPress={() => { setRecordKind('rental'); setSelectedCarIds([]); setForm((current) => ({ ...current, car_id: '' })); }}>
            <Text style={[styles.recordTypeText, recordKind === 'rental' && styles.recordTypeTextActive]}>Transportation</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={hasOpenCycle} style={[styles.recordType, recordKind === 'duplicate' && styles.recordTypeActive, hasOpenCycle && styles.actionDisabled]} onPress={() => { setRecordKind('duplicate'); setSelectedCarIds([]); setForm((current) => ({ ...current, car_id: '' })); }}>
            <Text style={[styles.recordTypeText, recordKind === 'duplicate' && styles.recordTypeTextActive]}>Investigation</Text>
          </TouchableOpacity>
        </View>

        {!selectedRangeValid ? <Text style={styles.availabilityMessage}>Pilih tanggal mulai dan selesai terlebih dahulu untuk melihat unit yang tersedia.</Text> : null}

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
        ) : null}

        {recordKind === 'rental' ? (
          <>
            {isAdmin ? (
              <>
                <Field label="Nama Pemesan*" value={renterContact.name} onChangeText={(value) => setRenterContact((current) => ({ ...current, name: value }))} placeholder="Nama lengkap pemesan" />
                <Field label="Email Pemesan*" value={renterContact.email} onChangeText={(value) => setRenterContact((current) => ({ ...current, email: value }))} placeholder="nama@email.com" keyboardType="email-address" />
                <Field label="Nomor Telepon Pemesan*" value={renterContact.phone} onChangeText={(value) => setRenterContact((current) => ({ ...current, phone: value }))} placeholder="08xxxxxxxxxx" keyboardType="phone-pad" />
                <Text style={styles.availabilityMessage}>Transportation Role 1/2 langsung disetujui setelah disimpan.</Text>
              </>
            ) : !profileComplete ? <Text style={styles.profileWarning}>Lengkapi nama, email, dan nomor telepon di Settings sebelum menyimpan Transportation.</Text> : null}
            <TimeField label="Jam Mulai (WIB)" value={form.start_time} onChange={(value) => setForm({ ...form, start_time: value })} />
            <TimeField label="Jam Selesai (WIB)" value={form.end_time} onChange={(value) => setForm({ ...form, end_time: value })} />
            <Field label="Tujuan Transportation" value={form.purpose} onChangeText={(t) => setForm({ ...form, purpose: t })} placeholder="Contoh: Perjalanan dinas, liburan keluarga" />
            <Field label="Detail Activity" value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} placeholder="Genba ke supplier..." multiline />
          </>
        ) : (
          <>
            <Field label="Bagian*" value={duplicateForm.section} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, section: t })} placeholder="Contoh: Maintenance / Ops" />
            <TimeField label="Jam Mulai (WIB)*" value={duplicateForm.start_time} onChange={(value) => setDuplicateForm({ ...duplicateForm, start_time: value })} />
            <TimeField label="Jam Selesai (WIB)*" value={duplicateForm.end_time} onChange={(value) => setDuplicateForm({ ...duplicateForm, end_time: value })} />
            <Field label="KM Awal*" value={duplicateForm.start_km} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, start_km: t })} placeholder="Contoh: 12000" keyboardType="numeric" />
            <Field label="Fuel Awal*" value={duplicateForm.start_fuel} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, start_fuel: t })} placeholder="0-100" keyboardType="numeric" />
            <Field label="Aktivitas*" value={duplicateForm.content} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, content: t })} placeholder="Aktivitas yang dilakukan..." multiline />
            <Field label="Detail" value={duplicateForm.detail} onChangeText={(t) => setDuplicateForm({ ...duplicateForm, detail: t })} placeholder="Detail atau keterangan tambahan..." multiline />
          </>
        )}

        <View style={{ height: Spacing.sm }} />
        <Button label={recordKind === 'rental' ? 'Simpan Transportation' : 'Simpan Investigation'} onPress={addRecord} loading={saving} disabled={hasOpenCycle || !selectedCarAvailable || (recordKind === 'rental' ? !rentalContactComplete || !form.start_time || !form.end_time : !userProfile?.full_name?.trim() || !duplicateForm.section.trim() || !duplicateForm.start_time || !duplicateForm.end_time || !duplicateForm.start_km || !duplicateForm.start_fuel || !duplicateForm.content.trim())} />
      </Sheet>
    </View>
  );
}

function ReturnDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
  profileWarning: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.error, marginBottom: Spacing.sm },
  carChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceAlt },
  carChipActive: { backgroundColor: Colors.primary },
  carChipText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  carChipTextActive: { color: Colors.white },
  recordTypeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  recordType: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.borderLight, alignItems: 'center' },
  recordTypeActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primarySoft },
  recordTypeText: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary },
  recordTypeTextActive: { color: Colors.primary, fontFamily: Typography.fontSemiBold },
  recordTypeBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: Colors.primaryLight, marginBottom: Spacing.xs },
  recordTypeBadgeText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: Colors.primary },
  cardActionButton: { height: 42, marginTop: Spacing.sm },
  detailTypeBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.pill, backgroundColor: Colors.primaryLight, marginBottom: Spacing.md },
  detailTypeBadgeText: { fontSize: Typography.sm, fontFamily: Typography.fontSemiBold, color: Colors.primary },
  detailRow: { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  detailLabel: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: 2 },
  detailValue: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textPrimary, lineHeight: 20 },
  partRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs },
  partField: { flex: 1 },
  removePartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: '#FEE2E2' },
  addPartButton: { width: 40, height: 40, marginBottom: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.primary },
  partReadOnly: { paddingVertical: 3, fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textPrimary },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  photoContainer: { position: 'relative' },
  photoPreview: { width: 88, height: 88, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  removePhotoButton: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.error },
  addPhotoButton: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryLight },
  addPhotoText: { fontSize: Typography.xs, fontFamily: Typography.fontMedium, color: Colors.primary },
});
