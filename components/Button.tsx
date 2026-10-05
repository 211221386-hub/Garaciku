import { ActivityIndicator, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const bg =
    variant === 'primary'
      ? Colors.primary
      : variant === 'secondary'
        ? Colors.surfaceAlt
        : variant === 'danger'
          ? Colors.error
          : 'transparent';

  const color =
    variant === 'primary' || variant === 'danger'
      ? Colors.textOnPrimary
      : variant === 'secondary'
        ? Colors.textPrimary
        : Colors.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.base, { backgroundColor: bg }, style]}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  label: {
    fontSize: Typography.base,
    fontFamily: Typography.fontSemiBold,
    letterSpacing: 0.2,
  },
});
