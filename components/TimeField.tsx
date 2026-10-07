import { createElement, type ChangeEvent } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

type Props = { label: string; value: string; onChange: (value: string) => void; placeholder?: string };

export function TimeField({ label, value, onChange, placeholder = 'Pilih jam' }: Props) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>{label}</Text>
        {createElement('input', {
          type: 'time',
          value,
          onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value),
          'aria-label': label,
          style: webInputStyle,
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={Colors.textTertiary} style={styles.input} keyboardType="numbers-and-punctuation" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: { minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, fontSize: Typography.base, fontFamily: Typography.fontRegular, color: Colors.textPrimary, backgroundColor: Colors.surface },
});

const webInputStyle = {
  width: '100%',
  minHeight: 52,
  boxSizing: 'border-box' as const,
  borderWidth: 1,
  borderStyle: 'solid' as const,
  borderColor: Colors.border,
  borderRadius: Radius.md,
  paddingLeft: Spacing.md,
  paddingRight: Spacing.md,
  fontSize: Typography.base,
  fontFamily: Typography.fontRegular,
  color: Colors.textPrimary,
  backgroundColor: Colors.surface,
};
