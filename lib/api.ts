import { supabase, workerApiUrl } from '@/lib/supabase';
import type { AppUser, Car, CarDisplayStatus, DailyNote, DailyNoteReturnItineraryDetails, CompletenessItem, Damage, RentalRecord, RentalReturnItineraryDetails, RentalStatus, ServiceRecord, VehicleInspection, VehicleInspectionItem, VehicleInspectionPhoto } from '@/lib/types';
import { addDaysToISO, getRentalStatus, todayISO } from '@/lib/format';
import { getSession } from '@/lib/auth';

export type LoginResult = {
  user: AppUser;
  token?: string;
  expiresAt?: number;
};

export type VehicleTaxType = 'annual' | 'plate';

export type CreateRentalCycleInput = {
  car_ids: string[];
  renter_name?: string;
  renter_email?: string;
  renter_phone?: string;
  start_date: string;
  start_time: string;
  end_date: string | null;
  end_time: string | null;
  purpose: string;
  notes: string;
};

export type UnitAvailability = {
  car_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
};

async function unwrap<T>(request: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data as T;
}

function withCarName<T extends { cars?: { name: string } | null }>(row: T): Omit<T, 'cars'> & { car_name: string } {
  const { cars, ...data } = row;
  return { ...data, car_name: cars?.name ?? '' };
}

function isBlockingRental(rental: { status: RentalStatus }) {
  return rental.status === 'active' || rental.status === 'approved' || rental.status === 'overdue';
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const timeoutError = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error(timeoutMessage)), { once: true });
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeoutError,
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callWorker(path: string, payload: Record<string, unknown>) {
  const session = getSession();
  if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
  const response = await fetchWithTimeout(workerApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(payload),
  }, 10000, 'Notifikasi otomatis tidak merespons dalam 10 detik.');
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
}

async function createWorkerRentalCycle(payload: CreateRentalCycleInput): Promise<RentalRecord[]> {
  const session = getSession();
  if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
  const response = await fetchWithTimeout(workerApiUrl('/api/rentals/create-cycle'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(payload),
  }, 20000, 'Penyimpanan Transportation melewati batas waktu. Periksa koneksi lalu muat ulang daftar sebelum mencoba lagi.');
  const result = await response.json().catch(() => null) as { data?: RentalRecord[]; error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
  if (!Array.isArray(result?.data)) throw new Error('Worker mengembalikan data siklus peminjaman yang tidak valid.');
  return result.data;
}

class ApiClient {
  users = {
    getAll: () => unwrap<AppUser[]>(supabase.from('users').select('id, username, full_name, email, phone, role, is_active, created_at').order('created_at', { ascending: false })),
    login: async (username: string, password: string): Promise<LoginResult | null> => {
      const response = await fetch(workerApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 401) return null;
      const result = await response.json().catch(() => null) as { user?: AppUser; token?: string; expiresAt?: number; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.user || !result.token || !result.expiresAt) return null;
      return { user: result.user, token: result.token, expiresAt: result.expiresAt };
    },
    register: async (username: string, fullName: string, email: string, phone: string, password: string): Promise<LoginResult> => {
      const response = await fetch(workerApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, fullName, email, phone, password }),
      });
      const result = await response.json().catch(() => null) as { user?: AppUser; token?: string; expiresAt?: number; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.user || !result.token || !result.expiresAt) throw new Error('Respons pendaftaran tidak valid.');
      return { user: result.user, token: result.token, expiresAt: result.expiresAt };
    },
    updateProfile: async (profile: Pick<AppUser, 'full_name' | 'email' | 'phone'>): Promise<AppUser> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/profile/update'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(profile),
      });
      const result = await response.json().catch(() => null) as { data?: AppUser; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data profil yang tidak valid.');
      return result.data;
    },
    completeFirstLogin: async (data: Pick<AppUser, 'full_name' | 'email' | 'phone'> & { new_password: string }): Promise<AppUser> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/auth/complete-profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => null) as { data?: AppUser; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data onboarding yang tidak valid.');
      return result.data;
    },
  };

  cars = {
    getAll: async () => {
      const cars = await unwrap<Car[]>(supabase.from('cars').select('*').order('created_at', { ascending: false }));
      return [3, 4].includes(getSession()?.user.role ?? 0)
        ? cars.filter((car) => car.operational_status !== 'inactive')
        : cars;
    },
    getById: (id: string) => unwrap<Car>(supabase.from('cars').select('*').eq('id', id).single()),
    create: (data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) {
        throw new Error('Hanya role 1 atau 2 yang dapat menambahkan mobil.');
      }
      return unwrap<Car>(supabase.from('cars').insert(data).select().single());
    },
    update: (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya role 1 atau 2 yang dapat mengubah data mobil.');
      return unwrap<Car>(supabase.from('cars').update(data).eq('id', id).select().single());
    },
    confirmTax: async (carId: string, taxType: VehicleTaxType, expectedDueDate: string): Promise<Car> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      if (![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 atau 2 yang dapat mengonfirmasi pajak kendaraan.');
      const response = await fetch(workerApiUrl('/api/cars/confirm-tax'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ car_id: carId, tax_type: taxType, expected_due_date: expectedDueDate }),
      });
      const result = await response.json().catch(() => null) as { data?: Car; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal mengonfirmasi pajak kendaraan.');
      return result.data;
    },
    setOperationalStatus: (id: string, operationalStatus: Car['operational_status']) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) {
        throw new Error('Hanya role 1 atau 2 yang dapat mengubah status unit.');
      }
      return unwrap<Car>(supabase.from('cars').update({
        operational_status: operationalStatus,
      }).eq('id', id).select().single());
    },
    getStatuses: async (carIds: string[]) => {
      if (!carIds.length) return { statuses: {}, warning: null };
      let cars: Pick<Car, 'id' | 'operational_status' | 'annual_tax_due_date' | 'plate_tax_due_date'>[];
      let taxDatesAvailable = true;
      try {
        cars = await unwrap<Pick<Car, 'id' | 'operational_status' | 'annual_tax_due_date' | 'plate_tax_due_date'>[]>(
          supabase.from('cars').select('id,operational_status,annual_tax_due_date,plate_tax_due_date').in('id', carIds)
        );
      } catch (error) {
        console.warn('Kolom pajak kendaraan belum tersedia; memuat status tanpa tanggal pajak.', error);
        try {
          const legacyCars = await unwrap<Pick<Car, 'id' | 'operational_status'>[]>(
            supabase.from('cars').select('id,operational_status').in('id', carIds)
          );
          cars = legacyCars.map((car) => ({ ...car, annual_tax_due_date: null, plate_tax_due_date: null }));
          taxDatesAvailable = false;
        } catch (legacyError) {
          console.warn('Kolom operational_status belum tersedia; unit dianggap Ready sampai migration dijalankan.', legacyError);
          const oldestCars = await unwrap<{ id: string }[]>(
            supabase.from('cars').select('id').in('id', carIds)
          );
          cars = oldestCars.map((car) => ({
            ...car,
            operational_status: 'ready' as const,
            annual_tax_due_date: null,
            plate_tax_due_date: null,
          }));
          taxDatesAvailable = false;
        }
      }

      const rentals = await unwrap<Pick<RentalRecord, 'car_id' | 'status' | 'renter_name' | 'end_date' | 'end_time'>[]>(
        supabase.from('rental_records').select('car_id,status,renter_name,end_date,end_time').in('status', ['active', 'approved', 'overdue']).in('car_id', carIds)
      );
      const session = getSession();
      const isRestrictedRole = [3, 4].includes(session?.user.role ?? 0);
      const investigationSelection = isRestrictedRole
        ? 'car_id,status,start_date,start_time,end_date,end_time'
        : 'car_id,created_name,status,start_date,start_time,end_date,end_time';
      const investigations = await unwrap<(Pick<DailyNote, 'car_id' | 'status' | 'start_date' | 'start_time' | 'end_date' | 'end_time'> & { created_name?: string })[]>(
        supabase.from('daily_notes').select(investigationSelection).eq('status', 'active').in('car_id', carIds)
      );
      const [ownRentals, ownInvestigations] = isRestrictedRole
        ? await Promise.all([
          this.rentals.getAll(),
          this.notes.getAll(),
        ])
        : [[], []];
      const rentalNames = new Map<string, string>();
      for (const rental of [...rentals, ...ownRentals]) {
        if (rental.renter_name) rentalNames.set(rental.car_id, rental.renter_name);
      }
      const investigationNames = new Map<string, string>();
      for (const note of [...investigations, ...ownInvestigations]) {
        if (note.status === 'active' && note.created_name) investigationNames.set(note.car_id, note.created_name);
      }
      let services: Pick<ServiceRecord, 'car_id' | 'next_service_date' | 'reminder_enabled' | 'status' | 'is_recurring'>[] = [];
      let serviceDetailsAvailable = true;
      try {
        const restrictedRole = [3, 4].includes(getSession()?.user.role ?? 0);
        services = await unwrap(
          restrictedRole
            ? supabase.from('service_records').select('car_id,status,service_date').in('status', ['scheduled', 'in_progress']).in('car_id', carIds)
            : supabase.from('service_records').select('car_id,next_service_date,reminder_enabled,status,is_recurring').in('status', ['scheduled', 'in_progress']).in('car_id', carIds)
        );
      } catch (error) {
        serviceDetailsAvailable = false;
        console.warn('Gagal memuat detail pengingat Service; mencoba memuat status Service dasar.', error);
        try {
          const basicServices = await unwrap<Pick<ServiceRecord, 'car_id' | 'status' | 'service_date'>[]>(
            supabase.from('service_records').select('car_id,status,service_date').in('status', ['scheduled', 'in_progress']).in('car_id', carIds)
          );
          services = basicServices.map((service) => ({
            ...service,
            next_service_date: null,
            reminder_enabled: false,
            is_recurring: false,
          }));
        } catch (fallbackError) {
          console.error('Gagal memuat status Service dasar.', fallbackError);
          throw new Error('Status Service tidak dapat dimuat. Periksa akses data Service dan deployment Worker.');
        }
      }
      const today = todayISO();
      const result: Record<string, { status: CarDisplayStatus; renter_name: string | null }> = {};

      for (const car of cars) {
        const taxDueDates = [car.annual_tax_due_date, car.plate_tax_due_date].filter((date): date is string => date !== null);
        const taxUnderMaintenance = taxDueDates.some((date) => today >= date);
        const taxReminderDue = taxDueDates.some((date) => today >= addDaysToISO(date, -21));
        const carRentals = rentals.filter((rental) => rental.car_id === car.id)
          .map((rental) => ({
            ...rental,
            renter_name: rental.renter_name ?? null,
            status: getRentalStatus(rental.status, rental.end_date, rental.end_time),
          }));
        const delayedRental = carRentals.find((rental) => rental.status === 'overdue');
        const bookedRental = carRentals.find((rental) => rental.status === 'active' || rental.status === 'approved');
        const carInvestigations = investigations.filter((note) => note.car_id === car.id)
          .map((note) => ({
            ...note,
            status: getRentalStatus('active', note.end_date, note.end_time),
          }));
        const delayedInvestigation = carInvestigations.find((note) => note.status === 'overdue');
        const bookedInvestigation = carInvestigations.find((note) => note.status === 'active');
        const serviceInProgress = services.some((service) => service.car_id === car.id && service.status === 'in_progress');
        const hasServiceDue = services.some((service) => service.car_id === car.id
          && service.status === 'scheduled'
          && service.reminder_enabled
          && service.next_service_date !== null
          && today >= addDaysToISO(service.next_service_date, service.is_recurring ? -7 : -2));

        if (car.operational_status === 'inactive') {
          result[car.id] = { status: 'Inactive', renter_name: null };
        } else if (car.operational_status === 'under_maintenance') {
          result[car.id] = { status: 'Under Maintenance', renter_name: null };
        } else if (serviceInProgress) {
          result[car.id] = { status: 'Under Maintenance', renter_name: null };
        } else if (taxUnderMaintenance) {
          result[car.id] = { status: 'Under Maintenance', renter_name: null };
        } else if (taxReminderDue) {
          result[car.id] = { status: 'Time to Service', renter_name: null };
        } else if (delayedRental) {
          result[car.id] = { status: 'Delay', renter_name: rentalNames.get(car.id) ?? null };
        } else if (delayedInvestigation) {
          result[car.id] = { status: 'Delay', renter_name: investigationNames.get(car.id) ?? null };
        } else if (bookedRental) {
          result[car.id] = { status: 'Booked', renter_name: rentalNames.get(car.id) ?? null };
        } else if (bookedInvestigation) {
          result[car.id] = { status: 'Booked', renter_name: investigationNames.get(car.id) ?? null };
        } else if (hasServiceDue) {
          result[car.id] = { status: 'Time to Service', renter_name: null };
        } else {
          result[car.id] = { status: 'Ready', renter_name: null };
        }
      }
      return {
        statuses: result,
        warning: serviceDetailsAvailable
          ? taxDatesAvailable
            ? null
            : 'Tanggal pajak kendaraan belum dapat dibaca. Jalankan migration pajak kendaraan agar reminder dan status pajak dihitung.'
          : `Status mobil berhasil dimuat. Detail pengingat Service tidak tersedia, tetapi peminjaman dan Service yang sedang berjalan tetap dihitung.${taxDatesAvailable ? '' : ' Tanggal pajak juga belum dapat dibaca; jalankan migration pajak kendaraan.'}`,
      };
    },
    delete: async (id: string) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya role 1 atau 2 yang dapat menghapus mobil.');
      await unwrap(supabase.from('cars').delete().eq('id', id));
      return { success: true };
    },
  };

  rentals = {
    getCurrentlyRentedCarIds: async () => {
      const rows = await unwrap<{ car_id: string; status: RentalStatus }[]>(
        supabase.from('rental_records').select('car_id, status').in('status', ['active', 'approved', 'overdue'])
      );
      return [...new Set(rows.filter(isBlockingRental).map((rental) => rental.car_id))];
    },
    getAvailability: async (): Promise<UnitAvailability[]> => {
      const [rentals, notes, services, cars] = await Promise.all([
        unwrap<Pick<RentalRecord, 'car_id' | 'status' | 'start_date' | 'end_date'>[]>(
          supabase.from('rental_records').select('car_id,status,start_date,end_date').in('status', ['pending', 'active', 'approved', 'overdue'])
        ),
        unwrap<Pick<DailyNote, 'car_id' | 'status' | 'start_date' | 'end_date'>[]>(
          supabase.from('daily_notes').select('car_id,status,start_date,end_date').in('status', ['pending_approval', 'active'])
        ),
        unwrap<Pick<ServiceRecord, 'car_id' | 'status' | 'service_date'>[]>(
          supabase.from('service_records').select('car_id,status,service_date').in('status', ['scheduled', 'in_progress'])
        ),
        (async () => {
          try {
            return await unwrap<Pick<Car, 'id' | 'operational_status' | 'annual_tax_due_date' | 'plate_tax_due_date'>[]>(
              supabase.from('cars').select('id,operational_status,annual_tax_due_date,plate_tax_due_date')
            );
          } catch (error) {
            console.warn('Tanggal pajak belum tersedia saat memuat ketersediaan unit.', error);
            return (await unwrap<Pick<Car, 'id' | 'operational_status'>[]>(
              supabase.from('cars').select('id,operational_status')
            )).map((car) => ({ ...car, annual_tax_due_date: null, plate_tax_due_date: null }));
          }
        })(),
      ]);
      return [
        ...rentals,
        ...notes,
        ...services.map((service) => ({
          car_id: service.car_id,
          status: service.status,
          start_date: service.service_date,
          end_date: service.status === 'in_progress' ? null : service.service_date,
        })),
        ...cars.flatMap((car) => [car.annual_tax_due_date, car.plate_tax_due_date]
          .filter((dueDate): dueDate is string => dueDate !== null)
          .map((dueDate) => ({
            car_id: car.id,
            status: 'tax_due',
            start_date: dueDate,
            end_date: dueDate < todayISO() ? null : dueDate,
          }))),
        ...cars.filter((car) => ['under_maintenance', 'inactive'].includes(car.operational_status)).map((car) => ({
          car_id: car.id,
          status: car.operational_status,
          start_date: '',
          end_date: null,
        })),
      ];
    },
    getAll: async () => {
      const session = getSession();
      let query = supabase.from('rental_records').select('*, cars(name)').order('created_at', { ascending: false });
      if (session && [3, 4].includes(session.user.role)) query = query.eq('user_id', session.user.id);
      return (await unwrap<(RentalRecord & { cars: { name: string } | null })[]>(query)).map((rental) => withCarName({ ...rental, status: getRentalStatus(rental.status, rental.end_date, rental.end_time) })) as (RentalRecord & { car_name: string })[];
    },
    getByCar: async (carId: string) => {
      const query = supabase.from('rental_records').select('*').eq('car_id', carId).order('start_date', { ascending: false });
      return (await unwrap<RentalRecord[]>(query)).map((rental) => ({ ...rental, status: getRentalStatus(rental.status, rental.end_date, rental.end_time) }));
    },
    getById: async (id: string) => {
      const query = supabase.from('rental_records').select('*').eq('id', id);
      const rental = await unwrap<RentalRecord>(query.single());
      return { ...rental, status: getRentalStatus(rental.status, rental.end_date, rental.end_time) };
    },
    createCycle: async (data: CreateRentalCycleInput) => {
      const session = getSession();
      if (!session || ![1, 2, 3, 4].includes(session.user.role)) {
        throw new Error('Role ini tidak memiliki izin membuat rental.');
      }
      return createWorkerRentalCycle(data);
    },
    create: async (data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2, 3, 4].includes(session.user.role)) throw new Error('Role ini tidak memiliki izin membuat rental.');
      if (typeof data.car_id !== 'string' || typeof data.start_date !== 'string') throw new Error('Unit dan tanggal mulai wajib dipilih.');
      const rows = await createWorkerRentalCycle({
        car_ids: [data.car_id],
        start_date: data.start_date,
        start_time: typeof data.start_time === 'string' ? data.start_time : '00:00',
        end_date: typeof data.end_date === 'string' ? data.end_date : null,
        end_time: typeof data.end_time === 'string' ? data.end_time : null,
        purpose: typeof data.purpose === 'string' ? data.purpose : '',
        notes: typeof data.notes === 'string' ? data.notes : '',
      });
      if (!rows[0]) throw new Error('Siklus peminjaman tidak menghasilkan unit.');
      return rows[0];
    },
    notifyApproved: async (payload: {
      namaPemesan: string;
      emailPemesan: string;
      nomorTelepon: string;
      jenisKendaraan: string;
      platNomor: string;
      tanggalMulaiSewa: string;
      tanggalSelesaiSewa: string;
      jumlahHariSewa: number;
    }) => {
      await callWorker('/api/rental-approved', payload);
    },
    update: (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || session.user.role !== 1) {
        throw new Error('Hanya Super Admin (Role 1) yang dapat mengubah rental.');
      }
      const query = supabase.from('rental_records').update(data).eq('id', id);
      return unwrap<RentalRecord>(query.select().single());
    },
    decideApproval: async (id: string, data: { status: 'approved' | 'rejected'; car_id: string; approved_by: string; approved_at: string }) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 atau 2 yang dapat memproses approval.');

      const rental = await unwrap<RentalRecord>(
        supabase.from('rental_records').select('*').eq('id', id).eq('status', 'pending').single()
      );
      if (!rental) throw new Error('Permintaan rental tidak ditemukan atau sudah diproses.');
      if (data.status === 'approved') {
        const response = await fetch(workerApiUrl('/api/rentals/approve-unit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ rental_id: id, car_id: data.car_id }),
        });
        const result = await response.json().catch(() => null) as { data?: RentalRecord; error?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
        if (!result?.data) throw new Error('Worker mengembalikan data approval yang tidak valid.');
        return result.data;
      }

      const response = await fetch(workerApiUrl('/api/rentals/reject-unit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ rental_id: id }),
      });
      const result = await response.json().catch(() => null) as { data?: RentalRecord; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data penolakan yang tidak valid.');
      return result.data;
    },
    confirmReturn: async (id: string) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian.');
      const response = await fetch(workerApiUrl('/api/rentals/confirm-return'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ rental_id: id }),
      });
      const result = await response.json().catch(() => null) as { data?: RentalRecord; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data rental yang tidak valid.');
      return result.data;
    },
    getReturnItinerary: async (id: string): Promise<RentalReturnItineraryDetails> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/rentals/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'get', rental_id: id }),
      });
      const result = await response.json().catch(() => null) as { data?: RentalReturnItineraryDetails; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal memuat itinerary pengembalian Transportation.');
      return result.data;
    },
    saveReturnItinerary: async (data: {
      rentalId: string;
      startKm: number;
      startFuel: number;
      endKm: number | null;
      endFuel: number | null;
      submit: boolean;
      damages: { id: string; description: string; severity: Damage['severity'] }[];
    }) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/rentals/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          action: 'save',
          rental_id: data.rentalId,
          start_km: data.startKm,
          start_fuel: data.startFuel,
          end_km: data.endKm,
          end_fuel: data.endFuel,
          submit: data.submit,
          damages: data.damages,
        }),
      });
      const result = await response.json().catch(() => null) as { data?: unknown; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal menyimpan itinerary pengembalian Transportation.');
      return result.data;
    },
    uploadReturnDamagePhoto: async (data: { rentalId: string; damageId: string; photoId: string; base64: string }) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/rentals/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'upload-photo', rental_id: data.rentalId, damage_id: data.damageId, photo_id: data.photoId, base64: data.base64, content_type: 'image/jpeg' }),
      });
      const result = await response.json().catch(() => null) as { data?: { id: string }; error?: string } | null;
      if (!response.ok || !result?.data?.id) throw new Error(result?.error ?? 'Gagal mengunggah foto kerusakan.');
      return result.data;
    },
    deleteReturnDamagePhoto: async (rentalId: string, damageId: string, photoId: string) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/rentals/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'delete-photo', rental_id: rentalId, damage_id: damageId, photo_id: photoId }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? 'Gagal menghapus foto kerusakan.');
    },
    delete: async (id: string) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) {
        throw new Error('Hanya Role 1 dan 2 yang dapat menghapus rental.');
      }
      const query = supabase.from('rental_records').delete().eq('id', id);
      await unwrap(query);
      return { success: true };
    },
  };

  notes = {
    getAll: async () => (await unwrap<(DailyNote & { cars: { name: string } | null })[]>(supabase.from('daily_notes').select('*, cars(name)').order('note_date', { ascending: false }))).map(withCarName) as (DailyNote & { car_name: string })[],
    getByCar: (carId: string) => unwrap<DailyNote[]>(supabase.from('daily_notes').select('*').eq('car_id', carId).order('note_date', { ascending: false })),
    getReturnItinerary: async (id: string): Promise<DailyNoteReturnItineraryDetails> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/daily-notes/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'get', note_id: id }),
      });
      const result = await response.json().catch(() => null) as { data?: DailyNoteReturnItineraryDetails; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal memuat itinerary pengembalian.');
      return result.data;
    },
    saveReturnItinerary: async (id: string, endKm: number, endFuel: number, parts: string[]) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/daily-notes/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'save', note_id: id, end_km: endKm, end_fuel: endFuel, parts }),
      });
      const result = await response.json().catch(() => null) as { data?: unknown; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal menyimpan itinerary pengembalian.');
      return result.data;
    },
    uploadReturnPhoto: async (id: string, base64: string): Promise<{ id: string; object_path: string }> => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/daily-notes/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'upload', note_id: id, base64, content_type: 'image/jpeg' }),
      });
      const result = await response.json().catch(() => null) as { data?: { id: string; object_path: string }; error?: string } | null;
      if (!response.ok || !result?.data?.id || !result.data.object_path) throw new Error(result?.error ?? 'Gagal mengunggah foto itinerary.');
      return result.data;
    },
    deleteReturnPhoto: async (id: string, photoId: string) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/daily-notes/return-itinerary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'delete-photo', note_id: id, photo_id: photoId }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? 'Gagal menghapus foto itinerary.');
    },
    create: async (data: Record<string, unknown>) => {
      const session = getSession();
      const role = session?.user.role ?? 0;
      if (!([1, 2, 3, 4].includes(role))) {
        throw new Error('Role ini tidak memiliki izin membuat catatan duplikasi.');
      }

      const payload = {
        ...data,
        created_name: typeof session?.user.full_name === 'string' ? session.user.full_name.trim() : '',
        section: typeof data.section === 'string' ? data.section.trim() : '',
        content: typeof data.content === 'string' ? data.content.trim() : '',
        detail: typeof data.detail === 'string' ? data.detail.trim() : '',
        note_date: data.note_date ?? data.start_date ?? todayISO(),
        start_date: data.start_date ?? data.note_date ?? todayISO(),
        end_date: data.end_date ?? data.start_date ?? data.note_date ?? todayISO(),
      };

      try {
        return await unwrap<DailyNote>(supabase.from('daily_notes').insert(payload).select().single());
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('column') && message.includes('does not exist')) {
          throw new Error('Skema tabel daily_notes belum diperbarui. Jalankan migration daily_notes supaya kolom created_name, section, start_date, start_time, end_date, end_time, start_km, end_km, start_fuel, end_fuel, detail, need_trial_outside, dan status tersedia.');
        }
        throw error;
      }
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      if (!(session && session.user.role === 1)) {
        throw new Error('Role ini tidak memiliki izin mengubah catatan duplikasi.');
      }
      try {
        return await unwrap<DailyNote>(supabase.from('daily_notes').update(data).eq('id', id).select().single());
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('column') && message.includes('does not exist')) {
          throw new Error('Skema tabel daily_notes belum diperbarui. Jalankan migration daily_notes supaya kolom created_name, section, start_date, start_time, end_date, end_time, start_km, end_km, start_fuel, end_fuel, detail, need_trial_outside, dan status tersedia.');
        }
        throw error;
      }
    },
    confirmReturn: async (id: string) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian unit.');
      const response = await fetch(workerApiUrl('/api/daily-notes/confirm-return'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ note_id: id }),
      });
      const result = await response.json().catch(() => null) as { data?: DailyNote; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data catatan yang tidak valid.');
      return result.data;
    },
    review: async (id: string, decision: 'approved' | 'rejected') => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 atau 2 yang dapat mereview Investigation.');
      const response = await fetch(workerApiUrl('/api/daily-notes/review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ note_id: id, decision }),
      });
      const result = await response.json().catch(() => null) as { data?: DailyNote; error?: string; notificationError?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
      if (!result?.data) throw new Error('Worker mengembalikan data review yang tidak valid.');
      return { note: result.data, notificationError: result.notificationError };
    },
    delete: async (id: string) => {
      const session = getSession();
      if (!(session && [1, 2].includes(session.user.role))) {
        throw new Error('Role ini tidak memiliki izin menghapus catatan duplikasi.');
      }
      await unwrap(supabase.from('daily_notes').delete().eq('id', id));
      return { success: true };
    },
  };

  inspections = {
    getByCar: (carId: string) => unwrap<VehicleInspection[]>(supabase.from('vehicle_inspections').select('*').eq('car_id', carId).order('inspection_date', { ascending: false })),
    getItems: (inspectionId: string) => unwrap<VehicleInspectionItem[]>(supabase.from('vehicle_inspection_items').select('*').eq('inspection_id', inspectionId).order('sort_order', { ascending: true })),
    getPhotos: (itemIds: string[]) => itemIds.length
      ? unwrap<VehicleInspectionPhoto[]>(supabase.from('vehicle_inspection_photos').select('*').in('item_id', itemIds))
      : Promise.resolve([] as VehicleInspectionPhoto[]),
    create: (data: Record<string, unknown>) => unwrap<VehicleInspection>(supabase.from('vehicle_inspections').insert(data).select().single()),
    createItems: (data: Record<string, unknown>[]) => unwrap<VehicleInspectionItem[]>(supabase.from('vehicle_inspection_items').insert(data).select()),
    approve: async (inspectionId: string) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/inspections/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ inspection_id: inspectionId }),
      });
      const result = await response.json().catch(() => null) as { data?: VehicleInspection; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? 'Gagal menyetujui pengecekan.');
      return result.data;
    },
    uploadPhoto: async (data: { inspectionId: string; itemId: string; base64: string; contentType: string }) => {
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/inspections/photo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'upload', inspection_id: data.inspectionId, item_id: data.itemId, base64: data.base64, content_type: data.contentType }),
      });
      const result = await response.json().catch(() => null) as { data?: { object_path: string }; error?: string } | null;
      if (!response.ok || !result?.data?.object_path) throw new Error(result?.error ?? 'Gagal mengunggah foto pengecekan.');
      return result.data;
    },
    getSignedPhotos: async (objectPaths: string[]) => {
      if (!objectPaths.length) return [] as { object_path: string; url: string }[];
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const response = await fetch(workerApiUrl('/api/inspections/photo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'sign', object_paths: objectPaths }),
      });
      const result = await response.json().catch(() => null) as { data?: { object_path: string; url: string }[]; error?: string } | null;
      if (!response.ok || !Array.isArray(result?.data)) throw new Error(result?.error ?? 'Gagal memuat foto pengecekan.');
      return result.data;
    },
  };

  services = {
    getAll: async () => (await unwrap<(ServiceRecord & { cars: { name: string } | null })[]>(supabase.from('service_records').select('*, cars(name)').order('service_date', { ascending: false }))).map(withCarName) as (ServiceRecord & { car_name: string })[],
    getByCar: (carId: string) => unwrap<ServiceRecord[]>(supabase.from('service_records').select('*').eq('car_id', carId).order('service_date', { ascending: false })),
    create: (data: Record<string, unknown>) => unwrap<ServiceRecord>(supabase.from('service_records').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<ServiceRecord>(supabase.from('service_records').update(data).eq('id', id).select().single()),
    delete: async (id: string) => {
      await unwrap(supabase.from('service_records').delete().eq('id', id));
      return { success: true };
    },
  };

  completeness = {
    getAll: async () => (await unwrap<(CompletenessItem & { cars: { name: string } | null })[]>(supabase.from('completeness_items').select('*, cars(name)').order('created_at', { ascending: false }))).map(withCarName),
    getByCar: (carId: string) => unwrap<CompletenessItem[]>(supabase.from('completeness_items').select('*').eq('car_id', carId).order('created_at', { ascending: false })),
    create: (data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 dan 2 yang dapat membuat kelengkapan.');
      return unwrap<CompletenessItem>(supabase.from('completeness_items').insert(data).select().single());
    },
    update: (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 dan 2 yang dapat mengubah kelengkapan.');
      return unwrap<CompletenessItem>(supabase.from('completeness_items').update(data).eq('id', id).select().single());
    },
    delete: async (id: string) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 dan 2 yang dapat menghapus kelengkapan.');
      await unwrap(supabase.from('completeness_items').delete().eq('id', id));
      return { success: true };
    },
  };

  damages = {
    getAll: async () => (await unwrap<(Damage & { cars: { name: string } | null })[]>(supabase.from('damages').select('*, cars(name)').eq('is_return_draft', false).order('reported_date', { ascending: false }))).map(withCarName),
    getByCar: (carId: string) => unwrap<Damage[]>(supabase.from('damages').select('*').eq('car_id', carId).eq('is_return_draft', false).order('reported_date', { ascending: false })),
    getSignedPhotos: async (damageIds: string[]) => {
      if (!damageIds.length) return [] as { id: string; damage_id: string; url: string }[];
      const session = getSession();
      if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
      const batches: string[][] = [];
      for (let index = 0; index < damageIds.length; index += 100) batches.push(damageIds.slice(index, index + 100));
      const results = await Promise.all(batches.map(async (batch) => {
        const response = await fetch(workerApiUrl('/api/damages/photos'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ damage_ids: batch }),
        });
        const result = await response.json().catch(() => null) as { data?: { id: string; damage_id: string; url: string }[]; error?: string } | null;
        if (!response.ok || !Array.isArray(result?.data)) throw new Error(result?.error ?? 'Gagal memuat foto kerusakan.');
        return result.data;
      }));
      return results.flat();
    },
    create: (data: Record<string, unknown>) => {
      const session = getSession();
      const role = session?.user.role ?? 0;
      if (!([1, 2, 3, 4].includes(role))) {
        throw new Error('Role ini tidak memiliki izin menambah kerusakan.');
      }
      return unwrap<Damage>(supabase.from('damages').insert(data).select().single());
    },
    update: (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) throw new Error('Hanya Role 1 dan 2 yang dapat mengubah kerusakan.');
      return unwrap<Damage>(supabase.from('damages').update(data).eq('id', id).select().single());
    },
    delete: async (id: string) => {
      const session = getSession();
      if (!session || session.user.role !== 1) throw new Error('Hanya Super Admin (Role 1) yang dapat menghapus kerusakan.');
      await unwrap(supabase.from('damages').delete().eq('id', id));
      return { success: true };
    },
  };
}

export const apiClient = new ApiClient();
