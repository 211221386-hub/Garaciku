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

export function addDaysToISO(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsToISO(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonth.setUTCDate(Math.min(day, lastDay));
  return targetMonth.toISOString().slice(0, 10);
}

export function getRentalStatus(status: RentalStatus, endDate: string | null, endTime: string | null = null): RentalStatus {
  if ((status !== 'active' && status !== 'approved') || !endDate || !endTime) return status;
  const now = new Date();
  const end = new Date(`${endDate}T${endTime}:00+07:00`);
  return end.getTime() <= now.getTime() ? 'overdue' : status;
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
