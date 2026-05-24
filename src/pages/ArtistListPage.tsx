import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getArtists, getBars, getArtistBarLinks, deleteArtist, deleteArtists } from '@/services/database';
import type { Artist, Bar } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Mic2, Guitar } from 'lucide-react';

export default function ArtistListPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [bars, setBars] = useState<Bar[]>([]);
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [a, b, allLinks] = await Promise.all([
        getArtists(),
        getBars(),
        getArtistBarLinks(),
      ]);
      setArtists(a);
      setBars(b);
      const linkMap: Record<string, string[]> = {};
      allLinks.forEach((l) => {
        if (!linkMap[l.artist_id]) linkMap[l.artist_id] = [];
        linkMap[l.artist_id].push(l.bar_id);
      });
      setLinks(linkMap);
    } catch (e) {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该艺人？')) return;
    try {
      await deleteArtist(id);
      toast.success('删除成功');
      loadData();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  const filtered = artists.filter((a) => {
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (search && !a.name.includes(search) && !a.phone?.includes(search)) return false;
    return true;
  });

  const allFilteredIds = filtered.map((a) => a.id);
  const isAllSelected = filtered.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 位艺人？`)) return;
    try {
      await deleteArtists(Array.from(selectedIds));
      toast.success(`已删除 ${selectedIds.size} 位艺人`);
      setSelectedIds(new Set());
      loadData();
    } catch (e: any) {
      toast.error('批量删除失败：' + e.message);
    }
  };

  if (loading) return <div className="text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-4 pb-6">
      <div className="px-4 pt-2">
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-bold text-balance">艺人管理</h2>
            <p className="text-sm text-muted-foreground">管理歌手和乐手信息</p>
          </div>
          <div className="flex gap-2">
            <Link to="/artists/availabilities" className="flex-1">
              <Button className="w-full h-11 text-sm" variant="outline">艺人档期</Button>
            </Link>
            <Link to="/artists/new" className="flex-1">
              <Button className="w-full h-11 text-sm"><Plus className="h-4 w-4 mr-2" />新增艺人</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4">
        <Input placeholder="搜索姓名/电话" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="singer">歌手</SelectItem>
            <SelectItem value="musician">乐手</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="mx-4"><CardContent className="p-8 text-center text-muted-foreground">暂无艺人</CardContent></Card>
      ) : (
        <div className="space-y-2 px-4">
          {/* Batch toolbar */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={isAllSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="全选"
              />
              <span className="text-sm text-muted-foreground">全选</span>
              {selectedIds.size > 0 && (
                <span className="text-sm text-primary">已选 {selectedIds.size} 位</span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-1" />
                批量删除
              </Button>
            )}
          </div>
          {filtered.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Checkbox
                    checked={selectedIds.has(a.id)}
                    onCheckedChange={() => toggleSelect(a.id)}
                    aria-label={`选择 ${a.name}`}
                  />
                  <div className="p-2 rounded-full bg-muted shrink-0">
                    {a.type === 'singer' ? <Mic2 className="h-4 w-4 text-primary" /> : <Guitar className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <span className="truncate">{a.name}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{a.type === 'singer' ? '歌手' : '乐手'}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.phone || '暂无电话'} · {a.style_tags.length > 0 ? a.style_tags.join(' / ') : '无风格标签'}
                    </div>
                    {links[a.id]?.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        合作酒吧: {links[a.id].map((bid) => bars.find((b) => b.id === bid)?.name).filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link to={`/artists/${a.id}/edit`}>
                    <Button variant="ghost" size="icon" className="h-9 w-9"><Pencil className="h-4 w-4" /></Button>
                  </Link>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => handleDelete(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
