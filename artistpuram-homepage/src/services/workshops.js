import { supabase } from '../lib/supabase';

export async function listOpenWorkshops() {
  const { data, error } = await supabase
    .from('workshops')
    .select('id, name, description, price, capacity, workshop_date, image_url')
    .eq('is_open', true)
    .order('workshop_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function listWorkshopsForOwner() {
  const { data, error } = await supabase.from('workshops').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveWorkshop(workshop) {
  const payload = {
    name: workshop.name.trim(),
    description: workshop.description?.trim() || null,
    price: Number(workshop.price),
    capacity: Number(workshop.capacity),
    workshop_date: workshop.workshop_date || null,
    is_open: Boolean(workshop.is_open),
    image_url: workshop.image_url?.trim() || null,
  };
  if (!payload.name || !Number.isFinite(payload.price) || payload.price < 0 ||
      !Number.isInteger(payload.capacity) || payload.capacity < 0) {
    throw new Error('Enter a name, valid price, and whole-number capacity.');
  }
  const query = workshop.id
    ? supabase.from('workshops').update(payload).eq('id', workshop.id)
    : supabase.from('workshops').insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function deleteWorkshop(id) {
  const { error } = await supabase.from('workshops').delete().eq('id', id);
  if (error) throw error;
}
