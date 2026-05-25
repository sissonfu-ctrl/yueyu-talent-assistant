import { sql } from '@/db/neon';
import { verifyToken } from '@/db/auth';
import type {
  Bar, BarSession, Artist, ArtistAvailability, ArtistBarLink,
  Schedule, ScheduleAssignment, BarArtistPrice, SettlementRecord
} from '@/types/types';

async function getCurrentUserId(): Promise<string> {
  if (typeof window === 'undefined') return '00000000-0000-0000-0000-000000000000';
  const token = localStorage.getItem('singer-tool-token');
  if (!token) return '00000000-0000-0000-0000-000000000000';
  const user = await verifyToken(token);
  return user?.id || '00000000-0000-0000-0000-000000000000';
}

// Helper: dynamic UPDATE with sql(query, params) — column names from typed Partial<> are safe
async function dynamicUpdate(table: string, id: string, updates: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const params = [...Object.values(updates), id];
  await sql.query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${keys.length + 1}`,
    params
  );
}

// Helper: dynamic INSERT ... ON CONFLICT DO UPDATE
async function dynamicUpsert(
  table: string,
  row: Record<string, unknown>,
  conflictCols: string = 'id'
): Promise<void> {
  const keys = Object.keys(row);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = Object.values(row);
  const conflictArr = conflictCols.split(',').map(c => c.trim());
  const setClauses = keys
    .filter(k => !conflictArr.includes(k))
    .map(k => `${k} = EXCLUDED.${k}`);
  await sql.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClauses.join(', ')}`,
    values
  );
}

// ================= Bars =================

export async function getBars(): Promise<Bar[]> {
  const rows = await sql`SELECT * FROM bars ORDER BY name`;
  return rows as Bar[];
}

export async function getBarById(id: string): Promise<Bar | null> {
  const rows = await sql`SELECT * FROM bars WHERE id = ${id}`;
  return (rows[0] as Bar) || null;
}

export async function createBar(bar: Omit<Bar, 'id' | 'created_at' | 'user_id'>): Promise<Bar> {
  const rows = await sql`
    INSERT INTO bars (name, address, contact, schedule_cycle_type, sessions_per_night, pool_type, default_price_per_show, rest_days, user_id)
    VALUES (${bar.name}, ${bar.address}, ${bar.contact}, ${bar.schedule_cycle_type}, ${bar.sessions_per_night}, ${bar.pool_type}, ${bar.default_price_per_show}, ${bar.rest_days}, ${await getCurrentUserId()})
    RETURNING *
  `;
  if (!rows[0]) throw new Error('Failed to create bar');
  return rows[0] as Bar;
}

export async function updateBar(id: string, updates: Partial<Bar>): Promise<void> {
  await dynamicUpdate('bars', id, updates as Record<string, unknown>);
}

export async function deleteBar(id: string): Promise<void> {
  await sql`DELETE FROM bars WHERE id = ${id}`;
}

// ================= Bar Sessions =================

export async function getBarSessions(barId: string, weekday?: number): Promise<BarSession[]> {
  if (weekday !== undefined) {
    const rows = await sql`SELECT * FROM bar_sessions WHERE bar_id = ${barId} AND weekday = ${weekday} ORDER BY session_number`;
    return rows as BarSession[];
  }
  const rows = await sql`SELECT * FROM bar_sessions WHERE bar_id = ${barId} ORDER BY session_number`;
  return rows as BarSession[];
}

export async function getBarSessionsForDate(barId: string, weekday: number, replaceWeekdays: number[] = []): Promise<BarSession[]> {
  const generic = await sql`SELECT * FROM bar_sessions WHERE bar_id = ${barId} AND weekday IS NULL ORDER BY session_number`;
  const specific = await sql`SELECT * FROM bar_sessions WHERE bar_id = ${barId} AND weekday = ${weekday} ORDER BY session_number`;
  if (replaceWeekdays.includes(weekday) && specific.length > 0) return specific as BarSession[];
  return [...generic, ...specific] as BarSession[];
}

export async function upsertBarSessions(sessions: Partial<BarSession>[]): Promise<void> {
  for (const session of sessions) {
    await dynamicUpsert('bar_sessions', session as Record<string, unknown>);
  }
}

export async function deleteBarSession(id: string): Promise<void> {
  await sql`DELETE FROM bar_sessions WHERE id = ${id}`;
}

// ================= Artists =================

export async function getArtists(): Promise<Artist[]> {
  const rows = await sql`SELECT * FROM artists ORDER BY name`;
  return rows as Artist[];
}

export async function getArtistsByType(type: 'singer' | 'musician'): Promise<Artist[]> {
  const rows = await sql`SELECT * FROM artists WHERE type = ${type} ORDER BY name`;
  return rows as Artist[];
}

export async function getArtistById(id: string): Promise<Artist | null> {
  const rows = await sql`SELECT * FROM artists WHERE id = ${id}`;
  return (rows[0] as Artist) || null;
}

export async function createArtist(artist: Omit<Artist, 'id' | 'created_at' | 'user_id'>): Promise<Artist> {
  const rows = await sql`
    INSERT INTO artists (name, phone, type, style_tags, fixed_bar_id, user_id)
    VALUES (${artist.name}, ${artist.phone}, ${artist.type}, ${artist.style_tags}, ${artist.fixed_bar_id}, ${await getCurrentUserId()})
    RETURNING *
  `;
  if (!rows[0]) throw new Error('Failed to create artist');
  return rows[0] as Artist;
}

export async function updateArtist(id: string, updates: Partial<Artist>): Promise<void> {
  await dynamicUpdate('artists', id, updates as Record<string, unknown>);
}

export async function deleteArtist(id: string): Promise<void> {
  await sql`DELETE FROM artists WHERE id = ${id}`;
}

export async function deleteArtists(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`DELETE FROM artists WHERE id = ANY(${ids})`;
}

// ================= Artist Bar Links =================

export async function getArtistBarLinks(artistId?: string, barId?: string): Promise<ArtistBarLink[]> {
  if (artistId && barId) {
    const rows = await sql`SELECT * FROM artist_bar_links WHERE artist_id = ${artistId} AND bar_id = ${barId}`;
    return rows as ArtistBarLink[];
  }
  if (artistId) {
    const rows = await sql`SELECT * FROM artist_bar_links WHERE artist_id = ${artistId}`;
    return rows as ArtistBarLink[];
  }
  if (barId) {
    const rows = await sql`SELECT * FROM artist_bar_links WHERE bar_id = ${barId}`;
    return rows as ArtistBarLink[];
  }
  const rows = await sql`SELECT * FROM artist_bar_links`;
  return rows as ArtistBarLink[];
}

export async function setArtistBars(artistId: string, barIds: string[]): Promise<void> {
  await sql`DELETE FROM artist_bar_links WHERE artist_id = ${artistId}`;
  if (barIds.length === 0) return;
  for (const barId of barIds) {
    await sql`INSERT INTO artist_bar_links (artist_id, bar_id) VALUES (${artistId}, ${barId})`;
  }
}

export async function linkArtistToBar(artistId: string, barId: string): Promise<void> {
  // 避免重复：先检查
  const existing = await sql`SELECT 1 FROM artist_bar_links WHERE artist_id = ${artistId} AND bar_id = ${barId}`;
  if (existing.length > 0) return;
  await sql`INSERT INTO artist_bar_links (artist_id, bar_id) VALUES (${artistId}, ${barId})`;
}

export async function unlinkArtistFromBar(artistId: string, barId: string): Promise<void> {
  await sql`DELETE FROM artist_bar_links WHERE artist_id = ${artistId} AND bar_id = ${barId}`;
}

export async function updateArtistBarPreferredSessions(
  artistId: string,
  barId: string,
  preferredSessions: number[] | null
): Promise<void> {
  await sql`
    UPDATE artist_bar_links
    SET preferred_sessions = ${preferredSessions}
    WHERE artist_id = ${artistId} AND bar_id = ${barId}
  `;
}

// ================= Availabilities =================

export async function getAvailabilities(artistId?: string): Promise<ArtistAvailability[]> {
  if (artistId) {
    const rows = await sql`SELECT * FROM artist_availabilities WHERE artist_id = ${artistId} ORDER BY created_at`;
    return rows as ArtistAvailability[];
  }
  const rows = await sql`SELECT * FROM artist_availabilities ORDER BY created_at`;
  return rows as ArtistAvailability[];
}

export async function createAvailability(
  availability: Omit<ArtistAvailability, 'id' | 'created_at'>
): Promise<ArtistAvailability> {
  const rows = await sql`
    INSERT INTO artist_availabilities (artist_id, availability_type, day_of_week, specific_date, available_start, available_end, is_available, note)
    VALUES (${availability.artist_id}, ${availability.availability_type}, ${availability.day_of_week}, ${availability.specific_date}, ${availability.available_start}, ${availability.available_end}, ${availability.is_available}, ${availability.note})
    RETURNING *
  `;
  if (!rows[0]) throw new Error('Failed to create availability');
  return rows[0] as ArtistAvailability;
}

export async function updateAvailability(id: string, updates: Partial<ArtistAvailability>): Promise<void> {
  await dynamicUpdate('artist_availabilities', id, updates as Record<string, unknown>);
}

export async function deleteAvailability(id: string): Promise<void> {
  await sql`DELETE FROM artist_availabilities WHERE id = ${id}`;
}

export async function deleteAvailabilities(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`DELETE FROM artist_availabilities WHERE id = ANY(${ids})`;
}

export async function deleteAllArtistAvailabilities(artistId: string): Promise<void> {
  await sql`DELETE FROM artist_availabilities WHERE artist_id = ${artistId}`;
}

// ================= Schedules =================

export async function getSchedules(barId?: string): Promise<Schedule[]> {
  if (barId) {
    const rows = await sql`SELECT * FROM schedules WHERE bar_id = ${barId} ORDER BY created_at DESC`;
    return rows as Schedule[];
  }
  const rows = await sql`SELECT * FROM schedules ORDER BY created_at DESC`;
  return rows as Schedule[];
}

export async function getScheduleById(id: string): Promise<Schedule | null> {
  const rows = await sql`SELECT * FROM schedules WHERE id = ${id}`;
  return (rows[0] as Schedule) || null;
}

export async function getCurrentSchedule(barId: string, periodLabel: string): Promise<Schedule | null> {
  const rows = await sql`SELECT * FROM schedules WHERE bar_id = ${barId} AND period_label = ${periodLabel} AND is_current = true`;
  return (rows[0] as Schedule) || null;
}

export async function createSchedule(schedule: Omit<Schedule, 'id' | 'created_at' | 'user_id'>): Promise<Schedule> {
  const rows = await sql`
    INSERT INTO schedules (bar_id, period_type, period_label, period_start, period_end, status, is_current, user_id)
    VALUES (${schedule.bar_id}, ${schedule.period_type}, ${schedule.period_label}, ${schedule.period_start}, ${schedule.period_end}, ${schedule.status}, ${schedule.is_current}, ${await getCurrentUserId()})
    RETURNING *
  `;
  if (!rows[0]) throw new Error('Failed to create schedule');
  return rows[0] as Schedule;
}

export async function updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
  await dynamicUpdate('schedules', id, updates as Record<string, unknown>);
}

export async function archiveOldSchedules(barId: string, periodLabel: string): Promise<void> {
  await sql`UPDATE schedules SET is_current = false WHERE bar_id = ${barId} AND period_label = ${periodLabel} AND is_current = true`;
}

export async function deleteSchedule(id: string): Promise<void> {
  await sql`DELETE FROM schedules WHERE id = ${id}`;
}

export async function deleteSchedules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`DELETE FROM schedules WHERE id = ANY(${ids})`;
}

// ================= Schedule Assignments =================

export async function getAssignments(scheduleId: string): Promise<ScheduleAssignment[]> {
  const rows = await sql`SELECT * FROM schedule_assignments WHERE schedule_id = ${scheduleId}`;
  return rows as ScheduleAssignment[];
}

export async function upsertAssignments(assignments: Partial<ScheduleAssignment>[]): Promise<void> {
  for (const assignment of assignments) {
    await dynamicUpsert('schedule_assignments', assignment as Record<string, unknown>);
  }
}

export async function deleteAssignment(id: string): Promise<void> {
  await sql`DELETE FROM schedule_assignments WHERE id = ${id}`;
}

export async function clearScheduleAssignments(scheduleId: string): Promise<void> {
  await sql`DELETE FROM schedule_assignments WHERE schedule_id = ${scheduleId}`;
}

export async function toggleLockAssignment(id: string, isLocked: boolean): Promise<void> {
  await sql`UPDATE schedule_assignments SET is_locked = ${isLocked} WHERE id = ${id}`;
}

export async function getLockedAssignments(barId: string): Promise<ScheduleAssignment[]> {
  const scheduleRows = await sql`
    SELECT id FROM schedules
    WHERE bar_id = ${barId} AND is_current = true
    ORDER BY created_at DESC LIMIT 1
  `;
  if (scheduleRows.length === 0) return [];
  const scheduleId = (scheduleRows[0] as { id: string }).id;
  const rows = await sql`SELECT * FROM schedule_assignments WHERE schedule_id = ${scheduleId} AND is_locked = true`;
  return rows as ScheduleAssignment[];
}

// 查询某歌手在某天的所有跨酒吧排班（含时间信息）
export async function getCrossBarAssignments(
  artistId: string,
  date: string
): Promise<{ bar_name: string; bar_id: string; session_number: number; start_time: string; end_time: string; assignment_id: string }[]> {
  const rows = await sql`
    SELECT
      b.name AS bar_name,
      b.id AS bar_id,
      bs.session_number,
      bs.start_time,
      bs.end_time,
      sa.id AS assignment_id
    FROM schedule_assignments sa
    JOIN schedules s ON sa.schedule_id = s.id
    JOIN bars b ON s.bar_id = b.id
    JOIN bar_sessions bs ON sa.session_id = bs.id
    WHERE sa.artist_id = ${artistId}
      AND sa.date = ${date}
      AND s.is_current = true
    ORDER BY bs.start_time
  `;
  return rows as any[];
}

// 扫描所有当前排班，返回所有时间冲突对
export async function detectScheduleConflicts(): Promise<
  { assignment_id: string; artist_name: string; date: string; bar1: string; time1: string; bar2: string; time2: string }[]
> {
  const rows = await sql`
    WITH current_assignments AS (
      SELECT
        sa.id AS assignment_id,
        sa.artist_id,
        sa.date,
        b.name AS bar_name,
        b.id AS bar_id,
        bs.start_time,
        bs.end_time
      FROM schedule_assignments sa
      JOIN schedules s ON sa.schedule_id = s.id
      JOIN bars b ON s.bar_id = b.id
      JOIN bar_sessions bs ON sa.session_id = bs.id
      WHERE s.is_current = true AND sa.artist_id IS NOT NULL
    )
    SELECT
      a1.assignment_id,
      ar.name AS artist_name,
      a1.date,
      a1.bar_name AS bar1,
      a1.start_time || '-' || a1.end_time AS time1,
      a2.bar_name AS bar2,
      a2.start_time || '-' || a2.end_time AS time2
    FROM current_assignments a1
    JOIN current_assignments a2
      ON a1.artist_id = a2.artist_id
      AND a1.date = a2.date
      AND a1.bar_id < a2.bar_id
      AND a1.start_time < a2.end_time
      AND a2.start_time < a1.end_time
    JOIN artists ar ON a1.artist_id = ar.id
    ORDER BY a1.date, ar.name
  `;
  return rows as any[];
}

// ================= Bar Artist Prices =================

export async function getBarArtistPrices(barId?: string, artistId?: string): Promise<BarArtistPrice[]> {
  if (barId && artistId) {
    const rows = await sql`SELECT * FROM bar_artist_prices WHERE bar_id = ${barId} AND artist_id = ${artistId}`;
    return rows as BarArtistPrice[];
  }
  if (barId) {
    const rows = await sql`SELECT * FROM bar_artist_prices WHERE bar_id = ${barId}`;
    return rows as BarArtistPrice[];
  }
  if (artistId) {
    const rows = await sql`SELECT * FROM bar_artist_prices WHERE artist_id = ${artistId}`;
    return rows as BarArtistPrice[];
  }
  const rows = await sql`SELECT * FROM bar_artist_prices`;
  return rows as BarArtistPrice[];
}

export async function upsertBarArtistPrice(price: BarArtistPrice): Promise<void> {
  await sql`
    INSERT INTO bar_artist_prices (bar_id, artist_id, price_per_show)
    VALUES (${price.bar_id}, ${price.artist_id}, ${price.price_per_show})
    ON CONFLICT (bar_id, artist_id) DO UPDATE SET price_per_show = EXCLUDED.price_per_show
  `;
}

// ================= Settlement =================

export async function getSettlements(scheduleId: string): Promise<SettlementRecord[]> {
  const rows = await sql`SELECT * FROM settlement_records WHERE schedule_id = ${scheduleId}`;
  return rows as SettlementRecord[];
}

export async function upsertSettlement(record: Partial<SettlementRecord>): Promise<void> {
  await dynamicUpsert('settlement_records', record as Record<string, unknown>);
}
