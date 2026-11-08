import { supabase } from '../lib/supabase';

// Paid bookings must be created by a trusted Edge Function so seats are reserved
// safely and the price is calculated from the database, not browser input.
export async function requestBooking({ workshopId, age, gender, place }) {
  const { data, error } = await supabase.functions.invoke('create-booking-order', {
    body: { workshop_id: workshopId, age: Number(age), gender, place: place.trim() },
  });
  if (error) throw error;
  return data;
}

export async function listMyBookings() {
  const { data, error } = await supabase.from('bookings')
    .select('id, age, gender, place, amount, status, created_at, workshops(id,name,workshop_date)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listBookingsForOwner() {
  const { data, error } = await supabase.from('bookings')
    .select('id, age, gender, place, amount, status, created_at, profiles:user_id(full_name,email), workshops(name,workshop_date), payments(status,provider_payment_id)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
