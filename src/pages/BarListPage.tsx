import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBars, deleteBar, getBarSessions, upsertBarSessions, deleteBarSession, createBar, updateBar, getArtists, getArtistBarLinks, getBarArtistPrices, upsertBarArtistPrice, updateArtistBarPreferredSessions, linkArtistToBar, unlinkArtistFromBar } from '@/services/database';
import type { Bar, BarSession, Artist, ArtistBarLink, BarArtistPrice } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    replace_weekdays: [] as number[],
    settlement_mode: 'weekly' as 'weekly' | 'monthly',
  });
  const [selectedWeekday, setSelectedWeekday] = useState<number | null>(null);
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
      replace_weekdays: [],
      settlement_mode: 'weekly',
    });
    setSessions([]);
    setSessionForm(null);
    setSelectedWeekday(null);
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
      replace_weekdays: bar.replace_weekdays || [],
      settlement_mode: bar.settlement_mode || 'weekly',
    });
    try {
      const [se] = await Promise.all([
        getBarSessions(bar.id),
      ]);
      setSessions(se);
      loadPoolData(bar.id);
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
        await updateBar(editing.id, { ...form, replace_weekdays: form.replace_weekdays });
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
    // Use global max session_number so weekday-specific sessions get correct numbering
    // e.g., if generic has 第1/2/3节, a new Friday session should be session_number=4, not 1
    const maxNum = sessions.reduce((m, s) => Math.max(m, s.session_number), 0);
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

  // ── 歌手池状态（编辑弹窗内使用） ──
  const [poolArtistsAll, setPoolArtistsAll] = useState<Artist[]>([]);
  const [poolBarLinks, setPoolBarLinks] = useState<ArtistBarLink[]>([]);
  const [poolPrices, setPoolPrices] = useState<BarArtistPrice[]>([]);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [priceForm, setPriceForm] = useState({ artist_id: '', price: 0 });

  async function loadPoolData(barId: string) {
    try {
      const [a, links, pr] = await Promise.all([
        getArtists(),
        getArtistBarLinks(undefined, barId),
        getBarArtistPrices(barId),
      ]);
      setPoolArtistsAll(a);
      setPoolBarLinks(links);
      setPoolPrices(pr);
    } catch {}
  }

  const poolArtistIds = new Set(poolBarLinks.map((l) => l.artist_id));
  const poolArtists = poolArtistsAll.filter((a) => poolArtistIds.has(a.id));
  const availableArtists = poolArtistsAll.filter((a) => !poolArtistIds.has(a.id));

  const getPoolPrice = (artistId: string) => {
    const p = poolPrices.find((pr) => pr.artist_id === artistId);
    return p ? p.price_per_show : (editing?.default_price_per_show || 0);
  };

  const getPreferredSessions = (artistId: string): number[] => {
    const link = poolBarLinks.find((l) => l.artist_id === artistId);
    return link?.preferred_sessions?.length ? link.preferred_sessions : [];
  };

  async function addToPool(artistId: string) {
    if (!editing) return;
    try {
      await linkArtistToBar(artistId, editing.id);
      await upsertBarArtistPrice({ bar_id: editing.id, artist_id: artistId, price_per_show: editing.default_price_per_show || 0 });
      await loadPoolData(editing.id);
      toast.success('已加入歌手池');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removeFromPool(artistId: string) {
    if (!editing) return;
    if (!confirm('确认从歌手池移除该歌手？')) return;
    try {
      await unlinkArtistFromBar(artistId, editing.id);
      await loadPoolData(editing.id);
      toast.success('已移除');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function savePoolPrice() {
    if (!editing) return;
    try {
      await upsertBarArtistPrice({ bar_id: editing.id, artist_id: priceForm.artist_id, price_per_show: priceForm.price });
      await loadPoolData(editing.id);
      setPriceDialogOpen(false);
      toast.success('单价已设置');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleUpdatePreferred(artistId: string, sessions: number[]) {
    if (!editing) return;
    setPoolBarLinks((prev) =>
      prev.map((l) => (l.artist_id === artistId ? { ...l, preferred_sessions: sessions.length ? sessions : null } : l))
    );
    updateArtistBarPreferredSessions(artistId, editing.id, sessions.length ? sessions : null).catch((e: any) => {
      toast.error(e.message);
      loadPoolData(editing.id);
    });
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b shrink-0 text-left">
            <DialogTitle>{editing ? '编辑酒吧' : '新增酒吧'}</DialogTitle>
            <DialogDescription>
              {editing ? '修改基本信息、节次配置和歌手池' : '填写酒吧基本信息并配置节次'}
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="info" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-4 mt-2 shrink-0">
              <TabsTrigger value="info">基本信息</TabsTrigger>
              <TabsTrigger value="sessions">节次配置</TabsTrigger>
              {editing && <TabsTrigger value="pool">歌手池管理</TabsTrigger>}
            </TabsList>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {/* ── Tab 1: 基本信息 ── */}
              <TabsContent value="info" className="space-y-4 mt-0">
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
                  <div className="space-y-2">
                    <Label>结算方式</Label>
                    <div className="flex gap-4 mt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={form.settlement_mode === 'weekly'} onChange={() => setForm({ ...form, settlement_mode: 'weekly' })} />
                        <span className="text-sm">周结</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={form.settlement_mode === 'monthly'} onChange={() => setForm({ ...form, settlement_mode: 'monthly' })} />
                        <span className="text-sm">月结</span>
                      </label>
                    </div>
                  </div>
                </div>
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
              </TabsContent>

              {/* ── Tab 2: 节次配置 ── */}
              <TabsContent value="sessions" className="space-y-4 mt-0">
                <div className="space-y-2">
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

                <div className="space-y-3 pt-2 border-t border-border">
                  <Label>按星期特殊配置</Label>
                  <Select value={selectedWeekday !== null ? String(selectedWeekday) : ''} onValueChange={(v) => setSelectedWeekday(v ? parseInt(v) : null)}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="选择星期..." />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((label, idx) => {
                        const specCount = weekdaySessions[idx].length;
                        const genCount = genericSessions.length;
                        const isReplace = (form.replace_weekdays || []).includes(idx);
                        const totalCount = isReplace ? specCount : genCount + specCount;
                        return (
                          <SelectItem key={idx} value={String(idx)}>
                            <span className="flex items-center gap-2">
                              <span>{label}</span>
                              <span className="text-xs text-muted-foreground">
                                ({totalCount}节{isReplace ? '，覆盖' : ''})
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {selectedWeekday !== null && (() => {
                    const idx = selectedWeekday;
                    const label = WEEKDAYS[idx];
                    const specSessions = weekdaySessions[idx];
                    const specCount = specSessions.length;
                    const genCount = genericSessions.length;
                    const isReplace = (form.replace_weekdays || []).includes(idx);
                    const totalCount = isReplace ? specCount : genCount + specCount;
                    return (
                      <div className={`border rounded-md p-3 ${isReplace ? 'border-destructive/30 bg-destructive/5' : 'border-border'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{label}</span>
                            {isReplace ? (
                              <span className="text-sm font-medium text-destructive">共 {totalCount} 节（覆盖通用）</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">共 {totalCount} 节（通用{genCount}+特殊{specCount}）</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              <Checkbox id={`replace-list-${idx}`} checked={isReplace} onCheckedChange={() => toggleReplaceWeekday(idx)} />
                              <label htmlFor={`replace-list-${idx}`} className="text-xs cursor-pointer text-muted-foreground">覆盖通用</label>
                            </div>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addSession(idx)}><Plus className="h-3 w-3 mr-1" />添加覆盖</Button>
                          </div>
                        </div>
                        {!isReplace && genericSessions.length > 0 && (
                          <div className="mb-2">
                            <div className="text-[10px] text-muted-foreground mb-1">通用节次</div>
                            <div className="space-y-1 opacity-60">
                              {genericSessions.map((s) => (
                                <div key={s.id} className="flex items-center p-2 bg-muted/20 rounded border border-dashed border-border">
                                  <span className="text-sm text-muted-foreground">{s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `(${s.start_time}~${s.end_time})` : ''} · {s.singers_per_session}人</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {specCount > 0 && (
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-1">{label}特殊节次</div>
                            <div className="space-y-1">
                              {specSessions.map((s) => (
                                <div key={s.id} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
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
                          </div>
                        )}
                        {genCount === 0 && specCount === 0 && (
                          <p className="text-xs text-muted-foreground">暂无节次配置</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>

              {/* ── Tab 3: 歌手池管理（仅编辑时） ── */}
              {editing && (
                <TabsContent value="pool" className="space-y-4 mt-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">本店歌手池（{poolArtists.length}人）</h3>
                  </div>
                  {poolArtists.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-muted-foreground">暂无歌手，请从下方添加</CardContent></Card>
                  ) : (
                    <div className="space-y-2">
                      {poolArtists.map((a) => {
                        const prefSessions = getPreferredSessions(a.id);
                        const availablePrefs = [1, 2, 3, 4].filter((s) => !prefSessions.includes(s));
                        return (
                        <Card key={a.id}>
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{a.name}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {a.style_tags.join(' / ') || '无风格标签'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground">{getPoolPrice(a.id)}元/场</span>
                                <Button variant="ghost" size="sm" onClick={() => { setPriceForm({ artist_id: a.id, price: getPoolPrice(a.id) }); setPriceDialogOpen(true); }}>改价</Button>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeFromPool(a.id)}>移除</Button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground shrink-0">偏好节次：</span>
                              {prefSessions.length === 0 ? (
                                <span className="text-xs text-muted-foreground">(无)</span>
                              ) : (
                                prefSessions.map((sessionNum, idx) => (
                                  <span
                                    key={`${a.id}_${sessionNum}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs cursor-grab active:cursor-grabbing select-none group"
                                    draggable
                                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${a.id}:${idx}`)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const [sourceArtist, sourceIdxStr] = e.dataTransfer.getData('text/plain').split(':');
                                      if (sourceArtist !== a.id) return;
                                      const fromIdx = Number(sourceIdxStr);
                                      if (fromIdx === idx) return;
                                      const newSessions = [...prefSessions];
                                      const [moved] = newSessions.splice(fromIdx, 1);
                                      newSessions.splice(idx, 0, moved);
                                      handleUpdatePreferred(a.id, newSessions);
                                    }}
                                  >
                                    <span className="text-[10px] font-bold">#{idx + 1}</span>
                                    <span>第{sessionNum}节</span>
                                    <button
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-destructive ml-0.5"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdatePreferred(a.id, prefSessions.filter((s) => s !== sessionNum));
                                      }}
                                    >✕</button>
                                  </span>
                                ))
                              )}
                              {availablePrefs.length > 0 && (
                                <select
                                  className="text-xs border rounded px-1 py-0.5 bg-background"
                                  value=""
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (!v) return;
                                    handleUpdatePreferred(a.id, [...prefSessions, v]);
                                    e.target.value = '';
                                  }}
                                >
                                  <option value="">＋添加</option>
                                  {availablePrefs.map((s) => (
                                    <option key={s} value={s}>第{s}节</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )})}
                    </div>
                  )}
                  <div className="pt-4 border-t border-border">
                    <h3 className="font-semibold mb-2">可加入歌手池</h3>
                    {availableArtists.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无可用歌手，请先到艺人管理添加歌手</p>
                    ) : (
                      <div className="space-y-2">
                        {availableArtists.map((a) => (
                          <Card key={a.id}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{a.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{a.style_tags.join(' / ') || '无风格标签'}</div>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => addToPool(a.id)}>
                                <Plus className="h-3.5 w-3.5 mr-1" />加入
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
          <div className="px-4 py-3 border-t shrink-0">
            <Button className="w-full h-12 text-base" onClick={handleSubmit}>
              {editing ? '保存修改' : '创建酒吧'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 节次编辑弹窗（保留） */}
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

      {/* 改价弹窗 */}
      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>设置专属单价</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>单价（元/场）</Label>
              <Input type="number" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: parseFloat(e.target.value) || 0 })} />
              {editing && <p className="text-xs text-muted-foreground">不设置则使用酒吧统一价 {editing.default_price_per_show} 元</p>}
            </div>
            <Button className="w-full" onClick={savePoolPrice}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
