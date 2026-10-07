export type UserRole = 1 | 2 | 3 | 4;

export type AppUser = {
  id: string;
  username: string;
  password?: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

export type Car = {
  id: string;
  name: string;
  brand: string;
  model: string;
  year: number | null;
  plate_number: string;
  color: string;
  photo_url: string | null;
  created_at: string;
};

export type DailyNote = {
  id: string;
  car_id: string;
  note_date: string;
  content: string;
  created_at: string;
};

export type ServiceRecord = {
  id: string;
  car_id: string;
  service_date: string;
  service_type: string;
  description: string;
  cost: number | null;
  mileage: number | null;
  workshop: string;
  status: 'completed' | 'scheduled';
  next_service_date: string | null;
  next_service_mileage: number | null;
  reminder_enabled: boolean;
  reminder_interval_months: number | null;
  reminder_interval_mileage: number | null;
  created_at: string;
};

export type CompletenessReminderType = 'general' | 'annual_tax' | 'plate_tax';

export type CompletenessItem = {
  id: string;
  car_id: string;
  name: string;
  is_present: boolean;
  reminder_type: CompletenessReminderType;
  next_due_date: string | null;
  created_at: string;
};

export type DamageSeverity = 'low' | 'medium' | 'high';
export type DamageStatus = 'open' | 'repairing' | 'fixed';

export type Damage = {
  id: string;
  car_id: string;
  description: string;
  severity: DamageSeverity;
  status: DamageStatus;
  reported_date: string;
  resolved_date: string | null;
  created_at: string;
};

export type RentalStatus = 'pending' | 'active' | 'approved' | 'overdue' | 'rejected' | 'returned' | 'cancelled' | 'completed';

export type RentalRecord = {
  id: string;
  car_id: string;
  user_id: string | null;
  renter_name: string;
  renter_email: string;
  renter_phone: string;
  start_date: string;
  start_time: string;
  end_date: string | null;
  end_time: string | null;
  total_cost: number | null;
  purpose: string;
  status: RentalStatus;
  approved_by: string | null;
  approved_at: string | null;
  return_confirmed_by: string | null;
  return_confirmed_at: string | null;
  notes: string;
  created_at: string;
};
