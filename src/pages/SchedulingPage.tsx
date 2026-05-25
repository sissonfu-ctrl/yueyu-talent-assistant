import { useEffect, useState, useMemo } from 'react';
import {
  getBars, getBarSessions, getArtists, getArtistBarLinks,
  getAvailabilities, getAssignments, getCurrentSchedule, createSchedule,
  upsertAssignments, archiveOldSchedules, toggleLockAssignment, getLockedAssignments,
  getBarById, getSchedules, getCrossBarAssignments, detectScheduleConflicts,
} from '@/services/database';
import {
  getPeriodLabel, getPeriodStart, getPeriodEnd, getDatesInPeriod, filterAndSortArtists,
  formatLocalDate, autoAssign,
} from '@/lib/schedule';
import { exportToCSV, downloadCSV } from '@/lib/export';
import type { Bar, BarSession, Artist, ArtistAvailability, Schedule, ScheduleAssignment, ArtistBarLink } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  CalendarDays, Wand2, Download, Trash2, Lock, LockOpen,
  ChevronLeft, ChevronRight, Clock, User, Plus, Zap,
} from 'lucide-react';

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

export default function SchedulingPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedBarId, setSelectedBarId] = useState('');
  const [periodType, setPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [periodDate, setPeriodDate] = useState(() => {
    const d = new Date();
    return formatLocalDate(d);
  });

  const [bar, setBar] = useState<Bar | null>(null);
  const [sessionMap, setSessionMap] = useState<Record<string, BarSession[]>>({});
  const [artists, setArtists] = useState<Artist[]>([]);
  const [availabilities, setAvailabilities] = useState<ArtistAvailability[]>([]);
  const [poolArtistIds, setPoolArtistIds] = useState<Set<string>>(new Set());
  const [artistBarLinks, setArtistBarLinks] = useState<ArtistBarLink[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set()); // 本期锁定（主页📌）
  const [loading, setLoading] = useState(false);
  const [activeDateIndex, setActiveDateIndex] = useState(0);

  // 跨酒吧冲突检测
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [conflictMessages, setConflictMessages] = useState<string[]>([]);

  // Sheet for cell editing
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cellKey, setCellKey] = useState('');
  const [cellAssignments, setCellAssignments] = useState<ScheduleAssignment[]>([]);

  // Temp singer input
  const [tempSingerName, setTempSingerName] = useState('');

  useEffect(() => {
    getBars().then(setBars);
  }, []);

  useEffect(() => {
    if (!selectedBarId) return;
    loadBarData();
  }, [selectedBarId]);

  // Reset active date when period changes
  useEffect(() => {
    setActiveDateIndex(0);
  }, [periodDate, periodType]);

  async function loadBarData() {
    if (!selectedBarId) return;
    try {
      const [b, se, a, links, avails] = await Promise.all([
        getBarById(selectedBarId),
        getBarSessions(selectedBarId),
        getArtists(),
        getArtistBarLinks(undefined, selectedBarId),
        getAvailabilities(),
      ]);
      setBar(b);
      setArtists(a);
      setAvailabilities(avails);
      setPoolArtistIds(new Set(links.map((l) => l.artist_id)));
      setArtistBarLinks(links);

      const map: Record<string, BarSession[]> = {};
      map['generic'] = se.filter((s) => s.weekday === null);
      const replaceWeekdays = new Set(b?.replace_weekdays || []);
      for (let i = 0; i <= 6; i++) {
        const specific = se.filter((s) => s.weekday === i);
        if (replaceWeekdays.has(i) && specific.length > 0) {
          map[i] = specific;
        } else {
          map[i] = se.filter((s) => s.weekday === i || s.weekday === null).sort((a, b) => (a.weekday === null ? -1 : 0) || a.session_number - b.session_number);
        }
      }
      setSessionMap(map);
      // 自动加载该酒吧的排班
      await loadScheduleForBar(selectedBarId, periodLabel);
    } catch (e) {
      toast.error('加载失败');
    }
  }

  async function loadScheduleForBar(barId: string, period: string) {
    if (!barId || !period) return;
    try {
      const existing = await getCurrentSchedule(barId, period);
      if (existing) {
        setSchedule(existing);
        const ass = await getAssignments(existing.id);
        setAssignments(ass);
      } else {
        setSchedule(null);
        setAssignments([]);
      }
    } catch { /* silent on background load */ }
  }

  const dates = useMemo(() => {
    if (!periodDate) return [];
    const d = new Date(periodDate);
    const start = getPeriodStart(periodType, d);
    const end = getPeriodEnd(periodType, d);
    return getDatesInPeriod(start, end).map((date) => formatLocalDate(date));
  }, [periodType, periodDate]);

  const periodLabel = useMemo(() => {
    if (!periodDate) return '';
    return getPeriodLabel(periodType, new Date(periodDate));
  }, [periodType, periodDate]);

  const poolArtists = useMemo(
    () => artists.filter((a) => poolArtistIds.has(a.id) && a.type === 'singer'),
    [artists, poolArtistIds]
  );

  const preferredSessionsMap = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const link of artistBarLinks) {
      if (link.preferred_sessions?.length) {
        map[link.artist_id] = link.preferred_sessions;
      }
    }
    return map;
  }, [artistBarLinks]);

  const [generatingAll, setGeneratingAll] = useState(false);

  const generateAll = async () => {
    setGeneratingAll(true);
    try {
      const allSchedules = await getSchedules();
      const unScheduled = bars.filter(
        (b) => !allSchedules.some((s) => s.bar_id === b.id && s.is_current)
      );

      if (unScheduled.length === 0) {
        toast.info('所有酒吧都已排班');
        return;
      }

      let count = 0;
      for (const barItem of unScheduled) {
        try {
          // 直接获取数据，不依赖 React 状态
          const [b, se, a, links, avails] = await Promise.all([
            getBarById(barItem.id),
            getBarSessions(barItem.id),
            getArtists(),
            getArtistBarLinks(undefined, barItem.id),
            getAvailabilities(),
          ]);

          if (!b || a.length === 0) continue;

          const poolIds = new Set(links.map((l) => l.artist_id));
          const poolList = a.filter((ar) => poolIds.has(ar.id) && ar.type === 'singer');

          if (poolList.length === 0) {
            toast.error(`${barItem.name} 没有歌手池，跳过`);
            continue;
          }

          // 构建 sessionMap
          const map: Record<string, BarSession[]> = {};
          map['generic'] = se.filter((s) => s.weekday === null);
          const replaceWeekdays = new Set(b?.replace_weekdays || []);
          for (let i = 0; i <= 6; i++) {
            const specific = se.filter((s) => s.weekday === i);
            if (replaceWeekdays.has(i) && specific.length > 0) {
              map[i] = specific;
            } else {
              map[i] = se.filter((s) => s.weekday === i || s.weekday === null).sort((a, b) => (a.weekday === null ? -1 : 0) || a.session_number - b.session_number);
            }
          }

          // 计算艺人酒吧优先级权重
          const artistBoosts: Record<string, number> = {};
          for (const artist of poolList) {
            if (artist.bar_priority?.length) {
              const idx = artist.bar_priority.indexOf(barItem.id);
              if (idx === 0) artistBoosts[artist.id] = 1000;   // 第一志愿
              else if (idx === 1) artistBoosts[artist.id] = 500;  // 第二志愿
              else if (idx >= 2) artistBoosts[artist.id] = 200;   // 第三志愿及以后
            }
          }

          await doGenerateSchedule({
            barId: barItem.id,
            bar: b,
            poolArtistIds: poolIds,
            poolArtists: poolList,
            artistBarLinks: links,
            sessionMap: map,
            availabilities: avails,
            artistBoosts,
          });

          count++;
          toast.success(`${barItem.name} 排班已生成`);
        } catch (e: any) {
          toast.error(`${barItem.name} 生成失败：${e.message}`);
        }
      }

      if (count > 0) {
        toast.success(`已为 ${count} 个酒吧生成排班`);
        // 跨酒吧冲突扫描
        try {
          const conflicts = await detectScheduleConflicts();
          if (conflicts.length > 0) {
            const ids = new Set(conflicts.map((c: any) => c.assignment_id));
            setConflictIds(ids);
            const msgs = conflicts.map((c: any) =>
              `${c.date} ${c.artist_name}：${c.bar1}(${c.time1}) ⇄ ${c.bar2}(${c.time2})`
            );
            setConflictMessages(msgs);
            toast.warning(`发现 ${conflicts.length} 个跨酒吧时间冲突`);
          } else {
            setConflictIds(new Set());
            setConflictMessages([]);
          }
        } catch { /* silent */ }
      }
    } catch (e: any) {
      toast.error('批量生成失败：' + e.message);
    } finally {
      setGeneratingAll(false);
    }
  };

  async function doGenerateSchedule(params: {
    barId: string;
    bar: Bar;
    poolArtistIds: Set<string>;
    poolArtists: Artist[];
    artistBarLinks: ArtistBarLink[];
    sessionMap: Record<string, BarSession[]>;
    availabilities: ArtistAvailability[];
    keepPins?: boolean;
    artistBoosts?: Record<string, number>;  // artistId -> priority boost (higher=more priority)
  }): Promise<void> {
    const { barId, bar, poolArtists, artistBarLinks, sessionMap, availabilities, keepPins = false, artistBoosts = {} } = params;

    if (!barId || !bar || poolArtists.length === 0) {
      throw new Error('请选择酒吧并确保有歌手');
    }

    const preferredSessionsMap: Record<string, number[]> = {};
    for (const link of artistBarLinks) {
      if (link.preferred_sessions?.length) {
        preferredSessionsMap[link.artist_id] = link.preferred_sessions;
      }
    }

    // Long-term locks (弹窗🔒): always preserved across cycles
    const lockedAssignments = await getLockedAssignments(barId);

    await archiveOldSchedules(barId, periodLabel);

    const start = getPeriodStart(periodType, new Date(periodDate));
    const end = getPeriodEnd(periodType, new Date(periodDate));

    const newSchedule = await createSchedule({
      bar_id: barId,
      period_type: periodType,
      period_label: periodLabel,
      period_start: formatLocalDate(start),
      period_end: formatLocalDate(end),
      status: 'draft',
      is_current: true,
    });

    const dateObjs = getDatesInPeriod(start, end);
    const allAssignments: Partial<ScheduleAssignment>[] = [];

    // Step 1: Re-use locked assignments
    const lockedKeys = new Set<string>();
    for (const la of lockedAssignments) {
      allAssignments.push({
        schedule_id: newSchedule.id,
        date: la.date,
        session_id: la.session_id,
        artist_id: la.artist_id,
        external_name: la.external_name,
        is_locked: true,
      });
      lockedKeys.add(`${la.date}_${la.session_id}_${la.artist_id}`);
      if (la.external_name) {
        lockedKeys.add(`${la.date}_${la.session_id}_ext_${la.external_name}`);
      }
    }

    // Step 1.5: If keeping pins
    if (keepPins) {
      for (const a of assignments) {
        if (pinnedIds.has(a.id)) {
          const key = `${a.date}_${a.session_id}_${a.artist_id || 'ext_' + a.external_name}`;
          if (!lockedKeys.has(key)) {
            allAssignments.push({
              schedule_id: newSchedule.id,
              date: a.date,
              session_id: a.session_id,
              artist_id: a.artist_id,
              external_name: a.external_name,
              is_locked: false,
            });
            lockedKeys.add(key);
          }
        }
      }
    }

    // Step 2: Auto-assign remaining slots
    const showCount: Record<string, number> = {};
    for (const dateObj of dateObjs) {
      const dateStr = formatLocalDate(dateObj);
      const weekday = dateObj.getDay();

      if ((bar.rest_days || []).includes(weekday)) continue;

      const sortKey = (t: string | null) => {
        if (!t) return '';
        const h = parseInt(t.slice(0, 2));
        return h < 6 ? `z${t}` : `a${t}`;
      };
      const sessionsForDay = (sessionMap[weekday] || []).sort(
        (a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time))
      );
      if (sessionsForDay.length === 0) continue;

      const assignedToday = new Set<string>();

      const lockedForDay = lockedAssignments.filter(
        (la) => la.date === dateStr && la.artist_id
      );
      for (const la of lockedForDay) {
        assignedToday.add(la.artist_id!);
      }

      for (const session of sessionsForDay) {
        const needed = session.singers_per_session || 1;
        const lockedForCell = lockedAssignments.filter(
          (la) => la.date === dateStr && la.session_id === session.id
        );
        const remainingNeeded = needed - lockedForCell.length;

        if (remainingNeeded <= 0) continue;

        const excludedArtistIds = new Set(
          lockedForCell.filter((la) => la.artist_id).map((la) => la.artist_id!)
        );
        for (const aid of assignedToday) excludedArtistIds.add(aid);

        const availableArtists = poolArtists.filter((a) => !excludedArtistIds.has(a.id));

        const { matched } = filterAndSortArtists(
          availableArtists,
          availabilities,
          dateObj,
          session,
          session.style_tags || []
        );

        const sorted = [...matched].sort((a, b) => {
          // 酒吧优先级加权（第一志愿优先于showCount）
          const boostA = artistBoosts[a.id] || 0;
          const boostB = artistBoosts[b.id] || 0;
          if (boostA !== boostB) return boostB - boostA; // 高boost优先
          // 正常排序：出场均衡 > 偏好节次 > 随机
          const diff = (showCount[a.id] || 0) - (showCount[b.id] || 0);
          if (diff !== 0) return diff;
          const aPref = preferredSessionsMap[a.id] || [];
          const bPref = preferredSessionsMap[b.id] || [];
          const aIdx = aPref.indexOf(session.session_number);
          const bIdx = bPref.indexOf(session.session_number);
          const aRank = aIdx === -1 ? Infinity : aIdx;
          const bRank = bIdx === -1 ? Infinity : bIdx;
          if (aRank !== bRank) return aRank - bRank;
          return Math.random() - 0.5;
        });

        const picked: Artist[] = [];
        for (const artist of sorted) {
          if (picked.length >= remainingNeeded) break;
          picked.push(artist);
          showCount[artist.id] = (showCount[artist.id] || 0) + 1;
        }
        for (const artist of picked) {
          const key = `${dateStr}_${session.id}_${artist.id}`;
          if (lockedKeys.has(key)) continue;
          allAssignments.push({
            schedule_id: newSchedule.id,
            date: dateStr,
            session_id: session.id,
            artist_id: artist.id,
          });
          lockedKeys.add(key);
          assignedToday.add(artist.id);
        }
      }
    }

    if (allAssignments.length > 0) {
      await upsertAssignments(allAssignments);
    }

    setSchedule(newSchedule);
    const ass = await getAssignments(newSchedule.id);
    setAssignments(ass);
    toast.success(`排班已生成，共分配 ${allAssignments.length} 个场次`);
  }

  async function generateSchedule(keepPins = false) {
    if (!selectedBarId || !bar || poolArtists.length === 0) {
      toast.error('请选择酒吧并确保有歌手');
      return;
    }
    setLoading(true);
    try {
      await doGenerateSchedule({
        barId: selectedBarId,
        bar,
        poolArtistIds,
        poolArtists,
        artistBarLinks,
        sessionMap,
        availabilities,
        keepPins,
      });
    } catch (e: any) {
      toast.error('生成失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const getCellAssignments = (date: string, sessionId: string) =>
    assignments.filter((a) => a.date === date && a.session_id === sessionId);

  const openCell = (date: string, sessionId: string) => {
    setCellKey(`${date}_${sessionId}`);
    setCellAssignments(getCellAssignments(date, sessionId));
    setTempSingerName('');
    setSheetOpen(true);
  };

  const addAssignment = async (artistId: string) => {
    if (!schedule || !activeSession) return;
    const [date, sessionId] = cellKey.split('_');
    const needed = activeSession.singers_per_session || 1;
    const current = cellAssignments.filter((a) => a.artist_id).length;
    if (current >= needed) {
      toast.error('本节已满，请先删除一名歌手再添加');
      return;
    }
    const payload: Partial<ScheduleAssignment> = {
      schedule_id: schedule.id,
      date,
      session_id: sessionId,
      artist_id: artistId,
    };
    // 乐观更新：立即显示，后台同步不阻塞 UI
    const tempId = 'temp_' + Date.now();
    setAssignments((prev) => [...prev, { ...payload, id: tempId, external_name: null, external_price: null, is_substitute: false, is_locked: false, created_at: new Date().toISOString() } as ScheduleAssignment]);
    setCellAssignments(getCellAssignments(date, sessionId));
    upsertAssignments([payload])
      .then(() => getAssignments(schedule.id))
      .then((ass) => setAssignments(ass))
      .catch((e: any) => {
        setAssignments((prev) => prev.filter((a) => a.id !== tempId));
        toast.error(e.message);
      });
  };

  const addExternal = async (name: string) => {
    if (!schedule || !name.trim()) return;
    const [date, sessionId] = cellKey.split('_');
    const trimmedName = name.trim();
    const matchedArtist = poolArtists.find((a) => a.name === trimmedName);
    // 乐观更新：立即显示
    const tempId = 'temp_ext_' + Date.now();
    const extPayload = {
      schedule_id: schedule.id, date, session_id: sessionId,
      artist_id: matchedArtist ? matchedArtist.id : undefined,
      external_name: matchedArtist ? undefined : trimmedName,
    };
    setAssignments((prev) => [...prev, { id: tempId, ...extPayload, external_price: null, is_substitute: false, is_locked: false, created_at: new Date().toISOString() } as ScheduleAssignment]);
    setTempSingerName('');
    setCellAssignments(getCellAssignments(date, sessionId));
    upsertAssignments([extPayload])
      .then(() => getAssignments(schedule.id))
      .then((ass) => { setAssignments(ass); if (matchedArtist) toast.success('已关联歌手：'+matchedArtist.name); })
      .catch((e: any) => {
        setAssignments((prev) => prev.filter((a) => a.id !== tempId));
        toast.error(e.message);
      });
  };

  const removeAssignment = async (assignmentId: string) => {
    if (!schedule) return;
    // 临时ID还没入库，直接从本地移除即可
    if (assignmentId.startsWith('temp_')) {
      const [date, sessionId] = cellKey.split('_');
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setCellAssignments(getCellAssignments(date, sessionId));
      return;
    }
    // 乐观删除：先移除本地状态
    const oldAssignments = assignments;
    const [date, sessionId] = cellKey.split('_');
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    setCellAssignments(getCellAssignments(date, sessionId));
    import('@/services/database').then((m) => m.deleteAssignment(assignmentId))
      .then(() => getAssignments(schedule.id))
      .then((ass) => setAssignments(ass))
      .catch((e: any) => {
        setAssignments(oldAssignments);
        toast.error(e.message);
      });
  };

  const toggleLock = (assignmentId: string, currentlyLocked: boolean) => {
    if (!schedule) return;
    // 临时ID还没入库，无法锁定
    if (assignmentId.startsWith('temp_')) {
      toast.error('正在保存中，请稍后再试');
      return;
    }
    // 乐观更新
    const [date, sessionId] = cellKey.split('_');
    setAssignments((prev) => prev.map((a) => a.id === assignmentId ? { ...a, is_locked: !currentlyLocked } : a));
    setCellAssignments(getCellAssignments(date, sessionId));
    toast.success(currentlyLocked ? '已解锁' : '已锁定');
    toggleLockAssignment(assignmentId, !currentlyLocked)
      .then(() => getAssignments(schedule.id))
      .then((ass) => setAssignments(ass))
      .catch((e: any) => toast.error(e.message));
  };

  const getAvailableForCell = (date: string, session: BarSession) => {
    const d = new Date(date + 'T00:00:00');
    return filterAndSortArtists(poolArtists, availabilities, d, session, session.style_tags || []);
  };

  const exportSchedule = () => {
    if (!bar || dates.length === 0) return;
    const allSessions = Object.values(sessionMap)
      .flat()
      .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
    const csv = exportToCSV(allSessions, dates, assignments, artists);
    downloadCSV(csv, `${bar.name}_${periodLabel}_排班表.csv`);
  };

  // ---- Render helpers ----
  const activeDate = dates[activeDateIndex] || '';
  const activeDateObj = activeDate ? new Date(activeDate + 'T00:00:00') : null;

  const daySessions = useMemo(() => {
    if (!activeDateObj) return [];
    const wd = activeDateObj.getDay();
    const sessions = sessionMap[wd] || [];
    const sortKey = (t: string | null) => {
      if (!t) return '';
      const h = parseInt(t.slice(0, 2));
      return h < 6 ? `z${t}` : `a${t}`;
    };
    return [...sessions].sort((a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time)));
  }, [activeDateObj, sessionMap]);

  // Desktop calendar: group by session_number instead of flattening all unique sessions
  // This way each session_number is one row, and each date cell shows the appropriate
  // session for that day (generic or weekday-specific override)
  const allSessionNumbers = useMemo(() => {
    const numbers = new Set<number>();
    Object.values(sessionMap).flat().forEach((s) => {
      numbers.add(s.session_number);
    });
    return Array.from(numbers).sort((a, b) => a - b);
  }, [sessionMap]);

  // Get the generic session for a session_number (for row label display)
  const getGenericSessionByNumber = (sessionNumber: number): BarSession | undefined => {
    return (sessionMap['generic'] || []).find((s) => s.session_number === sessionNumber);
  };

  const getDaySessionByNumber = (dateStr: string, sessionNumber: number): BarSession | undefined => {
    return getDaySessions(dateStr).find((s) => s.session_number === sessionNumber);
  };

  const getDaySessions = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const wd = d.getDay();
    const sessions = sessionMap[wd] || [];
    const sortKey = (t: string | null) => {
      if (!t) return '';
      const h = parseInt(t.slice(0, 2));
      return h < 6 ? `z${t}` : `a${t}`;
    };
    return [...sessions].sort((a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time)));
  };

  const isRestDay = activeDateObj && bar ? (bar.rest_days || []).includes(activeDateObj.getDay()) : false;

  const [, sessionId] = cellKey.split('_');
  const activeSession = Object.values(sessionMap).flat().find((s) => s.id === sessionId);
  const [celldate] = cellKey.split('_');

  // 跨酒吧排班信息：该日期所有歌手在其他酒吧的排班
  const [crossBarData, setCrossBarData] = useState<Record<string, { bar_name: string; time: string; overlaps: boolean }[]>>({});
  const [crossBarLoading, setCrossBarLoading] = useState(false);

  // 当前单元格歌手被其他酒吧占用的集合（时间重叠，不可选）
  const [blockedArtistIds, setBlockedArtistIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!celldate || !activeSession) return;
    setCrossBarLoading(true);
    const allPoolIds = poolArtists.map((a) => a.id);
    // 并行查所有池内歌手的跨酒吧排班
    Promise.all(allPoolIds.map((id) => getCrossBarAssignments(id, celldate).catch(() => [])))
      .then((results) => {
        const map: Record<string, { bar_name: string; time: string; overlaps: boolean }[]> = {};
        const blocked = new Set<string>();
        const sessionStart = activeSession.start_time || '';
        const sessionEnd = activeSession.end_time || '';

        results.forEach((rows, i) => {
          const artistId = allPoolIds[i];
          if (rows.length === 0) return;

          const entries = rows
            .filter((r: any) => r.bar_id !== selectedBarId) // 不看自己的排班
            .map((r: any) => {
              const overlaps = sessionStart < r.end_time && r.start_time < sessionEnd;
              return {
                bar_name: r.bar_name,
                time: `${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}`,
                overlaps,
              };
            });

          if (entries.length > 0) {
            map[artistId] = entries;
            // 如果任一条目时间重叠，则该歌手不可选
            if (entries.some((e) => e.overlaps)) {
              blocked.add(artistId);
            }
          }
        });
        setCrossBarData(map);
        setBlockedArtistIds(blocked);
        setCrossBarLoading(false);
      })
      .catch(() => setCrossBarLoading(false));
  }, [celldate, activeSession, selectedBarId, poolArtists]);

  const { matched: availableMatched, unmatched: availableUnmatched, priorityGroups } = useMemo(() => {
    if (!celldate || !activeSession) return { matched: [] as Artist[], unmatched: [] as Artist[], priorityGroups: [] as Artist[][] };
    return getAvailableForCell(celldate, activeSession);
  }, [celldate, activeSession, cellKey, poolArtists, availabilities]);

  const assignedIds = new Set(cellAssignments.map((a) => a.artist_id).filter(Boolean));

  // Artists already assigned in other sessions on the same day
  const todayAssignedIds = new Set(
    assignments
      .filter((a) => a.date === celldate && a.session_id !== activeSession?.id && a.artist_id)
      .map((a) => a.artist_id!)
  );

  // 只过滤同天其他节次已排的歌手；本节已分配歌手仍然显示（标"已选"），方便替换
  // 同时排除跨酒吧时间重叠的歌手（不能同时在两家）
  const filteredPriorityGroups = priorityGroups.map((group) =>
    group.filter((a) => !todayAssignedIds.has(a.id) && !blockedArtistIds.has(a.id))
  );

  const otherUnmatched = availableUnmatched.filter((a) => !todayAssignedIds.has(a.id) && !blockedArtistIds.has(a.id));

  // Artists available but already assigned today in other sessions
  const todayBusyMatched = availableMatched.filter((a) => todayAssignedIds.has(a.id));
  const todayBusyUnmatched = availableUnmatched.filter((a) => todayAssignedIds.has(a.id));

  // 被跨酒吧占用的歌手（不可选，单独展示）
  const crossBarBlocked = [...new Set([
    ...availableMatched.filter((a) => blockedArtistIds.has(a.id)),
    ...availableUnmatched.filter((a) => blockedArtistIds.has(a.id)),
  ])];

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="px-4 pt-2">
        <h2 className="text-lg font-bold text-balance">排班工作台</h2>
        <p className="text-sm text-muted-foreground">自动生成排班并手动调整</p>
      </div>

      {/* Bar tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
        {bars.map((b) => (
          <Button
            key={b.id}
            variant={selectedBarId === b.id ? 'default' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => setSelectedBarId(b.id)}
          >
            {b.name}
          </Button>
        ))}
      </div>

      {/* Conflict banner */}
      {conflictIds.size > 0 && (
        <div className="mx-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-destructive">⚠️ 跨酒吧时间冲突（{conflictIds.size}处）</span>
          </div>
          <div className="text-xs text-destructive/80 space-y-0.5 max-h-24 overflow-y-auto">
            {conflictMessages.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <Card className="mx-4">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">选择酒吧</label>
              <Select value={selectedBarId} onValueChange={setSelectedBarId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="选择酒吧" />
                </SelectTrigger>
                <SelectContent>
                  {bars.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">周期</label>
                <Select value={periodType} onValueChange={(v: any) => setPeriodType(v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">本周</SelectItem>
                    <SelectItem value="monthly">本月</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">基准日期</label>
                <Input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} className="h-11" />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              className="flex-1 h-12 text-base"
              onClick={generateAll}
              disabled={generatingAll || loading}
            >
              <Zap className="h-5 w-5 mr-2" />
              {generatingAll ? '生成中...' : `一键全生成 (${bars.length}个酒吧)`}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12 text-base" onClick={() => loadScheduleForBar(selectedBarId, periodLabel)} disabled={!selectedBarId || generatingAll}>
              <CalendarDays className="h-5 w-5 mr-2" />
              加载
            </Button>
            <Button className="flex-1 h-12 text-base" onClick={() => { setPinnedIds(new Set()); generateSchedule(false); }} disabled={!selectedBarId || loading || generatingAll}>
              <Wand2 className="h-5 w-5 mr-2" />
              {loading ? '生成中...' : '自动生成'}
            </Button>
          </div>

          {schedule && (
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div className="text-sm">
                <span className="text-muted-foreground">当前：</span>
                <span className="font-semibold">{periodLabel}</span>
                <Badge variant={schedule.status === 'published' ? 'default' : 'secondary'} className="ml-2 text-xs">
                  {schedule.status === 'published' ? '已发布' : '草稿'}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-9 px-3" onClick={() => generateSchedule(true)} disabled={generatingAll} title="保留锁定+📌歌手，重新填充空缺">
                  <Wand2 className="h-4 w-4 mr-1" />
                  补位空缺
                </Button>
                <Button variant="outline" size="sm" className="h-9 px-3" onClick={exportSchedule}>
                  <Download className="h-4 w-4 mr-1" />
                  导出
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== MOBILE: Card-based day view ===== */}
      <div className="md:hidden">
        {/* Date Navigation */}
        {dates.length > 0 && (
          <div className="flex items-center gap-2 px-4">
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => setActiveDateIndex(Math.max(0, activeDateIndex - 1))} disabled={activeDateIndex === 0}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 flex gap-1 overflow-x-auto scrollbar-hide py-1">
            {dates.map((d, idx) => {
              const date = new Date(d + 'T00:00:00');
              const wd = date.getDay();
              const isRest = bar && (bar.rest_days || []).includes(wd);
              const isActive = idx === activeDateIndex;
              return (
                <button
                  key={d}
                  onClick={() => setActiveDateIndex(idx)}
                  className={`shrink-0 flex flex-col items-center justify-center min-w-[60px] h-14 rounded-lg border text-sm transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : isRest
                        ? 'bg-destructive/5 text-destructive border-destructive/20'
                        : 'bg-card text-foreground border-border hover:bg-muted'
                  }`}
                >
                  <span className="font-medium">{formatDateShort(d)}</span>
                  <span className="text-xs opacity-80">周{weekDays[wd]}{isRest ? '·休' : ''}</span>
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => setActiveDateIndex(Math.min(dates.length - 1, activeDateIndex + 1))} disabled={activeDateIndex === dates.length - 1}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* Active Day Card */}
      {activeDate && (
        <Card className="mx-4">
          <CardContent className="p-4 space-y-4">
            {/* Day header */}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-lg font-bold">
                  {activeDate} 周{activeDateObj ? weekDays[activeDateObj.getDay()] : ''}
                </div>
                {isRestDay && (
                  <div className="text-sm text-destructive">本日酒吧休息</div>
                )}
              </div>
            </div>

            {isRestDay ? (
              <div className="py-8 text-center text-muted-foreground text-sm">今日休息，无需排班</div>
            ) : daySessions.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">暂无节次配置</div>
            ) : (
              <div className="space-y-3">
                {daySessions.map((session) => {
                  const cellAss = getCellAssignments(activeDate, session.id);
                  const needed = session.singers_per_session || 1;
                  const isFull = cellAss.length >= needed;
                  const hasLocked = cellAss.some((a) => a.is_locked);
                  const hasConflict = cellAss.some((a) => conflictIds.has(a.id));

                  return (
                    <div
                      key={session.id}
                      onClick={() => openCell(activeDate, session.id)}
                      className={`rounded-lg border p-3 transition-colors active:scale-[0.99] min-h-[64px] ${
                        hasConflict
                          ? 'bg-destructive/10 border-destructive/40'
                          : isFull
                            ? 'bg-primary/5 border-primary/20'
                            : 'bg-muted/30 border-border hover:bg-muted/50'
                      }`}
                    >
                      {/* Session header */}
                      <div className="flex items-start gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm">{session.session_name || `第${session.session_number}节`}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {session.start_time?.slice(0, 5)}-{session.end_time?.slice(0, 5)}
                        </span>
                        <div className="flex-1" />
                        {hasLocked && <Lock className="h-4 w-4 text-primary shrink-0" />}
                        {hasConflict && <span className="text-xs text-destructive font-medium shrink-0">⚠️冲突</span>}
                        <Badge variant={isFull ? 'default' : 'outline'} className="text-xs shrink-0 h-5">
                          {cellAss.length}/{needed}
                        </Badge>
                      </div>

                      {/* Style tags - first one highlighted as priority */}
                      {session.style_tags && session.style_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {session.style_tags.map((tag, idx) => (
                            <span
                              key={tag}
                              className={`text-[11px] px-2 py-0.5 rounded-full ${
                                idx === 0
                                  ? 'bg-primary text-primary-foreground font-medium'
                                  : 'bg-secondary text-secondary-foreground'
                              }`}
                            >
                              {idx === 0 && <span className="mr-0.5">★</span>}
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Artists */}
                      {cellAss.length === 0 ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                          <User className="h-4 w-4" />
                          <span>点击选择歌手</span>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {cellAss.map((a) => {
                            const artist = artists.find((x) => x.id === a.artist_id);
                            const name = a.external_name || artist?.name || '-';
                            const isStyleMatch = artist && (session.style_tags || []).some((st) => artist.style_tags.includes(st));
                            return (
                              <div key={a.id} className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${isStyleMatch ? 'text-primary' : ''}`}>
                                  {name}
                                </span>
                                {isStyleMatch && (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">风格匹配</span>
                                )}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setPinnedIds(prev => { const next = new Set(prev); if (next.has(a.id)) next.delete(a.id); else next.add(a.id); return next; }); }} className="cursor-pointer" title={pinnedIds.has(a.id) ? '📌已固定(本期) - 点击取消' : '📌固定本期 - 补位时不替换'}>
                                  {a.is_locked ? <Lock className="h-3 w-3 text-primary" title="长期锁定(弹窗)" /> : pinnedIds.has(a.id) ? <span className="text-xs">📌</span> : <LockOpen className="h-3 w-3 text-muted-foreground opacity-40" />}
                                </button>
                                {a.external_name && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">临时</Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      {/* ===== DESKTOP: Calendar table view ===== */}
      <div className="hidden md:block px-4">
        {dates.length > 0 && allSessionNumbers.length > 0 && (
          <Card>
            <CardContent className="p-4 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-2 border-b border-r font-medium text-muted-foreground w-32 shrink-0 sticky left-0 bg-card z-10">
                      节次
                    </th>
                    {dates.map((d) => {
                      const date = new Date(d + 'T00:00:00');
                      const wd = date.getDay();
                      const isRest = bar && (bar.rest_days || []).includes(wd);
                      return (
                        <th key={d} className={`text-center px-2 py-2 border-b min-w-[100px] ${isRest ? 'text-destructive' : ''}`}>
                          <div className="font-medium">{formatDateShort(d)}</div>
                          <div className="text-xs text-muted-foreground">周{weekDays[wd]}{isRest ? '·休' : ''}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {allSessionNumbers.map((sessionNumber) => {
                    const genericSession = getGenericSessionByNumber(sessionNumber);
                    // Fallback: if no generic session, use first session found with this number
                    const labelSession = genericSession ||
                      Object.values(sessionMap).flat().find((s) => s.session_number === sessionNumber);
                    return (
                    <tr key={`sn-${sessionNumber}`} className="border-b last:border-b-0">
                      <td className="px-2 py-2 border-r sticky left-0 bg-card z-10 w-32 shrink-0">
                        <div className="font-medium">{labelSession?.session_name || `第${sessionNumber}节`}</div>
                        {labelSession && (
                          <>
                            <div className="text-xs text-muted-foreground">{labelSession.start_time?.slice(0, 5)}-{labelSession.end_time?.slice(0, 5)}</div>
                            {labelSession.style_tags && labelSession.style_tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {labelSession.style_tags.map((tag, idx) => (
                                  <span key={tag} className={`text-[10px] px-1 py-0.5 rounded ${idx === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>{tag}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      {dates.map((d) => {
                        const session = getDaySessionByNumber(d, sessionNumber);
                        const dateObj = new Date(d + 'T00:00:00');
                        const isRest = bar && (bar.rest_days || []).includes(dateObj.getDay());
                        if (isRest) {
                          return (
                            <td key={d} className="px-2 py-2 text-center text-muted-foreground text-xs bg-destructive/5">
                              休息
                            </td>
                          );
                        }
                        if (!session) {
                          return (
                            <td key={d} className="px-2 py-2 text-center text-muted-foreground text-xs">
                              -
                            </td>
                          );
                        }
                        const cellAss = getCellAssignments(d, session.id);
                        const needed = session.singers_per_session || 1;
                        const isFull = cellAss.length >= needed;
                        const hasConflict = cellAss.some((a) => conflictIds.has(a.id));
                        return (
                          <td
                            key={d}
                            onClick={() => openCell(d, session.id)}
                            className={`px-2 py-2 text-center cursor-pointer hover:bg-muted transition-colors ${isFull ? 'bg-primary/5' : ''} ${hasConflict ? 'bg-destructive/10 border border-destructive/40 rounded' : ''}`}
                          >
                            {cellAss.length === 0 ? (
                              <span className="text-xs text-muted-foreground">点击分配</span>
                            ) : (
                              <div className="space-y-1">
                                {cellAss.map((a) => {
                                  const artist = artists.find((x) => x.id === a.artist_id);
                                  const name = a.external_name || artist?.name || '-';
                                  const isStyleMatch = artist && (session.style_tags || []).some((st) => artist.style_tags.includes(st));
                                  const isConflict = conflictIds.has(a.id);
                                  return (
                                    <div key={a.id} className="flex items-center justify-center gap-1 flex-wrap">
                                      {isConflict && <span className="text-xs shrink-0" title="跨酒吧时间冲突！">⚠️</span>}
                                      <span className={`text-xs font-medium ${isStyleMatch ? 'text-primary' : ''} ${isConflict ? 'text-destructive' : ''}`}>{name}</span>
                                      <button type="button" onClick={(e) => { e.stopPropagation(); setPinnedIds(prev => { const next = new Set(prev); if (next.has(a.id)) next.delete(a.id); else next.add(a.id); return next; }); }} className="cursor-pointer" title={pinnedIds.has(a.id) ? '📌已固定(本期) - 点击取消' : '📌固定本期 - 补位时不替换'}>
                                  {a.is_locked ? <Lock className="h-3 w-3 text-primary" title="长期锁定(弹窗)" /> : pinnedIds.has(a.id) ? <span className="text-xs">📌</span> : <LockOpen className="h-3 w-3 text-muted-foreground opacity-40" />}
                                </button>
                                      {a.external_name && <Badge variant="outline" className="text-[10px] h-4 px-1">临时</Badge>}
                                    </div>
                                  );
                                })}
                                <div className="text-[10px] text-muted-foreground">{cellAss.length}/{needed}</div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom Sheet for editing cell */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">调整排班</SheetTitle>
            {activeSession && (
              <div className="text-sm text-muted-foreground">
                {celldate} · {activeSession.session_name || `第${activeSession.session_number}节`}
                <span className="ml-2">{activeSession.start_time?.slice(0, 5)}-{activeSession.end_time?.slice(0, 5)}</span>
              </div>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Current assignments */}
            <div className="space-y-2">
              <label className="text-sm font-medium">当前安排</label>
              {cellAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">暂无安排</p>
              ) : (
                <div className="space-y-2">
                  {cellAssignments.map((a) => {
                    const artist = artists.find((x) => x.id === a.artist_id);
                    const sess = activeSession;
                    const isStyleMatch = artist && sess && (sess.style_tags || []).some((st) => artist.style_tags.includes(st));
                    const isPending = a.id.startsWith('temp_');
                    const isConflict = conflictIds.has(a.id);
                    return (
                      <div key={a.id} className={`flex items-center justify-between p-3 border rounded-lg min-h-[48px] ${isConflict ? 'border-destructive/40 bg-destructive/5' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          {a.is_locked && <Lock className="h-4 w-4 text-primary shrink-0" />}
                          {isConflict && <span className="text-xs shrink-0" title="跨酒吧时间冲突！">⚠️</span>}
                          <span className={`text-sm font-medium truncate ${isConflict ? 'text-destructive' : ''}`}>{a.external_name || artist?.name || '-'}</span>
                          {isPending && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0 animate-pulse">保存中</Badge>
                          )}
                          {isStyleMatch && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">风格匹配</span>
                          )}
                          {a.external_name && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">临时</Badge>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => toggleLock(a.id, a.is_locked)} disabled={isPending} title={a.is_locked ? '解锁' : '锁定'}>
                            {a.is_locked ? <Lock className="h-4 w-4 text-primary" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeAssignment(a.id)} disabled={isPending}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Available artists by priority */}
            {(filteredPriorityGroups.some((g) => g.length > 0) || otherUnmatched.length > 0) && (
              <div className="space-y-3">
                {filteredPriorityGroups.map((group, idx) =>
                  group.length > 0 ? (
                    <div key={idx} className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                          第{idx + 1}优先
                        </span>
                        <span>{activeSession?.style_tags?.[idx]}</span>
                      </label>
                      <div className="space-y-2">
                        {group.map((artist) => {
                          const isAssigned = assignedIds.has(artist.id);
                          const crossInfo = crossBarData[artist.id];
                          return (
                            <button
                              key={artist.id}
                              onClick={() => { if (!isAssigned) addAssignment(artist.id); }}
                              disabled={isAssigned}
                              className={`w-full text-left p-3 rounded-lg border flex items-center gap-3 min-h-[48px] ${
                                isAssigned
                                  ? 'border-border bg-muted/30 opacity-50 cursor-default'
                                  : 'border-border bg-card hover:bg-muted transition-colors'
                              }`}
                            >
                              {isAssigned ? (
                                <span className="text-xs text-muted-foreground shrink-0 w-4 text-center">已选</span>
                              ) : (
                                <Plus className="h-4 w-4 text-primary shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm truncate">{artist.name}</div>
                                <div className={`text-xs truncate ${isAssigned ? 'text-muted-foreground' : 'text-primary'}`}>{artist.style_tags.join(' / ')}</div>
                              </div>
                              {crossInfo && (
                                <span className="text-[10px] text-muted-foreground shrink-0 bg-muted px-1.5 py-0.5 rounded">
                                  {crossInfo.map((c: any) => `${c.bar_name} ${c.time}`).join(' ')}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null
                )}
                {otherUnmatched.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">其他可选</label>
                    <div className="space-y-2">
                      {otherUnmatched.map((artist) => {
                        const isAssigned = assignedIds.has(artist.id);
                        const crossInfo = crossBarData[artist.id];
                        return (
                          <button
                            key={artist.id}
                            onClick={() => { if (!isAssigned) addAssignment(artist.id); }}
                            disabled={isAssigned}
                            className={`w-full text-left p-3 rounded-lg border flex items-center gap-3 min-h-[48px] ${
                              isAssigned
                                ? 'border-border bg-muted/30 opacity-50 cursor-default'
                                : 'border-border bg-card hover:bg-muted transition-colors opacity-70'
                            }`}
                          >
                            {isAssigned ? (
                              <span className="text-xs text-muted-foreground shrink-0 w-4 text-center">已选</span>
                            ) : (
                              <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm truncate">{artist.name}</div>
                              <div className={`text-xs truncate ${isAssigned ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{artist.style_tags.join(' / ')}</div>
                            </div>
                            {crossInfo && (
                              <span className="text-[10px] text-muted-foreground shrink-0 bg-muted px-1.5 py-0.5 rounded">
                                {crossInfo.map((c: any) => `${c.bar_name} ${c.time}`).join(' ')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(todayBusyMatched.length > 0 || todayBusyUnmatched.length > 0) && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-muted-foreground">今日已排其他节次</label>
                <div className="space-y-2">
                  {[...todayBusyMatched, ...todayBusyUnmatched].map((artist) => (
                    <div
                      key={artist.id}
                      className="w-full text-left p-3 rounded-lg border border-border bg-muted/30 flex items-center gap-3 min-h-[48px] opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{artist.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{artist.style_tags.join(' / ')}</div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">今日已排</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {crossBarBlocked.length > 0 && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-destructive">跨酒吧冲突（该时段已被占用）</label>
                <div className="space-y-2">
                  {crossBarBlocked.map((artist) => {
                    const crossInfo = crossBarData[artist.id];
                    return (
                      <div
                        key={artist.id}
                        className="w-full text-left p-3 rounded-lg border border-destructive/30 bg-destructive/5 flex items-center gap-3 min-h-[48px] opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate text-destructive">{artist.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{artist.style_tags.join(' / ')}</div>
                        </div>
                        {crossInfo && (
                          <span className="text-[10px] text-destructive shrink-0 bg-destructive/10 px-1.5 py-0.5 rounded">
                            {crossInfo.map((c: any) => `${c.bar_name} ${c.time}`).join(' ')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {filteredPriorityGroups.every((g) => g.length === 0) && otherUnmatched.length === 0 && todayBusyMatched.length === 0 && todayBusyUnmatched.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">无可选歌手</p>
            )}

            {/* External singer */}
            <div className="space-y-2 pt-2 border-t">
              <label className="text-sm font-medium">应急临时歌手</label>
              <div className="flex gap-2">
                <Input
                  placeholder="输入临时歌手姓名"
                  value={tempSingerName}
                  onChange={(e) => setTempSingerName(e.target.value)}
                  className="h-11 flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') addExternal(tempSingerName); }}
                />
                <Button className="h-11 px-4" onClick={() => addExternal(tempSingerName)}>添加</Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
