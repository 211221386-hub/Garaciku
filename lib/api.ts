import { supabase } from '@/lib/supabase';
import type { AppUser, Car, DailyNote, CompletenessItem, Damage, RentalRecord, ServiceRecord } from '@/lib/types';
import { getRentalStatus, todayISO } from '@/lib/format';
import { getSession } from '@/lib/auth';

export type LoginResult = {
  user: AppUser;
  token?: string;
  expiresAt?: number;
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

class ApiClient {
  users = {
    getAll: () => unwrap<AppUser[]>(supabase.from('users').select('id, username, full_name, role, is_active, created_at').order('created_at', { ascending: false })),
    login: async (username: string, password: string): Promise<LoginResult | null> => {
      const { data, error } = await supabase.rpc('auth_login', {
        _username: username,
        _password: password,
      });

      if (error) {
        return null;
      }

      const user = (data as AppUser[] | null)?.[0] ?? null;

      if (!user) {
        return null;
      }

      return {
        user,
        token: `supabase-token-${Date.now()}`,
        expiresAt: Date.now() + (8 * 60 * 60 * 1000),
      };
    },
  };

  cars = {
    getAll: () => unwrap<Car[]>(supabase.from('cars').select('*').order('created_at', { ascending: false })),
    getById: (id: string) => unwrap<Car>(supabase.from('cars').select('*').eq('id', id).single()),
    create: (data: Record<string, unknown>) => unwrap<Car>(supabase.from('cars').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<Car>(supabase.from('cars').update(data).eq('id', id).select().single()),
    delete: async (id: string) => { await unwrap(supabase.from('cars').delete().eq('id', id)); return { success: true }; },
  };

  rentals = {
    getCurrentlyRentedCarIds: async () => {
      const rows = await unwrap<{ car_id: string; end_date: string | null }[]>(
        supabase.from('rental_records').select('car_id, end_date').in('status', ['active', 'approved'])
      );
      const today = todayISO();
      return [...new Set(rows.filter((rental) => !rental.end_date || rental.end_date >= today).map((rental) => rental.car_id))];
    },
    getAll: async () => {
      const session = getSession();
      let query = supabase.from('rental_records').select('*, cars(name)').order('created_at', { ascending: false });
      if (session && session.user.role !== 1 && session.user.role !== 2) query = query.eq('user_id', session.user.id);
      return (await unwrap<(RentalRecord & { cars: { name: string } | null })[]>(query)).map((rental) => withCarName({ ...rental, status: getRentalStatus(rental.status, rental.end_date) })) as (RentalRecord & { car_name: string })[];
    },
    getByCar: async (carId: string) => {
      const session = getSession();
      let query = supabase.from('rental_records').select('*').eq('car_id', carId).order('start_date', { ascending: false });
      if (session && session.user.role !== 1 && session.user.role !== 2) query = query.eq('user_id', session.user.id);
      return (await unwrap<RentalRecord[]>(query)).map((rental) => ({ ...rental, status: getRentalStatus(rental.status, rental.end_date) }));
    },
    getById: async (id: string) => {
      const session = getSession();
      let query = supabase.from('rental_records').select('*').eq('id', id);
      if (session && session.user.role !== 1 && session.user.role !== 2) query = query.eq('user_id', session.user.id);
      const rental = await unwrap<RentalRecord>(query.single());
      return { ...rental, status: getRentalStatus(rental.status, rental.end_date) };
    },
    create: (data: Record<string, unknown>) => {
      const session = getSession();
      const isRequester = session?.user.role === 3 || session?.user.role === 4;
      return unwrap<RentalRecord>(supabase.from('rental_records').insert({
        ...data,
        status: isRequester ? 'pending' : (data.status ?? 'active'),
        user_id: session?.user.id ?? null,
      }).select().single());
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
      const url = process.env.EXPO_PUBLIC_RENTAL_AUTOMATION_URL;
      if (!url) throw new Error('EXPO_PUBLIC_RENTAL_AUTOMATION_URL belum dikonfigurasi.');

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API automation mengembalikan status ${response.status}.`);
      }
    },
    update: (id: string, data: Record<string, unknown>) => {
      const session = getSession();
      const isAdmin = session?.user.role === 1 || session?.user.role === 2;
      if (session && !isAdmin) {
        throw new Error('Role ini hanya dapat membuat dan melihat rental milik sendiri.');
      }
      let query = supabase.from('rental_records').update(data).eq('id', id);
      if (session && !isAdmin) query = query.eq('user_id', session.user.id);
      return unwrap<RentalRecord>(query.select().single());
    },
    decideApproval: async (id: string, data: { status: 'approved' | 'rejected'; car_id: string; approved_by: string; approved_at: string }) => {
      const session = getSession();
      if (!session || ![1, 2].includes(session.user.role)) {
        throw new Error('Hanya role 1 atau 2 yang dapat memproses approval.');
      }

      const rental = await unwrap<RentalRecord>(
        supabase.from('rental_records').select('*').eq('id', id).eq('status', 'pending').single()
      );
      if (!rental) throw new Error('Permintaan rental tidak ditemukan atau sudah diproses.');

      return unwrap<RentalRecord>(
        supabase.from('rental_records').update(data).eq('id', id).eq('status', 'pending').select().single()
      );
    },
    delete: async (id: string) => {
      const session = getSession();
      const isAdmin = session?.user.role === 1 || session?.user.role === 2;
      if (session && !isAdmin) {
        throw new Error('Role ini hanya dapat membuat dan melihat rental milik sendiri.');
      }
      let query = supabase.from('rental_records').delete().eq('id', id);
      if (session && !isAdmin) query = query.eq('user_id', session.user.id);
      await unwrap(query);
      return { success: true };
    },
  };

  notes = {
    getAll: async () => (await unwrap<(DailyNote & { cars: { name: string } | null })[]>(supabase.from('daily_notes').select('*, cars(name)').order('note_date', { ascending: false }))).map(withCarName) as (DailyNote & { car_name: string })[],
    getByCar: (carId: string) => unwrap<DailyNote[]>(supabase.from('daily_notes').select('*').eq('car_id', carId).order('note_date', { ascending: false })),
    create: (data: Record<string, unknown>) => unwrap<DailyNote>(supabase.from('daily_notes').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<DailyNote>(supabase.from('daily_notes').update(data).eq('id', id).select().single()),
    delete: async (id: string) => { await unwrap(supabase.from('daily_notes').delete().eq('id', id)); return { success: true }; },
  };

  services = {
    getAll: async () => (await unwrap<(ServiceRecord & { cars: { name: string } | null })[]>(supabase.from('service_records').select('*, cars(name)').order('service_date', { ascending: false }))).map(withCarName) as (ServiceRecord & { car_name: string })[],
    getByCar: (carId: string) => unwrap<ServiceRecord[]>(supabase.from('service_records').select('*').eq('car_id', carId).order('service_date', { ascending: false })),
    create: (data: Record<string, unknown>) => unwrap<ServiceRecord>(supabase.from('service_records').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<ServiceRecord>(supabase.from('service_records').update(data).eq('id', id).select().single()),
    delete: async (id: string) => {
      await unwrap(supabase.from('service_records').delete().eq('id', id).select('id').single());
      return { success: true };
    },
  };

  completeness = {
    getAll: async () => (await unwrap<(CompletenessItem & { cars: { name: string } | null })[]>(supabase.from('completeness_items').select('*, cars(name)').order('created_at', { ascending: false }))).map(withCarName),
    getByCar: (carId: string) => unwrap<CompletenessItem[]>(supabase.from('completeness_items').select('*').eq('car_id', carId).order('created_at', { ascending: false })),
    create: (data: Record<string, unknown>) => unwrap<CompletenessItem>(supabase.from('completeness_items').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<CompletenessItem>(supabase.from('completeness_items').update(data).eq('id', id).select().single()),
    delete: async (id: string) => { await unwrap(supabase.from('completeness_items').delete().eq('id', id)); return { success: true }; },
  };

  damages = {
    getAll: async () => (await unwrap<(Damage & { cars: { name: string } | null })[]>(supabase.from('damages').select('*, cars(name)').order('reported_date', { ascending: false }))).map(withCarName),
    getByCar: (carId: string) => unwrap<Damage[]>(supabase.from('damages').select('*').eq('car_id', carId).order('reported_date', { ascending: false })),
    create: (data: Record<string, unknown>) => unwrap<Damage>(supabase.from('damages').insert(data).select().single()),
    update: (id: string, data: Record<string, unknown>) => unwrap<Damage>(supabase.from('damages').update(data).eq('id', id).select().single()),
    delete: async (id: string) => { await unwrap(supabase.from('damages').delete().eq('id', id)); return { success: true }; },
  };
}

export const apiClient = new ApiClient();