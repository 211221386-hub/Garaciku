import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { addDaysToISO, todayISO } from '@/lib/format';
import type { RentalRecord, ServiceRecord } from '@/lib/types';

const notifiedKey = 'garaciku.overdue.notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function notifyNativeOverdueRentals(overdue: RentalRecord[]) {
  const permission = await Notifications.getPermissionsAsync();
  let status = permission.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rental-overdue', {
      name: 'Rental overdue',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledRentalIds = new Set(
    scheduled.map((notification) => notification.content.data?.rentalId).filter(Boolean)
  );

  for (const rental of overdue) {
    if (scheduledRentalIds.has(rental.id)) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Konfirmasi pengembalian rental',
        body: `Rental ${rental.renter_name} sudah melewati jam selesai.`,
        data: { rentalId: rental.id },
        sound: 'default',
      },
      trigger: null,
    });
  }
}

export async function notifyOverdueRentals(rentals: RentalRecord[]) {
  const overdue = rentals.filter((rental) => rental.status === 'overdue');
  if (overdue.length === 0) return;

  if (Platform.OS !== 'web') {
    try { await notifyNativeOverdueRentals(overdue); } catch { return; }
    return;
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return;

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

export async function syncServiceReminders(services: (ServiceRecord & { car_name?: string })[]) {
  if (Platform.OS === 'web') return;

  const reminders = services.filter((service) => service.reminder_enabled && service.next_service_date);
  const today = todayISO();
  const now = Date.now();
  const pending = new Map<string, { service: ServiceRecord & { car_name?: string }; notificationDate: string; triggerDate: Date }>();

  for (const service of reminders) {
    const dueDate = service.next_service_date!;
    const firstNotificationDate = addDaysToISO(dueDate, -7);
    let notificationDate = firstNotificationDate < today ? today : firstNotificationDate;

    while (notificationDate <= dueDate) {
      const triggerDate = new Date(`${notificationDate}T09:00:00`);
      const notificationKey = `${service.id}:${dueDate}:${notificationDate}`;
      if (notificationDate === today && triggerDate.getTime() <= now) triggerDate.setTime(now + 15_000);
      if (triggerDate.getTime() > now) pending.set(notificationKey, { service, notificationDate, triggerDate });
      notificationDate = addDaysToISO(notificationDate, 1);
    }
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = scheduled.filter((notification) => notification.content.data?.kind === 'service-reminder');

  for (const notification of existing) {
    const notificationKey = notification.content.data?.notificationKey;
    if (typeof notificationKey !== 'string' || !pending.has(notificationKey)) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    } else {
      pending.delete(notificationKey);
    }
  }

  if (pending.size === 0) return;

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('service-reminders', {
      name: 'Service reminders',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  for (const [notificationKey, { service, notificationDate, triggerDate }] of pending) {
    if (Number.isNaN(triggerDate.getTime())) continue;
    const daysUntilService = Math.round((new Date(`${service.next_service_date}T00:00:00Z`).getTime() - new Date(`${notificationDate}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Jadwal service mobil',
        body: daysUntilService === 0
          ? `${service.service_type} untuk ${service.car_name || 'mobil'} dijadwalkan hari ini.`
          : `${service.service_type} untuk ${service.car_name || 'mobil'} dijadwalkan dalam ${daysUntilService} hari.`,
        data: { kind: 'service-reminder', serviceId: service.id, dueDate: service.next_service_date, notificationDate, notificationKey },
        sound: 'default',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
  }
}
