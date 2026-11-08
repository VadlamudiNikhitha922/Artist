-- Run only after checking the existing payments table and migration history.
-- Supports PhonePe alongside any older provider values.
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments alter column provider set default 'phonepe';

alter table public.payments add constraint payments_provider_check
  check (provider in ('phonepe', 'razorpay', 'manual'));
