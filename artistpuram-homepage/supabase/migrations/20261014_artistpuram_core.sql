-- Run only on a new/empty Supabase project. Merge with existing Artistpuram
-- migrations first if these tables already exist.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'customer' check (role in ('customer','owner')),
  created_at timestamptz not null default now()
);

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  capacity integer not null check (capacity >= 0),
  workshop_date timestamptz,
  is_open boolean not null default false,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  workshop_id uuid not null references public.workshops(id) on delete restrict,
  age integer not null check (age between 1 and 120),
  gender text not null,
  place text not null,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending','confirmed','cancelled','failed')),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text unique,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name',''),
          coalesce(new.email,''), 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workshops enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'owner');
$$;
grant execute on function public.is_owner() to authenticated;

create policy "profile read own or owner" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_owner()));

create policy "customer update own profile" on public.profiles
for update to authenticated
using (id = (select auth.uid()) and role = 'customer')
with check (id = (select auth.uid()) and role = 'customer');

create policy "read open workshops or owner reads all" on public.workshops
for select to anon, authenticated
using (is_open = true or (select public.is_owner()));

create policy "owner inserts workshops" on public.workshops
for insert to authenticated with check ((select public.is_owner()));

create policy "owner updates workshops" on public.workshops
for update to authenticated using ((select public.is_owner()))
with check ((select public.is_owner()));

create policy "owner deletes workshops" on public.workshops
for delete to authenticated using ((select public.is_owner()));

create policy "read own bookings or owner reads all" on public.bookings
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner()));

create policy "read own payments or owner reads all" on public.payments
for select to authenticated
using ((select public.is_owner()) or exists (
  select 1 from public.bookings b
  where b.id = payments.booking_id and b.user_id = (select auth.uid())
));

-- Intentionally no browser insert/update policies for bookings/payments.
-- Create trusted Edge Functions for seat reservation and payment verification.
