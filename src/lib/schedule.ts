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
 * - 凌晨节次（<06:00，如01:00）：歌手当天晚上在场 或 跨天工作到凌晨，均可匹配
 * - 正常节次：歌手来得不晚于节次开始，且离场不早于节次结束（+30分钟缓冲）
 */
function canCoverSession(
  availStart: string,
  availEnd: string,
  sessionStart: string,
  sessionEnd: string
): boolean {
  // 凌晨节次（< 06:00）：当晚在场 或 跨天工作到凌晨
  if (sessionStart < '06:00') {
    const tonight = availStart >= '18:00' && availEnd >= '18:00'; // 当晚在场
    const overnight = availStart >= '18:00' && availEnd < '06:00'; // 跨天到凌晨
    if (tonight || overnight) {
      // 跨天还需检查是否覆盖节次结束
      if (overnight) {
        const availEndMin = timeToMinutes(availEnd);
        const sessionEndMin = timeToMinutes(sessionEnd);
        return availEndMin + 30 >= sessionEndMin;
      }
      return true;
    }
    return false;
  }

  // 正常节次：歌手来得不比节次晚
  if (availStart > sessionStart) return false;

  // 歌手必须覆盖到节次结束（+30分钟缓冲）
  const availEndMin = timeToMinutes(availEnd);
  const sessionEndMin = timeToMinutes(sessionEnd);
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
  restDays: number[] = []
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

      // Step 1: Auto-lock fixed-slot singers, style-matched first
      const styleTags = session.style_tags || [];
      const fixedCandidates = artists.filter(
        (a) =>
          hasFixedAvailability(a.id, availabilities, dayOfWeek) &&
          isArtistAvailable(a, availabilities, date, session)
      );
      // Sort: style-matched first, then by show count (balanced)
      const sortedFixed = [...fixedCandidates].sort((a, b) => {
        const aStyleMatch = styleTags.some((st) => a.style_tags.includes(st)) ? 1 : 0;
        const bStyleMatch = styleTags.some((st) => b.style_tags.includes(st)) ? 1 : 0;
        if (bStyleMatch !== aStyleMatch) return bStyleMatch - aStyleMatch;
        return (showCount[a.id] || 0) - (showCount[b.id] || 0);
      });
      const locked: string[] = [];
      for (const artist of sortedFixed) {
        if (locked.length >= needed) break;
        locked.push(artist.id);
        showCount[artist.id] = (showCount[artist.id] || 0) + 1;
      }

      // Step 2: Fill remaining slots with style-matched available artists
      const remainingNeeded = needed - locked.length;
      const styleMatched = filterStyleMatchedArtists(
        artists.filter((a) => !locked.includes(a.id)),
        availabilities,
        date,
        session,
        session.style_tags || []
      );

      // Sort by show count for balanced distribution
      const sorted = [...styleMatched].sort(
        (a, b) => (showCount[a.id] || 0) - (showCount[b.id] || 0)
      );

      const picked: string[] = [];
      for (const artist of sorted) {
        if (picked.length >= remainingNeeded) break;
        picked.push(artist.id);
        showCount[artist.id] = (showCount[artist.id] || 0) + 1;
      }

      result[key] = [...locked, ...picked];
    }
  }

  return result;
}
