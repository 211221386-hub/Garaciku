import { createElement, useState, type ChangeEvent } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

function parseDate(value: string): Date {
  if (!value) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minimumDate?: Date;
};

export function DateField({ label, value, onChange, placeholder = 'Pilih tanggal', minimumDate }: Props) {
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'set' && date) onChange(toISODate(date));
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>{label}</Text>
        {createElement('input', {
          type: 'date',
          value,
          min: minimumDate ? toISODate(minimumDate) : undefined,
          onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value),
          'aria-label': label,
          style: webDateInputStyle,
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={[styles.value, !value && styles.placeholder]}>{value || placeholder}</Text>
        <Calendar size={19} color={Colors.primary} strokeWidth={2.1} />
      </TouchableOpacity>
      {open ? (
        <DateTimePicker
          value={parseDate(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          minimumDate={minimumDate}
        />
      ) : null}
      {open && Platform.OS === 'ios' ? (
        <TouchableOpacity style={styles.doneButton} onPress={() => setOpen(false)}>
          <Text style={styles.doneText}>Selesai</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: { minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface },
  webInput: { flex: 1, paddingVertical: 14 },
  value: { fontSize: Typography.base, fontFamily: Typography.fontRegular, color: Colors.textPrimary },
  placeholder: { color: Colors.textTertiary },
  doneButton: { alignSelf: 'flex-end', paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  doneText: { color: Colors.primary, fontFamily: Typography.fontSemiBold, fontSize: Typography.sm },
});

const webDateInputStyle = {
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
