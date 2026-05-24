import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getArtistById, createArtist, updateArtist, getBars, getArtistBarLinks, setArtistBars, getAvailabilities, createAvailability, updateAvailability, deleteAvailability, deleteAllArtistAvailabilities } from '@/services/database';
import type { Artist, Bar, ArtistAvailability } from '@/types/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Save, Plus, Trash2, Upload, Download } from 'lucide-react';
import { ALL_STYLES } from '@/lib/schedule';

const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function ArtistEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const [artist, setArtist] = useState<Partial<Artist>>({
    name: '',
    phone: '',
    type: 'singer',
    style_tags: [],
    fixed_bar_id: null,
  });
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedBars, setSelectedBars] = useState<string[]>([]);
  const [availabilities, setAvailabilities] = useState<ArtistAvailability[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [availDialogOpen, setAvailDialogOpen] = useState(false);
  const [editingAvail, setEditingAvail] = useState<ArtistAvailability | null>(null);
  const [availForm, setAvailForm] = useState<Partial<ArtistAvailability>>({
    availability_type: 'fixed',
    day_of_week: 1,
    specific_date: '',
    available_start: '20:00',
    available_end: '23:00',
    is_available: true,
    note: '',
  });

  const artistId = id && id !== 'new' ? id : '';

  useEffect(() => {
    getBars().then(setBars);
    if (!isNew && artistId) {
      loadArtist(artistId);
    } else {
      setLoading(false);
    }
  }, [isNew, artistId]);

  async function loadArtist(aid: string) {
    try {
      const [a, links, avails] = await Promise.all([
        getArtistById(aid),
        getArtistBarLinks(aid),
        getAvailabilities(aid),
      ]);
      if (a) {
        setArtist(a);
        setSelectedBars(links.map((l) => l.bar_id));
        setAvailabilities(avails);
      }
    } catch (e) {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }

  const saveArtist = async () => {
    if (!artist.name) {
      toast.error('姓名不能为空');
      return;
    }
    try {
      let savedId = artistId;
      if (isNew) {
        const created = await createArtist(artist as any);
        savedId = created.id;
        await setArtistBars(savedId, selectedBars);
        toast.success('创建成功');
        navigate(`/artists/${savedId}/edit`);
      } else {
        await updateArtist(artistId, artist);
        await setArtistBars(artistId, selectedBars);
        toast.success('保存成功');
      }
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  };

  const openAvailDialog = (a?: ArtistAvailability) => {
    if (a) {
      setEditingAvail(a);
      setAvailForm({ ...a });
    } else {
      setEditingAvail(null);
      setAvailForm({
        availability_type: 'fixed',
        day_of_week: 1,
        specific_date: '',
        available_start: '20:00',
        available_end: '23:00',
        is_available: true,
        note: '',
      });
    }
    setAvailDialogOpen(true);
  };

  const saveAvailability = async () => {
    if (!artistId) {
      toast.error('请先保存艺人基本信息');
      return;
    }
    const payload: Partial<ArtistAvailability> = {
      ...availForm,
      artist_id: artistId,
    };
    if (availForm.availability_type === 'fixed') {
      payload.specific_date = null;
    } else {
      payload.day_of_week = null;
    }
    try {
      if (editingAvail) {
        await updateAvailability(editingAvail.id, payload);
      } else {
        await createAvailability(payload as any);
      }
      setAvailDialogOpen(false);
      const avails = await getAvailabilities(artistId);
      setAvailabilities(avails);
      toast.success('保存成功');
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  };

  const handleDeleteAvail = async (id: string) => {
    if (!confirm('确认删除该档期？')) return;
    try {
      await deleteAvailability(id);
      setAvailabilities((prev) => prev.filter((a) => a.id !== id));
      toast.success('已删除');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !artistId) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      await deleteAllArtistAvailabilities(artistId);

      const newAvails: Partial<ArtistAvailability>[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const type = String(row[0]).trim().toLowerCase();
        if (type === 'fixed' || type === '长期') {
          const dayMap: Record<string, number> = { '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6 };
          const day = dayMap[String(row[1]).trim()];
          if (day === undefined) continue;
          newAvails.push({
            artist_id: artistId,
            availability_type: 'fixed',
            day_of_week: day,
            available_start: row[2] || null,
            available_end: row[3] || null,
            is_available: row[4] !== false && row[4] !== '否',
            note: row[5] || null,
          });
        } else if (type === 'temporary' || type === '临时') {
          newAvails.push({
            artist_id: artistId,
            availability_type: 'temporary',
            specific_date: row[1] || null,
            available_start: row[2] || null,
            available_end: row[3] || null,
            is_available: row[4] !== false && row[4] !== '否',
            note: row[5] || null,
          });
        }
      }

      for (const av of newAvails) {
        await createAvailability(av as any);
      }

      const avails = await getAvailabilities(artistId);
      setAvailabilities(avails);
      toast.success(`导入成功，共 ${newAvails.length} 条档期`);
    } catch (err: any) {
      toast.error('导入失败：' + err.message);
    }
    e.target.value = '';
  }, [artistId]);

  const exportTemplate = () => {
    const rows = [
      ['类型(fixed/temporary)', '星期/日期', '可排开始时间', '可排结束时间', '是否可排(是/否)', '备注'],
      ['fixed', '周一', '20:00', '23:00', '是', ''],
      ['fixed', '周五', '20:00', '23:00', '是', ''],
      ['temporary', '2026-06-13', '', '', '否', '请假'],
    ];
    let csv = '\uFEFF' + rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '档期导入模板.csv';
    link.click();
  };

  if (loading) return <div className="text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-balance">{isNew ? '新增艺人' : '编辑艺人'}</h2>
        <Button onClick={saveArtist}><Save className="h-4 w-4 mr-1" />保存</Button>
      </div>

      <Tabs defaultValue="basic">
        <TabsList className="w-full md:w-auto flex flex-wrap h-auto gap-1">
          <TabsTrigger value="basic">基础信息</TabsTrigger>
          {!isNew && <TabsTrigger value="schedule">档期配置</TabsTrigger>}
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>姓名 *</Label>
                  <Input value={artist.name} onChange={(e) => setArtist({ ...artist, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>电话</Label>
                  <Input value={artist.phone || ''} onChange={(e) => setArtist({ ...artist, phone: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>类型</Label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={artist.type === 'singer'} onChange={() => setArtist({ ...artist, type: 'singer' })} />
                      <span className="text-sm">歌手</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={artist.type === 'musician'} onChange={() => setArtist({ ...artist, type: 'musician' })} />
                      <span className="text-sm">乐手</span>
                    </label>
                  </div>
                </div>
                {artist.type === 'musician' && (
                  <div className="space-y-2">
                    <Label>固定分配酒吧</Label>
                    <select
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      value={artist.fixed_bar_id || ''}
                      onChange={(e) => setArtist({ ...artist, fixed_bar_id: e.target.value || null })}
                    >
                      <option value="">不固定</option>
                      {bars.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {artist.type === 'singer' && (
                <div className="space-y-2">
                  <Label>所属合作酒吧</Label>
                  <div className="flex flex-wrap gap-3 mt-1">
                    {bars.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={selectedBars.includes(b.id)}
                          onCheckedChange={(checked) => {
                            if (checked) setSelectedBars([...selectedBars, b.id]);
                            else setSelectedBars(selectedBars.filter((x) => x !== b.id));
                          }}
                        />
                        <span className="text-sm">{b.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>擅长风格标签</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_STYLES.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const set = new Set(artist.style_tags || []);
                        if (set.has(tag)) set.delete(tag); else set.add(tag);
                        setArtist({ ...artist, style_tags: Array.from(set) });
                      }}
                      className={`text-xs px-3 py-1 rounded border ${(artist.style_tags || []).includes(tag) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {!isNew && (
          <TabsContent value="schedule" className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold">档期配置</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportTemplate}><Download className="h-3.5 w-3.5 mr-1" />下载模板</Button>
                <Label className="cursor-pointer">
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileImport} />
                  <Button size="sm" variant="outline" asChild><span><Upload className="h-3.5 w-3.5 mr-1" />导入Excel</span></Button>
                </Label>
                <Button size="sm" onClick={() => openAvailDialog()}><Plus className="h-3.5 w-3.5 mr-1" />新增档期</Button>
              </div>
            </div>

            {availabilities.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground">暂无档期配置</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {availabilities.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium flex items-center gap-2">
                          {a.availability_type === 'fixed' ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted">长期固定</span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">临时特殊</span>
                          )}
                          <span>
                            {a.availability_type === 'fixed'
                              ? weekDays[a.day_of_week || 0]
                              : a.specific_date}
                          </span>
                          {!a.is_available && <span className="text-xs text-destructive">不可排</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {a.available_start && a.available_end
                            ? `${a.available_start} ~ ${a.available_end}`
                            : '全天'}{a.note ? ` · ${a.note}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openAvailDialog(a)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteAvail(a.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={availDialogOpen} onOpenChange={setAvailDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAvail ? '编辑档期' : '新增档期'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>档期类型</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={availForm.availability_type === 'fixed'} onChange={() => setAvailForm({ ...availForm, availability_type: 'fixed' })} />
                  <span className="text-sm">长期固定（按星期）</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={availForm.availability_type === 'temporary'} onChange={() => setAvailForm({ ...availForm, availability_type: 'temporary' })} />
                  <span className="text-sm">临时特殊（按日期）</span>
                </label>
              </div>
            </div>

            {availForm.availability_type === 'fixed' ? (
              <div className="space-y-2">
                <Label>星期</Label>
                <select className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" value={availForm.day_of_week || 1} onChange={(e) => setAvailForm({ ...availForm, day_of_week: parseInt(e.target.value) })}>
                  {weekDays.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>具体日期</Label>
                <Input type="date" value={availForm.specific_date || ''} onChange={(e) => setAvailForm({ ...availForm, specific_date: e.target.value })} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>可排开始时间</Label>
                <Input type="time" value={availForm.available_start || ''} onChange={(e) => setAvailForm({ ...availForm, available_start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>可排结束时间</Label>
                <Input type="time" value={availForm.available_end || ''} onChange={(e) => setAvailForm({ ...availForm, available_end: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox checked={availForm.is_available !== false} onCheckedChange={(v) => setAvailForm({ ...availForm, is_available: v === true })} />
                <Label className="cursor-pointer">该时段可排</Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>备注</Label>
              <Input value={availForm.note || ''} onChange={(e) => setAvailForm({ ...availForm, note: e.target.value })} />
            </div>

            <Button className="w-full" onClick={saveAvailability}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pencil(props: { className?: string }) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
  );
}
