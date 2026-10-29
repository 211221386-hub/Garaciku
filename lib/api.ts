import { supabase, workerApiUrl } from '@/lib/supabase';
import type { AppUser, Car, DailyNote, CompletenessItem, Damage, RentalRecord, RentalStatus, ServiceRecord } from '@/lib/types';
import { getRentalStatus, todayISO } from '@/lib/format';
import { getSession } from '@/lib/auth';

export type LoginResult = {
  user: AppUser;
  token?: string;
  expiresAt?: number;
};

export type CreateRentalCycleInput = {
  car_ids: string[];
  start_date: string;
  start_time: string;
  end_date: string | null;
  end_time: string | null;
  purpose: string;
  notes: string;
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

async function callWorker(path: string, payload: Record<string, unknown>) {
  const session = getSession();
  if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
  const response = await fetch(workerApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? `Worker mengembalikan status ${response.status}.`);
}

async function createWorkerRentalCycle(payload: CreateRentalCycleInput): Promise<RentalRecord[]> {
  const session = getSession();
  if (!session?.token) throw new Error('Sesi login tidak valid. Silakan login ulang.');
  const response = await fetch(workerApiUrl('/api/rentals/create-cycle'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(payload),
  });
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
    getAll: () => unwrap<Car[]>(supabase.from('cars').select('*').order('created_at', { ascending: false })),
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
    getAvailability: () => unwrap<Pick<RentalRecord, 'car_id' | 'status' | 'start_date' | 'end_date'>[]>(
      supabase.from('rental_records').select('car_id,status,start_date,end_date').in('status', ['pending', 'active', 'approved', 'overdue'])
    ),
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
    notifyCreated: async (payload: {
      namaPemesan: string;
      emailPemesan: string;
      nomorTelepon: string;
      jenisKendaraan: string;
      platNomor: string;
      tanggalMulaiSewa: string;
      tanggalSelesaiSewa: string;
      jumlahHariSewa: number | '';
    }) => {
      await callWorker('/api/rental-created', payload);
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
      if (!session || session.user.role !== 1) {
        throw new Error('Hanya Super Admin (Role 1) yang dapat memproses approval.');
      }

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

      await unwrap(
        supabase.from('rental_records').update(data).eq('id', id).eq('status', 'pending')
      );
      return { ...rental, ...data } as RentalRecord;
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
    create: async (data: Record<string, unknown>) => {
      const session = getSession();
      const role = session?.user.role ?? 0;
      if (!([1, 2, 3, 4].includes(role))) {
        throw new Error('Role ini tidak memiliki izin membuat catatan duplikasi.');
      }

      const payload = {
        ...data,
        name: typeof data.name === 'string' ? data.name.trim() : '',
        section: typeof data.section === 'string' ? data.section.trim() : '',
        content: typeof data.content === 'string' ? data.content.trim() : '',
        note_date: data.note_date ?? data.start_date ?? todayISO(),
        start_date: data.start_date ?? data.note_date ?? todayISO(),
        end_date: data.end_date ?? data.start_date ?? data.note_date ?? todayISO(),
      };

      try {
        return await unwrap<DailyNote>(supabase.from('daily_notes').insert(payload).select().single());
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('column') && message.includes('does not exist')) {
          throw new Error('Skema tabel daily_notes belum diperbarui. Jalankan migration daily_notes supaya kolom name, section, start_date, start_time, end_date, end_time, start_km, end_km, start_fuel, dan end_fuel tersedia.');
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
          throw new Error('Skema tabel daily_notes belum diperbarui. Jalankan migration daily_notes supaya kolom name, section, start_date, start_time, end_date, end_time, start_km, end_km, start_fuel, dan end_fuel tersedia.');
        }
        throw error;
      }
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
    getAll: async () => (await unwrap<(Damage & { cars: { name: string } | null })[]>(supabase.from('damages').select('*, cars(name)').order('reported_date', { ascending: false }))).map(withCarName),
    getByCar: (carId: string) => unwrap<Damage[]>(supabase.from('damages').select('*').eq('car_id', carId).order('reported_date', { ascending: false })),
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