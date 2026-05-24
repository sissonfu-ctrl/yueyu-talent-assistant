import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBars, deleteBar, getBarSessions, upsertBarSessions, deleteBarSession, createBar, updateBar } from '@/services/database';
import type { Bar, BarSession } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Building2 } from 'lucide-react';
import { ALL_STYLES } from '@/lib/schedule';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function BarListPage() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Bar | null>(null);
  const [form, setForm] = useState({
    name: '',
    address: '',
    contact: '',
    schedule_cycle_type: 'weekly' as 'weekly' | 'monthly',
    sessions_per_night: 3,
    pool_type: 'open' as 'closed' | 'open',
    default_price_per_show: 0,
    rest_days: [] as number[],
  });
  const [sessionForm, setSessionForm] = useState<{
    id?: string;
    weekday: number | null;
    session_number: number;
    session_name: string;
    start_time: string;
    end_time: string;
    singers_per_session: number;
    style_tags: string[];
  } | null>(null);
  const [sessions, setSessions] = useState<BarSession[]>([]);

  useEffect(() => {
    loadBars();
  }, []);

  async function loadBars() {
    setLoading(true);
    try {
      const data = await getBars();
      setBars(data);
    } catch (e) {
      toast.error('加载酒吧列表失败');
    } finally {
      setLoading(false);
    }
  }

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      address: '',
      contact: '',
      schedule_cycle_type: 'weekly',
      sessions_per_night: 3,
      pool_type: 'open',
      default_price_per_show: 0,
      rest_days: [],
    });
    setSessions([]);
    setSessionForm(null);
    setDialogOpen(true);
  };

  const openEdit = async (bar: Bar) => {
    setEditing(bar);
    setForm({
      name: bar.name,
      address: bar.address || '',
      contact: bar.contact || '',
      schedule_cycle_type: bar.schedule_cycle_type,
      sessions_per_night: bar.sessions_per_night,
      pool_type: bar.pool_type,
      default_price_per_show: bar.default_price_per_show,
      rest_days: bar.rest_days || [],
    });
    try {
      const se = await getBarSessions(bar.id);
      setSessions(se);
    } catch {}
    setSessionForm(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) {
      toast.error('酒吧名称不能为空');
      return;
    }
    try {
      let barId = editing?.id;
      if (editing) {
        await updateBar(editing.id, form);
        toast.success('更新成功');
      } else {
        const created = await createBar(form as any);
        barId = created.id;
        toast.success('创建成功');
      }
      // Save sessions
      if (barId) {
        for (const s of sessions) {
          const payload: Record<string, any> = {
            bar_id: barId,
            weekday: s.weekday,
            session_number: s.session_number,
            session_name: s.session_name || null,
            start_time: s.start_time || null,
            end_time: s.end_time || null,
            singers_per_session: s.singers_per_session || 1,
            style_tags: s.style_tags || [],
          };
          if (s.id && !s.id.startsWith('temp_')) {
            payload.id = s.id;
          }
          await upsertBarSessions([payload]);
        }
      }
      setDialogOpen(false);
      setSessionForm(null);
      loadBars();
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  };

  function addSession(weekday: number | null) {
    const filtered = weekday !== null
      ? sessions.filter((s) => s.weekday === weekday)
      : sessions.filter((s) => s.weekday === null);
    const maxNum = filtered.reduce((m, s) => Math.max(m, s.session_number), 0);
    const newSession: BarSession = {
      id: `temp_${Date.now()}`,
      bar_id: editing?.id || '',
      weekday,
      session_number: maxNum + 1,
      session_name: weekday !== null ? `${WEEKDAYS[weekday]} 第${maxNum + 1}节` : `第${maxNum + 1}节`,
      start_time: '20:00',
      end_time: '22:00',
      singers_per_session: 1,
      style_tags: [],
      created_at: new Date().toISOString(),
    };
    setSessions([...sessions, newSession]);
    setSessionForm({
      id: newSession.id,
      weekday,
      session_number: newSession.session_number,
      session_name: newSession.session_name || '',
      start_time: newSession.start_time || '',
      end_time: newSession.end_time || '',
      singers_per_session: newSession.singers_per_session || 1,
      style_tags: [],
    });
  }

  function openSessionEdit(s: BarSession) {
    setSessionForm({
      id: s.id,
      weekday: s.weekday,
      session_number: s.session_number,
      session_name: s.session_name || '',
      start_time: s.start_time || '',
      end_time: s.end_time || '',
      singers_per_session: s.singers_per_session || 1,
      style_tags: s.style_tags || [],
    });
  }

  function saveSessionForm() {
    if (!sessionForm) return;
    setSessions((prev) => prev.map((s) => s.id === sessionForm.id ? {
      ...s,
      session_name: sessionForm.session_name || null,
      start_time: sessionForm.start_time || null,
      end_time: sessionForm.end_time || null,
      singers_per_session: sessionForm.singers_per_session,
      style_tags: sessionForm.style_tags,
    } : s));
    setSessionForm(null);
  }

  async function removeSession(s: BarSession) {
    if (!s.id.startsWith('temp_')) {
      try { await deleteBarSession(s.id); } catch {}
    }
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
  }

  function toggleStyleTag(tag: string) {
    if (!sessionForm) return;
    const set = new Set(sessionForm.style_tags);
    if (set.has(tag)) set.delete(tag); else set.add(tag);
    setSessionForm({ ...sessionForm, style_tags: Array.from(set) });
  }

  function toggleRestDay(day: number) {
    const current = form.rest_days || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    setForm({ ...form, rest_days: next });
  }

  const genericSessions = sessions.filter((s) => s.weekday === null);
  const weekdaySessions: Record<number, BarSession[]> = {};
  for (let i = 0; i <= 6; i++) weekdaySessions[i] = sessions.filter((s) => s.weekday === i);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该酒吧？相关排班数据也将一并删除。')) return;
    try {
      await deleteBar(id);
      toast.success('删除成功');
      loadBars();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  if (loading) return <div className="text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-4 pb-6">
      <div className="px-4 pt-2">
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-bold text-balance">酒吧管理</h2>
            <p className="text-sm text-muted-foreground">管理你合作的所有酒吧</p>
          </div>
          <Button className="h-11 text-sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            新增酒吧
          </Button>
        </div>
      </div>
      <div className="px-4">

      {bars.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            暂无酒吧，点击上方按钮新增
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bars.map((bar) => (
            <Card key={bar.id} className="h-full flex flex-col">
              <CardContent className="p-4 flex flex-col flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-5 w-5 text-primary shrink-0" />
                    <h3 className="font-semibold truncate">{bar.name}</h3>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(bar)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(bar.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{bar.address || '暂无地址'}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {bar.schedule_cycle_type === 'weekly' ? '每周排班' : '每月排班'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {bar.sessions_per_night}节/晚
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {bar.pool_type === 'closed' ? '封闭池' : '开放池'}
                  </span>
                </div>
                <div className="mt-auto pt-3">
                  <Link to={`/bars/${bar.id}`}>
                    <Button variant="outline" size="sm" className="w-full">
                      查看详情
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>

      <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">{editing ? '编辑酒吧' : '新增酒吧'}</SheetTitle>
            <SheetDescription>填写酒吧基本信息并配置节次</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="space-y-2">
              <Label>酒吧名称 *</Label>
              <Input className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>地址</Label>
              <Input className="h-11" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>联系方式</Label>
              <Input className="h-11" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>排班周期</Label>
                <Select value={form.schedule_cycle_type} onValueChange={(v: any) => setForm({ ...form, schedule_cycle_type: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">一周一排</SelectItem>
                    <SelectItem value="monthly">一月一排</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>每晚节数</Label>
                <Input className="h-11" type="number" min={1} max={10} value={form.sessions_per_night} onChange={(e) => setForm({ ...form, sessions_per_night: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>歌手池类型</Label>
                <Select value={form.pool_type} onValueChange={(v: any) => setForm({ ...form, pool_type: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">开放型（可外部顶班）</SelectItem>
                    <SelectItem value="closed">封闭型（仅内部调配）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>统一单价（元/场）</Label>
                <Input className="h-11" type="number" min={0} value={form.default_price_per_show} onChange={(e) => setForm({ ...form, default_price_per_show: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>

            {/* 休息日 */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Label>休息日</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((label, idx) => (
                  <div key={idx} className="flex items-center space-x-1.5">
                    <Checkbox id={`rest-${idx}`} checked={(form.rest_days || []).includes(idx)} onCheckedChange={() => toggleRestDay(idx)} />
                    <label htmlFor={`rest-${idx}`} className="text-sm cursor-pointer">{label}</label>
                  </div>
                ))}
              </div>
            </div>

            {/* 通用节次配置 */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <Label>通用节次配置</Label>
                <Button size="sm" variant="outline" onClick={() => addSession(null)}><Plus className="h-3.5 w-3.5 mr-1" />新增通用节次</Button>
              </div>
              {genericSessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无通用配置</p>
              ) : (
                <div className="space-y-1">
                  {genericSessions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-2 border border-border rounded-md text-sm">
                      <div className="min-w-0">
                        <span>{s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `(${s.start_time}~${s.end_time})` : ''}</span>
                        <span className="text-xs text-muted-foreground ml-2">需{s.singers_per_session}人 · {s.style_tags?.join(', ') || '不限'}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openSessionEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeSession(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 按星期特殊配置 */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Label>按星期特殊配置</Label>
              <div className="space-y-3">
                {WEEKDAYS.map((label, idx) => (
                  <div key={idx} className="border border-border rounded-md p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{label}</span>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addSession(idx)}><Plus className="h-3 w-3 mr-1" />添加覆盖</Button>
                    </div>
                    {weekdaySessions[idx].length === 0 ? (
                      <p className="text-xs text-muted-foreground">使用通用配置</p>
                    ) : (
                      <div className="space-y-1">
                        {weekdaySessions[idx].map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-1.5 bg-muted/30 rounded text-sm">
                            <div className="min-w-0">
                              <span>{s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `(${s.start_time}~${s.end_time})` : ''}</span>
                              <span className="text-xs text-muted-foreground ml-2">需{s.singers_per_session}人 · {s.style_tags?.join(', ') || '不限'}</span>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openSessionEdit(s)}><Pencil className="h-3 w-3" /></Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeSession(s)}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Button className="w-full h-12 text-base" onClick={handleSubmit}>
              {editing ? '保存修改' : '创建酒吧'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 节次编辑弹窗 */}
      <Sheet open={!!sessionForm} onOpenChange={(open) => { if (!open) setSessionForm(null); }}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-left">编辑节次</SheetTitle>
          </SheetHeader>
          {sessionForm && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div className="space-y-2">
                <Label>节次名称</Label>
                <Input className="h-11" value={sessionForm.session_name} onChange={(e) => setSessionForm({ ...sessionForm, session_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>开始时间</Label><Input className="h-11" type="time" value={sessionForm.start_time} onChange={(e) => setSessionForm({ ...sessionForm, start_time: e.target.value })} /></div>
                <div className="space-y-2"><Label>结束时间</Label><Input className="h-11" type="time" value={sessionForm.end_time} onChange={(e) => setSessionForm({ ...sessionForm, end_time: e.target.value })} /></div>
              </div>
              <div className="space-y-2">
                <Label>所需歌手人数</Label>
                <Input className="h-11" type="number" min={1} value={sessionForm.singers_per_session} onChange={(e) => setSessionForm({ ...sessionForm, singers_per_session: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="space-y-2">
                <Label>风格要求（点击添加/移除，拖拽或按钮调整优先级顺序）</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_STYLES.map((tag) => (
                    <button key={tag} type="button" onClick={() => toggleStyleTag(tag)}
                      className={`text-sm px-3 py-2 rounded-lg border min-h-[40px] ${sessionForm.style_tags.includes(tag) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'}`}>
                      {tag}
                    </button>
                  ))}
                </div>
                {/* Priority order display */}
                {sessionForm.style_tags.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-xs text-muted-foreground">优先级顺序（越靠前越优先）：</div>
                    <div className="flex flex-wrap gap-2">
                      {sessionForm.style_tags.map((tag, idx) => (
                        <div key={tag} className="flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                          <span className="text-xs font-medium">{idx + 1}</span>
                          <span>{tag}</span>
                          <div className="flex flex-col ml-1">
                            {idx > 0 && (
                              <button type="button" onClick={() => {
                                const arr = [...sessionForm.style_tags];
                                [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
                                setSessionForm({ ...sessionForm, style_tags: arr });
                              }} className="leading-none text-[10px] opacity-60 hover:opacity-100">▲</button>
                            )}
                            {idx < sessionForm.style_tags.length - 1 && (
                              <button type="button" onClick={() => {
                                const arr = [...sessionForm.style_tags];
                                [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                                setSessionForm({ ...sessionForm, style_tags: arr });
                              }} className="leading-none text-[10px] opacity-60 hover:opacity-100">▼</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <Button className="w-full h-12 text-base" onClick={saveSessionForm}>保存节次</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
