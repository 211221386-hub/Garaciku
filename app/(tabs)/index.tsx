import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Car as CarIcon, Plus, Search, RefreshCw } from 'lucide-react-native';
import { apiClient } from '@/lib/api';
import { Colors, Spacing, Typography, Radius } from '@/lib/theme';
import type { Car } from '@/lib/types';
import { CarCard } from '@/components/CarCard';
import { EmptyState } from '@/components/EmptyState';
import { getSession } from '@/lib/auth';

export default function CarsScreen() {
  const [cars, setCars] = useState<Car[]>([]);
  const [currentlyRentedCarIds, setCurrentlyRentedCarIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRestrictedRole = ![1, 2].includes(getSession()?.user.role ?? 4);

  const fetchCars = useCallback(async () => {
    try {
      const [data, rentedIds] = await Promise.all([
        apiClient.cars.getAll(),
        apiClient.rentals.getCurrentlyRentedCarIds(),
      ]);
      setCars(data);
      setCurrentlyRentedCarIds(rentedIds);
    } catch (error) {
      console.error('Error fetching cars:', error);
    }
    setLoading(false);
    setRefreshing(false);
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Garasi Saya</Text>
            <Text style={styles.title}>Perawatan Mobil</Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} hitSlop={12}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={cars}
        numColumns={2}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
        renderItem={({ item }) => {
          const isCurrentlyRented = currentlyRentedCarIds.includes(item.id);
          const unavailableToUser = isRestrictedRole && isCurrentlyRented;
          return (
            <CarCard
              car={item}
              onPress={() => router.push(`/car/${item.id}`)}
              disabled={unavailableToUser}
              statusLabel={unavailableToUser ? 'Sedang digunakan' : undefined}
            />
          );
        }}
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
