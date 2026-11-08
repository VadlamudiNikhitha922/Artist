import { supabase } from '../lib/supabase';

/** Creates a pending booking and a PhonePe checkout order through a trusted Edge Function. */
export async function startPhonePeBooking({ workshopId, age, gender, place }) {
  const { data, error } = await supabase.functions.invoke('create-booking-order', {
    body: { workshop_id: workshopId, age: Number(age), gender, place: String(place).trim() },
  });
  if (error) throw error;
  if (!data?.redirect_url || !data?.merchant_order_id) {
    throw new Error(data?.error || 'PhonePe checkout could not be started');
  }
  window.location.assign(data.redirect_url);
}

/** Call on the payment-result page. The server queries PhonePe; URL parameters alone are not trusted. */
export async function verifyPhonePePayment(merchantOrderId) {
  const { data, error } = await supabase.functions.invoke('verify-phonepe-payment', {
    body: { merchant_order_id: merchantOrderId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
