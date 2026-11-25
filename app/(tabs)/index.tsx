import { useState, useCallback } from 'react';
import { Alert, View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Car as CarIcon, Plus, RefreshCw } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import type { Car, CarStatusInfo } from '@/lib/types';
import { CarCard } from '@/components/CarCard';
import { EmptyState } from '@/components/EmptyState';
import { getSession } from '@/lib/auth';

export default function CarsScreen() {
  const [cars, setCars] = useState<Car[]>([]);
  const [carStatuses, setCarStatuses] = useState<Record<string, CarStatusInfo>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRestrictedRole = ![1, 2].includes(getSession()?.user.role ?? 4);

  const fetchCars = useCallback(async () => {
    try {
      const data = await apiClient.cars.getAll();
      setCars(data);
      setLoading(false);

      try {
        const statusResult = await apiClient.cars.getStatuses(data.map((car) => car.id));
        setCarStatuses(statusResult.statuses);
        if (statusResult.warning) Alert.alert('Status mobil belum lengkap', statusResult.warning);
      } catch (statusError) {
        console.error('Gagal memuat status mobil.', statusError);
        setCarStatuses(Object.fromEntries(data
          .map((car) => [car.id, {
            status: car.operational_status === 'inactive'
              ? 'Inactive' as const
              : car.operational_status === 'under_maintenance' ? 'Under Maintenance' as const : 'Unknown' as const,
            renter_name: null,
          }])));
        Alert.alert('Gagal memuat status mobil', statusError instanceof Error ? statusError.message : 'Terjadi kesalahan saat memuat status unit.');
      }
    } catch (error) {
      console.error('Error fetching cars:', error);
      setCars([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchCars();
    }, [fetchCars])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchCars();
  };
  const carRows = Array.from({ length: Math.ceil(cars.length / 2) }, (_, index) =>
    cars.slice(index * 2, index * 2 + 2)
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Garasi Saya</Text>
            <Text style={styles.title}>List Mobil</Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} hitSlop={12}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={carRows}
        keyExtractor={(row) => row[0].id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
        renderItem={({ item: row }) => (
          <View style={styles.carRow}>
            {row.map((car) => {
              const carStatus = carStatuses[car.id] ?? { status: 'Unknown' as const, renter_name: null };
              const unavailableToUser = isRestrictedRole && (
                ['Booked', 'Delay', 'Under Maintenance', 'Unknown'].includes(carStatus.status)
              );
              return (
                <CarCard
                  key={car.id}
                  car={car}
                  onPress={() => router.push(`/car/${car.id}`)}
                  disabled={unavailableToUser}
                  statusLabel={carStatus.status}
                  statusDetail={carStatus.renter_name ? `Peminjam: ${carStatus.renter_name}` : null}
                />
              );
            })}
            {row.length === 1 ? <View style={styles.emptyCardSlot} /> : null}
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon={<CarIcon size={32} color={Colors.primary} strokeWidth={2} />}
              title="Belum ada mobil"
              subtitle="Tambahkan mobil pertama Anda untuk mulai melacak perawatan."
            />
          ) : null
        }
      />

      {!isRestrictedRole ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/car/add')}
          activeOpacity={0.85}
        >
          <Plus size={26} color={Colors.white} strokeWidth={2.6} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: Spacing.xl + 18,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontMedium,
    color: Colors.primarySoft,
    marginBottom: 2,
  },
  title: {
    fontSize: Typography.xxxl,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  carRow: {
    flexDirection: 'row',
  },
  emptyCardSlot: {
    flex: 1,
    marginHorizontal: Spacing.xs,
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
});
