import { useEffect, useState, useMemo } from 'react';
import { getBars, getSchedules, getAssignments, getBarArtistPrices, getArtists, getBarSessions } from '@/services/database';
import type { Bar, Schedule, ScheduleAssignment, BarArtistPrice, Artist, BarSession } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ClipboardList, Calculator } from 'lucide-react';

export default function SettlementPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedBarId, setSelectedBarId] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [prices, setPrices] = useState<BarArtistPrice[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [sessions, setSessions] = useState<BarSession[]>([]);

  useEffect(() => {
    getBars().then(setBars);
  }, []);

  useEffect(() => {
    if (!selectedBarId) return;
    getSchedules(selectedBarId).then((s) => {
      setSchedules(s);
      setSelectedScheduleId('');
      setSelectedScheduleIds(new Set());
    });
  }, [selectedBarId]);

  const bar = bars.find((b) => b.id === selectedBarId);
  const isMonthly = bar?.settlement_mode === 'monthly';

  const loadSettlement = async () => {
    if (isMonthly) {
      if (selectedScheduleIds.size === 0) return;
      const scheduleIds = Array.from(selectedScheduleIds);
      const allAss: ScheduleAssignment[] = [];
      for (const sid of scheduleIds) {
        const ass = await getAssignments(sid);
        allAss.push(...ass);
      }
      const [pr, a, se] = await Promise.all([
        getBarArtistPrices(selectedBarId),
        getArtists(),
        getBarSessions(selectedBarId),
      ]);
      setAssignments(allAss);
      setPrices(pr);
      setArtists(a);
      setSessions(se);
    } else {
      if (!selectedScheduleId) return;
      const [ass, pr, a, se] = await Promise.all([
        getAssignments(selectedScheduleId),
        getBarArtistPrices(selectedBarId),
        getArtists(),
        getBarSessions(selectedBarId),
      ]);
      setAssignments(ass);
      setPrices(pr);
      setArtists(a);
      setSessions(se);
    }
  };

  const toggleScheduleCheck = (id: string) => {
    setSelectedScheduleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllSchedules = () => {
    const allIds = schedules.map((s) => s.id);
    if (selectedScheduleIds.size === allIds.length) {
      setSelectedScheduleIds(new Set());
    } else {
      setSelectedScheduleIds(new Set(allIds));
    }
  };

  const sessionMap = useMemo(() => {
    const map: Record<string, BarSession> = {};
    sessions.forEach((s) => { map[s.id] = s; });
    return map;
  }, [sessions]);

  const summary = useMemo(() => {
    const result: Record<string, {
      artistId: string | null;
      name: string;
      regularCount: number;
      regularPrice: number;
      residentCount: number;
      residentPrice: number;
      details: { date: string; sessionName: string; isResident: boolean; price: number }[];
    }> = {};

    for (const a of assignments) {
      const sess = sessionMap[a.session_id];
      const artist = a.artist_id ? artists.find((ar) => ar.id === a.artist_id) : null;
      const key = a.artist_id || a.external_name || 'unknown';
      const name = a.external_name || artist?.name || '-';
      const isResident = sess && sess.session_number === 4 && (bar?.name === 'Chao lounge');
      const regularPrice = a.artist_id
        ? (prices.find((p) => p.artist_id === a.artist_id)?.price_per_show ?? bar?.default_price_per_show ?? 0)
        : (a.external_price ?? 0);
      const price = isResident ? 800 : regularPrice;

      if (!result[key]) {
        result[key] = {
          artistId: a.artist_id,
          name,
          regularCount: 0,
          regularPrice,
          residentCount: 0,
          residentPrice: 800,
          details: [],
        };
      }
      if (isResident) {
        result[key].residentCount++;
      } else {
        result[key].regularCount++;
      }
      result[key].details.push({
        date: a.date,
        sessionName: sess?.session_name || sess ? `第${sess.session_number}节` : '-',
        isResident,
        price,
      });
    }
    return Object.entries(result).map(([key, s]) => ({
      key,
      ...s,
      total: s.regularCount * s.regularPrice + s.residentCount * s.residentPrice,
    }));
  }, [assignments, artists, prices, bar, sessionMap]);

  const totalAmount = summary.reduce((sum, s) => sum + s.total, 0);
  const totalShows = assignments.length;

  const updateExternalPrice = async (key: string, newPrice: number) => {
    const target = assignments.find((a) => (a.artist_id || a.external_name) === key);
    if (!target || !target.external_name) return;
    const toUpdate = assignments.filter((a) => a.external_name === target.external_name && !a.artist_id);
    try {
      for (const a of toUpdate) {
        await import('@/services/database').then((m) =>
          m.upsertAssignments([{ id: a.id, external_price: newPrice }])
        );
      }
      toast.success('价格已更新');
      loadSettlement();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // 月结时计算合并区间
  const selectedSchedules = schedules.filter((s) => selectedScheduleIds.has(s.id));
  const mergedRange = isMonthly && selectedSchedules.length > 0
    ? (() => {
        const starts = selectedSchedules.map((s) => s.period_start).sort();
        const ends = selectedSchedules.map((s) => s.period_end).sort();
        return `${starts[0]} ~ ${ends[ends.length - 1]}`;
      })()
    : '';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-balance">记账结算</h2>
        <p className="text-sm text-muted-foreground">按酒吧和排班周期自动生成结算表</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">选择酒吧</label>
              <Select value={selectedBarId} onValueChange={(v) => { setSelectedBarId(v); }}>
                <SelectTrigger><SelectValue placeholder="选择酒吧" /></SelectTrigger>
                <SelectContent>
                  {bars.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}{b.settlement_mode === 'monthly' ? '（月结）' : '（周结）'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={loadSettlement} disabled={!selectedBarId || (isMonthly ? selectedScheduleIds.size === 0 : !selectedScheduleId)}>
                <Calculator className="h-4 w-4 mr-1" />
                {isMonthly ? `合并生成（${selectedScheduleIds.size}周）` : '生成结算'}
              </Button>
            </div>
          </div>

          {/* 排班版本选择 */}
          {schedules.length > 0 && bar && (
            <div className="pt-2 border-t">
              <label className="text-xs text-muted-foreground mb-2 block">
                {isMonthly ? '勾选需要合并的周（月结）' : '选择排班版本（周结）'}
              </label>
              {isMonthly ? (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-muted/50 rounded text-sm">
                    <Checkbox
                      checked={selectedScheduleIds.size === schedules.length}
                      onCheckedChange={toggleSelectAllSchedules}
                    />
                    <span className="text-xs text-muted-foreground">全选</span>
                  </label>
                  {schedules.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-muted/50 rounded text-sm">
                      <Checkbox
                        checked={selectedScheduleIds.has(s.id)}
                        onCheckedChange={() => toggleScheduleCheck(s.id)}
                      />
                      <span>{s.period_label}</span>
                      <span className="text-xs text-muted-foreground">{s.period_start}~{s.period_end}</span>
                      {s.is_current && <Badge variant="secondary" className="text-[10px]">当前</Badge>}
                    </label>
                  ))}
                  {mergedRange && (
                    <div className="text-xs text-muted-foreground pt-1">合并区间：{mergedRange}</div>
                  )}
                </div>
              ) : (
                <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
                  <SelectTrigger><SelectValue placeholder="选择版本" /></SelectTrigger>
                  <SelectContent>
                    {schedules.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.period_label} {s.period_start}~{s.period_end} {s.is_current ? '(当前)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {assignments.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              结算明细{isMonthly ? `（合并${selectedScheduleIds.size}周）` : ''}
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              总场次 {totalShows} · 总金额 {totalAmount}元
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 汇总表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground whitespace-nowrap">歌手</th>
                    <th className="text-right py-2 font-medium text-muted-foreground whitespace-nowrap px-2">常规单价</th>
                    <th className="text-right py-2 font-medium text-muted-foreground whitespace-nowrap px-2">常规场次</th>
                    {summary.some((s) => s.residentCount > 0) && (
                      <>
                        <th className="text-right py-2 font-medium text-muted-foreground whitespace-nowrap px-2">驻场</th>
                        <th className="text-right py-2 font-medium text-muted-foreground whitespace-nowrap px-2">驻场场次</th>
                      </>
                    )}
                    <th className="text-right py-2 font-medium text-muted-foreground whitespace-nowrap px-2">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.key} className="border-b last:border-b-0">
                      <td className="py-2 font-medium whitespace-nowrap">{s.artistId ? s.name : `${s.name}（临时）`}</td>
                      <td className="py-2 text-right px-2">
                        {s.artistId ? s.regularPrice : (
                          <Input
                            type="number"
                            className="w-20 h-7 text-sm ml-auto"
                            value={s.regularPrice}
                            onChange={(e) => updateExternalPrice(s.key, parseFloat(e.target.value) || 0)}
                          />
                        )}
                      </td>
                      <td className="py-2 text-right px-2">{s.regularCount}</td>
                      {summary.some((x) => x.residentCount > 0) && (
                        <>
                          <td className="py-2 text-right px-2 text-muted-foreground">{s.residentCount > 0 ? 800 : '-'}</td>
                          <td className="py-2 text-right px-2">
                            {s.residentCount > 0 && <Badge variant="secondary" className="text-xs">{s.residentCount}场</Badge>}
                          </td>
                        </>
                      )}
                      <td className="py-2 text-right px-2 font-medium">{s.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 明细表 */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-3">场次明细</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium text-muted-foreground text-xs whitespace-nowrap">歌手</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground text-xs whitespace-nowrap px-2">日期</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground text-xs whitespace-nowrap px-2">节次</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground text-xs whitespace-nowrap px-2">单价</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.flatMap((s) =>
                      s.details.map((d, i) => (
                        <tr key={`${s.key}-${i}`} className="border-b last:border-b-0">
                          <td className="py-1.5 whitespace-nowrap text-xs">{i === 0 ? s.name : ''}</td>
                          <td className="py-1.5 whitespace-nowrap text-xs text-muted-foreground px-2">{d.date}</td>
                          <td className="py-1.5 whitespace-nowrap text-xs px-2">
                            {d.sessionName}
                            {d.isResident && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1 text-primary border-primary/30">驻场</Badge>
                            )}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap text-xs px-2">{d.price}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
