import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import {
  ChevronLeft,
  Pencil,
  Trash2,
  NotebookPen,
  ClipboardCheck,
  AlertTriangle,
  KeyRound,
  Plus,
  Check,
  ListChecks,
  ImagePlus,
  X,
} from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import type { Car, DailyNote, CompletenessItem, Damage, RentalRecord, RentalStatus, DamageSeverity, DamageStatus, CompletenessReminderType, VehicleInspection, VehicleInspectionItem } from '@/lib/types';
import { differenceInCalendarDays, formatDate, formatShortDate, formatCurrency, todayISO } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/Button';
import { getSession } from '@/lib/auth';

type Tab = 'notes' | 'completeness' | 'damages' | 'rental' | 'checking';
type InspectionPhotoDraft = { base64: string; preview: string; contentType: string; localId: string };
type InspectionItemDraft = Pick<VehicleInspectionItem, 'id' | 'category' | 'item_name' | 'sort_order' | 'result' | 'remark' | 'responsible'> & { photos: InspectionPhotoDraft[] };

const inspectionChecklist = [
  { category: 'Engine Room', items: ['Hose & Wire', 'Master Brake', 'Washer Tank', 'Cover Engine', 'Oil Engine', 'Air Radiator', 'Air Cleaner', 'Battery'] },
  { category: 'Body & Tire', items: ['Fr Side', 'Rh Side', 'Outer Mirror Rh', 'Tire Fr Rh & Fr Rr', 'Spare Wheel Carrier', 'Lh Side', 'Tire Lh Fr & Rr', 'Outer Mirror Lh'] },
  { category: 'Cabin', items: ['Headlining & Assis Grip', 'Seat', 'Seat Belt', 'Tool Set'] },
  { category: 'Electrical', items: ['Electrical'] },
  { category: 'Others', items: ['Others'] },
];

function makeInspectionDraft(): InspectionItemDraft[] {
  let sortOrder = 0;
  return inspectionChecklist.flatMap(({ category, items }) => items.map((item_name) => ({
    id: crypto.randomUUID(), category, item_name, result: null, remark: '', responsible: '', sort_order: sortOrder++, photos: [],
  })));
}

function pickCompressedInspectionPhoto(): Promise<InspectionPhotoDraft | null> {
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
          const maxDimension = 1440;
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
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
              resolve({ base64: preview.split(',')[1] ?? '', preview, contentType: 'image/jpeg', localId: crypto.randomUUID() });
            };
            compressedReader.readAsDataURL(blob);
          }, 'image/jpeg', 0.78);
        };
        image.src = String(reader.result ?? '');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export default function CarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionUser = getSession()?.user;
  const sessionRole = sessionUser?.role ?? 0;
  const profileEmail = sessionUser?.email?.trim() ?? '';
  const profilePhone = sessionUser?.phone?.trim() ?? '';
  const profileComplete = Boolean(sessionUser?.full_name?.trim()
    && /^\S+@\S+\.\S+$/.test(profileEmail)
    && profilePhone.replace(/\D/g, '').length >= 7);
  const canManageCar = [1, 2].includes(sessionRole);
  const isSuperAdmin = sessionRole === 1;
  const canManageRental = isSuperAdmin;
  const canDeleteRental = [1, 2].includes(sessionRole);
  const canUpdateNotes = isSuperAdmin;
  const canDeleteNotes = [1, 2].includes(sessionRole);
  const canCreateDamages = [1, 2, 3, 4].includes(sessionRole);
  const canDeleteDamages = isSuperAdmin;
  const canUpdateDamages = [1, 2].includes(sessionRole);
  const canCreateCompleteness = [1, 2].includes(sessionRole);
  const canUpdateCompleteness = [1, 2].includes(sessionRole);
  const canDeleteCompleteness = [1, 2].includes(sessionRole);
  const [car, setCar] = useState<Car | null>(null);
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [completeness, setCompleteness] = useState<CompletenessItem[]>([]);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [rentals, setRentals] = useState<RentalRecord[]>([]);
  const [inspections, setInspections] = useState<VehicleInspection[]>([]);
  const [inspectionDraft, setInspectionDraft] = useState<InspectionItemDraft[]>([]);
  const [inspectionDate, setInspectionDate] = useState(todayISO());
  const [inspectionMileage, setInspectionMileage] = useState('');
  const [creatingInspection, setCreatingInspection] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<VehicleInspection | null>(null);
  const [selectedInspectionItems, setSelectedInspectionItems] = useState<VehicleInspectionItem[]>([]);
  const [inspectionPhotos, setInspectionPhotos] = useState<Record<string, { path: string; url?: string; preview?: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('notes');

  // Sheet state
  const [noteSheet, setNoteSheet] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState({ name: '', section: '', start_date: '', end_date: '', start_km: '', end_km: '', start_fuel: '', end_fuel: '', content: '' });
  const [completenessSheet, setCompletenessSheet] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [newReminderType, setNewReminderType] = useState<CompletenessReminderType>('general');
  const [newReminderDueDate, setNewReminderDueDate] = useState('');
  const [newGeneralPresent, setNewGeneralPresent] = useState(true);
  const [damageSheet, setDamageSheet] = useState(false);
  const [newDamage, setNewDamage] = useState({ description: '', severity: 'low' as DamageSeverity });
  const [rentalSheet, setRentalSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newRental, setNewRental] = useState({
    start_date: '',
    end_date: '',
    purpose: '',
    notes: '',
  });

  const fetchAll = useCallback(async () => {
    try {
      const isRestrictedRole = ![1, 2].includes(getSession()?.user.role ?? 4);
      if (isRestrictedRole && (await apiClient.rentals.getCurrentlyRentedCarIds()).includes(id)) {
        Alert.alert('Mobil sedang digunakan', 'Mobil ini sudah di-booking dan tidak tersedia untuk saat ini.');
        router.replace('/(tabs)');
        return;
      }
      const [carData, notesData, compData, dmgData, rentalData, inspectionData] = await Promise.all([
        apiClient.cars.getById(id),
        apiClient.notes.getByCar(id),
        apiClient.completeness.getByCar(id),
        apiClient.damages.getByCar(id),
        apiClient.rentals.getByCar(id),
        [1, 2].includes(getSession()?.user.role ?? 0) ? apiClient.inspections.getByCar(id) : Promise.resolve([] as VehicleInspection[]),
      ]);
      setCar(carData);
      setNotes(notesData);
      setCompleteness(compData);
      setDamages(dmgData);
      setRentals(rentalData);
      setInspections(inspectionData);
    } catch (error) {
      console.error('Error fetching car details:', error);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  const openInspection = async (inspection: VehicleInspection) => {
    if (selectedInspection?.id === inspection.id) {
      setSelectedInspection(null);
      setSelectedInspectionItems([]);
      setInspectionPhotos({});
      return;
    }
    try {
      const items = await apiClient.inspections.getItems(inspection.id);
      const photos = await apiClient.inspections.getPhotos(items.map((item) => item.id));
      const signedPhotos = await apiClient.inspections.getSignedPhotos(photos.map((photo) => photo.object_path));
      const signedByPath = new Map(signedPhotos.map((photo) => [photo.object_path, photo.url]));
      const photosByItem = photos.reduce<Record<string, { path: string; url?: string }[]>>((result, photo) => {
        result[photo.item_id] ??= [];
        result[photo.item_id].push({ path: photo.object_path, url: signedByPath.get(photo.object_path) });
        return result;
      }, {});
      setSelectedInspection(inspection);
      setSelectedInspectionItems(items);
      setInspectionPhotos(photosByItem);
    } catch (error) {
      Alert.alert('Gagal membuka riwayat pengecekan', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    }
  };

  const addInspection = async () => {
    if (submitting) return;
    if (sessionRole !== 2) {
      Alert.alert('Akses ditolak', 'Role 2 yang mengisi Checked / Prepared dan mengirim pengecekan ke Role 1.');
      return;
    }
    const mileage = Number(inspectionMileage);
    if (!inspectionDate || !inspectionMileage || !Number.isInteger(mileage) || mileage < 0) {
      Alert.alert('Data belum lengkap', 'Isi tanggal pengecekan dan kilometer dengan angka nol atau lebih.');
      return;
    }
    const incomplete = inspectionDraft.find((item) => !item.result || (item.result === 'ng' && !item.remark.trim()));
    if (incomplete) {
      Alert.alert('Butir belum lengkap', incomplete.result === 'ng'
        ? `Isi catatan masalah untuk “${incomplete.item_name}”.`
        : `Pilih OK atau NG untuk “${incomplete.item_name}”.`);
      return;
    }

    setSubmitting(true);
    try {
      const inspection = await apiClient.inspections.create({
        car_id: id,
        inspection_date: inspectionDate,
        mileage,
      });
      const items = inspectionDraft.map((item) => ({
        id: item.id,
        inspection_id: inspection.id,
        category: item.category,
        item_name: item.item_name,
        result: item.result,
        remark: item.remark.trim(),
        responsible: item.responsible.trim(),
        sort_order: item.sort_order,
      }));
      await apiClient.inspections.createItems(items);

      let uploadedCount = 0;
      for (const item of inspectionDraft) {
        for (const photo of item.photos) {
          await apiClient.inspections.uploadPhoto({
            inspectionId: inspection.id,
            itemId: item.id,
            base64: photo.base64,
            contentType: photo.contentType,
          });
          uploadedCount += 1;
        }
      }

      setCreatingInspection(false);
      setInspectionDraft([]);
      setInspectionMileage('');
      setInspectionDate(todayISO());
      await fetchAll();
      Alert.alert('Pengecekan dikirim', `Pengecekan tersimpan dengan ${uploadedCount} foto dan menunggu Approved dari Role 1.`);
    } catch (error) {
      await fetchAll();
      Alert.alert('Gagal menyimpan pengecekan', error instanceof Error ? error.message : 'Terjadi kesalahan. Pastikan migration dan bucket Supabase sudah tersedia.');
    } finally {
      setSubmitting(false);
    }
  };

  const approveInspection = async (inspection: VehicleInspection) => {
    if (sessionRole !== 1 || submitting) return;
    setSubmitting(true);
    try {
      const approved = await apiClient.inspections.approve(inspection.id);
      setSelectedInspection(approved);
      await fetchAll();
      Alert.alert('Pengecekan disetujui', 'Tahap Approved sudah dicatat.');
    } catch (error) {
      Alert.alert('Gagal menyetujui pengecekan', error instanceof Error ? error.message : 'Terjadi kesalahan.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteCar = () => {
    Alert.alert('Hapus Mobil', `Hapus "${car?.name}"? Semua catatan akan terhapus.`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.cars.delete(id);
            router.replace('/(tabs)');
          } catch (error) {
            Alert.alert('Gagal menghapus', error instanceof Error ? error.message : 'Terjadi kesalahan.');
          }
        },
      },
    ]);
  };

  // --- Notes CRUD ---
  const addNote = async () => {
    if (submitting) return;
    if (!newNote.name.trim() || !newNote.section.trim() || !newNote.start_date || !newNote.end_date || !newNote.start_km || !newNote.end_km || !newNote.start_fuel || !newNote.end_fuel || !newNote.content.trim()) {
      Alert.alert('Data belum lengkap', 'Isi semua field catatan sebelum menyimpan.');
      return;
    }
    if (newNote.end_date < newNote.start_date) {
      Alert.alert('Rentang tanggal tidak valid', 'Tanggal selesai harus sama atau setelah tanggal mulai.');
      return;
    }

    const startKm = Number(newNote.start_km);
    const endKm = Number(newNote.end_km);
    const startFuel = Number(newNote.start_fuel);
    const endFuel = Number(newNote.end_fuel);
    if ([startKm, endKm, startFuel, endFuel].some((value) => !Number.isFinite(value) || value < 0)) {
      Alert.alert('Angka tidak valid', 'KM dan Fuel harus berupa angka nol atau lebih.');
      return;
    }
    if (startFuel > 100 || endFuel > 100) {
      Alert.alert('Persentase Fuel tidak valid', 'Fuel Awal dan Fuel Akhir harus berada di antara 0% dan 100%.');
      return;
    }
    if (endKm < startKm) {
      Alert.alert('KM tidak valid', 'KM Akhir harus sama atau lebih besar dari KM Awal.');
      return;
    }

    setSubmitting(true);
    try {
      const noteData = {
        car_id: id,
        name: newNote.name.trim(),
        section: newNote.section.trim(),
        note_date: newNote.start_date,
        start_date: newNote.start_date,
        end_date: newNote.end_date,
        start_km: startKm,
        end_km: endKm,
        start_fuel: startFuel,
        end_fuel: endFuel,
        content: newNote.content.trim(),
      };
      if (editingNoteId) await apiClient.notes.update(editingNoteId, noteData);
      else await apiClient.notes.create(noteData);
      setEditingNoteId(null);
      setNewNote({ name: '', section: '', start_date: '', end_date: '', start_km: '', end_km: '', start_fuel: '', end_fuel: '', content: '' });
      setNoteSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan catatan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const deleteNote = async (noteId: string) => {
    try { await apiClient.notes.delete(noteId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus catatan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const editNote = (note: DailyNote) => {
    setEditingNoteId(note.id);
    setNewNote({
      name: note.name ?? '',
      section: note.section ?? '',
      start_date: note.start_date || note.note_date,
      end_date: note.end_date || note.note_date,
      start_km: note.start_km === null ? '' : String(note.start_km),
      end_km: note.end_km === null ? '' : String(note.end_km),
      start_fuel: note.start_fuel === null ? '' : String(note.start_fuel),
      end_fuel: note.end_fuel === null ? '' : String(note.end_fuel),
      content: note.content ?? '',
    });
    setNoteSheet(true);
  };

  const updateFuelPercentage = (field: 'start_fuel' | 'end_fuel', value: string) => {
    const sanitized = value.replace(',', '.').replace(/[^\d.]/g, '');
    const decimalIndex = sanitized.indexOf('.');
    const normalized = decimalIndex < 0
      ? sanitized
      : `${sanitized.slice(0, decimalIndex)}.${sanitized.slice(decimalIndex + 1).replace(/\./g, '')}`;
    setNewNote({ ...newNote, [field]: normalized && Number(normalized) > 100 ? '100' : normalized });
  };

  // --- Completeness CRUD ---
  const addItem = async () => {
    if (submitting) return;
    const itemName = newItem.trim() || (newReminderType === 'general' ? '' : reminderTypeLabels[newReminderType]);
    if (!itemName) return;

    if (newReminderType !== 'general' && !newReminderDueDate) {
      Alert.alert('Tanggal reminder wajib diisi', 'Masukkan tanggal untuk reminder pajak agar sistem bisa memicu pengingat berikutnya.');
      return;
    }

    if (!canCreateCompleteness) return;
    setSubmitting(true);

    try {
      await apiClient.completeness.create({
        car_id: id,
        name: itemName,
        is_present: newReminderType === 'general' ? newGeneralPresent : false,
        reminder_type: newReminderType,
        next_due_date: newReminderType === 'general' ? null : newReminderDueDate,
      });
      setNewItem('');
      setNewReminderType('general');
      setNewReminderDueDate('');
      setNewGeneralPresent(true);
      setCompletenessSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan kelengkapan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const advanceReminderDate = (currentDate: string, reminderType: CompletenessReminderType) => {
    const parsedDate = new Date(`${currentDate}T00:00:00`);
    if (reminderType === 'annual_tax') parsedDate.setFullYear(parsedDate.getFullYear() + 1);
    if (reminderType === 'plate_tax') parsedDate.setFullYear(parsedDate.getFullYear() + 5);

    const year = parsedDate.getFullYear();
    const month = `${parsedDate.getMonth() + 1}`.padStart(2, '0');
    const day = `${parsedDate.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toggleItem = async (item: CompletenessItem) => {
    if (!canUpdateCompleteness) return;
    if (item.reminder_type !== 'general') {
      const nextDueDate = item.next_due_date ? advanceReminderDate(item.next_due_date, item.reminder_type) : todayISO();

      try {
        await apiClient.completeness.update(item.id, {
          is_present: true,
          next_due_date: nextDueDate,
        });
        fetchAll();
      } catch (error) {
        Alert.alert('Gagal memperbarui reminder', error instanceof Error ? error.message : 'Terjadi kesalahan.');
      }
      return;
    }

    try { await apiClient.completeness.update(item.id, { is_present: !item.is_present }); fetchAll(); }
    catch (error) { Alert.alert('Gagal mengubah kelengkapan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const deleteItem = async (itemId: string) => {
    if (!canDeleteCompleteness) return;
    try { await apiClient.completeness.delete(itemId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus kelengkapan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  // --- Damages CRUD ---
  const addDamage = async () => {
    if (submitting) return;
    if (!newDamage.description.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.damages.create({ car_id: id, description: newDamage.description.trim(), severity: newDamage.severity, status: 'open', reported_date: todayISO() });
      setNewDamage({ description: '', severity: 'low' });
      setDamageSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan kerusakan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const cycleDamageStatus = async (dmg: Damage) => {
    if (!canUpdateDamages) {
      Alert.alert('Akses ditolak', 'Role ini hanya dapat melihat dan membuat kerusakan, tidak dapat mengubah status.');
      return;
    }
    const next: DamageStatus = dmg.status === 'open' ? 'repairing' : dmg.status === 'repairing' ? 'fixed' : 'open';
    const update: Partial<Damage> = { status: next };
    if (next === 'fixed') update.resolved_date = todayISO();
    else update.resolved_date = null;
    try { await apiClient.damages.update(dmg.id, update); fetchAll(); }
    catch (error) { Alert.alert('Gagal mengubah status kerusakan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const deleteDamage = async (dmgId: string) => {
    if (!canDeleteDamages) {
      Alert.alert('Akses ditolak', 'Role ini tidak memiliki izin menghapus kerusakan.');
      return;
    }
    try { await apiClient.damages.delete(dmgId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus kerusakan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  // --- Rental CRUD ---
  const addRental = async () => {
    if (submitting) return;
    const renterProfile = getSession()?.user;
    const renterName = renterProfile?.full_name?.trim() ?? '';
    const renterEmail = renterProfile?.email?.trim() ?? '';
    const renterPhone = renterProfile?.phone?.trim() ?? '';
    if (!renterName || !/^\S+@\S+\.\S+$/.test(renterEmail) || renterPhone.replace(/\D/g, '').length < 7) {
      Alert.alert('Profil belum lengkap', 'Lengkapi nama lengkap, email, dan nomor telepon di Settings sebelum membuat Transportation.');
      return;
    }
    setSubmitting(true);
    try {
      const startDate = newRental.start_date || todayISO();
      const rental = await apiClient.rentals.create({ car_id: id, renter_name: renterName, renter_email: renterEmail, renter_phone: renterPhone, start_date: startDate, end_date: newRental.end_date || null, purpose: newRental.purpose.trim(), notes: newRental.notes.trim(), status: 'active' });
      try {
        const endDate = rental.end_date ?? '';
        await apiClient.rentals.notifyCreated({
          namaPemesan: rental.renter_name,
          emailPemesan: rental.renter_email,
          nomorTelepon: rental.renter_phone,
          jenisKendaraan: car?.name ?? '',
          platNomor: car?.plate_number ?? '',
          tanggalMulaiSewa: rental.start_date,
          tanggalSelesaiSewa: endDate,
          jumlahHariSewa: endDate ? differenceInCalendarDays(rental.start_date, endDate) : '',
        });
      } catch (error) {
        Alert.alert('Transportation tersimpan', `Notifikasi otomatis gagal dikirim: ${error instanceof Error ? error.message : 'Terjadi kesalahan.'}`);
      }
      setNewRental({ start_date: '', end_date: '', purpose: '', notes: '' });
      setRentalSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan Transportation', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const cycleRentalStatus = async (rental: RentalRecord) => {
    if (rental.status === 'completed') return;
    const next: RentalStatus = rental.status === 'active' ? 'returned' : rental.status === 'returned' ? 'cancelled' : 'active';
    const update: Partial<RentalRecord> = { status: next };
    if (next === 'returned' && !rental.end_date) update.end_date = todayISO();
    try { await apiClient.rentals.update(rental.id, update); fetchAll(); }
    catch (error) { Alert.alert('Gagal mengubah status Transportation', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const deleteRental = async (rentalId: string) => {
    try { await apiClient.rentals.delete(rentalId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus Transportation', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof NotebookPen }[] = [
    { key: 'notes', label: 'Catatan Investigasi', icon: NotebookPen },
    { key: 'completeness', label: 'Kelengkapan', icon: ClipboardCheck },
    { key: 'damages', label: 'Kerusakan', icon: AlertTriangle },
    { key: 'rental', label: 'Transportation', icon: KeyRound },
    ...(canManageCar ? [{ key: 'checking' as const, label: 'Pengecekan', icon: ListChecks }] : []),
  ];

  const reminderTypeLabels: Record<CompletenessReminderType, string> = {
    general: 'Umum',
    annual_tax: 'Pajak Tahunan',
    plate_tax: 'Pajak Plat Nomor',
  };

  const isReminderDue = (item: CompletenessItem) => {
    if (item.reminder_type === 'general' || !item.next_due_date) return false;
    const today = new Date(`${todayISO()}T00:00:00`);
    const nextDueDate = new Date(`${item.next_due_date}T00:00:00`);
    return nextDueDate <= today;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <ChevronLeft size={24} color={Colors.white} strokeWidth={2.4} />
          </TouchableOpacity>
          {canManageCar ? <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => router.push(`/car/edit/${id}`)}
              style={styles.iconBtn}
            >
              <Pencil size={20} color={Colors.white} strokeWidth={2.2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={deleteCar} style={styles.iconBtn}>
              <Trash2 size={20} color={Colors.white} strokeWidth={2.2} />
            </TouchableOpacity>
          </View> : null}
        </View>
        <Text style={styles.carName} numberOfLines={1}>{car?.name ?? 'Mobil'}</Text>
        <Text style={styles.carSubtitle} numberOfLines={1}>
          {[car?.brand, car?.model, car?.year].filter(Boolean).join(' ')}
        </Text>
        {car?.plate_number ? (
          <View style={styles.plate}>
            <Text style={styles.plateText}>{car.plate_number}</Text>
          </View>
        ) : null}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Icon size={16} color={active ? Colors.primary : Colors.textTertiary} strokeWidth={2.2} />
              <Text numberOfLines={2} style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* NOTES */}
        {activeTab === 'notes' && (
          <View style={styles.section}>
            {notes.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada data Investigation untuk mobil ini.</Text>
            ) : (
              notes.map((note) => (
                <View key={note.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateBadgeText}>{formatShortDate(note.start_date || note.note_date)}</Text>
                    </View>
                    <View style={styles.headerActions}>
                      {canUpdateNotes ? (
                        <TouchableOpacity onPress={() => editNote(note)} hitSlop={12}>
                          <Pencil size={16} color={Colors.textSecondary} strokeWidth={2} />
                        </TouchableOpacity>
                      ) : null}
                      {canDeleteNotes ? (
                      <TouchableOpacity onPress={() => deleteNote(note.id)} hitSlop={12}>
                        <Trash2 size={16} color={Colors.error} strokeWidth={2} />
                      </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.cardTitle}>{note.name || 'Catatan lama'}</Text>
                  {note.section ? <Text style={styles.metaText}>Section: {note.section}</Text> : null}
                  <View style={styles.serviceMeta}>
                    <Text style={styles.metaText}>Tanggal: {formatDate(note.start_date || note.note_date)} {note.start_time?.slice(0, 5) || ''} - {formatDate(note.end_date || note.note_date)} {note.end_time?.slice(0, 5) || ''}</Text>
                  </View>
                  {note.start_km !== null && note.end_km !== null ? <Text style={styles.metaText}>KM: {note.start_km.toLocaleString('id-ID')} - {note.end_km.toLocaleString('id-ID')}</Text> : null}
                  {note.start_fuel !== null && note.end_fuel !== null ? <Text style={styles.metaText}>Fuel: {note.start_fuel}% - {note.end_fuel}%</Text> : null}
                  <Text style={styles.cardBody}>{note.content}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'checking' && canManageCar ? (
          <View style={styles.section}>
            {creatingInspection ? (
              <View style={styles.card}>
                <Text style={styles.sectionHeading}>Form Pengecekan</Text>
                <Text style={styles.metaText}>Inspector: {sessionUser?.full_name || 'Nama akun belum tersedia'}</Text>
                <Text style={styles.metaText}>Model: {car?.model || '-'}</Text>
                <Text style={styles.metaText}>No Pol: {car?.plate_number || '-'}</Text>
                <DateField label="Hari / Tanggal*" value={inspectionDate} onChange={setInspectionDate} />
                <Field label="KM*" value={inspectionMileage} onChangeText={setInspectionMileage} placeholder="Masukkan kilometer" keyboardType="numeric" />
                <Text style={styles.inspectionWorkflowHint}>Checked / Prepared akan dicatat dari akun Role 2. Setelah dikirim, Role 1 mengisi Approved.</Text>
                {inspectionDraft.map((item, index) => (
                  <View key={item.id} style={styles.inspectionItemCard}>
                    {index === 0 || inspectionDraft[index - 1].category !== item.category ? <Text style={styles.inspectionCategory}>{item.category}</Text> : null}
                    <Text style={styles.inspectionItemName}>{index + 1}. {item.item_name}</Text>
                    <View style={styles.inspectionResultRow}>
                      {(['ok', 'ng'] as const).map((result) => (
                        <TouchableOpacity key={result} onPress={() => setInspectionDraft((current) => current.map((draft) => draft.id === item.id ? { ...draft, result } : draft))} style={[styles.inspectionResultButton, item.result === result && (result === 'ok' ? styles.inspectionOkSelected : styles.inspectionNgSelected)]}>
                          <Text style={[styles.inspectionResultText, item.result === result && styles.inspectionResultTextSelected]}>{result.toUpperCase()}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput value={item.remark} onChangeText={(remark) => setInspectionDraft((current) => current.map((draft) => draft.id === item.id ? { ...draft, remark } : draft))} placeholder={item.result === 'ng' ? 'Catatan masalah wajib diisi' : 'Remark (opsional)'} multiline style={styles.inspectionTextInput} />
                    <TextInput value={item.responsible} onChangeText={(responsible) => setInspectionDraft((current) => current.map((draft) => draft.id === item.id ? { ...draft, responsible } : draft))} placeholder="Penanggung jawab (opsional)" style={styles.inspectionTextInput} />
                    <TouchableOpacity style={styles.inspectionPhotoButton} onPress={async () => {
                      if (item.photos.length >= 5) {
                        Alert.alert('Batas foto tercapai', 'Maksimal 5 foto untuk setiap butir pengecekan.');
                        return;
                      }
                      try {
                        const photo = await pickCompressedInspectionPhoto();
                        if (photo) setInspectionDraft((current) => current.map((draft) => draft.id === item.id ? { ...draft, photos: [...draft.photos, photo] } : draft));
                      } catch (error) {
                        Alert.alert('Gagal memilih foto', error instanceof Error ? error.message : 'Terjadi kesalahan.');
                      }
                    }}>
                      <ImagePlus size={16} color={Colors.primary} />
                      <Text style={styles.inspectionPhotoButtonText}>Tambah foto ({item.photos.length}/5)</Text>
                    </TouchableOpacity>
                    {item.photos.length ? <View style={styles.inspectionPhotoRow}>{item.photos.map((photo) => (
                      <View key={photo.localId} style={styles.inspectionPhotoThumbWrap}>
                        <Image source={{ uri: photo.preview }} style={styles.inspectionPhotoThumb} />
                        <TouchableOpacity style={styles.inspectionPhotoRemove} onPress={() => setInspectionDraft((current) => current.map((draft) => draft.id === item.id ? { ...draft, photos: draft.photos.filter((entry) => entry.localId !== photo.localId) } : draft))}><X size={13} color={Colors.white} /></TouchableOpacity>
                      </View>
                    ))}</View> : null}
                  </View>
                ))}
                <Button label="Kirim Checked / Prepared ke Role 1" onPress={addInspection} loading={submitting} />
                <TouchableOpacity style={styles.inspectionCancelButton} onPress={() => setCreatingInspection(false)}><Text style={styles.inspectionCancelText}>Batal</Text></TouchableOpacity>
              </View>
            ) : (
              <>
                {sessionRole === 2 ? <Button label="Buat Pengecekan" onPress={() => { setInspectionDate(todayISO()); setInspectionMileage(''); setInspectionDraft(makeInspectionDraft()); setCreatingInspection(true); setSelectedInspection(null); }} /> : null}
                {inspections.length === 0 ? <Text style={styles.emptyText}>Belum ada riwayat pengecekan untuk mobil ini.</Text> : inspections.map((inspection) => (
                  <TouchableOpacity key={inspection.id} style={styles.card} onPress={() => { void openInspection(inspection); }}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>{formatDate(inspection.inspection_date)} · {inspection.mileage.toLocaleString('id-ID')} KM</Text>
                      <View style={[styles.inspectionStatusPill, inspection.status === 'approved' ? styles.inspectionApprovedPill : styles.inspectionPendingPill]}><Text style={styles.inspectionStatusText}>{inspection.status === 'approved' ? 'Approved' : 'Menunggu Role 1'}</Text></View>
                    </View>
                    <Text style={styles.metaText}>Inspector: {inspection.inspector_name}</Text>
                    <Text style={styles.metaText}>{inspection.model_snapshot} · {inspection.plate_snapshot}</Text>
                  </TouchableOpacity>
                ))}
                {selectedInspection ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}><Text style={styles.sectionHeading}>Rincian Pengecekan</Text><TouchableOpacity onPress={() => { setSelectedInspection(null); setSelectedInspectionItems([]); setInspectionPhotos({}); }}><X size={18} color={Colors.textSecondary} /></TouchableOpacity></View>
                    <Text style={styles.metaText}>Checked / Prepared: {selectedInspection.checked_prepared_name || '-'}</Text>
                    <Text style={styles.metaText}>Approved: {selectedInspection.approved_name || 'Menunggu Role 1'}</Text>
                    {selectedInspectionItems.map((item) => (
                      <View key={item.id} style={styles.inspectionReadOnlyItem}>
                        <Text style={styles.inspectionCategory}>{item.category}</Text>
                        <Text style={styles.inspectionItemName}>{item.item_name} · {item.result?.toUpperCase() || '-'}</Text>
                        {item.remark ? <Text style={styles.metaText}>Remark: {item.remark}</Text> : null}
                        {item.responsible ? <Text style={styles.metaText}>Penanggung jawab: {item.responsible}</Text> : null}
                        {(inspectionPhotos[item.id] ?? []).length ? <View style={styles.inspectionPhotoRow}>{inspectionPhotos[item.id].map((photo) => photo.url ? <Image key={photo.path} source={{ uri: photo.url }} style={styles.inspectionPhotoThumb} /> : null)}</View> : null}
                      </View>
                    ))}
                    {sessionRole === 1 && selectedInspection.status === 'pending_approval' ? <Button label="Approved" onPress={() => { void approveInspection(selectedInspection); }} loading={submitting} /> : null}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {/* COMPLETENESS */}
        {activeTab === 'completeness' && (
          <View style={styles.section}>
            {completeness.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada item kelengkapan. Tambahkan dongkrak, ban serep, dll.</Text>
            ) : (
              completeness.map((item) => {
                const reminderText = item.next_due_date ? `Reminder: ${formatDate(item.next_due_date)}` : null;
                const reminderTypeLabel = item.reminder_type !== 'general' ? reminderTypeLabels[item.reminder_type] : null;
                const dueStatusText = item.reminder_type !== 'general' && item.next_due_date
                  ? (isReminderDue(item) ? 'Jatuh tempo' : item.is_present ? 'Sudah dicatat' : 'Belum dibayar')
                  : null;

                return (
                  <View key={item.id} style={styles.checkRow}>
                    <TouchableOpacity
                      style={styles.checkLeft}
                      onPress={() => canUpdateCompleteness && toggleItem(item)}
                      disabled={!canUpdateCompleteness}
                    >
                      <View style={[styles.checkbox, item.is_present && styles.checkboxChecked]}>
                        {item.is_present ? <Check size={14} color={Colors.white} strokeWidth={3} /> : null}
                      </View>
                      <View style={styles.checkContent}>
                        <Text style={[styles.checkLabel, !item.is_present && styles.checkLabelMissing]}>
                          {item.name}
                        </Text>
                        {reminderTypeLabel || reminderText || dueStatusText ? (
                          <View style={styles.reminderWrap}>
                            {reminderTypeLabel ? <Text style={styles.reminderType}>{reminderTypeLabel}</Text> : null}
                            {dueStatusText ? <Text style={[styles.reminderText, isReminderDue(item) && styles.dueReminderText]}>{dueStatusText}</Text> : null}
                            {reminderText ? <Text style={styles.reminderText}>{reminderText}</Text> : null}
                          </View>
                        ) : null}
                        {item.reminder_type === 'general' ? (
                          <Text style={[styles.reminderText, item.is_present ? styles.presentText : styles.missingText]}>
                            {item.is_present ? 'Aktif' : 'Nonaktif'}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                    {canDeleteCompleteness ? (
                      <TouchableOpacity onPress={() => deleteItem(item.id)} hitSlop={12}>
                        <Trash2 size={16} color={Colors.textTertiary} strokeWidth={2} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* DAMAGES */}
        {activeTab === 'damages' && (
          <View style={styles.section}>
            {damages.length === 0 ? (
              <Text style={styles.emptyText}>Tidak ada catatan kerusakan.</Text>
            ) : (
              damages.map((dmg) => {
                const sevColor =
                  dmg.severity === 'high' ? Colors.error : dmg.severity === 'medium' ? Colors.warning : Colors.success;
                const statusLabel = dmg.status === 'open' ? 'Belum' : dmg.status === 'repairing' ? 'Diperbaiki' : 'Selesai';
                return (
                  <View key={dmg.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.damageTop}>
                        <View style={[styles.sevDot, { backgroundColor: sevColor }]} />
                        <Text style={styles.cardTitle}>{dmg.description}</Text>
                      </View>
                      {canDeleteDamages ? (
                        <TouchableOpacity onPress={() => deleteDamage(dmg.id)} hitSlop={12}>
                          <Trash2 size={16} color={Colors.textTertiary} strokeWidth={2} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={styles.damageMeta}>
                      <Text style={styles.metaText}>Dilaporkan: {formatDate(dmg.reported_date)}</Text>
                      {canUpdateDamages ? (
                      <TouchableOpacity onPress={() => cycleDamageStatus(dmg)} style={[styles.statusPill, { backgroundColor: dmg.status === 'fixed' ? Colors.primaryLight : Colors.surfaceAlt }]}>
                        <Text style={[styles.statusText, { color: dmg.status === 'fixed' ? Colors.primary : Colors.textSecondary }]}>
                          {statusLabel}
                        </Text>
                      </TouchableOpacity>
                      ) : (
                        <View style={[styles.statusPill, { backgroundColor: dmg.status === 'fixed' ? Colors.primaryLight : Colors.surfaceAlt }]}>
                          <Text style={[styles.statusText, { color: dmg.status === 'fixed' ? Colors.primary : Colors.textSecondary }]}>{statusLabel}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* RENTAL */}
        {activeTab === 'rental' && (
          <View style={styles.section}>
            {rentals.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada riwayat Transportation.</Text>
            ) : (
              rentals.map((rental) => {
                const statusLabel = rental.status === 'active' ? 'Aktif' : rental.status === 'returned' ? 'Dikembalikan' : rental.status === 'completed' ? 'Selesai' : 'Dibatalkan';
                const statusBg = rental.status === 'active' ? Colors.primaryLight : rental.status === 'cancelled' ? '#FEE2E2' : rental.status === 'completed' ? '#DCFCE7' : Colors.surfaceAlt;
                const statusColor = rental.status === 'active' ? Colors.primary : rental.status === 'cancelled' ? Colors.error : rental.status === 'completed' ? '#15803D' : Colors.textSecondary;
                return (
                  <View key={rental.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.serviceTop}>
                        <View style={styles.serviceIcon}>
                          <KeyRound size={14} color={Colors.primary} strokeWidth={2.2} />
                        </View>
                        <Text style={styles.cardTitle}>{rental.renter_name}</Text>
                      </View>
                      {canDeleteRental ? (
                        <TouchableOpacity onPress={() => deleteRental(rental.id)} hitSlop={12}>
                          <Trash2 size={16} color={Colors.textTertiary} strokeWidth={2} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {rental.notes ? <Text style={styles.cardBody}>{rental.notes}</Text> : null}
                    <View style={styles.serviceMeta}>
                      <Text style={styles.metaText}>Mulai: {formatDate(rental.start_date)}</Text>
                      {rental.end_date ? <Text style={styles.metaText}>Selesai: {formatDate(rental.end_date)}</Text> : null}
                    </View>
                    <View style={styles.serviceMeta}>
                      {rental.purpose ? <Text style={styles.metaText}>Tujuan: {rental.purpose}</Text> : null}
                      {rental.total_cost ? <Text style={styles.costText}>{formatCurrency(rental.total_cost)}</Text> : null}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: statusBg, marginTop: Spacing.xs }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                    {canManageRental ? (
                      <TouchableOpacity
                        style={styles.statusAction}
                        onPress={() => cycleRentalStatus(rental)}
                      >
                        <Text style={styles.statusActionText}>Ubah status</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      {(activeTab === 'completeness' && canCreateCompleteness) || (activeTab === 'damages' && canCreateDamages) || (activeTab === 'rental' && isSuperAdmin) ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            if (activeTab === 'damages') setDamageSheet(true);
            else if (activeTab === 'completeness') setCompletenessSheet(true);
            else if (activeTab === 'rental' && isSuperAdmin) setRentalSheet(true);
          }}
        >
          <Plus size={26} color={Colors.white} strokeWidth={2.6} />
        </TouchableOpacity>
      ) : null}

      {/* Note Sheet */}
      <Sheet visible={noteSheet} onClose={() => { setNoteSheet(false); setEditingNoteId(null); }} title={editingNoteId ? 'Ubah Investigation' : 'Investigation Baru'}>
        <Field label="Nama*" value={newNote.name} onChangeText={(value) => setNewNote({ ...newNote, name: value })} placeholder="Nama petugas atau pencatat" />
        <Field label="Section*" value={newNote.section} onChangeText={(value) => setNewNote({ ...newNote, section: value })} placeholder="Section" />
        <DateField label="Tanggal Mulai*" value={newNote.start_date} onChange={(value) => setNewNote({ ...newNote, start_date: value })} />
        <DateField label="Tanggal Selesai*" value={newNote.end_date} onChange={(value) => setNewNote({ ...newNote, end_date: value })} minimumDate={newNote.start_date ? new Date(`${newNote.start_date}T00:00:00`) : undefined} />
        <Field label="KM Awal*" value={newNote.start_km} onChangeText={(value) => setNewNote({ ...newNote, start_km: value })} placeholder="Contoh: 12000" keyboardType="numeric" />
        <Field label="KM Akhir*" value={newNote.end_km} onChangeText={(value) => setNewNote({ ...newNote, end_km: value })} placeholder="Contoh: 12150" keyboardType="numeric" />
        <Field label="Fuel Awal (%)*" value={newNote.start_fuel} onChangeText={(value) => updateFuelPercentage('start_fuel', value)} placeholder="0-100" keyboardType="numeric" />
        <Field label="Fuel Akhir (%)*" value={newNote.end_fuel} onChangeText={(value) => updateFuelPercentage('end_fuel', value)} placeholder="0-100" keyboardType="numeric" />
        <Field
          label="Note / Rincian Aktivitas*"
          value={newNote.content}
          onChangeText={(value) => setNewNote({ ...newNote, content: value })}
          placeholder="Rincian aktivitas yang dilakukan..."
          multiline
        />
        <Button label={editingNoteId ? 'Simpan Perubahan' : 'Simpan Catatan'} onPress={addNote} loading={submitting} disabled={!newNote.name.trim() || !newNote.section.trim() || !newNote.start_date || !newNote.end_date || !newNote.start_km || !newNote.end_km || !newNote.start_fuel || !newNote.end_fuel || !newNote.content.trim()} />
      </Sheet>

      {/* Completeness Sheet */}
      <Sheet visible={completenessSheet} onClose={() => setCompletenessSheet(false)} title="Tambah Kelengkapan">
        <Text style={styles.sevLabel}>Jenis Reminder</Text>
        <View style={styles.sevRow}>
          {(['general', 'annual_tax', 'plate_tax'] as CompletenessReminderType[]).map((type) => {
            const active = newReminderType === type;
            return (
              <TouchableOpacity
                key={type}
                onPress={() => setNewReminderType(type)}
                style={[styles.sevBtn, active && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}
              >
                <Text style={[styles.sevBtnText, active && { color: Colors.white }]}>{type === 'general' ? 'Umum' : type === 'annual_tax' ? 'Pajak Tahunan' : 'Pajak Plat Nomor'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {newReminderType === 'general' ? (
          <>
            <Text style={styles.sevLabel}>Status kelengkapan</Text>
            <View style={styles.sevRow}>
              {([true, false] as const).map((isPresent) => (
                <TouchableOpacity
                  key={String(isPresent)}
                  onPress={() => setNewGeneralPresent(isPresent)}
                  style={[styles.sevBtn, newGeneralPresent === isPresent && { backgroundColor: isPresent ? Colors.success : Colors.textTertiary, borderColor: isPresent ? Colors.success : Colors.textTertiary }]}
                >
                  <Text style={[styles.sevBtnText, newGeneralPresent === isPresent && { color: Colors.white }]}>{isPresent ? 'Aktif' : 'Nonaktif'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}
        <Field
          label="Nama item"
          value={newItem}
          onChangeText={setNewItem}
          placeholder={newReminderType === 'general' ? 'Contoh: Dongkrak, Ban serep, APAR...' : reminderTypeLabels[newReminderType]}
        />
        {newReminderType !== 'general' ? (
          <DateField
            label="Tanggal reminder"
            value={newReminderDueDate}
            onChange={setNewReminderDueDate}
            placeholder="Pilih tanggal reminder"
          />
        ) : null}
        <Button label="Tambah" onPress={addItem} loading={submitting} />
      </Sheet>

      {/* Damage Sheet */}
      <Sheet visible={damageSheet} onClose={() => setDamageSheet(false)} title="Catat Kerusakan">
        <Field
          label="Deskripsi kerusakan"
          value={newDamage.description}
          onChangeText={(t) => setNewDamage({ ...newDamage, description: t })}
          placeholder="Contoh: Rem depan berbunyi..."
          multiline
        />
        <Text style={styles.sevLabel}>Tingkat Keparahan</Text>
        <View style={styles.sevRow}>
          {(['low', 'medium', 'high'] as DamageSeverity[]).map((sev) => {
            const labels = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };
            const colors = { low: Colors.success, medium: Colors.warning, high: Colors.error };
            const active = newDamage.severity === sev;
            return (
              <TouchableOpacity
                key={sev}
                onPress={() => setNewDamage({ ...newDamage, severity: sev })}
                style={[styles.sevBtn, active && { backgroundColor: colors[sev], borderColor: colors[sev] }]}
              >
                <Text style={[styles.sevBtnText, active && { color: Colors.white }]}>{labels[sev]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ height: Spacing.md }} />
        <Button label="Simpan Kerusakan" onPress={addDamage} loading={submitting} />
      </Sheet>

      {/* Rental Sheet */}
      <Sheet visible={rentalSheet} onClose={() => setRentalSheet(false)} title="Tambah Transportation Mobil">
        <Text style={styles.profileHint}>{profileComplete ? `Pemesan: ${sessionUser?.full_name} · ${profileEmail} · ${profilePhone}` : 'Lengkapi nama, email, dan nomor telepon di Settings sebelum membuat Transportation.'}</Text>
        <DateField
          label="Tanggal Mulai"
          value={newRental.start_date}
          onChange={(value) => setNewRental({ ...newRental, start_date: value })}
          placeholder="Pilih tanggal (kosongkan = hari ini)"
        />
        <DateField
          label="Tanggal Selesai"
          value={newRental.end_date}
          onChange={(value) => setNewRental({ ...newRental, end_date: value })}
          placeholder="Pilih tanggal (kosongkan = masih berjalan)"
          minimumDate={newRental.start_date ? new Date(`${newRental.start_date}T00:00:00`) : undefined}
        />
        <Field
          label="Tujuan Transportation"
          value={newRental.purpose}
          onChangeText={(t) => setNewRental({ ...newRental, purpose: t })}
          placeholder="Contoh: Perjalanan dinas, liburan keluarga"
        />
        <Field
          label="Catatan"
          value={newRental.notes}
          onChangeText={(t) => setNewRental({ ...newRental, notes: t })}
          placeholder="Catatan tambahan..."
          multiline
        />
        <View style={{ height: Spacing.sm }} />
        <Button label="Simpan Transportation" onPress={addRental} loading={submitting} disabled={!profileComplete} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  profileHint: {
    marginBottom: Spacing.md,
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
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
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carName: {
    fontSize: Typography.xxl,
    fontFamily: Typography.fontBold,
    color: Colors.white,
    marginBottom: 2,
  },
  carSubtitle: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.primarySoft,
  },
  plate: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    marginTop: Spacing.sm,
  },
  plateText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.white,
    letterSpacing: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tabActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primarySoft,
  },
  tabLabel: {
    flexShrink: 1,
    fontSize: Typography.xs,
    fontFamily: Typography.fontMedium,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  tabLabelActive: {
    color: Colors.primary,
    fontFamily: Typography.fontSemiBold,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionHeading: {
    fontSize: Typography.lg,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  inspectionWorkflowHint: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  inspectionItemCard: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  inspectionReadOnlyItem: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingVertical: Spacing.sm,
  },
  inspectionCategory: {
    color: Colors.primary,
    fontSize: Typography.xs,
    fontFamily: Typography.fontSemiBold,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  inspectionItemName: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontFamily: Typography.fontSemiBold,
    marginBottom: Spacing.xs,
  },
  inspectionResultRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  inspectionResultButton: {
    minWidth: 58,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  inspectionOkSelected: { backgroundColor: '#DCFCE7', borderColor: Colors.success },
  inspectionNgSelected: { backgroundColor: '#FEE2E2', borderColor: Colors.error },
  inspectionResultText: { color: Colors.textSecondary, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  inspectionResultTextSelected: { color: Colors.textPrimary },
  inspectionTextInput: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.white,
  },
  inspectionPhotoButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.sm,
    marginTop: 2,
  },
  inspectionPhotoButtonText: { color: Colors.primary, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  inspectionPhotoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  inspectionPhotoThumbWrap: { position: 'relative' },
  inspectionPhotoThumb: { width: 76, height: 76, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  inspectionPhotoRemove: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 21,
    height: 21,
    borderRadius: Radius.pill,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectionStatusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill },
  inspectionPendingPill: { backgroundColor: '#FEF3C7' },
  inspectionApprovedPill: { backgroundColor: '#DCFCE7' },
  inspectionStatusText: { color: Colors.textPrimary, fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  inspectionCancelButton: { alignItems: 'center', paddingVertical: Spacing.md },
  inspectionCancelText: { color: Colors.error, fontSize: Typography.sm, fontFamily: Typography.fontSemiBold },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
  },
  cardTitle: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  cardBody: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: Typography.lineHeightBody,
  },
  dateBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  dateBadgeText: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  emptyText: {
    fontSize: Typography.base,
    fontFamily: Typography.fontRegular,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
    lineHeight: Typography.lineHeightBody,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  checkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.sm,
  },
  checkContent: {
    flex: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkLabel: {
    fontSize: Typography.base,
    fontFamily: Typography.fontMedium,
    color: Colors.textPrimary,
  },
  reminderWrap: {
    marginTop: 4,
    gap: 2,
  },
  reminderType: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  reminderText: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontMedium,
    color: Colors.textTertiary,
  },
  dueReminderText: {
    color: Colors.error,
    fontFamily: Typography.fontSemiBold,
  },
  presentText: {
    color: Colors.success,
    fontFamily: Typography.fontSemiBold,
  },
  missingText: {
    color: Colors.error,
    fontFamily: Typography.fontSemiBold,
  },
  checkLabelMissing: {
    color: Colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  damageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.sm,
    marginRight: Spacing.sm,
  },
  sevDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.pill,
  },
  damageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  metaText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textTertiary,
  },
  statusPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusText: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontSemiBold,
  },
  statusAction: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xs,
  },
  statusActionText: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },
  serviceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.sm,
    marginRight: Spacing.sm,
  },
  serviceIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  costText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontSemiBold,
    color: Colors.primary,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 58,
    height: 58,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  sevLabel: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  sevRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  sevBtn: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  sevBtnText: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.textSecondary,
  },
});
