import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BarChart3, CarFront, Download, RefreshCw, Search, TriangleAlert, Wrench } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/lib/theme';
import { workerApiUrl } from '@/lib/supabase';

type UnitStatus = 'available' | 'rented' | 'service' | 'attention';
type Unit = {
  id: string;
  name: string;
  brand: string;
  model: string;
  year: number | null;
  plate_number: string;
  status: UnitStatus;
  service_count: number;
  open_damages: number;
  completeness: number;
  last_service: string | null;
};
type DashboardData = {
  updated_at: string;
  units: Unit[];
  activity: { label: string; value: number }[];
};

const demoData: DashboardData = {
  updated_at: new Date().toISOString(),
  units: [
    { id: '1', name: 'Operasional 01', brand: 'Toyota', model: 'Avanza', year: 2022, plate_number: 'B 1234 GRC', status: 'available', service_count: 8, open_damages: 0, completeness: 100, last_service: '2026-10-24' },
    { id: '2', name: 'Operasional 02', brand: 'Mitsubishi', model: 'Xpander', year: 2021, plate_number: 'B 5678 GRC', status: 'rented', service_count: 6, open_damages: 1, completeness: 92, last_service: '2026-09-18' },
    { id: '3', name: 'Operasional 03', brand: 'Honda', model: 'Brio', year: 2023, plate_number: 'B 9012 GRC', status: 'service', service_count: 4, open_damages: 2, completeness: 78, last_service: '2026-08-03' },
  ],
  activity: [
    { label: 'Jun', value: 5 }, { label: 'Jul', value: 8 }, { label: 'Agu', value: 6 },
    { label: 'Sep', value: 11 }, { label: 'Okt', value: 9 }, { label: 'Nov', value: 13 },
  ],
};

const statusLabels: Record<UnitStatus, string> = {
  available: 'Siap digunakan',
  rented: 'Sedang dipakai',
  service: 'Dalam service',
  attention: 'Perlu perhatian',
};

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function downloadExcel(units: Unit[]) {
  if (Platform.OS !== 'web') {
    Alert.alert('Ekspor Excel', 'Unduhan Excel tersedia melalui browser web dashboard.');
    return;
  }
  const headers = ['Unit', 'Merek', 'Model', 'Tahun', 'Nomor Polisi', 'Status', 'Service', 'Kerusakan Terbuka', 'Kelengkapan (%)', 'Service Terakhir'];
  const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = units.map((unit) => [
    unit.name, unit.brand, unit.model, unit.year ?? '', unit.plate_number, statusLabels[unit.status],
    unit.service_count, unit.open_damages, unit.completeness, formatDate(unit.last_service),
  ].map(escape).join(','));
  const csv = `\uFEFF${headers.map(escape).join(',')}\n${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `monitoring-unit-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData>(demoData);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UnitStatus>('all');
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetch(workerApiUrl('/api/dashboard'));
      if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
      const result = await response.json() as DashboardData;
      if (!Array.isArray(result.units)) throw new Error('Format data dashboard tidak valid.');
      setData(result);
      setIsDemo(false);
    } catch (error) {
      console.error('Gagal memuat dashboard:', error);
      setIsDemo(true);
      setData((current) => ({ ...demoData, updated_at: current.updated_at }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filteredUnits = useMemo(() => data.units.filter((unit) => {
    const matchesStatus = statusFilter === 'all' || unit.status === statusFilter;
    const needle = query.trim().toLowerCase();
    return matchesStatus && (!needle || `${unit.name} ${unit.brand} ${unit.model} ${unit.plate_number}`.toLowerCase().includes(needle));
  }), [data.units, query, statusFilter]);

  const stats = useMemo(() => ({
    total: data.units.length,
    ready: data.units.filter((unit) => unit.status === 'available').length,
    service: data.units.filter((unit) => unit.status === 'service').length,
    attention: data.units.filter((unit) => unit.status === 'attention' || unit.open_damages > 0).length,
  }), [data.units]);
  const maxActivity = Math.max(...data.activity.map((item) => item.value), 1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>GARACIKU OPERATIONS</Text>
          <Text style={styles.title}>Monitoring Unit</Text>
          <Text style={styles.subtitle}>Pantau kondisi, ketersediaan, dan perawatan seluruh unit dalam satu layar.</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.headerButton} onPress={loadData}><RefreshCw size={18} color={Colors.white} /></Pressable>
          <Pressable style={styles.exportButton} onPress={() => downloadExcel(filteredUnits)}>
            <Download size={18} color={Colors.primaryDark} />
            <Text style={styles.exportText}>Download Excel</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.liveDot} />
        <Text style={styles.metaText}>{isDemo ? 'Mode pratinjau' : `Data diperbarui ${formatUpdated(data.updated_at)}`}</Text>
        {loading && <ActivityIndicator size="small" color={Colors.primary} />}
      </View>

      <View style={styles.statGrid}>
        <StatCard label="Total unit" value={stats.total} icon={<CarFront size={21} color={Colors.primary} />} tone="green" />
        <StatCard label="Siap digunakan" value={stats.ready} icon={<BarChart3 size={21} color="#2563EB" />} tone="blue" />
        <StatCard label="Dalam service" value={stats.service} icon={<Wrench size={21} color="#D97706" />} tone="orange" />
        <StatCard label="Perlu perhatian" value={stats.attention} icon={<TriangleAlert size={21} color="#DC2626" />} tone="red" />
      </View>

      <View style={styles.chartCard}>
        <View style={styles.cardHeading}>
          <View><Text style={styles.cardTitle}>Aktivitas operasional</Text><Text style={styles.cardHint}>Jumlah aktivitas unit per bulan</Text></View>
          <Text style={styles.periodLabel}>6 bulan terakhir</Text>
        </View>
        <View style={styles.chart}>
          {data.activity.map((item) => (
            <View style={styles.barColumn} key={item.label}>
              <Text style={styles.barValue}>{item.value}</Text>
              <View style={styles.barTrack}><View style={[styles.bar, { height: `${Math.max((item.value / maxActivity) * 100, 8)}%` }]} /></View>
              <Text style={styles.barLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <View><Text style={styles.cardTitle}>Daftar seluruh unit</Text><Text style={styles.cardHint}>{filteredUnits.length} unit ditampilkan</Text></View>
          <View style={styles.searchBox}><Search size={16} color={Colors.textTertiary} /><TextInput value={query} onChangeText={setQuery} placeholder="Cari unit..." placeholderTextColor={Colors.textTertiary} style={styles.searchInput} /></View>
        </View>
        <View style={styles.filterRow}>
          {(['all', 'available', 'rented', 'service', 'attention'] as const).map((filter) => (
            <Pressable key={filter} onPress={() => setStatusFilter(filter)} style={[styles.filterChip, statusFilter === filter && styles.filterChipActive]}>
              <Text style={[styles.filterText, statusFilter === filter && styles.filterTextActive]}>
                {filter === 'all' ? 'Semua' : statusLabels[filter]}
              </Text>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeadRow]}>
              <Text style={[styles.cell, styles.unitCell, styles.headText]}>UNIT</Text><Text style={[styles.cell, styles.statusCell, styles.headText]}>STATUS</Text><Text style={[styles.cell, styles.metricCell, styles.headText]}>KELENGKAPAN</Text><Text style={[styles.cell, styles.metricCell, styles.headText]}>SERVICE</Text><Text style={[styles.cell, styles.metricCell, styles.headText]}>KERUSAKAN</Text><Text style={[styles.cell, styles.dateCell, styles.headText]}>SERVICE TERAKHIR</Text>
            </View>
            {filteredUnits.map((unit) => (
              <View style={styles.tableRow} key={unit.id}>
                <View style={[styles.cell, styles.unitCell]}><Text style={styles.unitName}>{unit.name}</Text><Text style={styles.unitDetail}>{unit.brand} {unit.model} · {unit.plate_number}</Text></View>
                <View style={[styles.cell, styles.statusCell]}><StatusPill status={unit.status} /></View>
                <View style={[styles.cell, styles.metricCell]}><Text style={styles.metricText}>{unit.completeness}%</Text><View style={styles.progressTrack}><View style={[styles.progress, { width: `${unit.completeness}%` }]} /></View></View>
                <Text style={[styles.cell, styles.metricCell, styles.numberText]}>{unit.service_count} kali</Text>
                <Text style={[styles.cell, styles.metricCell, unit.open_damages > 0 ? styles.dangerText : styles.numberText]}>{unit.open_damages} terbuka</Text>
                <Text style={[styles.cell, styles.dateCell, styles.numberText]}>{formatDate(unit.last_service)}</Text>
              </View>
            ))}
            {filteredUnits.length === 0 && <Text style={styles.emptyText}>Tidak ada unit yang sesuai filter.</Text>}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.footer}>Dashboard monitoring Garaciku · Data operasional internal</Text>
    </ScrollView>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'green' | 'blue' | 'orange' | 'red' }) {
  return <View style={styles.statCard}><View style={[styles.statIcon, styles[`stat${tone}`]]}>{icon}</View><View><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View></View>;
}

function StatusPill({ status }: { status: UnitStatus }) {
  return <Pressable style={[styles.pill, styles[`pill${status}`]]}><View style={styles.pillDot} /><Text style={[styles.pillText, styles[`pillText${status}`]]}>{statusLabels[status]}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F9' },
  content: { paddingBottom: 42 },
  header: { backgroundColor: '#072D22', paddingHorizontal: '5%', paddingTop: 54, paddingBottom: 38, flexDirection: 'row', justifyContent: 'space-between', gap: 20 },
  headerCopy: { maxWidth: 650 },
  eyebrow: { color: '#91C9A6', fontSize: 11, fontFamily: Typography.fontBold, letterSpacing: 1.8, marginBottom: 10 },
  title: { color: Colors.white, fontSize: 34, fontFamily: Typography.fontBold, marginBottom: 8 },
  subtitle: { color: '#B9D2C2', fontSize: 14, fontFamily: Typography.fontRegular, lineHeight: 22 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' },
  headerButton: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#356052', alignItems: 'center', justifyContent: 'center' },
  exportButton: { height: 42, paddingHorizontal: 15, borderRadius: 12, backgroundColor: '#C8F6D4', flexDirection: 'row', alignItems: 'center', gap: 8 },
  exportText: { color: Colors.primaryDark, fontFamily: Typography.fontSemiBold, fontSize: 13 },
  metaRow: { marginHorizontal: '5%', marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: Colors.success },
  metaText: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium },
  statGrid: { marginHorizontal: '5%', marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flex: 1, minWidth: 180, backgroundColor: Colors.white, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: '#E8EEEA' },
  statIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statgreen: { backgroundColor: '#E7F8EC' }, statblue: { backgroundColor: '#E9F1FF' }, statorange: { backgroundColor: '#FFF4DF' }, statred: { backgroundColor: '#FEECEC' },
  statValue: { color: Colors.textPrimary, fontSize: 24, fontFamily: Typography.fontBold }, statLabel: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium, marginTop: 2 },
  chartCard: { marginHorizontal: '5%', marginTop: 18, backgroundColor: Colors.white, borderRadius: 16, padding: 22, borderWidth: 1, borderColor: '#E8EEEA' },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, cardTitle: { color: Colors.textPrimary, fontSize: 16, fontFamily: Typography.fontBold }, cardHint: { color: Colors.textTertiary, fontSize: 12, fontFamily: Typography.fontRegular, marginTop: 4 }, periodLabel: { color: Colors.primaryDark, backgroundColor: '#E7F8EC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 11, fontFamily: Typography.fontSemiBold },
  chart: { height: 178, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginTop: 15, borderBottomWidth: 1, borderBottomColor: '#EDF1EE' },
  barColumn: { height: '100%', alignItems: 'center', justifyContent: 'flex-end', width: 42, gap: 6 }, barValue: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontSemiBold }, barTrack: { height: 120, width: 26, justifyContent: 'flex-end', backgroundColor: '#F0F6F2', borderRadius: 8, overflow: 'hidden' }, bar: { width: '100%', backgroundColor: Colors.primary, borderRadius: 8 }, barLabel: { color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontMedium, marginBottom: -22 },
  tableCard: { marginHorizontal: '5%', marginTop: 18, backgroundColor: Colors.white, borderRadius: 16, padding: 22, borderWidth: 1, borderColor: '#E8EEEA' }, tableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 15, marginBottom: 12 }, searchBox: { width: 190, height: 38, borderWidth: 1, borderColor: '#DDE6E0', borderRadius: 9, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 7 }, searchInput: { flex: 1, color: Colors.textPrimary, fontFamily: Typography.fontRegular, fontSize: 12 }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }, filterChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: '#F3F6F4' }, filterChipActive: { backgroundColor: Colors.primary }, filterText: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontMedium }, filterTextActive: { color: Colors.white, fontFamily: Typography.fontSemiBold }, table: { minWidth: 850 }, tableRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F3F1' }, tableHeadRow: { minHeight: 34, backgroundColor: '#F7FAF8', borderRadius: 6, borderBottomWidth: 0 }, cell: { paddingHorizontal: 12 }, unitCell: { width: 245 }, statusCell: { width: 145 }, metricCell: { width: 125 }, dateCell: { width: 145 }, headText: { color: Colors.textTertiary, fontSize: 10, fontFamily: Typography.fontBold, letterSpacing: 0.6 }, unitName: { color: Colors.textPrimary, fontSize: 13, fontFamily: Typography.fontSemiBold }, unitDetail: { color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontRegular, marginTop: 5 }, metricText: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontSemiBold, marginBottom: 5 }, numberText: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium }, dangerText: { color: Colors.error, fontSize: 12, fontFamily: Typography.fontSemiBold }, progressTrack: { height: 5, width: 78, backgroundColor: '#EDF2EE', borderRadius: 4 }, progress: { height: 5, backgroundColor: Colors.primary, borderRadius: 4 }, pill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }, pillDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: 'currentColor' }, pillText: { fontSize: 10, fontFamily: Typography.fontSemiBold }, pillavailable: { backgroundColor: '#E7F8EC' }, pillrented: { backgroundColor: '#E9F1FF' }, pillservice: { backgroundColor: '#FFF4DF' }, pillattention: { backgroundColor: '#FEECEC' }, pillTextavailable: { color: Colors.success }, pillTextrented: { color: '#2563EB' }, pillTextservice: { color: '#B45309' }, pillTextattention: { color: Colors.error }, emptyText: { padding: 28, textAlign: 'center', color: Colors.textTertiary, fontFamily: Typography.fontRegular }, footer: { textAlign: 'center', color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontRegular, marginTop: 24 },
});
