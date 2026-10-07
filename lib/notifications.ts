import { Platform } from 'react-native';
import type { RentalRecord } from '@/lib/types';

const notifiedKey = 'garaciku.overdue.notifications';

export async function notifyOverdueRentals(rentals: RentalRecord[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('Notification' in window)) return;

  const overdue = rentals.filter((rental) => rental.status === 'overdue');
  if (overdue.length === 0) return;

  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { return; }
  }
  if (Notification.permission !== 'granted') return;

  let notified = new Set<string>();
  try {
    notified = new Set(JSON.parse(window.localStorage.getItem(notifiedKey) ?? '[]') as string[]);
  } catch {
    notified = new Set();
  }

  const pending = overdue.filter((rental) => !notified.has(rental.id));
  if (pending.length === 0) return;

  new Notification('Konfirmasi pengembalian rental', {
    body: pending.length === 1
      ? `Rental ${pending[0].renter_name} sudah melewati jam selesai.`
      : `${pending.length} rental sudah melewati jam selesai. Periksa tab Rental.`,
    tag: 'garaciku-overdue-rentals',
  });

  pending.forEach((rental) => notified.add(rental.id));
  window.localStorage.setItem(notifiedKey, JSON.stringify([...notified]));
}
