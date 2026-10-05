ALTER TABLE public.completeness_items
  ADD COLUMN IF NOT EXISTS reminder_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS next_due_date date;

ALTER TABLE public.completeness_items
  DROP CONSTRAINT IF EXISTS completeness_items_reminder_type_check;

ALTER TABLE public.completeness_items
  ADD CONSTRAINT completeness_items_reminder_type_check
  CHECK (reminder_type IN ('general', 'annual_tax', 'plate_tax'));

CREATE INDEX IF NOT EXISTS idx_completeness_items_next_due_date
  ON public.completeness_items(next_due_date)
  WHERE reminder_type IN ('annual_tax', 'plate_tax');
