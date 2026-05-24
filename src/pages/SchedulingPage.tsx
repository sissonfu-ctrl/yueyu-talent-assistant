import React, { useEffect, useState, useMemo } from 'react';
import {
  getBars, getBarSessions, getArtists, getArtistBarLinks,
  getAvailabilities, getAssignments, getCurrentSchedule, createSchedule,
  upsertAssignments, archiveOldSchedules, toggleLockAssignment, getLockedAssignments,
  getBarById,
} from '@/services/database';
import {
  getPeriodLabel, getPeriodStart, getPeriodEnd, getDatesInPeriod, filterAndSortArtists,
  formatLocalDate,
} from '@/lib/schedule';
import { exportToCSV, downloadCSV } from '@/lib/export';
import type { Bar, BarSession, Artist, ArtistAvailability, Schedule, ScheduleAssignment } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  CalendarDays, Wand2, Download, Trash2, Lock, LockOpen,
  ChevronLeft, ChevronRight, MapPin, Clock, User, Plus,
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
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDateIndex, setActiveDateIndex] = useState(0);

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

      const map: Record<string, BarSession[]> = {};
      map['generic'] = se.filter((s) => s.weekday === null);
      for (let i = 0; i <= 6; i++) {
        map[i] = se.filter((s) => s.weekday === i);
      }
      setSessionMap(map);
    } catch (e) {
      toast.error('加载失败');
    }
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

  const loadSchedule = async () => {
    if (!selectedBarId || !periodLabel) return;
    setLoading(true);
    try {
      const existing = await getCurrentSchedule(selectedBarId, periodLabel);
      if (existing) {
        setSchedule(existing);
        const ass = await getAssignments(existing.id);
        setAssignments(ass);
      } else {
        setSchedule(null);
        setAssignments([]);
      }
    } catch (e) {
      toast.error('加载排班失败');
    } finally {
      setLoading(false);
    }
  };

  const generateSchedule = async () => {
    if (!selectedBarId || !bar || poolArtists.length === 0) {
      toast.error('请选择酒吧并确保有歌手');
      return;
    }

    setLoading(true);
    try {
      await archiveOldSchedules(selectedBarId, periodLabel);

      const start = getPeriodStart(periodType, new Date(periodDate));
      const end = getPeriodEnd(periodType, new Date(periodDate));

      const newSchedule = await createSchedule({
        bar_id: selectedBarId,
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
      const lockedAssignments = await getLockedAssignments(selectedBarId);
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

      // Step 2: Auto-assign remaining slots
      for (const dateObj of dateObjs) {
        const dateStr = formatLocalDate(dateObj);
        const weekday = dateObj.getDay();

        if ((bar.rest_days || []).includes(weekday)) continue;

        // Merge generic + weekday-specific sessions
        const genericSessions = sessionMap['generic'] || [];
        const specificSessions = sessionMap[weekday] || [];
        // Sort: early-morning slots (before 6am) are treated as "next day" and go last
        const sortKey = (t: string | null) => {
          if (!t) return '';
          const h = parseInt(t.slice(0, 2));
          return h < 6 ? `z${t}` : `a${t}`;
        };
        const sessionsForDay = [...genericSessions, ...specificSessions].sort(
          (a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time))
        );
        if (sessionsForDay.length === 0) continue;

        // Track artists already assigned today (locked + newly assigned)
        const assignedToday = new Set<string>();

        // Collect locked artists for this day
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

          // Exclude: locked in this cell + already assigned in other sessions today
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

          const picked = matched.slice(0, remainingNeeded);
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
    if (!schedule) return;
    const [date, sessionId] = cellKey.split('_');
    const payload: Partial<ScheduleAssignment> = {
      schedule_id: schedule.id,
      date,
      session_id: sessionId,
      artist_id: artistId,
    };
    try {
      await upsertAssignments([payload]);
      const ass = await getAssignments(schedule.id);
      setAssignments(ass);
      setCellAssignments(getCellAssignments(date, sessionId));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const addExternal = async (name: string) => {
    if (!schedule || !name.trim()) return;
    const [date, sessionId] = cellKey.split('_');
    try {
      const trimmedName = name.trim();
      // 匹配歌手池中同名歌手，自动关联
      const matchedArtist = poolArtists.find(
        (a) => a.name === trimmedName
      );
      await upsertAssignments([{
        schedule_id: schedule.id,
        date,
        session_id: sessionId,
        artist_id: matchedArtist ? matchedArtist.id : undefined,
        external_name: matchedArtist ? undefined : trimmedName,
      }]);
      const ass = await getAssignments(schedule.id);
      setAssignments(ass);
      setCellAssignments(getCellAssignments(date, sessionId));
      setTempSingerName('');
      if (matchedArtist) {
        toast.success(`已关联歌手：${matchedArtist.name}`);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    if (!schedule) return;
    try {
      await import('@/services/database').then((m) => m.deleteAssignment(assignmentId));
      const ass = await getAssignments(schedule.id);
      setAssignments(ass);
      const [date, sessionId] = cellKey.split('_');
      setCellAssignments(getCellAssignments(date, sessionId));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleLock = async (assignmentId: string, currentlyLocked: boolean) => {
    if (!schedule) return;
    try {
      await toggleLockAssignment(assignmentId, !currentlyLocked);
      const ass = await getAssignments(schedule.id);
      setAssignments(ass);
      const [date, sessionId] = cellKey.split('_');
      setCellAssignments(getCellAssignments(date, sessionId));
      toast.success(currentlyLocked ? '已解锁' : '已锁定');
    } catch (e: any) {
      toast.error(e.message);
    }
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
    const csv = exportToCSV(bar, allSessions, dates, assignments, artists);
    downloadCSV(csv, `${bar.name}_${periodLabel}_排班表.csv`);
  };

  // ---- Render helpers ----
  const activeDate = dates[activeDateIndex] || '';
  const activeDateObj = activeDate ? new Date(activeDate + 'T00:00:00') : null;

  const daySessions = useMemo(() => {
    if (!activeDateObj) return [];
    const wd = activeDateObj.getDay();
    const generic = sessionMap['generic'] || [];
    const specific = sessionMap[wd] || [];
    const sortKey = (t: string | null) => {
      if (!t) return '';
      const h = parseInt(t.slice(0, 2));
      return h < 6 ? `z${t}` : `a${t}`;
    };
    return [...generic, ...specific].sort((a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time)));
  }, [activeDateObj, sessionMap]);

  // Desktop calendar: all unique sessions and per-date sessions
  const allSessions = useMemo(() => {
    const seen = new Set<string>();
    const list: BarSession[] = [];
    Object.values(sessionMap).flat().forEach((s) => {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        list.push(s);
      }
    });
    const sortKey = (t: string | null) => {
      if (!t) return '';
      const h = parseInt(t.slice(0, 2));
      return h < 6 ? `z${t}` : `a${t}`;
    };
    return list.sort((a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time)));
  }, [sessionMap]);

  const getDaySessions = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const wd = d.getDay();
    const generic = sessionMap['generic'] || [];
    const specific = sessionMap[wd] || [];
    const sortKey = (t: string | null) => {
      if (!t) return '';
      const h = parseInt(t.slice(0, 2));
      return h < 6 ? `z${t}` : `a${t}`;
    };
    return [...generic, ...specific].sort((a, b) => sortKey(a.start_time).localeCompare(sortKey(b.start_time)));
  };

  const isRestDay = activeDateObj && bar ? (bar.rest_days || []).includes(activeDateObj.getDay()) : false;

  const [, sessionId] = cellKey.split('_');
  const activeSession = Object.values(sessionMap).flat().find((s) => s.id === sessionId);
  const { matched: availableMatched, unmatched: availableUnmatched, priorityGroups } = useMemo(() => {
    if (!activeDate || !activeSession) return { matched: [] as Artist[], unmatched: [] as Artist[], priorityGroups: [] as Artist[][] };
    return getAvailableForCell(activeDate, activeSession);
  }, [activeDate, activeSession, cellKey]);

  const assignedIds = new Set(cellAssignments.map((a) => a.artist_id).filter(Boolean));

  // Artists already assigned in other sessions on the same day
  const todayAssignedIds = new Set(
    assignments
      .filter((a) => a.date === activeDate && a.session_id !== activeSession?.id && a.artist_id)
      .map((a) => a.artist_id!)
  );

  // Filter out already-assigned and today-busy from priority groups
  const filteredPriorityGroups = priorityGroups.map((group) =>
    group.filter((a) => !assignedIds.has(a.id) && !todayAssignedIds.has(a.id))
  );

  const remainingMatched = availableMatched.filter((a) => !assignedIds.has(a.id) && !todayAssignedIds.has(a.id));
  const remainingUnmatched = availableUnmatched.filter((a) => !assignedIds.has(a.id) && !todayAssignedIds.has(a.id));

  // Artists available but already assigned today in other sessions
  const todayBusyMatched = availableMatched.filter((a) => todayAssignedIds.has(a.id));
  const todayBusyUnmatched = availableUnmatched.filter((a) => todayAssignedIds.has(a.id));

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="px-4 pt-2">
        <h2 className="text-lg font-bold text-balance">排班工作台</h2>
        <p className="text-sm text-muted-foreground">自动生成排班并手动调整</p>
      </div>

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
            <Button variant="outline" className="flex-1 h-12 text-base" onClick={loadSchedule} disabled={!selectedBarId}>
              <CalendarDays className="h-5 w-5 mr-2" />
              加载
            </Button>
            <Button className="flex-1 h-12 text-base" onClick={generateSchedule} disabled={!selectedBarId || loading}>
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
              <Button variant="outline" size="sm" className="h-9 px-3" onClick={exportSchedule}>
                <Download className="h-4 w-4 mr-1" />
                导出
              </Button>
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

                  return (
                    <div
                      key={session.id}
                      onClick={() => openCell(activeDate, session.id)}
                      className={`rounded-lg border p-3 transition-colors active:scale-[0.99] min-h-[64px] ${
                        isFull
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
                                {a.is_locked && <Lock className="h-3 w-3 text-primary" />}
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
        {dates.length > 0 && allSessions.length > 0 && (
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
                  {allSessions.map((session) => (
                    <tr key={session.id} className="border-b last:border-b-0">
                      <td className="px-2 py-2 border-r sticky left-0 bg-card z-10 w-32 shrink-0">
                        <div className="font-medium">{session.session_name || `第${session.session_number}节`}</div>
                        <div className="text-xs text-muted-foreground">{session.start_time?.slice(0, 5)}-{session.end_time?.slice(0, 5)}</div>
                        {session.style_tags && session.style_tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {session.style_tags.map((tag, idx) => (
                              <span key={tag} className={`text-[10px] px-1 py-0.5 rounded ${idx === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      {dates.map((d) => {
                        const daySess = getDaySessions(d);
                        const hasSession = daySess.some((s) => s.id === session.id);
                        const cellAss = getCellAssignments(d, session.id);
                        const needed = session.singers_per_session || 1;
                        const isFull = cellAss.length >= needed;
                        const dateObj = new Date(d + 'T00:00:00');
                        const isRest = bar && (bar.rest_days || []).includes(dateObj.getDay());
                        if (isRest) {
                          return (
                            <td key={d} className="px-2 py-2 text-center text-muted-foreground text-xs bg-destructive/5">
                              休息
                            </td>
                          );
                        }
                        if (!hasSession) {
                          return (
                            <td key={d} className="px-2 py-2 text-center text-muted-foreground text-xs">
                              -
                            </td>
                          );
                        }
                        return (
                          <td
                            key={d}
                            onClick={() => openCell(d, session.id)}
                            className={`px-2 py-2 text-center cursor-pointer hover:bg-muted transition-colors ${isFull ? 'bg-primary/5' : ''}`}
                          >
                            {cellAss.length === 0 ? (
                              <span className="text-xs text-muted-foreground">点击分配</span>
                            ) : (
                              <div className="space-y-1">
                                {cellAss.map((a) => {
                                  const artist = artists.find((x) => x.id === a.artist_id);
                                  const name = a.external_name || artist?.name || '-';
                                  const isStyleMatch = artist && (session.style_tags || []).some((st) => artist.style_tags.includes(st));
                                  return (
                                    <div key={a.id} className="flex items-center justify-center gap-1 flex-wrap">
                                      <span className={`text-xs font-medium ${isStyleMatch ? 'text-primary' : ''}`}>{name}</span>
                                      {a.is_locked && <Lock className="h-3 w-3 text-primary" />}
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
                  ))}
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
                {activeDate} · {activeSession.session_name || `第${activeSession.session_number}节`}
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
                    return (
                      <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg min-h-[48px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {a.is_locked && <Lock className="h-4 w-4 text-primary shrink-0" />}
                          <span className="text-sm font-medium truncate">{a.external_name || artist?.name || '-'}</span>
                          {isStyleMatch && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">风格匹配</span>
                          )}
                          {a.external_name && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">临时</Badge>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => toggleLock(a.id, a.is_locked)} title={a.is_locked ? '解锁' : '锁定'}>
                            {a.is_locked ? <Lock className="h-4 w-4 text-primary" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeAssignment(a.id)}>
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
            {(filteredPriorityGroups.some((g) => g.length > 0) || remainingUnmatched.length > 0) && (
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
                        {group.map((artist) => (
                          <button
                            key={artist.id}
                            onClick={() => addAssignment(artist.id)}
                            className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors flex items-center gap-3 min-h-[48px]"
                          >
                            <Plus className="h-4 w-4 text-primary shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm truncate">{artist.name}</div>
                              <div className="text-xs text-primary truncate">{artist.style_tags.join(' / ')}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
                {remainingUnmatched.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">其他可选</label>
                    <div className="space-y-2">
                      {remainingUnmatched.map((artist) => (
                        <button
                          key={artist.id}
                          onClick={() => addAssignment(artist.id)}
                          className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors flex items-center gap-3 min-h-[48px] opacity-70"
                        >
                          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{artist.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{artist.style_tags.join(' / ')}</div>
                          </div>
                        </button>
                      ))}
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
            {filteredPriorityGroups.every((g) => g.length === 0) && remainingUnmatched.length === 0 && todayBusyMatched.length === 0 && todayBusyUnmatched.length === 0 && (
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
