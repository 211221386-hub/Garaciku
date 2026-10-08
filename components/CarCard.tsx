import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Car as CarIcon } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import type { Car } from '@/lib/types';

type Props = {
  car: Car;
  onPress: () => void;
  disabled?: boolean;
  statusLabel?: string;
};

export function CarCard({ car, onPress, disabled = false, statusLabel }: Props) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.card, disabled && styles.disabledCard]} activeOpacity={0.9} disabled={disabled}>
      <View style={styles.imageWrap}>
        {car.photo_url ? <Image source={{ uri: car.photo_url }} style={[styles.image, disabled ? styles.disabledImage : undefined]} resizeMode="cover" /> : null}
        {!car.photo_url ? <View style={[styles.placeholder, disabled ? styles.disabledPlaceholder : undefined]}><CarIcon size={34} color={Colors.primary} strokeWidth={2.1} /></View> : null}
        <View style={styles.favorite}><Text style={styles.favoriteText}>♡</Text></View>
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, disabled && styles.disabledText]} numberOfLines={1}>
          {car.name}
        </Text>
        <Text style={[styles.subtitle, disabled && styles.disabledText]} numberOfLines={1}>
          {[car.brand, car.model, car.year].filter(Boolean).join(' ') || 'Tidak ada detail'}
        </Text>
        {car.plate_number ? (
          <View style={styles.plateRow}>
          <View style={[styles.plate, disabled && styles.disabledPlate]}>
            <Text style={[styles.plateText, disabled && styles.disabledText]}>{car.plate_number}</Text>
          </View>
          {statusLabel ? (
            <View style={[styles.statusBadge, statusLabel === 'Booked' ? styles.bookedBadge : styles.readyBadge]}>
              <Text style={styles.statusText}>{statusLabel}</Text>
            </View>
          ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    flex: 1,
    marginHorizontal: Spacing.xs,
  },
  disabledCard: { backgroundColor: '#ECEFF1', borderColor: '#D7DDE0' },
  disabledText: { color: '#8A9499' },
  disabledPlate: { backgroundColor: '#E2E6E8', borderColor: '#CDD3D6' },
  imageWrap: { height: 132, backgroundColor: Colors.surfaceAlt, position: 'relative' },
  disabledImage: { opacity: 0.42 },
  disabledPlaceholder: { opacity: 0.42 },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  favorite: { position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  favoriteText: { fontSize: 20, color: Colors.textSecondary, lineHeight: 22 },
  statusBadge: { borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2, alignItems: 'center' },
  bookedBadge: { backgroundColor: 'rgba(45, 55, 60, 0.88)' },
  readyBadge: { backgroundColor: 'rgba(22, 163, 74, 0.9)' },
  statusText: { fontSize: Typography.xs, fontFamily: Typography.fontSemiBold, color: Colors.white, textAlign: 'center' },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  info: { padding: Spacing.sm },
  name: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: Typography.sm,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    minHeight: 36,
  },
  plate: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  plateText: {
    fontSize: Typography.xs,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
});
