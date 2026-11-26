import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const percentages = Array.from({ length: 101 }, (_, value) => value);

export function PercentageField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>{value ? `${value}%` : 'Pilih persentase'}</Text>
        <ChevronDown size={18} color={Colors.primary} />
      </TouchableOpacity>
      {open ? (
        <View style={styles.options}>
          <ScrollView style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {percentages.map((percentage) => (
              <TouchableOpacity
                key={percentage}
                style={[styles.option, value === String(percentage) && styles.selectedOption]}
                onPress={() => {
                  onChange(String(percentage));
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${percentage}%`}
                accessibilityState={{ selected: value === String(percentage) }}
              >
                <Text style={[styles.optionText, value === String(percentage) && styles.selectedOptionText]}>{percentage}%</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  label: { fontSize: Typography.sm, fontFamily: Typography.fontMedium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  dropdown: { minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface },
  value: { fontSize: Typography.base, fontFamily: Typography.fontRegular, color: Colors.textPrimary },
  placeholder: { color: Colors.textTertiary },
  options: { marginTop: Spacing.xs, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surface },
  optionList: { maxHeight: 220 },
  option: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.md },
  selectedOption: { backgroundColor: Colors.primaryLight },
  optionText: { fontSize: Typography.base, fontFamily: Typography.fontRegular, color: Colors.textPrimary },
  selectedOptionText: { color: Colors.primary, fontFamily: Typography.fontSemiBold },
});
