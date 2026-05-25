import type { Artist, ArtistAvailability, BarSession } from '@/types/types';

const ALL_STYLES = ['R&B', '流行', '英文', '唱跳', '气氛', '抒情', '说唱'];
export { ALL_STYLES };

/** 将 Date 格式化为本地 YYYY-MM-DD（不受 toISOString UTC 偏移影响） */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 判断歌手档期是否能覆盖节次
 * 逻辑：
 * - 凌晨节次（start<06:00，如01:00）：歌手当晚在场 或 跨天工作到凌晨
 * - 跨天节次（end<start，如23:30-00:00）：歌手必须跨天工作到凌晨
 * - 正常节次：歌手来得不晚于节次开始，且离场不早于节次结束（+30分钟缓冲）
 */
function canCoverSession(
  availStart: string,
  availEnd: string,
  sessionStart: string,
  sessionEnd: string
): boolean {
  // 凌晨节次（< 06:00）：当晚在场 或 跨天工作到凌晨
  if (timeToMinutes(sessionStart) < 360) {
    const tonight = timeToMinutes(availStart) >= 1080 && timeToMinutes(availEnd) >= 1080; // 1080=18:00 当晚在场
    const overnight = timeToMinutes(availStart) >= 1080 && timeToMinutes(availEnd) < 360; // 跨天到凌晨
    if (tonight || overnight) {
      if (overnight) {
        const availEndMin = timeToMinutes(availEnd);
        const sessionEndMin = timeToMinutes(sessionEnd);
        return availEndMin + 30 >= sessionEndMin;
      }
      return true;
    }
    return false;
  }

  // 跨天节次（如 23:30-00:00）：歌手必须跨天工作（availEnd < 06:00 即凌晨）
  if (sessionEnd < sessionStart) {
    if (timeToMinutes(availEnd) >= 360) return false; // 360 = 06:00，非凌晨的歌手无法覆盖跨天节次
    const availEndMin = timeToMinutes(availEnd);
    const sessionEndMin = timeToMinutes(sessionEnd);
    return availEndMin + 30 >= sessionEndMin;
  }

  // 正常节次：歌手来得不比节次晚
  if (availStart > sessionStart) return false;

  // 歌手必须覆盖到节次结束（+30分钟缓冲）
  let availEndMin = timeToMinutes(availEnd);
  const sessionEndMin = timeToMinutes(sessionEnd);
  // 歌手跨午夜（如 22:30-0:00）：结束时间算到次日 +1440
  if (timeToMinutes(availEnd) < timeToMinutes(availStart)) {
    availEndMin += 1440;
  }
  return availEndMin + 30 >= sessionEndMin;
}

export function isArtistAvailable(
  artist: Artist,
  availabilities: ArtistAvailability[],
  date: Date,
  session: BarSession
): boolean {
  const dateStr = formatLocalDate(date);
  const dayOfWeek = date.getDay();

  // --- 辅助：fallback 到固定档期时间检查 ---
  const checkFixed = (): boolean => {
    const fixedAvail = availabilities.find(
      (a) =>
        a.artist_id === artist.id &&
        a.availability_type === 'fixed' &&
        a.day_of_week === dayOfWeek
    );
    if (!fixedAvail || !fixedAvail.is_available) return false;
    if (!fixedAvail.available_start || !fixedAvail.available_end) return true;
    return canCoverSession(
      fixedAvail.available_start,
      fixedAvail.available_end,
      session.start_time || '',
      session.end_time || ''
    );
  };

  // 1. Check temporary with specific_date (exact date override, highest priority)
  const tempExact = availabilities.find(
    (a) =>
      a.artist_id === artist.id &&
      a.availability_type === 'temporary' &&
      a.specific_date === dateStr
  );
  if (tempExact && tempExact.is_available) {
    // 没填时间 → fallback 到固定档期，防止误排
    if (!tempExact.available_start || !tempExact.available_end) {
      return checkFixed();
    }
    return canCoverSession(
      tempExact.available_start,
      tempExact.available_end,
      session.start_time || '',
      session.end_time || ''
    );
  }
  // tempExact 存在但 is_available=false → 继续查 fixed

  // 2. Check temporary with day_of_week (weekly temporary schedule)
  const tempWeekly = availabilities.find(
    (a) =>
      a.artist_id === artist.id &&
      a.availability_type === 'temporary' &&
      a.specific_date === null &&
      a.day_of_week === dayOfWeek
  );
  if (tempWeekly && tempWeekly.is_available) {
    // 没填时间 → fallback 到固定档期，防止误排
    if (!tempWeekly.available_start || !tempWeekly.available_end) {
      return checkFixed();
    }
    return canCoverSession(
      tempWeekly.available_start,
      tempWeekly.available_end,
      session.start_time || '',
      session.end_time || ''
    );
  }
  // tempWeekly 存在但 is_available=false → 继续查 fixed

  // 3. Check fixed schedule
  return checkFixed();
}

/**
 * Check if artist has fixed availability (not temporary override)
 * Used to identify fixed-slot singers for auto-locking
 */
export function hasFixedAvailability(
  artistId: string,
  availabilities: ArtistAvailability[],
  dayOfWeek: number
): boolean {
  return availabilities.some(
    (a) =>
      a.artist_id === artistId &&
      a.availability_type === 'fixed' &&
      a.day_of_week === dayOfWeek &&
      a.is_available
  );
}

/**
 * Filter available artists by style priority (degradation)
 * style_tags array order = priority order
 * e.g. [抒情, R&B, 说唱] → first try 抒情-only, then R&B-only, then 说唱-only
 * Returns: matched in priority order, unmatched (available but no style match), priorityGroups
 */
export function filterAndSortArtists(
  artists: Artist[],
  availabilities: ArtistAvailability[],
  date: Date,
  session: BarSession,
  requiredStyles: string[]
): { matched: Artist[]; unmatched: Artist[]; priorityGroups: Artist[][] } {
  const allAvailable = artists.filter((a) =>
    isArtistAvailable(a, availabilities, date, session)
  );

  if (requiredStyles.length === 0) {
    return {
      matched: allAvailable,
      unmatched: [],
      priorityGroups: [allAvailable],
    };
  }

  const pickedIds = new Set<string>();
  const priorityGroups: Artist[][] = [];
  const allMatched: Artist[] = [];

  for (const style of requiredStyles) {
    const matches = allAvailable.filter(
      (a) => !pickedIds.has(a.id) && a.style_tags.includes(style)
    );
    priorityGroups.push(matches);
    for (const a of matches) {
      allMatched.push(a);
      pickedIds.add(a.id);
    }
  }

  const unmatched = allAvailable.filter((a) => !pickedIds.has(a.id));

  return { matched: allMatched, unmatched, priorityGroups };
}

// For auto-assign: return style-matched available artists in priority order
export function filterStyleMatchedArtists(
  artists: Artist[],
  availabilities: ArtistAvailability[],
  date: Date,
  session: BarSession,
  requiredStyles: string[]
): Artist[] {
  const { matched } = filterAndSortArtists(
    artists,
    availabilities,
    date,
    session,
    requiredStyles
  );
  return matched;
}

export function getPeriodLabel(type: 'weekly' | 'monthly', date: Date): string {
  const y = date.getFullYear();
  if (type === 'monthly') {
    const m = date.getMonth() + 1;
    return `${y}年${m}月`;
  }
  const startOfYear = new Date(y, 0, 1);
  const day = startOfYear.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  const firstMonday = new Date(y, 0, 1 + offset);
  const diff = date.getTime() - firstMonday.getTime();
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${y}年第${weekNum}周`;
}

export function getPeriodStart(type: 'weekly' | 'monthly', date: Date): Date {
  if (type === 'monthly') {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

export function getPeriodEnd(type: 'weekly' | 'monthly', date: Date): Date {
  if (type === 'monthly') {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
  const start = getPeriodStart(type, date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

export function getDatesInPeriod(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const curr = new Date(start);
  while (curr <= end) {
    dates.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

export function autoAssign(
  artists: Artist[],
  availabilities: ArtistAvailability[],
  sessions: BarSession[],
  dates: Date[],
  restDays: number[] = [],
  preferredSessionsMap?: Record<string, number[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const showCount: Record<string, number> = {};
  artists.forEach((a) => (showCount[a.id] = 0));

  for (const date of dates) {
    const dayOfWeek = date.getDay();
    // Skip rest days
    if (restDays.includes(dayOfWeek)) continue;

    for (const session of sessions) {
      const dateStr = formatLocalDate(date);
      const key = `${dateStr}_${session.id}`;
      const needed = session.singers_per_session;

      // Fill slots with style-matched available artists, balanced distribution
      const styleMatched = filterStyleMatchedArtists(
        artists,
        availabilities,
        date,
        session,
        session.style_tags || []
      );

      // Sort: 1) showCount (lowest first = fair)  2) preference match  3) random
      const sorted = [...styleMatched].sort(
        (a, b) => {
          const diff = (showCount[a.id] || 0) - (showCount[b.id] || 0);
          if (diff !== 0) return diff;
          // 偏好节次：当前节次在偏好数组中的索引，越靠前越优先
          const aPref = preferredSessionsMap?.[a.id] || [];
          const bPref = preferredSessionsMap?.[b.id] || [];
          const aIdx = aPref.indexOf(session.session_number);
          const bIdx = bPref.indexOf(session.session_number);
          const aRank = aIdx === -1 ? Infinity : aIdx;
          const bRank = bIdx === -1 ? Infinity : bIdx;
          if (aRank !== bRank) return aRank - bRank;
          return Math.random() - 0.5;
        }
      );

      const picked: string[] = [];
      for (const artist of sorted) {
        if (picked.length >= needed) break;
        picked.push(artist.id);
        showCount[artist.id] = (showCount[artist.id] || 0) + 1;
      }

      result[key] = picked;
    }
  }

  return result;
}
