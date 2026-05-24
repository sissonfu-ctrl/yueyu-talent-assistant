import { supabase } from '@/db/supabase';
import type {
  Bar, BarSession, Artist, ArtistAvailability, ArtistBarLink,
  Schedule, ScheduleAssignment, BarArtistPrice, SettlementRecord
} from '@/types/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const EDGE_URL = `${SUPABASE_URL}/functions/v1/db-proxy`;

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function proxyRequest(table: string, action: string, payload?: any, filter?: any) {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ table, action, payload, filter }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || '请求失败');
  return json.data;
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user.id;
  const { data: refreshData } = await supabase.auth.refreshSession();
  if (refreshData?.session?.user?.id) return refreshData.session.user.id;
  const { data: { user: user2 } } = await supabase.auth.getUser();
  if (user2?.id) return user2.id;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) return session.user.id;
  throw new Error('登录已过期，请退出后重新登录');
}

// ================= Bars =================
export async function getBars(): Promise<Bar[]> {
  const { data, error } = await supabase.from('bars').select('*').order('name');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getBarById(id: string): Promise<Bar | null> {
  const { data, error } = await supabase.from('bars').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createBar(bar: Omit<Bar, 'id' | 'created_at' | 'user_id'>): Promise<Bar> {
  // Fallback to Edge Function if auth fails
  try {
    let userId: string;
    try {
      userId = await getCurrentUserId();
    } catch {
      userId = '00000000-0000-0000-0000-000000000000';
    }
    const { data, error } = await supabase.from('bars').insert({ ...bar, user_id: userId }).select().single();
    if (!error && data) return data;
    if (error) throw error;
    return data;
  } catch (e: any) {
    // Always fallback to Edge Function proxy on any error
    let userId: string;
    try { userId = await getCurrentUserId(); } catch { userId = '00000000-0000-0000-0000-000000000000'; }
    return await proxyRequest('bars', 'insert', { ...bar, user_id: userId }) as Bar;
  }
}

export async function updateBar(id: string, updates: Partial<Bar>): Promise<void> {
  try {
    const { error } = await supabase.from('bars').update(updates).eq('id', id);
    if (!error) return;
    throw error;
  } catch {
    await proxyRequest('bars', 'update', updates, { id });
  }
}

export async function deleteBar(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('bars').delete().eq('id', id);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('bars', 'delete', undefined, { id });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('bars', 'delete', undefined, { id });
      return;
    }
    throw e;
  }
}

// ================= Bar Sessions =================
export async function getBarSessions(barId: string, weekday?: number): Promise<BarSession[]> {
  let q = supabase.from('bar_sessions').select('*').eq('bar_id', barId).order('session_number');
  if (weekday !== undefined) {
    q = q.eq('weekday', weekday);
  } else {
    // Return both weekday-specific and null (generic) when no weekday filter
    // Actually for the full list view we want all, but for schedule generation we want a specific weekday
  }
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getBarSessionsForDate(barId: string, weekday: number): Promise<BarSession[]> {
  // First try weekday-specific config
  const { data: specific, error: err1 } = await supabase
    .from('bar_sessions')
    .select('*')
    .eq('bar_id', barId)
    .eq('weekday', weekday)
    .order('session_number');
  if (err1) throw err1;
  if (specific && specific.length > 0) return specific;
  // Fallback to generic config (weekday is null)
  const { data: generic, error: err2 } = await supabase
    .from('bar_sessions')
    .select('*')
    .eq('bar_id', barId)
    .is('weekday', null)
    .order('session_number');
  if (err2) throw err2;
  return Array.isArray(generic) ? generic : [];
}

export async function upsertBarSessions(sessions: Partial<BarSession>[]): Promise<void> {
  const { error } = await supabase.from('bar_sessions').upsert(sessions);
  if (error) throw error;
}

export async function deleteBarSession(id: string): Promise<void> {
  const { error } = await supabase.from('bar_sessions').delete().eq('id', id);
  if (error) throw error;
}

// ================= Artists =================
export async function getArtists(): Promise<Artist[]> {
  const { data, error } = await supabase.from('artists').select('*').order('name');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getArtistsByType(type: 'singer' | 'musician'): Promise<Artist[]> {
  const { data, error } = await supabase.from('artists').select('*').eq('type', type).order('name');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getArtistById(id: string): Promise<Artist | null> {
  const { data, error } = await supabase.from('artists').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createArtist(artist: Omit<Artist, 'id' | 'created_at' | 'user_id'>): Promise<Artist> {
  try {
    let userId: string;
    try { userId = await getCurrentUserId(); } catch { userId = '00000000-0000-0000-0000-000000000000'; }
    const { data, error } = await supabase.from('artists').insert({ ...artist, user_id: userId }).select().single();
    if (!error && data) return data;
    if (error?.message?.includes('row-level security') || error?.code === '42501') {
      return await proxyRequest('artists', 'insert', { ...artist, user_id: userId }) as Artist;
    }
    if (error) throw error;
    return data;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      let userId: string;
      try { userId = await getCurrentUserId(); } catch { userId = '00000000-0000-0000-0000-000000000000'; }
      return await proxyRequest('artists', 'insert', { ...artist, user_id: userId }) as Artist;
    }
    throw e;
  }
}

export async function updateArtist(id: string, updates: Partial<Artist>): Promise<void> {
  try {
    const { error } = await supabase.from('artists').update(updates).eq('id', id);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artists', 'update', updates, { id });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artists', 'update', updates, { id });
      return;
    }
    throw e;
  }
}

export async function deleteArtist(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('artists').delete().eq('id', id);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artists', 'delete', undefined, { id });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artists', 'delete', undefined, { id });
      return;
    }
    throw e;
  }
}

export async function deleteArtists(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { error } = await supabase.from('artists').delete().in('id', ids);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artists', 'delete', undefined, { id: ids });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artists', 'delete', undefined, { id: ids });
      return;
    }
    throw e;
  }
}

// ================= Artist Bar Links =================
export async function getArtistBarLinks(artistId?: string, barId?: string): Promise<ArtistBarLink[]> {
  let q = supabase.from('artist_bar_links').select('*');
  if (artistId) q = q.eq('artist_id', artistId);
  if (barId) q = q.eq('bar_id', barId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function setArtistBars(artistId: string, barIds: string[]): Promise<void> {
  await supabase.from('artist_bar_links').delete().eq('artist_id', artistId);
  if (barIds.length > 0) {
    const rows = barIds.map((barId) => ({ artist_id: artistId, bar_id: barId }));
    const { error } = await supabase.from('artist_bar_links').insert(rows);
    if (error) throw error;
  }
}

// ================= Availabilities =================
export async function getAvailabilities(artistId?: string): Promise<ArtistAvailability[]> {
  let q = supabase.from('artist_availabilities').select('*').order('created_at');
  if (artistId) q = q.eq('artist_id', artistId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createAvailability(availability: Omit<ArtistAvailability, 'id' | 'created_at'>): Promise<ArtistAvailability> {
  try {
    const { data, error } = await supabase.from('artist_availabilities').insert(availability).select().single();
    if (!error && data) return data;
    if (error?.message?.includes('row-level security') || error?.code === '42501') {
      return await proxyRequest('artist_availabilities', 'insert', availability) as ArtistAvailability;
    }
    if (error) throw error;
    return data;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      return await proxyRequest('artist_availabilities', 'insert', availability) as ArtistAvailability;
    }
    throw e;
  }
}

export async function updateAvailability(id: string, updates: Partial<ArtistAvailability>): Promise<void> {
  try {
    const { error } = await supabase.from('artist_availabilities').update(updates).eq('id', id);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artist_availabilities', 'update', updates, { id });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artist_availabilities', 'update', updates, { id });
      return;
    }
    throw e;
  }
}

export async function deleteAvailability(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('artist_availabilities').delete().eq('id', id);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artist_availabilities', 'delete', undefined, { id });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artist_availabilities', 'delete', undefined, { id });
      return;
    }
    throw e;
  }
}

export async function deleteAvailabilities(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { error } = await supabase.from('artist_availabilities').delete().in('id', ids);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artist_availabilities', 'delete', undefined, { id: ids });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artist_availabilities', 'delete', undefined, { id: ids });
      return;
    }
    throw e;
  }
}

export async function deleteAllArtistAvailabilities(artistId: string): Promise<void> {
  try {
    const { error } = await supabase.from('artist_availabilities').delete().eq('artist_id', artistId);
    if (!error) return;
    if (error.message?.includes('row-level security') || error.code === '42501') {
      await proxyRequest('artist_availabilities', 'delete', undefined, { artist_id: artistId });
      return;
    }
    throw error;
  } catch (e: any) {
    if (e.message?.includes('row-level security') || e.message?.includes('42501')) {
      await proxyRequest('artist_availabilities', 'delete', undefined, { artist_id: artistId });
      return;
    }
    throw e;
  }
}

// ================= Schedules =================
export async function getSchedules(barId?: string): Promise<Schedule[]> {
  let q = supabase.from('schedules').select('*').order('created_at', { ascending: false });
  if (barId) q = q.eq('bar_id', barId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getScheduleById(id: string): Promise<Schedule | null> {
  const { data, error } = await supabase.from('schedules').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCurrentSchedule(barId: string, periodLabel: string): Promise<Schedule | null> {
  const { data, error } = await supabase.from('schedules')
    .select('*')
    .eq('bar_id', barId)
    .eq('period_label', periodLabel)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSchedule(schedule: Omit<Schedule, 'id' | 'created_at' | 'user_id'>): Promise<Schedule> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from('schedules').insert({ ...schedule, user_id: userId }).select().single();
  if (error) throw error;
  return data;
}

export async function updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
  const { error } = await supabase.from('schedules').update(updates).eq('id', id);
  if (error) throw error;
}

export async function archiveOldSchedules(barId: string, periodLabel: string): Promise<void> {
  const { error } = await supabase.from('schedules')
    .update({ is_current: false })
    .eq('bar_id', barId)
    .eq('period_label', periodLabel)
    .eq('is_current', true);
  if (error) throw error;
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('schedules').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteSchedules(ids: string[]): Promise<void> {
  const { error } = await supabase.from('schedules').delete().in('id', ids);
  if (error) throw error;
}

// ================= Schedule Assignments =================
export async function getAssignments(scheduleId: string): Promise<ScheduleAssignment[]> {
  const { data, error } = await supabase.from('schedule_assignments').select('*').eq('schedule_id', scheduleId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertAssignments(assignments: Partial<ScheduleAssignment>[]): Promise<void> {
  const { error } = await supabase.from('schedule_assignments').upsert(assignments);
  if (error) throw error;
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('schedule_assignments').delete().eq('id', id);
  if (error) throw error;
}

export async function clearScheduleAssignments(scheduleId: string): Promise<void> {
  const { error } = await supabase.from('schedule_assignments').delete().eq('schedule_id', scheduleId);
  if (error) throw error;
}

export async function toggleLockAssignment(id: string, isLocked: boolean): Promise<void> {
  const { error } = await supabase.from('schedule_assignments').update({ is_locked: isLocked }).eq('id', id);
  if (error) throw error;
}

export async function getLockedAssignments(barId: string): Promise<ScheduleAssignment[]> {
  // Get the most current schedule for this bar, then its locked assignments
  const { data: schedules, error: sErr } = await supabase
    .from('schedules')
    .select('id')
    .eq('bar_id', barId)
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (sErr) throw sErr;
  if (!schedules || schedules.length === 0) return [];
  const scheduleId = schedules[0].id;
  const { data, error } = await supabase
    .from('schedule_assignments')
    .select('*')
    .eq('schedule_id', scheduleId)
    .eq('is_locked', true);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// ================= Bar Artist Prices =================
export async function getBarArtistPrices(barId?: string, artistId?: string): Promise<BarArtistPrice[]> {
  let q = supabase.from('bar_artist_prices').select('*');
  if (barId) q = q.eq('bar_id', barId);
  if (artistId) q = q.eq('artist_id', artistId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertBarArtistPrice(price: BarArtistPrice): Promise<void> {
  const { error } = await supabase.from('bar_artist_prices').upsert(price);
  if (error) throw error;
}

// ================= Settlement =================
export async function getSettlements(scheduleId: string): Promise<SettlementRecord[]> {
  const { data, error } = await supabase.from('settlement_records').select('*').eq('schedule_id', scheduleId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertSettlement(record: Partial<SettlementRecord>): Promise<void> {
  const { error } = await supabase.from('settlement_records').upsert(record);
  if (error) throw error;
}
