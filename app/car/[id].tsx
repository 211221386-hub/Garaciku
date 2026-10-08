import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
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
} from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import type { Car, DailyNote, CompletenessItem, Damage, RentalRecord, RentalStatus, DamageSeverity, DamageStatus, CompletenessReminderType } from '@/lib/types';
import { differenceInCalendarDays, formatDate, formatShortDate, formatCurrency, todayISO } from '@/lib/format';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/Field';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/Button';
import { getSession } from '@/lib/auth';

type Tab = 'notes' | 'completeness' | 'damages' | 'rental';

export default function CarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const canManageRental = [1, 2].includes(getSession()?.user.role ?? 0);
  const [car, setCar] = useState<Car | null>(null);
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [completeness, setCompleteness] = useState<CompletenessItem[]>([]);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [rentals, setRentals] = useState<RentalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('notes');

  // Sheet state
  const [noteSheet, setNoteSheet] = useState(false);
  const [newNote, setNewNote] = useState('');
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
    renter_name: '',
    renter_email: '',
    renter_phone: '',
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
      const [carData, notesData, compData, dmgData, rentalData] = await Promise.all([
        apiClient.cars.getById(id),
        apiClient.notes.getByCar(id),
        apiClient.completeness.getByCar(id),
        apiClient.damages.getByCar(id),
        apiClient.rentals.getByCar(id),
      ]);
      setCar(carData);
      setNotes(notesData);
      setCompleteness(compData);
      setDamages(dmgData);
      setRentals(rentalData);
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
    if (!newNote.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.notes.create({ car_id: id, content: newNote.trim(), note_date: todayISO() });
      setNewNote('');
      setNoteSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan catatan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const deleteNote = async (noteId: string) => {
    try { await apiClient.notes.delete(noteId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus catatan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
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
    const next: DamageStatus = dmg.status === 'open' ? 'repairing' : dmg.status === 'repairing' ? 'fixed' : 'open';
    const update: Partial<Damage> = { status: next };
    if (next === 'fixed') update.resolved_date = todayISO();
    else update.resolved_date = null;
    try { await apiClient.damages.update(dmg.id, update); fetchAll(); }
    catch (error) { Alert.alert('Gagal mengubah status kerusakan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const deleteDamage = async (dmgId: string) => {
    try { await apiClient.damages.delete(dmgId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus kerusakan', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  // --- Rental CRUD ---
  const addRental = async () => {
    if (submitting) return;
    if (!newRental.renter_name.trim()) return;
    if (!/^\S+@\S+\.\S+$/.test(newRental.renter_email.trim())) {
      Alert.alert('Email wajib diisi', 'Masukkan alamat email penyewa yang valid.');
      return;
    }
    if (!newRental.renter_phone.trim()) {
      Alert.alert('Nomor telepon wajib diisi', 'Masukkan nomor telepon pemesan.');
      return;
    }
    setSubmitting(true);
    try {
      const startDate = newRental.start_date || todayISO();
      const rental = await apiClient.rentals.create({ car_id: id, renter_name: newRental.renter_name.trim(), renter_email: newRental.renter_email.trim(), renter_phone: newRental.renter_phone.trim(), start_date: startDate, end_date: newRental.end_date || null, purpose: newRental.purpose.trim(), notes: newRental.notes.trim(), status: 'active' });
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
        Alert.alert('Rental tersimpan', `Notifikasi otomatis gagal dikirim: ${error instanceof Error ? error.message : 'Terjadi kesalahan.'}`);
      }
      setNewRental({ renter_name: '', renter_email: '', renter_phone: '', start_date: '', end_date: '', purpose: '', notes: '' });
      setRentalSheet(false);
      await fetchAll();
    } catch (error) { Alert.alert('Gagal menyimpan rental', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
    finally { setSubmitting(false); }
  };

  const cycleRentalStatus = async (rental: RentalRecord) => {
    if (rental.status === 'completed') return;
    const next: RentalStatus = rental.status === 'active' ? 'returned' : rental.status === 'returned' ? 'cancelled' : 'active';
    const update: Partial<RentalRecord> = { status: next };
    if (next === 'returned' && !rental.end_date) update.end_date = todayISO();
    try { await apiClient.rentals.update(rental.id, update); fetchAll(); }
    catch (error) { Alert.alert('Gagal mengubah status rental', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  const deleteRental = async (rentalId: string) => {
    try { await apiClient.rentals.delete(rentalId); fetchAll(); }
    catch (error) { Alert.alert('Gagal menghapus rental', error instanceof Error ? error.message : 'Terjadi kesalahan.'); }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof NotebookPen }[] = [
    { key: 'notes', label: 'Catatan', icon: NotebookPen },
    { key: 'completeness', label: 'Kelengkapan', icon: ClipboardCheck },
    { key: 'damages', label: 'Kerusakan', icon: AlertTriangle },
    { key: 'rental', label: 'Rental', icon: KeyRound },
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
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => router.push(`/car/edit/${id}`)}
              style={styles.iconBtn}
            >
              <Pencil size={20} color={Colors.white} strokeWidth={2.2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={deleteCar} style={styles.iconBtn}>
              <Trash2 size={20} color={Colors.white} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
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
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* NOTES */}
        {activeTab === 'notes' && (
          <View style={styles.section}>
            {notes.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada catatan. Tambahkan catatan untuk hari ini.</Text>
            ) : (
              notes.map((note) => (
                <View key={note.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateBadgeText}>{formatShortDate(note.note_date)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteNote(note.id)} hitSlop={12}>
                      <Trash2 size={16} color={Colors.error} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.cardBody}>{note.content}</Text>
                </View>
              ))
            )}
          </View>
        )}

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
                    <TouchableOpacity style={styles.checkLeft} onPress={() => toggleItem(item)}>
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
                    <TouchableOpacity onPress={() => deleteItem(item.id)} hitSlop={12}>
                      <Trash2 size={16} color={Colors.textTertiary} strokeWidth={2} />
                    </TouchableOpacity>
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
                      <TouchableOpacity onPress={() => deleteDamage(dmg.id)} hitSlop={12}>
                        <Trash2 size={16} color={Colors.textTertiary} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.damageMeta}>
                      <Text style={styles.metaText}>Dilaporkan: {formatDate(dmg.reported_date)}</Text>
                      <TouchableOpacity
                        style={[styles.statusPill, { backgroundColor: dmg.status === 'fixed' ? Colors.primaryLight : Colors.surfaceAlt }]}
                        onPress={() => cycleDamageStatus(dmg)}
                      >
                        <Text style={[styles.statusText, { color: dmg.status === 'fixed' ? Colors.primary : Colors.textSecondary }]}>
                          {statusLabel}
                        </Text>
                      </TouchableOpacity>
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
              <Text style={styles.emptyText}>Belum ada riwayat rental.</Text>
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
                      {canManageRental ? (
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
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          if (activeTab === 'notes') setNoteSheet(true);
          else if (activeTab === 'completeness') setCompletenessSheet(true);
          else if (activeTab === 'damages') setDamageSheet(true);
          else setRentalSheet(true);
        }}
      >
        <Plus size={26} color={Colors.white} strokeWidth={2.6} />
      </TouchableOpacity>

      {/* Note Sheet */}
      <Sheet visible={noteSheet} onClose={() => setNoteSheet(false)} title="Catatan Hari Ini">
        <Field
          label="Apa yang dilakukan hari ini?"
          value={newNote}
          onChangeText={setNewNote}
          placeholder="Contoh: Ganti oli mesin, cek rem depan..."
          multiline
        />
        <Button label="Simpan Catatan" onPress={addNote} loading={submitting} />
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
      <Sheet visible={rentalSheet} onClose={() => setRentalSheet(false)} title="Tambah Rental Mobil">
        <Field
          label="Nama Penyewa*"
          value={newRental.renter_name}
          onChangeText={(t) => setNewRental({ ...newRental, renter_name: t })}
          placeholder="Contoh: Budi Santoso"
        />
        <Field label="Email Penyewa*" value={newRental.renter_email} onChangeText={(t) => setNewRental({ ...newRental, renter_email: t })} placeholder="contoh@email.com" />
        <Field label="Nomor Telepon*" value={newRental.renter_phone} onChangeText={(t) => setNewRental({ ...newRental, renter_phone: t })} placeholder="Contoh: 08123456789" keyboardType="phone-pad" />
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
          label="Tujuan Peminjaman"
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
        <Button label="Simpan Rental" onPress={addRental} loading={submitting} />
      </Sheet>
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
    fontSize: Typography.xs,
    fontFamily: Typography.fontMedium,
    color: Colors.textTertiary,
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
