import type { RentalStatus } from '@/lib/types';

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return 'Rp ' + amount.toLocaleString('id-ID');
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function getRentalStatus(status: RentalStatus, endDate: string | null): RentalStatus {
  return (status === 'active' || status === 'approved') && endDate !== null && endDate < todayISO() ? 'completed' : status;
}

export function differenceInCalendarDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Tanggal rental tidak valid.');
  }

  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
}
