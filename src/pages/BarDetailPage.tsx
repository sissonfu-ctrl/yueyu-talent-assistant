import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getBarById, getBarSessions, getSchedules, getArtists, getArtistBarLinks, getBarArtistPrices, updateBar, upsertBarSessions, upsertBarArtistPrice, getAssignments, deleteBarSession } from '@/services/database';
import type { Bar, BarSession, Schedule, Artist, BarArtistPrice } from '@/types/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Pencil } from 'lucide-react';
import { ALL_STYLES } from '@/lib/schedule';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function BarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'schedules';

  const [bar, setBar] = useState<Bar | null>(null);
  const [sessions, setSessions] = useState<BarSession[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [poolArtistIds, setPoolArtistIds] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<BarArtistPrice[]>([]);
  const [loading, setLoading] = useState(true);

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<BarSession | null>(null);
  const [activeWeekday, setActiveWeekday] = useState<number | null>(null);
  const [sessionForm, setSessionForm] = useState({
    session_number: 1,
    session_name: '',
    start_time: '',
    end_time: '',
    singers_per_session: 1,
    style_tags: [] as string[],
  });

  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [priceForm, setPriceForm] = useState({ artist_id: '', price: 0 });

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
    if (!id) return;
    setLoading(true);
    try {
      const [b, se, sc, a, links, pr] = await Promise.all([
        getBarById(id),
        getBarSessions(id),
        getSchedules(id),
        getArtists(),
        getArtistBarLinks(undefined, id),
        getBarArtistPrices(id),
      ]);
      setBar(b);
      setSessions(se);
      setSchedules(sc);
      setArtists(a);
      setPoolArtistIds(new Set(links.map((l) => l.artist_id)));
      setPrices(pr);
    } finally {
      setLoading(false);
    }
  }

  const poolArtists = artists.filter((a) => poolArtistIds.has(a.id));
  const availableArtists = artists.filter((a) => !poolArtistIds.has(a.id));

  const getArtistPrice = (artistId: string) => {
    const p = prices.find((pr) => pr.artist_id === artistId);
    return p ? p.price_per_show : (bar?.default_price_per_show || 0);
  };

  async function saveBarSettings() {
    if (!bar || !id) return;
    try {
      await updateBar(id, {
        name: bar.name,
        address: bar.address,
        contact: bar.contact,
        schedule_cycle_type: bar.schedule_cycle_type,
        sessions_per_night: bar.sessions_per_night,
        pool_type: bar.pool_type,
        default_price_per_show: bar.default_price_per_show,
        rest_days: bar.rest_days,
      });
      toast.success('酒吧设置已保存');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function addToPool(artistId: string) {
    if (!id) return;
    try {
      await upsertBarArtistPrice({ bar_id: id, artist_id: artistId, price_per_show: bar?.default_price_per_show || 0 });
      await loadData();
      toast.success('已加入歌手池');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removeFromPool(artistId: string) {
    if (!id) return;
    if (!confirm('确认从歌手池移除该歌手？')) return;
    try {
      await deleteBarSession(artistId);
      await loadData();
      toast.success('已移除');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function openSessionDialog(s?: BarSession, weekday?: number | null) {
    if (s) {
      setEditingSession(s);
      setActiveWeekday(s.weekday ?? null);
      setSessionForm({
        session_number: s.session_number,
        session_name: s.session_name || '',
        start_time: s.start_time || '',
        end_time: s.end_time || '',
        singers_per_session: s.singers_per_session || 1,
        style_tags: s.style_tags || [],
      });
    } else {
      setEditingSession(null);
      setActiveWeekday(weekday ?? null);
      setSessionForm({
        session_number: getNextSessionNumber(weekday),
        session_name: '',
        start_time: '',
        end_time: '',
        singers_per_session: 1,
        style_tags: [],
      });
    }
    setSessionDialogOpen(true);
  }

  function getNextSessionNumber(weekday?: number | null): number {
    const filtered = weekday !== undefined && weekday !== null
      ? sessions.filter((s) => s.weekday === weekday)
      : sessions.filter((s) => s.weekday === null);
    const max = filtered.reduce((m, s) => Math.max(m, s.session_number), 0);
    return max + 1;
  }

  async function handleSessionSubmit() {
    if (!id) return;
    try {
      const payload: Record<string, any> = {
        bar_id: id,
        weekday: activeWeekday,
        session_number: sessionForm.session_number,
        session_name: sessionForm.session_name || null,
        start_time: sessionForm.start_time || null,
        end_time: sessionForm.end_time || null,
        singers_per_session: sessionForm.singers_per_session,
        style_tags: sessionForm.style_tags,
      };
      if (editingSession?.id) {
        payload.id = editingSession.id;
      }
      await upsertBarSessions([payload]);
      await loadData();
      setSessionDialogOpen(false);
      toast.success('节次配置已保存');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function deleteSession(s: BarSession) {
    if (!confirm('确认删除此节次配置？')) return;
    try {
      await deleteBarSession(s.id);
      await loadData();
      toast.success('已删除');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function savePrice() {
    if (!id) return;
    try {
      await upsertBarArtistPrice({ bar_id: id, artist_id: priceForm.artist_id, price_per_show: priceForm.price });
      await loadData();
      setPriceDialogOpen(false);
      toast.success('单价已设置');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function toggleRestDay(day: number) {
    if (!bar) return;
    const current = bar.rest_days || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    setBar({ ...bar, rest_days: next });
  }

  function toggleStyleTag(tag: string) {
    const set = new Set(sessionForm.style_tags);
    if (set.has(tag)) set.delete(tag); else set.add(tag);
    setSessionForm({ ...sessionForm, style_tags: Array.from(set) });
  }

  // Group sessions by weekday
  const genericSessions = sessions.filter((s) => s.weekday === null);
  const weekdaySessions: Record<number, BarSession[]> = {};
  for (let i = 0; i <= 6; i++) {
    weekdaySessions[i] = sessions.filter((s) => s.weekday === i);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!bar) return <div className="p-4 text-muted-foreground">酒吧不存在</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-balance">{bar.name}</h2>
        <p className="text-sm text-muted-foreground">{bar.address || '暂无地址'}</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="schedules">排班版本</TabsTrigger>
          <TabsTrigger value="pool">歌手池</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">排班版本</h3>
          </div>
          {schedules.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">暂无排班记录</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <Card key={s.id} className={s.is_current ? 'border-primary' : ''}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.period_label}</div>
                      <div className="text-xs text-muted-foreground">{s.period_start} ~ {s.period_end}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.is_current && <span className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground">当前</span>}
                      <span className="px-2 py-0.5 text-xs rounded bg-muted">{s.status === 'published' ? '已发布' : '草稿'}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pool" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">本店歌手池（{poolArtists.length}人）</h3>
          </div>
          {poolArtists.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">暂无歌手，请从下方添加</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {poolArtists.map((a) => (
                <Card key={a.id}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.style_tags.join(' / ') || '无风格标签'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{getArtistPrice(a.id)}元/场</span>
                      <Button variant="ghost" size="sm" onClick={() => { setPriceForm({ artist_id: a.id, price: getArtistPrice(a.id) }); setPriceDialogOpen(true); }}>改价</Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeFromPool(a.id)}>移除</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>基本信息</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>酒吧名称</Label>
                  <Input value={bar.name} onChange={(e) => setBar({ ...bar, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>联系方式</Label>
                  <Input value={bar.contact || ''} onChange={(e) => setBar({ ...bar, contact: e.target.value })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>地址</Label>
                  <Input value={bar.address || ''} onChange={(e) => setBar({ ...bar, address: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>排班周期</Label>
                  <Select value={bar.schedule_cycle_type} onValueChange={(v: any) => setBar({ ...bar, schedule_cycle_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">一周一排</SelectItem>
                      <SelectItem value="monthly">一月一排</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>歌手池类型</Label>
                  <Select value={bar.pool_type} onValueChange={(v: any) => setBar({ ...bar, pool_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">开放型</SelectItem>
                      <SelectItem value="closed">封闭型</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>统一单价（元/场）</Label>
                  <Input type="number" value={bar.default_price_per_show} onChange={(e) => setBar({ ...bar, default_price_per_show: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <Label>每晚节数（默认）</Label>
                  <Input type="number" value={bar.sessions_per_night} onChange={(e) => setBar({ ...bar, sessions_per_night: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>休息日</Label>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((label, idx) => (
                      <div key={idx} className="flex items-center space-x-1.5">
                        <Checkbox id={`rest-${idx}`} checked={(bar.rest_days || []).includes(idx)} onCheckedChange={() => toggleRestDay(idx)} />
                        <label htmlFor={`rest-${idx}`} className="text-sm cursor-pointer">{label}</label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <Button onClick={saveBarSettings}><Save className="h-4 w-4 mr-1" />保存设置</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>通用节次配置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {genericSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无通用配置</p>
              ) : (
                genericSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 border border-border rounded-md">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `(${s.start_time}~${s.end_time})` : ''}</div>
                      <div className="text-xs text-muted-foreground">需{s.singers_per_session}人 · 风格优先级: {s.style_tags && s.style_tags.length > 0 ? (
                        <span>
                          <span className="text-primary font-medium">{s.style_tags[0]}</span>
                          {s.style_tags.slice(1).map(t => ` › ${t}`).join('')}
                        </span>
                      ) : '不限'}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openSessionDialog(s, null)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteSession(s)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))
              )}
              <Button size="sm" variant="outline" onClick={() => openSessionDialog(undefined, null)}><Plus className="h-4 w-4 mr-1" />新增通用节次</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>按星期特殊配置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {WEEKDAYS.map((label, idx) => (
                <div key={idx} className="border border-border rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{label}</span>
                    <Button size="sm" variant="ghost" onClick={() => openSessionDialog(undefined, idx)}><Plus className="h-3.5 w-3.5 mr-1" />添加覆盖</Button>
                  </div>
                  {weekdaySessions[idx].length === 0 ? (
                    <p className="text-xs text-muted-foreground">使用通用配置</p>
                  ) : (
                    <div className="space-y-1">
                      {weekdaySessions[idx].map((s) => (
                        <div key={s.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                          <div className="min-w-0">
                            <span className="text-sm">{s.session_name || `第${s.session_number}节`} {s.start_time && s.end_time ? `(${s.start_time}~${s.end_time})` : ''}</span>
                            <span className="text-xs text-muted-foreground ml-2">需{s.singers_per_session}人 · {s.style_tags && s.style_tags.length > 0 ? (
                              <span>
                                <span className="text-primary font-medium">{s.style_tags[0]}</span>
                                {s.style_tags.slice(1).map(t => ` › ${t}`).join('')}
                              </span>
                            ) : '不限'}</span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openSessionDialog(s, idx)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteSession(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingSession ? '编辑节次' : '新增节次'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>应用星期</Label>
              <Select value={activeWeekday === null ? 'generic' : String(activeWeekday)} onValueChange={(v) => setActiveWeekday(v === 'generic' ? null : parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">通用（所有天）</SelectItem>
                  {WEEKDAYS.map((label, idx) => (<SelectItem key={idx} value={String(idx)}>{label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>节次名称</Label>
              <Input value={sessionForm.session_name} onChange={(e) => setSessionForm({ ...sessionForm, session_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>开始时间</Label><Input type="time" value={sessionForm.start_time} onChange={(e) => setSessionForm({ ...sessionForm, start_time: e.target.value })} /></div>
              <div className="space-y-2"><Label>结束时间</Label><Input type="time" value={sessionForm.end_time} onChange={(e) => setSessionForm({ ...sessionForm, end_time: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>所需歌手人数</Label>
              <Input type="number" min={1} value={sessionForm.singers_per_session} onChange={(e) => setSessionForm({ ...sessionForm, singers_per_session: parseInt(e.target.value) || 1 })} />
            </div>
            <div className="space-y-2">
              <Label>风格要求（点击添加/移除，调整优先级顺序）</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_STYLES.map((tag) => (
                  <button key={tag} type="button" onClick={() => toggleStyleTag(tag)}
                    className={`text-xs px-3 py-1 rounded border ${sessionForm.style_tags.includes(tag) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'}`}>
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
                      <div key={tag} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20">
                        <span className="text-[10px] font-medium">{idx + 1}</span>
                        <span>{tag}</span>
                        <div className="flex flex-col ml-0.5">
                          {idx > 0 && (
                            <button type="button" onClick={() => {
                              const arr = [...sessionForm.style_tags];
                              [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
                              setSessionForm({ ...sessionForm, style_tags: arr });
                            }} className="leading-none text-[8px] opacity-60 hover:opacity-100">▲</button>
                          )}
                          {idx < sessionForm.style_tags.length - 1 && (
                            <button type="button" onClick={() => {
                              const arr = [...sessionForm.style_tags];
                              [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                              setSessionForm({ ...sessionForm, style_tags: arr });
                            }} className="leading-none text-[8px] opacity-60 hover:opacity-100">▼</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleSessionSubmit}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>设置专属单价</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>单价（元/场）</Label>
              <Input type="number" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: parseFloat(e.target.value) || 0 })} />
              <p className="text-xs text-muted-foreground">不设置则使用酒吧统一价 {bar.default_price_per_show} 元</p>
            </div>
            <Button className="w-full" onClick={savePrice}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
