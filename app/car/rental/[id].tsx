import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, KeyRound, Mail, Phone, Trash2, Compass } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { Car, RentalRecord, RentalStatus } from '@/lib/types';
import { getSession } from '@/lib/auth';

const statusConfig: Record<RentalStatus, { label: string; backgroundColor: string; color: string }> = {
  pending: { label: 'Menunggu persetujuan', backgroundColor: '#FEF3C7', color: '#92400E' },
  active: { label: 'Aktif', backgroundColor: Colors.primaryLight, color: Colors.primary },
  approved: { label: 'Disetujui', backgroundColor: '#DCFCE7', color: '#15803D' },
  rejected: { label: 'Ditolak', backgroundColor: '#FEE2E2', color: Colors.error },
  returned: { label: 'Dikembalikan', backgroundColor: Colors.surfaceAlt, color: Colors.textSecondary },
  cancelled: { label: 'Dibatalkan', backgroundColor: '#FEE2E2', color: Colors.error },
  completed: { label: 'Selesai', backgroundColor: '#DCFCE7', color: '#15803D' },
};

export default function RentalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rental, setRental] = useState<RentalRecord | null>(null);
  const [car, setCar] = useState<Car | null>(null);
  const [loading, setLoading] = useState(true);
  const canManageRental = [1, 2].includes(getSession()?.user.role ?? 0);

  const fetchRental = useCallback(async () => {
    try {
      const rentalData = await apiClient.rentals.getById(id);
      const carData = await apiClient.cars.getById(rentalData.car_id);
      setRental(rentalData);
      setCar(carData);
    } catch (error) {
      Alert.alert('Gagal memuat rental', error instanceof Error ? error.message : 'Terjadi kesalahan.');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [canManageRental, id]);

  useFocusEffect(useCallback(() => { fetchRental(); }, [fetchRental]));

  const deleteRental = () => {
    if (!rental) return;
    Alert.alert('Hapus Rental', 'Data rental ini akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.rentals.delete(rental.id);
            router.back();
          } catch (error) {
            Alert.alert('Gagal menghapus rental', error instanceof Error ? error.message : 'Terjadi kesalahan.');
          }
        },
      },
    ]);
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>;
  if (!rental) return null;

  const status = statusConfig[rental.status];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <ChevronLeft size={24} color={Colors.white} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detail Rental</Text>
        {canManageRental ? (
          <TouchableOpacity onPress={deleteRental} style={styles.deleteButton} hitSlop={12}>
            <Trash2 size={19} color={Colors.white} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : <View style={styles.deleteButton} />}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}><KeyRound size={25} color={Colors.primary} strokeWidth={2.2} /></View>
          <View style={styles.heroText}>
            <Text style={styles.renterName}>{rental.renter_name}</Text>
            <Text style={styles.vehicleName}>{car?.name ?? 'Mobil tidak diketahui'}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informasi Penyewa</Text>
          <InfoRow icon={<Mail size={18} color={Colors.primary} />} value={rental.renter_email} />
          {rental.renter_phone ? <InfoRow icon={<Phone size={18} color={Colors.primary} />} value={rental.renter_phone} /> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informasi Kendaraan</Text>
          <DetailRow label="Kendaraan" value={car?.name ?? '-'} />
          <DetailRow label="Plat nomor" value={car?.plate_number ?? '-'} />
          <DetailRow label="Tujuan peminjaman" value={rental.purpose || '-'} icon={<Compass size={17} color={Colors.primary} />} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Periode Rental</Text>
          <DetailRow label="Tanggal mulai" value={formatDate(rental.start_date)} />
          <DetailRow label="Tanggal selesai" value={rental.end_date ? formatDate(rental.end_date) : 'Masih berjalan'} />
          <DetailRow label="Total biaya" value={formatCurrency(rental.total_cost)} />
        </View>

        {rental.notes ? <View style={styles.card}><Text style={styles.sectionTitle}>Catatan</Text><Text style={styles.notes}>{rental.notes}</Text></View> : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return <View style={styles.infoRow}>{icon}<Text style={styles.infoValue}>{value}</Text></View>;
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><View style={styles.detailValueWrap}>{icon}<Text style={styles.detailValue}>{value}</Text></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingTop: Spacing.xl + 12, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, marginLeft: Spacing.sm, fontSize: Typography.xl, fontFamily: Typography.fontBold, color: Colors.white },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  hero: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.borderLight, marginBottom: Spacing.md },
  iconCircle: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  heroText: { flex: 1 },
  renterName: { fontSize: Typography.lg, fontFamily: Typography.fontBold, color: Colors.textPrimary },
  vehicleName: { marginTop: 3, fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.primary },
  statusPill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  statusText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: Spacing.md },
  sectionTitle: { fontSize: Typography.base, fontFamily: Typography.fontBold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  infoValue: { flex: 1, fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary },
  detailRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  detailLabel: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textTertiary },
  detailValueWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  detailValue: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textPrimary, textAlign: 'right' },
  notes: { fontSize: Typography.sm, fontFamily: Typography.fontRegular, color: Colors.textSecondary, lineHeight: 21 },
});
