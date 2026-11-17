DROP TRIGGER IF EXISTS daily_notes_schedule_conflict ON public.daily_notes;
CREATE TRIGGER daily_notes_schedule_conflict
  BEFORE INSERT OR UPDATE
  ON public.daily_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.check_daily_note_schedule_conflict();

DROP TRIGGER IF EXISTS service_records_schedule_conflict ON public.service_records;
CREATE TRIGGER service_records_schedule_conflict
  BEFORE INSERT OR UPDATE
  ON public.service_records
  FOR EACH ROW
  EXECUTE FUNCTION public.check_service_schedule_conflict();

DROP TRIGGER IF EXISTS rental_records_schedule_conflict ON public.rental_records;
CREATE TRIGGER rental_records_schedule_conflict
  BEFORE INSERT OR UPDATE
  ON public.rental_records
  FOR EACH ROW
  EXECUTE FUNCTION public.check_rental_schedule_conflict();
