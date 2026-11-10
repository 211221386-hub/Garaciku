import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createElement, type ChangeEvent } from 'react';
import { BarChart3, CalendarDays, Download, RefreshCw, Search, TriangleAlert, Wrench } from 'lucide-react-native';
import { Colors, Typography } from '@/lib/theme';
import { workerApiUrl } from '@/lib/supabase';
import { DateField } from '@/components/DateField';

type UnitStatus = 'available' | 'rented' | 'service' | 'attention';
type HistoryType = 'service' | 'rental' | 'inspection' | 'transport' | 'damage';
type Unit = { id: string; name: string; brand: string; model: string; year: number | null; plate_number: string; status: UnitStatus; service_count: number; open_damages: number; completeness: number; last_service: string | null };
type History = { id: string; type: HistoryType; date: string; unit_id: string; title: string; detail: string; amount: number | null };
type DashboardData = {
  updated_at: string;
  units: Unit[];
  unit_options: Pick<Unit, 'id' | 'name' | 'brand' | 'model' | 'year' | 'plate_number'>[];
  histories: History[];
  activity: { label: string; service: number; rental: number; inspection: number; transport: number; damage: number }[];
  totals: Record<HistoryType, number>;
};

const demoData: DashboardData = {
  updated_at: new Date().toISOString(),
  units: [
    { id: '1', name: 'Operasional 01', brand: 'Toyota', model: 'Avanza', year: 2022, plate_number: 'B 1234 GRC', status: 'available', service_count: 8, open_damages: 0, completeness: 100, last_service: '2026-10-24' },
    { id: '2', name: 'Operasional 02', brand: 'Mitsubishi', model: 'Xpander', year: 2021, plate_number: 'B 5678 GRC', status: 'rented', service_count: 6, open_damages: 1, completeness: 92, last_service: '2026-09-18' },
  ],
  unit_options: [
    { id: '1', name: 'Operasional 01', brand: 'Toyota', model: 'Avanza', year: 2022, plate_number: 'B 1234 GRC' },
    { id: '2', name: 'Operasional 02', brand: 'Mitsubishi', model: 'Xpander', year: 2021, plate_number: 'B 5678 GRC' },
  ],
  histories: [
    { id: '1', type: 'service', date: '2026-10-24', unit_id: '1', title: 'Ganti oli berkala', detail: 'Selesai · Bengkel resmi', amount: 850000 },
    { id: '2', type: 'rental', date: '2026-10-20', unit_id: '2', title: 'Peminjaman oleh Budi', detail: 'Dinas luar kota · selesai', amount: null },
    { id: '3', type: 'inspection', date: '2026-10-12', unit_id: '1', title: 'Investigasi / inspeksi unit', detail: 'approved · Admin', amount: null },
  ],
  activity: [{ label: '06/26', service: 3, rental: 2, inspection: 1, transport: 2, damage: 0 }, { label: '07/26', service: 5, rental: 4, inspection: 2, transport: 3, damage: 1 }, { label: '08/26', service: 4, rental: 6, inspection: 3, transport: 4, damage: 1 }],
  totals: { service: 8, rental: 12, inspection: 6, transport: 9, damage: 2 },
};

const typeLabels: Record<HistoryType, string> = { service: 'Service', rental: 'Transportation', inspection: 'Maintenance Check', transport: 'Investigation', damage: 'Accident' };
const statusLabels: Record<UnitStatus, string> = { available: 'Siap digunakan', rented: 'Sedang dipakai', service: 'Dalam service', attention: 'Perlu perhatian' };
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '-';
const formatUpdated = (value: string) => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function downloadExcel(histories: History[], units: Unit[]) {
  if (Platform.OS !== 'web') { Alert.alert('Ekspor Excel', 'Unduhan Excel tersedia melalui browser web dashboard.'); return; }
  const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  const headers = ['Tanggal', 'Jenis Riwayat', 'Unit', 'Aktivitas', 'Detail', 'Nominal'];
  const rows = histories.map((item) => [item.date, typeLabels[item.type], unitName.get(item.unit_id) || item.unit_id, item.title, item.detail, item.amount ?? ''].map(escape).join(','));
  const blob = new Blob([`\uFEFF${headers.map(escape).join(',')}\n${rows.join('\n')}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `riwayat-dashboard-${new Date().toISOString().slice(0, 10)}.xls`; link.click(); URL.revokeObjectURL(url);
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData>(demoData);
  const [unit, setUnit] = useState('all');
  const [type, setType] = useState<'all' | HistoryType>('all');
  const [query, setQuery] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [unitMenuOpen, setUnitMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const loadData = async (unitOverride = unit) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set('start', start); if (end) params.set('end', end); if (unitOverride !== 'all') params.set('unit', unitOverride);
      const response = await fetch(`${workerApiUrl('/api/dashboard')}?${params.toString()}`);
      if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
      const result = await response.json() as DashboardData;
      if (!Array.isArray(result.histories)) throw new Error('Format data riwayat tidak valid.');
      setData(result); setIsDemo(false);
    } catch (error) {
      console.error('Gagal memuat riwayat dashboard:', error); setIsDemo(true); setData(demoData);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  const visibleHistories = useMemo(() => data.histories.filter((item) => {
    const needle = query.trim().toLowerCase();
    return (type === 'all' || item.type === type) && (!needle || `${item.title} ${item.detail}`.toLowerCase().includes(needle));
  }), [data.histories, query, type]);
  const unitById = useMemo(() => new Map(data.units.map((item) => [item.id, item])), [data.units]);
  const chartMax = Math.max(...data.activity.map((item) => item.service + item.rental + item.inspection + item.transport + item.damage), 1);
  const stats = { total: data.units.length, ready: data.units.filter((item) => item.status === 'available').length, attention: data.units.filter((item) => item.status === 'attention' || item.open_damages > 0).length };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>GARACIKU OPERATIONS</Text><Text style={styles.title}>Riwayat Monitoring Unit</Text><Text style={styles.subtitle}>Lihat seluruh riwayat service, peminjaman, investigasi, transportasi, dan kerusakan.</Text></View>
        <View style={styles.actions}><Pressable style={styles.iconButton} onPress={() => loadData()}><RefreshCw size={18} color={Colors.white} /></Pressable><Pressable style={styles.exportButton} onPress={() => downloadExcel(visibleHistories, data.units)}><Download size={18} color={Colors.primaryDark} /><Text style={styles.exportText}>Download Excel</Text></Pressable></View>
      </View>
      <View style={styles.meta}><View style={styles.dot} /><Text style={styles.metaText}>{isDemo ? 'Mode pratinjau' : `Data diperbarui ${formatUpdated(data.updated_at)}`}</Text>{loading && <ActivityIndicator size="small" color={Colors.primary} />}</View>

      <View style={styles.filterCard}>
        <View style={styles.filterTitle}><CalendarDays size={18} color={Colors.primary} /><Text style={styles.cardTitle}>Filter riwayat</Text><Text style={styles.filterHint}>Default: semua unit dan semua periode</Text></View>
        <View style={styles.filterControls}>
          <View style={styles.control}><DateField label="Dari tanggal" value={start} onChange={setStart} placeholder="Pilih tanggal" containerStyle={styles.compactDate} /></View>
          <View style={styles.control}><DateField label="Sampai tanggal" value={end} onChange={setEnd} placeholder="Pilih tanggal" containerStyle={styles.compactDate} /></View>
          <View style={styles.control}><Text style={styles.label}>Unit</Text>{Platform.OS === 'web' ? createElement('select', { value: unit, onChange: (event: ChangeEvent<HTMLSelectElement>) => { setUnit(event.currentTarget.value); }, style: webSelectStyle }, <option value="all">Semua unit</option>, ...data.unit_options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)) : <Pressable style={styles.select} onPress={() => setUnitMenuOpen(true)}><Text style={styles.selectText}>{unit === 'all' ? 'Semua unit' : data.unit_options.find((item) => item.id === unit)?.name || 'Pilih unit'}</Text><Text style={styles.chevron}>⌄</Text></Pressable>}</View>
          <Pressable style={styles.applyButton} onPress={() => loadData()}><Text style={styles.applyText}>Terapkan filter</Text></Pressable>
        </View>
        <Modal visible={unitMenuOpen} transparent animationType="fade" onRequestClose={() => setUnitMenuOpen(false)}><Pressable style={styles.modalBackdrop} onPress={() => setUnitMenuOpen(false)}><View style={styles.dropdownMenu}><Text style={styles.dropdownTitle}>Pilih unit</Text><FilterChip active={unit === 'all'} label="Semua unit" onPress={() => { setUnit('all'); setUnitMenuOpen(false); }} />{data.unit_options.map((item) => <FilterChip key={item.id} active={unit === item.id} label={item.name} onPress={() => { setUnit(item.id); setUnitMenuOpen(false); }} />)}</View></Pressable></Modal>
      </View>

      <View style={styles.statGrid}><StatCard label="Total unit" value={stats.total} tone="green" icon={<BarChart3 size={20} color={Colors.primary} />} /><StatCard label="Riwayat service" value={data.totals.service} tone="orange" icon={<Wrench size={20} color="#D97706" />} /><StatCard label="Riwayat peminjaman" value={data.totals.rental} tone="blue" icon={<CalendarDays size={20} color="#2563EB" />} /><StatCard label="Perlu perhatian" value={stats.attention} tone="red" icon={<TriangleAlert size={20} color="#DC2626" />} /></View>

      <View style={styles.card}><View style={styles.heading}><View><Text style={styles.cardTitle}>Grafik riwayat per bulan</Text><Text style={styles.cardHint}>Perbandingan aktivitas berdasarkan filter unit dan waktu</Text></View></View><View style={styles.chart}>{data.activity.map((item) => { const total = item.service + item.rental + item.inspection + item.transport + item.damage; return <View style={styles.barColumn} key={item.label}><Text style={styles.barValue}>{total}</Text><View style={styles.barTrack}><View style={[styles.bar, { height: `${Math.max(total / chartMax * 100, 8)}%` }]} /></View><Text style={styles.barLabel}>{item.label}</Text></View>; })}</View><View style={styles.legend}>{(Object.keys(typeLabels) as HistoryType[]).map((item) => <Text style={styles.legendItem} key={item}><View style={[styles.legendDot, { backgroundColor: typeColor(item) }]} /> {typeLabels[item]} {data.totals[item]}</Text>)}</View></View>

      <View style={styles.card}><View style={styles.tableHeader}><View><Text style={styles.cardTitle}>Semua riwayat aktivitas</Text><Text style={styles.cardHint}>{visibleHistories.length} riwayat ditampilkan</Text></View><View style={styles.search}><Search size={16} color={Colors.textTertiary} /><TextInput value={query} onChangeText={setQuery} placeholder="Cari riwayat..." placeholderTextColor={Colors.textTertiary} style={styles.searchInput} /></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.table}><View style={[styles.row, styles.headRow]}><Text style={[styles.cell, styles.dateCell, styles.head]}>TANGGAL</Text><Text style={[styles.cell, styles.typeCell, styles.head]}>JENIS</Text><Text style={[styles.cell, styles.unitCell, styles.head]}>UNIT</Text><Text style={[styles.cell, styles.activityCell, styles.head]}>AKTIVITAS</Text><Text style={[styles.cell, styles.detailCell, styles.head]}>DETAIL</Text></View>{visibleHistories.map((item) => <View style={styles.row} key={`${item.type}-${item.id}`}><Text style={[styles.cell, styles.dateCell, styles.normal]}>{formatDate(item.date)}</Text><View style={[styles.cell, styles.typeCell]}><TypePill type={item.type} /></View><Text style={[styles.cell, styles.unitCell, styles.normal]}>{unitById.get(item.unit_id)?.name || '-'}</Text><View style={[styles.cell, styles.activityCell]}><Text style={styles.activityTitle}>{item.title}</Text>{item.amount !== null && <Text style={styles.amount}>Rp {item.amount.toLocaleString('id-ID')}</Text>}</View><Text style={[styles.cell, styles.detailCell, styles.normal]}>{item.detail}</Text></View>)}{visibleHistories.length === 0 && <Text style={styles.empty}>Tidak ada riwayat pada filter yang dipilih.</Text>}</View></ScrollView></View>
      <Text style={styles.footer}>Dashboard riwayat Garaciku · Data operasional internal</Text>
    </ScrollView>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) { return <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>; }
function typeColor(type: HistoryType) { return ({ service: '#F59E0B', rental: '#2563EB', inspection: '#8B5CF6', transport: '#00AA13', damage: '#DC2626' })[type]; }
function TypePill({ type }: { type: HistoryType }) { return <View style={[styles.typePill, { backgroundColor: `${typeColor(type)}18` }]}><Text style={[styles.typeText, { color: typeColor(type) }]}>{typeLabels[type]}</Text></View>; }
function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) { return <View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: ({ green: '#E7F8EC', blue: '#E9F1FF', orange: '#FFF4DF', red: '#FEECEC' } as Record<string, string>)[tone] }]}>{icon}</View><View><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View></View>; }

const webSelectStyle = {
  width: '100%',
  height: 52,
  boxSizing: 'border-box' as const,
  borderWidth: 1,
  borderStyle: 'solid' as const,
  borderColor: '#DDE6E0',
  borderRadius: 9,
  paddingLeft: 11,
  paddingRight: 11,
  color: Colors.textPrimary,
  fontSize: 12,
  fontFamily: Typography.fontRegular,
  backgroundColor: Colors.white,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F9' }, content: { paddingBottom: 42 }, header: { backgroundColor: '#072D22', paddingHorizontal: '5%', paddingTop: 54, paddingBottom: 38, flexDirection: 'row', justifyContent: 'space-between', gap: 20 }, headerCopy: { maxWidth: 700 }, eyebrow: { color: '#91C9A6', fontSize: 11, fontFamily: Typography.fontBold, letterSpacing: 1.8, marginBottom: 10 }, title: { color: Colors.white, fontSize: 34, fontFamily: Typography.fontBold, marginBottom: 8 }, subtitle: { color: '#B9D2C2', fontSize: 14, fontFamily: Typography.fontRegular, lineHeight: 22 }, actions: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }, iconButton: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#356052', alignItems: 'center', justifyContent: 'center' }, exportButton: { height: 42, paddingHorizontal: 15, borderRadius: 12, backgroundColor: '#C8F6D4', flexDirection: 'row', alignItems: 'center', gap: 8 }, exportText: { color: Colors.primaryDark, fontFamily: Typography.fontSemiBold, fontSize: 13 }, meta: { marginHorizontal: '5%', marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 7 }, dot: { width: 7, height: 7, borderRadius: 7, backgroundColor: Colors.success }, metaText: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium },
  filterCard: { marginHorizontal: '5%', marginTop: 18, backgroundColor: Colors.white, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#E8EEEA' }, filterTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }, filterHint: { color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontRegular, marginLeft: 5 }, filterControls: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }, control: { width: 160 }, compactDate: { marginBottom: 0 }, label: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontSemiBold, marginBottom: 6 }, input: { height: 40, borderWidth: 1, borderColor: '#DDE6E0', borderRadius: 9, paddingHorizontal: 11, color: Colors.textPrimary, fontSize: 12, fontFamily: Typography.fontRegular }, select: { height: 52, borderWidth: 1, borderColor: '#DDE6E0', borderRadius: 9, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.white }, selectText: { color: Colors.textPrimary, fontSize: 12, fontFamily: Typography.fontRegular }, chevron: { color: Colors.textSecondary, fontSize: 18 }, applyButton: { height: 52, paddingHorizontal: 16, borderRadius: 9, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }, applyText: { color: Colors.white, fontSize: 12, fontFamily: Typography.fontSemiBold }, chips: { gap: 7, paddingTop: 16 }, chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#F2F6F3' }, chipActive: { backgroundColor: Colors.primary }, chipText: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontMedium }, chipTextActive: { color: Colors.white, fontFamily: Typography.fontSemiBold }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'center', alignItems: 'center' }, dropdownMenu: { width: 280, maxHeight: '70%', backgroundColor: Colors.white, borderRadius: 14, padding: 16, gap: 8 }, dropdownTitle: { color: Colors.textPrimary, fontSize: 15, fontFamily: Typography.fontBold, marginBottom: 4 },
  statGrid: { marginHorizontal: '5%', marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, statCard: { flex: 1, minWidth: 180, backgroundColor: Colors.white, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: '#E8EEEA' }, statIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, statValue: { color: Colors.textPrimary, fontSize: 24, fontFamily: Typography.fontBold }, statLabel: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium, marginTop: 2 },
  card: { marginHorizontal: '5%', marginTop: 18, backgroundColor: Colors.white, borderRadius: 16, padding: 22, borderWidth: 1, borderColor: '#E8EEEA' }, heading: { flexDirection: 'row', justifyContent: 'space-between' }, cardTitle: { color: Colors.textPrimary, fontSize: 16, fontFamily: Typography.fontBold }, cardHint: { color: Colors.textTertiary, fontSize: 12, fontFamily: Typography.fontRegular, marginTop: 4 }, chart: { height: 178, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginTop: 15, borderBottomWidth: 1, borderBottomColor: '#EDF1EE' }, barColumn: { height: '100%', alignItems: 'center', justifyContent: 'flex-end', width: 42, gap: 6 }, barValue: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontSemiBold }, barTrack: { height: 120, width: 26, justifyContent: 'flex-end', backgroundColor: '#F0F6F2', borderRadius: 8, overflow: 'hidden' }, bar: { width: '100%', backgroundColor: Colors.primary, borderRadius: 8 }, barLabel: { color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontMedium, marginBottom: -22 }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20 }, legendItem: { color: Colors.textSecondary, fontSize: 11, fontFamily: Typography.fontMedium }, legendDot: { width: 7, height: 7, borderRadius: 7 },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 15, marginBottom: 18 }, search: { width: 210, height: 38, borderWidth: 1, borderColor: '#DDE6E0', borderRadius: 9, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 7 }, searchInput: { flex: 1, color: Colors.textPrimary, fontFamily: Typography.fontRegular, fontSize: 12 }, table: { minWidth: 930 }, row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F3F1' }, headRow: { minHeight: 34, backgroundColor: '#F7FAF8', borderBottomWidth: 0 }, cell: { paddingHorizontal: 12 }, dateCell: { width: 125 }, typeCell: { width: 125 }, unitCell: { width: 170 }, activityCell: { width: 245 }, detailCell: { width: 240 }, head: { color: Colors.textTertiary, fontSize: 10, fontFamily: Typography.fontBold, letterSpacing: 0.6 }, normal: { color: Colors.textSecondary, fontSize: 12, fontFamily: Typography.fontMedium }, activityTitle: { color: Colors.textPrimary, fontSize: 12, fontFamily: Typography.fontSemiBold }, amount: { color: Colors.primaryDark, fontSize: 11, fontFamily: Typography.fontMedium, marginTop: 4 }, typePill: { alignSelf: 'flex-start', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 6 }, typeText: { fontSize: 10, fontFamily: Typography.fontSemiBold }, empty: { padding: 28, textAlign: 'center', color: Colors.textTertiary, fontFamily: Typography.fontRegular }, footer: { textAlign: 'center', color: Colors.textTertiary, fontSize: 11, fontFamily: Typography.fontRegular, marginTop: 24 },
});
