export type UserRole = 1 | 2 | 3 | 4;

export type AppUser = {
  id: string;
  username: string;
  password?: string;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  must_reset_password: boolean;
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
  operational_status: 'ready' | 'under_maintenance' | 'inactive';
  periodic_service_start_date: string | null;
  annual_tax_due_date: string | null;
  plate_tax_due_date: string | null;
  created_at: string;
};

export type CarDisplayStatus = 'Ready' | 'Booked' | 'Under Maintenance' | 'Time to Service' | 'Delay' | 'Inactive' | 'Unknown';

export type CarStatusInfo = {
  status: CarDisplayStatus;
  renter_name: string | null;
};

export type DailyNote = {
  id: string;
  car_id: string;
  created_by: string | null;
  created_name: string;
  section: string;
  note_date: string;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
  start_km: number | null;
  end_km: number | null;
  start_fuel: number | null;
  end_fuel: number | null;
  content: string;
  detail: string;
  need_trial_outside: boolean;
  status: 'pending_approval' | 'active' | 'completed' | 'rejected';
  return_confirmed_by: string | null;
  return_confirmed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type DailyNoteReturnItinerary = {
  note_id: string;
  start_km: number | null;
  start_fuel: number | null;
  end_km: number | null;
  end_fuel: number | null;
  submitted_by: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type DailyNoteDismantledPart = {
  id: string;
  part_name: string;
  sort_order: number;
};

export type DailyNoteReturnPhoto = {
  id: string;
  url: string;
};

export type DailyNoteReturnDamageReport = Pick<Damage, 'id' | 'daily_note_id' | 'is_return_draft' | 'description' | 'severity' | 'status' | 'reported_date'> & {
  photos: { id: string; url: string }[];
};

export type DailyNoteReturnItineraryDetails = {
  itinerary: DailyNoteReturnItinerary | null;
  parts: DailyNoteDismantledPart[];
  photos: DailyNoteReturnPhoto[];
  damages: DailyNoteReturnDamageReport[];
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
  status: 'completed' | 'scheduled' | 'in_progress';
  next_service_date: string | null;
  next_service_mileage: number | null;
  reminder_enabled: boolean;
  is_recurring: boolean;
  reminder_interval_months: number | null;
  reminder_interval_mileage: number | null;
  created_name: string;
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
  rental_id: string | null;
  daily_note_id: string | null;
  is_return_draft: boolean;
  description: string;
  severity: DamageSeverity;
  status: DamageStatus;
  reported_date: string;
  resolved_date: string | null;
  created_at: string;
};

export type RentalReturnDamageReport = Pick<Damage, 'id' | 'rental_id' | 'is_return_draft' | 'description' | 'severity' | 'status' | 'reported_date'> & {
  photos: { id: string; url: string }[];
};

export type RentalReturnItinerary = {
  rental_id: string;
  start_km: number;
  start_fuel: number;
  end_km: number | null;
  end_fuel: number | null;
  submitted_by: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type RentalReturnItineraryDetails = {
  itinerary: RentalReturnItinerary | null;
  damages: RentalReturnDamageReport[];
  return_confirmed_by_name: string | null;
};

export type RentalStatus = 'pending' | 'active' | 'approved' | 'overdue' | 'rejected' | 'returned' | 'cancelled' | 'completed';

export type RentalRecord = {
  id: string;
  cycle_id: string;
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

export type VehicleInspection = {
  id: string;
  car_id: string;
  inspector_user_id: string;
  inspector_name: string;
  inspection_date: string;
  mileage: number;
  model_snapshot: string;
  plate_snapshot: string;
  status: 'pending_approval' | 'approved';
  checked_prepared_by: string | null;
  checked_prepared_name: string | null;
  checked_prepared_at: string | null;
  approved_by: string | null;
  approved_name: string | null;
  approved_at: string | null;
  created_at: string;
};

export type VehicleInspectionItem = {
  id: string;
  inspection_id: string;
  category: string;
  item_name: string;
  result: 'ok' | 'ng' | null;
  remark: string;
  countermeasure: string;
  sort_order: number;
  created_at: string;
};

export type VehicleInspectionPhoto = {
  id: string;
  item_id: string;
  object_path: string;
  created_at: string;
};
