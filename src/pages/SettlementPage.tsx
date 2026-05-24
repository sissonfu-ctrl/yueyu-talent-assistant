import { useEffect, useState, useMemo } from 'react';
import { getBars, getSchedules, getAssignments, getBarArtistPrices } from '@/services/database';
import type { Bar, Schedule, ScheduleAssignment, BarArtistPrice } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ClipboardList, Calculator } from 'lucide-react';

export default function SettlementPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedBarId, setSelectedBarId] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [prices, setPrices] = useState<BarArtistPrice[]>([]);

  useEffect(() => {
    getBars().then(setBars);
  }, []);

  useEffect(() => {
    if (!selectedBarId) return;
    getSchedules(selectedBarId).then((s) => {
      setSchedules(s);
      setSelectedScheduleId('');
    });
  }, [selectedBarId]);

  const loadSettlement = async () => {
    if (!selectedScheduleId) return;
    const [ass, pr] = await Promise.all([
      getAssignments(selectedScheduleId),
      getBarArtistPrices(selectedBarId),
    ]);
    setAssignments(ass);
    setPrices(pr);
  };

  const bar = bars.find((b) => b.id === selectedBarId);

  const artistStats = useMemo(() => {
    const stats: Record<string, { name: string; count: number; price: number; external: boolean }> = {};
    for (const a of assignments) {
      const key = a.artist_id || a.external_name || 'unknown';
      if (!stats[key]) {
        const price = a.artist_id
          ? (prices.find((p) => p.artist_id === a.artist_id)?.price_per_show ?? bar?.default_price_per_show ?? 0)
          : (a.external_price ?? 0);
        stats[key] = {
          name: a.external_name || '',
          count: 0,
          price,
          external: !!a.external_name,
        };
      }
      stats[key].count++;
    }
    return Object.entries(stats).map(([key, s]) => ({
      key,
      ...s,
      total: s.count * s.price,
    }));
  }, [assignments, prices, bar]);

  const totalAmount = artistStats.reduce((sum, s) => sum + s.total, 0);
  const totalShows = assignments.length;

  const updateExternalPrice = async (key: string, newPrice: number) => {
    const target = assignments.find((a) => (a.artist_id || a.external_name) === key);
    if (!target || !target.external_name) return;
    // Update all assignments for this external singer in this schedule
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-balance">记账结算</h2>
        <p className="text-sm text-muted-foreground">按酒吧和排班周期自动生成结算表</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">选择酒吧</label>
              <Select value={selectedBarId} onValueChange={setSelectedBarId}>
                <SelectTrigger><SelectValue placeholder="选择酒吧" /></SelectTrigger>
                <SelectContent>
                  {bars.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">排班版本</label>
              <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
                <SelectTrigger><SelectValue placeholder="选择版本" /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.period_label} {s.is_current ? '(当前)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={loadSettlement} disabled={!selectedScheduleId}>
                <Calculator className="h-4 w-4 mr-1" />生成结算
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {assignments.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              结算明细
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              总场次 {totalShows} · 总金额 {totalAmount}元
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">歌手</TableHead>
                    <TableHead className="whitespace-nowrap">单价（元/场）</TableHead>
                    <TableHead className="whitespace-nowrap">演出场次</TableHead>
                    <TableHead className="whitespace-nowrap">结算总价</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {artistStats.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {s.external ? s.name + '（临时）' : s.name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {s.external ? (
                          <Input
                            type="number"
                            className="w-24 h-8 text-sm"
                            value={s.price}
                            onChange={(e) => updateExternalPrice(s.key, parseFloat(e.target.value) || 0)}
                          />
                        ) : (
                          s.price
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{s.count}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{s.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
