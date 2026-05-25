import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { getArtistById, createArtist, updateArtist, getBars, getArtistBarLinks, setArtistBars, getAvailabilities } from '@/services/database';
import type { Artist, Bar, ArtistAvailability } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Save, CalendarDays, ArrowRight } from 'lucide-react';
import { ALL_STYLES } from '@/lib/schedule';

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

  const artistId = id && id !== 'new' ? id : '';
  const location = useLocation();

  useEffect(() => {
    getBars().then(setBars);
    if (!isNew && artistId) {
      loadArtist(artistId);
    } else {
      setLoading(false);
    }
  }, [isNew, artistId, location.key]);

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
        navigate('/artists');
      } else {
        await updateArtist(artistId, artist);
        await setArtistBars(artistId, selectedBars);
        toast.success('保存成功');
        navigate('/artists');
      }
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  };

  if (loading) return <div className="text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-balance">{isNew ? '新增艺人' : '编辑艺人'}</h2>
        <Button onClick={saveArtist}><Save className="h-4 w-4 mr-1" />保存</Button>
      </div>

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

      {!isNew && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">档期概览</span>
                <span className="text-xs text-muted-foreground">
                  （{availabilities.length} 条档期）
                </span>
              </div>
              <Link to="/artists/availabilities" className="text-xs text-primary hover:underline flex items-center gap-1">
                前往艺人档期管理 <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {availabilities.length > 0 && (
              <div className="mt-2 space-y-1">
                {availabilities.slice(0, 5).map((a) => (
                  <div key={a.id} className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${a.is_available ? 'bg-green-400' : 'bg-red-400'}`} />
                    {a.availability_type === 'fixed'
                      ? `每周${['日','一','二','三','四','五','六'][a.day_of_week || 0]}`
                      : a.specific_date}
                    {a.available_start && a.available_end && ` ${a.available_start}~${a.available_end}`}
                    {!a.is_available && ' · 不可排'}
                  </div>
                ))}
                {availabilities.length > 5 && (
                  <div className="text-xs text-muted-foreground">...还有 {availabilities.length - 5} 条</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
