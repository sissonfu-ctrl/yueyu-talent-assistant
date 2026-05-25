import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getArtists, getBars, getArtistBarLinks, deleteArtist, deleteArtists } from '@/services/database';
import type { Artist, Bar } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Mic2, Guitar } from 'lucide-react';

export default function ArtistListPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [bars, setBars] = useState<Bar[]>([]);
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState('all');
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

  // 动态计算标签 + 人数
  const tagStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let untagged = 0;
    artists.forEach((a) => {
      if (a.style_tags.length === 0) {
        untagged++;
      } else {
        a.style_tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });
    // 按人数降序排列
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { entries, untagged, total: artists.length };
  }, [artists]);

  // 当前可见的艺人列表（搜索 + 标签双层过滤）
  const visibleArtistIds = useMemo(() => {
    return new Set(
      artists
        .filter((a) => {
          if (search && !a.name.includes(search) && !a.phone?.includes(search)) return false;
          if (selectedTag === '未分类') return a.style_tags.length === 0;
          if (selectedTag !== 'all') return a.style_tags.includes(selectedTag);
          return true;
        })
        .map((a) => a.id)
    );
  }, [artists, search, selectedTag]);

  // 「全部」模式下的分区数据
  const sections = useMemo(() => {
    if (selectedTag !== 'all') return null;
    const result: { tag: string; artists: Artist[] }[] = [];
    tagStats.entries.forEach(([tag]) => {
      const list = artists.filter(
        (a) => a.style_tags.includes(tag) && (!search || a.name.includes(search) || a.phone?.includes(search))
      );
      if (list.length > 0) result.push({ tag, artists: list });
    });
    // 未分类
    const untaggedList = artists.filter(
      (a) => a.style_tags.length === 0 && (!search || a.name.includes(search) || a.phone?.includes(search))
    );
    if (untaggedList.length > 0) result.push({ tag: '未分类', artists: untaggedList });
    return result;
  }, [artists, search, selectedTag, tagStats]);

  // 单个标签模式下的扁平列表
  const filteredFlat = useMemo(() => {
    return artists.filter((a) => visibleArtistIds.has(a.id));
  }, [artists, visibleArtistIds]);

  const allVisibleIds = useMemo(() => {
    if (selectedTag === 'all' && sections) {
      return sections.flatMap((s) => s.artists.map((a) => a.id));
    }
    return filteredFlat.map((a) => a.id);
  }, [sections, filteredFlat, selectedTag]);

  const visibleCount = allVisibleIds.length;
  const isAllSelected = visibleCount > 0 && allVisibleIds.every((id) => selectedIds.has(id));

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
        allVisibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisibleIds.forEach((id) => next.add(id));
        return next;
      });
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

  // 艺人卡片渲染函数
  function renderArtistCard(a: Artist) {
    return (
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
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
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

      {/* Tag filter bar */}
      <div className="px-4 -mb-1">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedTag('all')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              selectedTag === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            全部{tagStats.total}
          </button>
          {tagStats.entries.map(([tag, count]) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                selectedTag === tag
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tag}{count}
            </button>
          ))}
          {tagStats.untagged > 0 && (
            <button
              onClick={() => setSelectedTag('未分类')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                selectedTag === '未分类'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              未分类{tagStats.untagged}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-4">
        <Input placeholder="搜索姓名/电话" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11" />
      </div>

      {/* Content */}
      {visibleCount === 0 ? (
        <Card className="mx-4"><CardContent className="p-8 text-center text-muted-foreground">暂无艺人</CardContent></Card>
      ) : (
        <div className="space-y-4 px-4">
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

          {/* 「全部」模式：按标签分区 */}
          {selectedTag === 'all' && sections ? (
            sections.map((section) => (
              <div key={section.tag} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {section.tag}
                  </span>
                  <span className="text-xs text-muted-foreground/60">· {section.artists.length}人</span>
                </div>
                <div className="space-y-2">
                  {section.artists.map(renderArtistCard)}
                </div>
              </div>
            ))
          ) : (
            /* 单标签模式：扁平列表 */
            <div className="space-y-2">
              {filteredFlat.map(renderArtistCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
