import { useEffect, useMemo, useState, useCallback } from 'react';
import { getBars, getSchedules, getBarSessions, getAssignments, deleteSchedule, deleteSchedules } from '@/services/database';
import { formatLocalDate } from '@/lib/schedule';
import type { Bar, Schedule, BarSession, ScheduleAssignment } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { History, Eye, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function HistoryPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [filterBarId, setFilterBarId] = useState('all');
  const [viewSchedule, setViewSchedule] = useState<Schedule | null>(null);
  const [sessions, setSessions] = useState<BarSession[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  useEffect(() => {
    getBars().then(setBars);
    loadSchedules();
  }, []);

  async function loadSchedules() {
    const sc = await getSchedules();
    setSchedules(sc);
    setSelectedIds(new Set());
  }

  const filtered = useMemo(() =>
    filterBarId !== 'all' ? schedules.filter((s) => s.bar_id === filterBarId) : schedules,
    [schedules, filterBarId]
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isAllSelected = useMemo(() =>
    filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id)),
    [filtered, selectedIds]
  );

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((s) => next.delete(s.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((s) => next.add(s.id));
        return next;
      });
    }
  }, [isAllSelected, filtered]);

  async function handleDeleteSingle(id: string) {
    try {
      await deleteSchedule(id);
      toast.success('删除成功');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadSchedules();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  }

  async function handleDeleteBatch() {
    if (selectedIds.size === 0) return;
    try {
      await deleteSchedules(Array.from(selectedIds));
      toast.success(`成功删除 ${selectedIds.size} 条排班`);
      setSelectedIds(new Set());
      loadSchedules();
    } catch (e: any) {
      toast.error('批量删除失败：' + e.message);
    }
  }

  const viewDetail = async (schedule: Schedule) => {
    const [se, ass] = await Promise.all([
      getBarSessions(schedule.bar_id),
      getAssignments(schedule.id),
    ]);
    setSessions(se);
    setAssignments(ass);
    setViewSchedule(schedule);
  };

  const getBarName = (id: string) => bars.find((b) => b.id === id)?.name || '-';

  const dates = viewSchedule
    ? (() => {
        const result: string[] = [];
        const curr = new Date(viewSchedule.period_start);
        const end = new Date(viewSchedule.period_end);
        while (curr <= end) {
          result.push(formatLocalDate(curr));
          curr.setDate(curr.getDate() + 1);
        }
        return result;
      })()
    : [];

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-balance">历史排班</h2>
        <p className="text-sm text-muted-foreground">查看过往排班版本</p>
      </div>

      <div className="flex gap-3">
        <Select value={filterBarId} onValueChange={setFilterBarId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="全部酒吧" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部酒吧</SelectItem>
            {bars.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">暂无历史排班</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {/* Batch toolbar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={isAllSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="全选"
              />
              <span className="text-sm text-muted-foreground">全选</span>
              {selectedIds.size > 0 && (
                <span className="text-sm text-primary">已选 {selectedIds.size} 条</span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" variant="destructive" className="h-9" onClick={() => setConfirmBulkOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1" />
                批量删除
              </Button>
            )}
          </div>

          {filtered.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <Checkbox
                  checked={selectedIds.has(s.id)}
                  onCheckedChange={() => toggleSelect(s.id)}
                  aria-label={`选择 ${s.period_label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{getBarName(s.bar_id)} · {s.period_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.period_start} ~ {s.period_end}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.is_current && <span className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground">当前</span>}
                  <span className="px-2 py-0.5 text-xs rounded bg-muted">{s.status === 'published' ? '已发布' : '草稿'}</span>
                  <Button size="sm" variant="outline" onClick={() => viewDetail(s)}>
                    <Eye className="h-3.5 w-3.5 mr-1" />查看
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 p-0 text-destructive"
                    onClick={() => {
                      setDeleteTargetId(s.id);
                      setConfirmOpen(true);
                    }}
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!viewSchedule} onOpenChange={(v) => !v && setViewSchedule(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-4xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              {viewSchedule ? `${getBarName(viewSchedule.bar_id)} · ${viewSchedule.period_label}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="p-2 text-left text-xs font-medium sticky left-0 bg-muted/50 z-10">节次</th>
                  {dates.map((d) => {
                    const date = new Date(d);
                    return (
                      <th key={d} className="p-2 text-center text-xs font-medium min-w-[80px]">
                        <div>{d.slice(5)}</div>
                        <div className="text-muted-foreground">周{weekDays[date.getDay()]}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-border">
                    <td className="p-2 text-xs font-medium sticky left-0 bg-card z-10">
                      {session.session_name || `第${session.session_number}节`}
                    </td>
                    {dates.map((d) => {
                      const ass = assignments.filter((a) => a.date === d && a.session_id === session.id);
                      const names = ass.map((a) => a.external_name || '歌手').join(', ') || '-';
                      return (
                        <td key={`${d}_${session.id}`} className="p-2 text-xs text-muted-foreground align-top">
                          <div className="truncate max-w-[80px]">{names}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Single delete confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，是否确认删除该排班记录？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTargetId) {
                  handleDeleteSingle(deleteTargetId);
                }
                setConfirmOpen(false);
                setDeleteTargetId(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch delete confirm */}
      <AlertDialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedIds.size} 条排班记录吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmBulkOpen(false)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                handleDeleteBatch();
                setConfirmBulkOpen(false);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
